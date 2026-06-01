import os
import re
import requests as http
from pathlib import Path
from sqlalchemy import text

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Any
from sqlalchemy.orm import Session as DbSession

from backend.database.engine import engine, get_db
from backend.database import models as db_models
from backend.database import crud
from backend.pdf_extractor import extract_text
from backend.report_generator import build_decision_report_pdf
from multi_agent_system.orchestrator import run_society
from multi_agent_system.debate import (
    run_debate, extract_vendor_names, classify_documents, search_vendors, detect_category,
    draft_negotiation_email,
)

# ── Create / migrate DB on startup ────────────────────────────────────────────
db_models.Base.metadata.create_all(bind=engine)
# Add columns if upgrading from an older DB (idempotent)
for _ddl in (
    "ALTER TABLE step3_vendor_inputs ADD COLUMN vendor_text TEXT",
    "ALTER TABLE step2_agent_boards ADD COLUMN configs_json TEXT",
):
    with engine.connect() as _conn:
        try:
            _conn.execute(text(_ddl))
            _conn.commit()
        except Exception:
            pass  # column already exists

# Folder for uploaded files
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "backend" / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="AI Purchasing Society API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulateRequest(BaseModel):
    target:          str            = "Project Management Software"
    users:           int            = 100
    budget:          float          = 30000
    vendors:         List[str]      = ["Asana", "Monday.com"]
    selected_agents: Optional[List[str]] = None
    session_id:      Optional[str]  = None   # attach to a stored session for vendor_text


@app.get("/")
def root():
    return {"status": "AI Purchasing Society API is running"}


@app.post("/api/simulate")
def simulate(req: SimulateRequest, db: DbSession = Depends(get_db)):
    """
    Run the AI Purchasing Society deliberation.
    Pulls vendor_text from the session's uploaded PDF (if any).
    Calls real OpenRouter-powered agents when OPENROUTER_API_KEY is set,
    otherwise falls back to deterministic mock responses.
    """
    # Retrieve extracted PDF text from the session (if a file was uploaded)
    vendor_text = ""
    if req.session_id:
        session = crud.get_session(db, req.session_id)
        if session and session.step3 and session.step3.vendor_text:
            vendor_text = session.step3.vendor_text

    # Build the procurement brief fed to every agent
    brief = (
        f"Category: {req.target}\n"
        f"Number of users: {req.users}\n"
        f"Annual budget: €{req.budget:,.0f}\n"
        f"Vendors under consideration: {', '.join(req.vendors)}"
    )

    result = run_society(
        requirements=brief,
        vendor_info=vendor_text,
        selected_agents=req.selected_agents,
        vendors=req.vendors,
    )
    return result


def _build_brief(req: "SimulateRequest") -> str:
    """
    The exact procurement brief text forwarded to every agent.
    Only contains what the user actually provided in Step 1 (requirements) and
    the vendors under consideration — no fabricated user-count/budget figures.
    """
    return (
        f"Requirements: {req.target}\n"
        f"Vendors under consideration: {', '.join(req.vendors)}"
    )


def _session_vendor_text(req: "SimulateRequest", db: DbSession) -> str:
    """Extracted PDF/document text stored for the session (Step 3), if any."""
    if req.session_id:
        session = crud.get_session(db, req.session_id)
        if session and session.step3 and session.step3.vendor_text:
            return session.step3.vendor_text
    return ""


def _stored_vendor_names(req: "SimulateRequest", db: DbSession) -> List[str]:
    """Vendor names detected from the uploaded documents (Step 3), if any."""
    if req.session_id:
        session = crud.get_session(db, req.session_id)
        if session and session.step3 and session.step3.vendor_names:
            return session.step3.vendor_names
    return []


def _resolve_vendors(req: "SimulateRequest", db: DbSession, vendor_text: str) -> List[str]:
    """
    When documents were uploaded, the vendors detected from them are the source
    of truth — they always win over names the UI guessed from the Step 1 text.
    Only fall back to the request's vendors when no documents were provided.
    """
    detected = _stored_vendor_names(req, db)
    if not detected and vendor_text.strip():
        detected = extract_vendor_names(vendor_text)
    if len(detected) >= 2:
        return detected[:4]
    return req.vendors


