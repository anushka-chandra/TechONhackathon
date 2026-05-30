import os
import requests as http
from pathlib import Path
from sqlalchemy import text

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session as DbSession

from backend.database.engine import engine, get_db
from backend.database import models as db_models
from backend.database import crud
from backend.pdf_extractor import extract_text
from multi_agent_system.orchestrator import run_society
from multi_agent_system.debate import run_debate

# ── Create / migrate DB on startup ────────────────────────────────────────────
db_models.Base.metadata.create_all(bind=engine)
# Add vendor_text column if upgrading from an older DB
with engine.connect() as _conn:
    try:
        _conn.execute(text("ALTER TABLE step3_vendor_inputs ADD COLUMN vendor_text TEXT"))
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


@app.post("/api/debate")
def debate(req: SimulateRequest, db: DbSession = Depends(get_db)):
    """
    Run the multi-round boardroom DEBATE (Opening → Rebuttal → Closing) and
    return the full transcript plus the moderator's synthesised decision.
    Same inputs as /api/simulate — pulls vendor_text from the session's PDF.
    """
    vendor_text = ""
    if req.session_id:
        session = crud.get_session(db, req.session_id)
        if session and session.step3 and session.step3.vendor_text:
            vendor_text = session.step3.vendor_text

    brief = (
        f"Category: {req.target}\n"
        f"Number of users: {req.users}\n"
        f"Annual budget: €{req.budget:,.0f}\n"
        f"Vendors under consideration: {', '.join(req.vendors)}"
    )

    return run_debate(
        requirements=brief,
        vendor_info=vendor_text,
        selected_agents=req.selected_agents,
        vendors=req.vendors,
    )


# ── File upload endpoint ───────────────────────────────────────────────────────

# How much combined vendor text we keep per session (agents truncate further)
MAX_VENDOR_TEXT = 40_000


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

    if session.step3:
        existing = session.step3.vendor_text or ""
        merged = f"{existing}\n\n{combined}".strip() if existing else combined
        session.step3.vendor_text = merged[:MAX_VENDOR_TEXT]
        db.commit()
        total_chars = len(session.step3.vendor_text)
    else:
        total_chars = len(combined)

    return {
        "session_id":      session_id,
        "files":           saved_names,
        "count":           len(saved_names),
        "chars_extracted": total_chars,
        "preview":         combined[:300] + ("…" if len(combined) > 300 else ""),
    }


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
                    "temperature": 0.2,
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


# ── Session endpoints (SQLite via SQLAlchemy) ──────────────────────────────────

class Step1Body(BaseModel):
    text: str
    summary: Optional[str] = None

class Step2Body(BaseModel):
    agents: List[str]

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
        session = crud.save_step2(db, session_id, agents=body.agents)
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