def parse_documents(vendor_text: str) -> List[dict]:
    """Split combined vendor text ('=== Document: name ===' headers) into docs."""
    if not vendor_text.strip():
        return []
    parts = re.split(r"=== Document: (.+?) ===\n?", vendor_text)
    docs: List[dict] = []
    for i in range(1, len(parts), 2):
        content = parts[i + 1].strip() if i + 1 < len(parts) else ""
        docs.append({"name": parts[i].strip(), "content": content})
    if not docs:
        docs.append({"name": "Document", "content": vendor_text.strip()})
    return docs


def _good_text(parsed: List[dict], flags: dict) -> str:
    """Join only the vendor (non-flagged) documents' text."""
    return "\n\n".join(
        f"=== Document: {d['name']} ===\n{d['content']}"
        for d in parsed
        if flags.get(d["name"], {}).get("is_vendor", True)
    )


def _build_step3_summary(session) -> dict:
    """
    Classify every source on the session, persist the vendor names detected from
    the GOOD (non-flagged) documents only, and return the data the UI needs:
    per-document flags, the detected vendor names, and the category.
    """
    text = (session.step3.vendor_text if session and session.step3 else "") or ""
    parsed = parse_documents(text)
    flags = classify_documents(parsed) if parsed else {}

    documents = [
        {
            "name":      d["name"],
            "chars":     len(d["content"]),
            "is_vendor": bool(flags.get(d["name"], {}).get("is_vendor", True)),
            "reason":    flags.get(d["name"], {}).get("reason", ""),
        }
        for d in parsed
    ]

    good_text = _good_text(parsed, flags)
    detected_vendors = extract_vendor_names(good_text) if good_text.strip() else []
    category = detect_category(good_text) if good_text.strip() else ""

    if session and session.step3:
        session.step3.vendor_names = detected_vendors

    return {"documents": documents, "detected_vendors": detected_vendors, "category": category}


@app.post("/api/context")
def context(req: SimulateRequest, db: DbSession = Depends(get_db)):
    """
    Return the exact context that WILL be forwarded to the agents — the
    Step 1 brief and the Step 3 document text — WITHOUT running the debate.
    Lets the UI show the user what was read before spending a debate run.
    """
    vendor_text = _session_vendor_text(req, db)
    suggested = _resolve_vendors(req, db, vendor_text)
    req.vendors = suggested   # brief should reflect the real vendors

    # Classify each uploaded document so the UI can flag non-vendor noise
    parsed = parse_documents(vendor_text)
    flags = classify_documents(parsed) if parsed else {}
    documents = [
        {
            "name":      d["name"],
            "content":   d["content"],
            "chars":     len(d["content"]),
            "is_vendor": flags.get(d["name"], {}).get("is_vendor", True),
            "reason":    flags.get(d["name"], {}).get("reason", ""),
        }
        for d in parsed
    ]

    return {
        "requirements":     req.target,
        "brief":            _build_brief(req),
        "vendor_text":      vendor_text,
        "has_documents":    bool(vendor_text.strip()),
        "suggested_vendors": suggested,
        "documents":        documents,
    }


@app.post("/api/debate")
def debate(req: SimulateRequest, db: DbSession = Depends(get_db)):
    """
    Run the multi-round boardroom DEBATE (Opening → Rebuttal → Closing) and
    return the full transcript plus the moderator's synthesised decision.
    Same inputs as /api/simulate — pulls vendor_text from the session's PDF.
    """
    vendor_text = _session_vendor_text(req, db)
    req.vendors = _resolve_vendors(req, db, vendor_text)   # prefer real vendors from PDFs
    brief = _build_brief(req)

    # Per-agent personality config saved in Step 2 (so agents debate in the company's voice)
    agent_configs = {}
    if req.session_id:
        session = crud.get_session(db, req.session_id)
        if session and session.step2:
            agent_configs = session.step2.configs or {}

    result = run_debate(
        requirements=brief,
        vendor_info=vendor_text,
        selected_agents=req.selected_agents,
        vendors=req.vendors,
        agent_configs=agent_configs,
    )
    # Echo back the exact inputs so the UI can show what the agents received
    result["inputs"] = {
        "requirements":  req.target,
        "brief":         brief,
        "vendor_text":   vendor_text,
        "has_documents": bool(vendor_text.strip()),
    }
    return result


# ── Negotiation endpoint ───────────────────────────────────────────────────────

class NegotiateBody(BaseModel):
    winner:       str            = ""
    vendors:      List[str]      = []
    requirements: str            = ""


@app.post("/api/negotiate/{session_id}")
def negotiate(session_id: str, body: NegotiateBody, db: DbSession = Depends(get_db)):
    """
    Sales-negotiation agent: draft one email per vendor telling them a competitor
    is currently ahead and inviting a revised offer (sent as a PDF). Looks up each
    vendor's contact email via AI; if not found, the UI asks the user to enter it.
    """
    session = crud.get_session(db, session_id)
    vendor_text = (session.step3.vendor_text if session and session.step3 else "") or ""

    vendors = body.vendors or (session.step3.vendor_names if session and session.step3 else []) or []
    vendors = vendors[:MAX_VENDORS]
    if not vendors:
        raise HTTPException(status_code=400, detail="No vendors to negotiate with")

    winner = body.winner or vendors[0]
    category = detect_category(vendor_text) if vendor_text.strip() else (body.requirements or "")

    docs = parse_documents(vendor_text)

    def _context_for(v: str) -> str:
        for d in docs:
            if v.lower() in d["name"].lower() or d["name"].lower() in v.lower():
                return d["content"]
        return ""

    drafts = []
    for v in vendors:
        # Each vendor is told the strongest *other* option is ahead
        better = winner if v != winner else next((x for x in vendors if x != v), winner)
        drafts.append(draft_negotiation_email(v, better, category, _context_for(v)))

    return {"category": category, "winner": winner, "drafts": drafts}


# ── Formal long-form decision report (PDF) ─────────────────────────────────────

class ReportVendor(BaseModel):
    id:       str            = ""
    name:     str
    scores:   dict           = {}
    features: List[Any]      = []

class ReportConstraints(BaseModel):
    budget:         float    = 0
    timelineMonths: int      = 12

class ReportTranscriptEntry(BaseModel):
    agent: str
    role:  str = ""
    text:  str = ""

class DecisionReportPayload(BaseModel):
    vendors:     List[ReportVendor]
    constraints: ReportConstraints           = ReportConstraints()
    transcript:  List[ReportTranscriptEntry] = []


@app.post("/api/decision-report")
def decision_report(payload: DecisionReportPayload):
    """
    Generate the formal, long-form Procurement Decision Report as a downloadable
    PDF (executive essay + normalized matrix + TCO simulation + evidence log).
    """
    if len(payload.vendors) < 2:
        raise HTTPException(status_code=400, detail="At least two vendors are required")

    data = payload.model_dump()
    try:
        pdf = build_decision_report_pdf(data)
    except Exception as exc:  # pragma: no cover - surfaced to the caller
        raise HTTPException(status_code=500, detail=f"Report generation failed: {exc}")

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="procurement-decision-report.pdf"'},
    )


# ── File upload endpoint ───────────────────────────────────────────────────────

# How much combined vendor text we keep per session (agents truncate further)
MAX_VENDOR_TEXT = 40_000
# Hard cap on total sources per session (uploaded files + AI-found vendors)
MAX_VENDORS = 4


@app.post("/api/upload/{session_id}")
async def upload_vendor_files(
    session_id: str,
    files: List[UploadFile] = File(...),
    db: DbSession = Depends(get_db),
):
    """
    Accept one OR MANY PDF / plain-text files for a session's Step 3.
    Extracts text from each, saves every file to disk, and appends the
    combined text to the session so the agents see all documents together.
    """
    session = crud.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Enforce a hard cap of MAX_VENDORS total sources (files), flagged or not
    existing_count = len(parse_documents((session.step3.vendor_text if session.step3 else "") or ""))
    remaining_slots = MAX_VENDORS - existing_count
    skipped = max(0, len(files) - max(0, remaining_slots))
    files = files[:max(0, remaining_slots)]

    extracted_parts: List[str] = []
    saved_names: List[str] = []

    for f in files:
        raw = await f.read()
        filename = f.filename or "upload"

        if filename.lower().endswith(".pdf"):
            text = extract_text(raw)
        else:
            # Plain text / CSV / markdown
            try:
                text = raw.decode("utf-8", errors="ignore")[:12_000]
            except Exception:
                text = ""

        # Save each file to disk (prefix with session id to avoid collisions)
        (UPLOAD_DIR / f"{session_id}_{filename}").write_bytes(raw)
        saved_names.append(filename)

        if text.strip():
            extracted_parts.append(f"=== Document: {filename} ===\n{text}")

    combined = "\n\n".join(extracted_parts)

    # Ensure a step3 row exists, then APPEND so multiple upload calls accumulate
    if not session.step3:
        try:
            session = crud.save_step3(db, session_id, method="upload", vendor_names=[])
        except Exception:
            pass

    summary = {"documents": [], "detected_vendors": [], "category": ""}
    if session.step3:
        existing = session.step3.vendor_text or ""
        merged = f"{existing}\n\n{combined}".strip() if existing else combined
        session.step3.vendor_text = merged[:MAX_VENDOR_TEXT]
        # Classify every source, flag non-vendor files, detect vendors + category
        summary = _build_step3_summary(session)
        db.commit()
        total_chars = len(session.step3.vendor_text)
    else:
        total_chars = len(combined)

    return {
        "session_id":      session_id,
        "files":           saved_names,
        "count":           len(saved_names),
        "chars_extracted": total_chars,
        "documents":       summary["documents"],
        "detected_vendors": summary["detected_vendors"],
        "category":        summary["category"],
        "skipped":         skipped,   # files not stored because the 4-source cap was hit
        "preview":         combined[:300] + ("…" if len(combined) > 300 else ""),
    }


class VendorSearchBody(BaseModel):
    field:        str
    requirements: Optional[str]       = ""
    count:        int                 = 3
    must_include: Optional[List[str]] = None


@app.post("/api/vendor-search/{session_id}")
def vendor_search(session_id: str, body: VendorSearchBody, db: DbSession = Depends(get_db)):
    """
    AI vendor finder for Step 3: searches for real vendors in the given field and
    APPENDS their briefs to the session's vendor text (same place uploaded PDFs
    land). Respects a hard cap of 4 total vendors — if files are already present,
    only the remaining slots are filled.
    """
    session = crud.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    existing_text = (session.step3.vendor_text if session.step3 else "") or ""
    existing_names = (session.step3.vendor_names if session.step3 else []) or []
    parsed_existing = parse_documents(existing_text)
    flags = classify_documents(parsed_existing) if parsed_existing else {}
    remaining = MAX_VENDORS - len(parsed_existing)   # cap counts ALL sources, flagged or not

    def _docs(extra: Optional[List[dict]] = None) -> List[dict]:
        out = [
            {
                "name":      d["name"],
                "chars":     len(d["content"]),
                "is_vendor": bool(flags.get(d["name"], {}).get("is_vendor", True)),
                "reason":    flags.get(d["name"], {}).get("reason", ""),
            }
            for d in parsed_existing
        ]
        return out + (extra or [])

    if remaining <= 0:
        return {
            "session_id": session_id, "added": [], "documents": _docs(),
            "detected_vendors": existing_names,
            "message": f"You already have {MAX_VENDORS} vendors (the maximum).",
        }

    # Need either an explicit field, or uploaded docs to base the search on
    if not body.field.strip() and not existing_text.strip():
        raise HTTPException(
            status_code=400,
            detail="Provide a field/category to search, or upload files to base the search on.",
        )

    found = search_vendors(
        field=body.field,
        requirements=body.requirements or "",
        count=min(body.count, remaining),
        must_include=body.must_include,
        context_docs=_good_text(parsed_existing, flags),   # ONLY good files guide the search
    )
    existing_lower = {n.lower() for n in existing_names}
    found = [v for v in found if v["name"].lower() not in existing_lower][:remaining]
    if not found:
        raise HTTPException(status_code=502, detail="Vendor search returned no new results")

    new_block = "\n\n".join(
        f"=== Document: {v['name']} (AI web search) ===\n{v['info']}" for v in found
    )
    merged_text = f"{existing_text}\n\n{new_block}".strip() if existing_text else new_block
    detected_vendors = (existing_names + [v["name"] for v in found])[:MAX_VENDORS]

    if not session.step3:
        try:
            session = crud.save_step3(db, session_id, method="search", vendor_names=detected_vendors)
        except Exception:
            pass
    if session.step3:
        session.step3.method = "both" if existing_text else "search"
        session.step3.vendor_names = detected_vendors
        session.step3.vendor_text = merged_text[:MAX_VENDOR_TEXT]
        db.commit()

    searched_docs = [
        {"name": f"{v['name']} (AI web search)", "chars": len(v["info"]), "is_vendor": True, "reason": ""}
        for v in found
    ]
    return {
        "session_id":       session_id,
        "added":            [v["name"] for v in found],
        "documents":        _docs(searched_docs),
        "detected_vendors": detected_vendors,
        "remaining":        remaining - len(found),
    }


class TypedVendorBody(BaseModel):
    name: str = ""
    text: str


@app.post("/api/sessions/{session_id}/add-vendor")
def add_typed_vendor(session_id: str, body: TypedVendorBody, db: DbSession = Depends(get_db)):
    """
    Add a MANUALLY TYPED vendor as a Step 3 source. It is stored in exactly the
    same document format as uploaded files (=== Document: name === blocks), so the
    rest of the pipeline (classification, vendor detection, debate) treats it
    identically. Respects the 4-source cap.
    """
    session = crud.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Vendor details are empty")

    existing_text = (session.step3.vendor_text if session.step3 else "") or ""
    existing_docs = parse_documents(existing_text)
    if len(existing_docs) >= MAX_VENDORS:
        summary = _build_step3_summary(session) if session.step3 else {"documents": [], "detected_vendors": [], "category": ""}
        return {
            "session_id": session_id, **summary,
            "added": False, "message": f"You already have {MAX_VENDORS} sources (the maximum).",
        }

    name = body.name.strip() or f"Typed vendor {len(existing_docs) + 1}"
    block = f"=== Document: {name} ===\n{body.text.strip()[:12_000]}"
    merged = f"{existing_text}\n\n{block}".strip() if existing_text else block

    if not session.step3:
        try:
            session = crud.save_step3(db, session_id, method="manual", vendor_names=[])
        except Exception:
            pass
    if session.step3:
        session.step3.method = "both" if existing_text else "manual"
        session.step3.vendor_text = merged[:MAX_VENDOR_TEXT]
        summary = _build_step3_summary(session)
        db.commit()
    else:
        summary = {"documents": [], "detected_vendors": [], "category": ""}

    return {"session_id": session_id, **summary, "added": True}


class RemoveDocBody(BaseModel):
    filename: str


@app.post("/api/sessions/{session_id}/remove-document")
def remove_document(session_id: str, body: RemoveDocBody, db: DbSession = Depends(get_db)):
    """
    Remove a single uploaded document from a session (e.g. a flagged non-vendor
    file), then re-detect the vendors from what remains.
    """
    session = crud.get_session(db, session_id)
    if session is None or session.step3 is None:
        raise HTTPException(status_code=404, detail="Session or documents not found")

    docs = parse_documents(session.step3.vendor_text or "")
    kept = [d for d in docs if d["name"] != body.filename]
    session.step3.vendor_text = "\n\n".join(
        f"=== Document: {d['name']} ===\n{d['content']}" for d in kept
    )
    summary = _build_step3_summary(session)
    db.commit()

    # Best-effort: delete the file from disk too
    try:
        (UPLOAD_DIR / f"{session_id}_{body.filename}").unlink(missing_ok=True)
    except Exception:
        pass

    return {"removed": body.filename, **summary}


# ── Summarise endpoint ─────────────────────────────────────────────────────────

class SummarizeRequest(BaseModel):
    text: str


def _truncate_fallback(text: str) -> str:
    words = text.split()
    return " ".join(words[:7]) + ("…" if len(words) > 7 else "")


@app.post("/api/summarize")
def summarize(req: SummarizeRequest):
    hf_token = os.getenv("HF_TOKEN", "")

    if not hf_token:
        return {"summary": _truncate_fallback(req.text), "method": "truncation"}

    prompt = (
        "Summarise the following procurement requirement in 6 words or fewer. "
        "Return only the summary, no explanation.\n\n"
        f"Requirement: {req.text}\n\nSummary:"
    )

    try:
        response = http.post(
            "https://api-inference.huggingface.co/models/unsloth/Qwen3-27B-GGUF",
            headers={
                "Authorization": f"Bearer {hf_token}",
                "Content-Type": "application/json",
            },
            json={
                "inputs": prompt,
                "parameters": {
                    "max_new_tokens": 24,
                    "return_full_text": False,
                    # HuggingFace inference call (not OpenRouter) — temperature only;
                    # seed/provider pinning are OpenRouter-specific and don't apply here.
                    "temperature": 0,
                },
            },
            timeout=30,
        )

        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list) and data:
                raw = data[0].get("generated_text", "").strip()
                # Take only the first line and cap at 60 chars
                summary = raw.splitlines()[0][:60].strip()
                return {"summary": summary or _truncate_fallback(req.text), "method": "hf_api"}

        # Non-200 → graceful fallback
        return {"summary": _truncate_fallback(req.text), "method": "truncation_fallback"}

    except Exception:
        return {"summary": _truncate_fallback(req.text), "method": "error_fallback"}


@app.post("/api/requirement-summary")
def requirement_summary(req: SummarizeRequest):
    """
    Use the configured LLM (OpenRouter/Gemini) to distill the Step 1 text into a
    short title plus a few concise requirement bullet points — only the relevant
    purchasing requirements (budget, must-have features, constraints, scale).
    """
    import json as _json
    from multi_agent_system.agents.base_agent import _client, _MODEL, _SEED, _PROVIDER_PIN

    text = (req.text or "").strip()
    if not text:
        return {"summary": "Untitled session", "bullets": [], "method": "empty"}

    try:
        resp = _client().chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content":
                    "You distill a company's procurement requirement into a short title and "
                    "3-5 concise bullet points. Each bullet captures ONE concrete requirement "
                    "(budget, must-have feature, integration, security/compliance, scale/users). "
                    "Be terse — a few words per bullet, no full sentences, no fluff."},
                {"role": "user", "content":
                    f"Requirement:\n{text}\n\n"
                    'Return JSON: {"summary": "<= 6 word title", "bullets": ["short requirement", ...]}'},
            ],
            response_format={"type": "json_object"},
            max_tokens=220,
            temperature=0,
            seed=_SEED,
            extra_body=_PROVIDER_PIN,
        )
        data = _json.loads(resp.choices[0].message.content)
        summary = str(data.get("summary", "")).strip()[:60]
        bullets = [str(b).strip()[:80] for b in data.get("bullets", []) if str(b).strip()][:5]
        return {
            "summary": summary or _truncate_fallback(text),
            "bullets": bullets,
            "method": "llm",
        }
    except Exception:
        return {"summary": _truncate_fallback(text), "bullets": [], "method": "fallback"}


# ── Requirements assistant (Step 1 helper chatbot) ─────────────────────────────

class AssistantMessage(BaseModel):
    role: str
    content: str


class AssistantBody(BaseModel):
    messages: List[AssistantMessage]


@app.post("/api/requirements-assistant")
def requirements_assistant(body: AssistantBody):
    """
    A friendly support chatbot that helps the user think through and define their
    purchasing requirements in Step 1. Conversational, concise, asks clarifying
    questions and suggests requirement dimensions.
    """
    from multi_agent_system.agents.base_agent import _client, _MODEL, _SEED, _PROVIDER_PIN

    system = (
        "You are a friendly, concise procurement requirements assistant inside an app where the "
        "user is about to define what they want to purchase. Help them think through and articulate "
        "their needs. Ask one or two focused clarifying questions at a time, and suggest important "
        "requirement dimensions when relevant: budget, number of users / scale, must-have features, "
        "integrations, security & compliance (e.g. GDPR, SOC 2), hosting / data residency, support & "
        "SLAs, and timeline. Keep replies short (2-5 sentences or a short bullet list). Be "
        "encouraging and practical. Do not invent specific vendors or prices."
    )

    msgs = [{"role": "system", "content": system}]
    for m in body.messages[-12:]:
        role = m.role if m.role in ("user", "assistant") else "user"
        msgs.append({"role": role, "content": (m.content or "")[:2000]})

    try:
        resp = _client().chat.completions.create(
            model=_MODEL,
            messages=msgs,
            max_tokens=400,
            temperature=0,
            seed=_SEED,
            extra_body=_PROVIDER_PIN,
        )
        reply = (resp.choices[0].message.content or "").strip()
        return {"reply": reply or "Could you tell me a bit more about what you're looking to buy?"}
    except Exception:
        return {"reply": (
            "I'm having trouble connecting right now. In the meantime, a good requirement covers: "
            "budget, number of users, must-have features, key integrations, and any security or "
            "compliance needs."
        )}


# ── Session endpoints (SQLite via SQLAlchemy) ──────────────────────────────────

class Step1Body(BaseModel):
    text: str
    summary: Optional[str] = None

class Step2Body(BaseModel):
    agents: List[str]
    configs: Optional[dict] = None   # {agent_id: {tone, risk, decision, priority, communication}}

class Step3Body(BaseModel):
    method: str
    vendor_names: Optional[List[str]] = None


@app.post("/api/sessions", status_code=201)
def create_session(db: DbSession = Depends(get_db)):
    session = crud.create_session(db)
    return {"session_id": session.id, "status": session.status}


@app.post("/api/sessions/{session_id}/step1")
def save_step1(session_id: str, body: Step1Body, db: DbSession = Depends(get_db)):
    try:
        session = crud.save_step1(db, session_id, text=body.text, summary=body.summary)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session.id, "status": session.status, "step": 1}


@app.post("/api/sessions/{session_id}/step2")
def save_step2(session_id: str, body: Step2Body, db: DbSession = Depends(get_db)):
    try:
        session = crud.save_step2(db, session_id, agents=body.agents, configs=body.configs)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session.id, "status": session.status, "step": 2}


@app.post("/api/sessions/{session_id}/step3")
def save_step3(session_id: str, body: Step3Body, db: DbSession = Depends(get_db)):
    try:
        session = crud.save_step3(db, session_id, method=body.method, vendor_names=body.vendor_names)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session.id, "status": session.status, "step": 3}


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str, db: DbSession = Depends(get_db)):
    session = crud.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.to_dict()


@app.get("/api/sessions")
def list_sessions(db: DbSession = Depends(get_db)):
    return crud.list_sessions(db)


@app.delete("/api/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, db: DbSession = Depends(get_db)):
    if not crud.delete_session(db, session_id):
        raise HTTPException(status_code=404, detail="Session not found")
