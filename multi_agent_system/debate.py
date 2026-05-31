"""
Debate Orchestrator — runs the selected AI agents through a multi-round
boardroom debate (Opening → Rebuttal → Closing), then a neutral moderator
synthesises the summary, decision, and per-vendor pros/cons.

Returns a single JSON-serialisable dict consumed by the /debate frontend page.
"""

from __future__ import annotations

import json
from typing import List, Optional

from multi_agent_system.agents.base_agent import _client, _MODEL
from multi_agent_system.orchestrator import (
    AGENT_REGISTRY,
    ALL_AGENTS,
    _extract_vendors,
    _pick_winner,
)
from multi_agent_system.scoring import score_all_vendors, build_decision_matrix, compute_derived_confidence

# Three debate rounds, in order
PHASES: list[tuple[str, str]] = [
    ("opening",  "Opening Statements"),
    ("rebuttal", "Rebuttals & Clashes"),
    ("closing",  "Closing Arguments"),
]


def extract_vendor_names(text: str, max_vendors: int = 4) -> List[str]:
    """
    Identify the distinct vendors/products actually being proposed in the
    uploaded documents. Irrelevant files (e.g. a recipe) are excluded.
    Uses one cheap LLM call; returns [] on any failure.
    """
    if not text.strip():
        return []
    try:
        resp = _client().chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content":
                    "You identify the distinct vendors or products described in procurement "
                    "documents — for ANY kind of product or service (software, appliances, "
                    "equipment, machinery, services, etc.). Ignore any document that does NOT "
                    "contain vendor/product information (recipes, unrelated notes, etc.)."},
                {"role": "user", "content":
                    "From the following documents, list ONLY the distinct vendor/product names that "
                    "are genuine procurement options to compare. Use the real product name where given.\n\n"
                    f"{text[:8000]}\n\n"
                    'Return JSON: {"vendors": ["name1", "name2"]}'},
            ],
            response_format={"type": "json_object"},
            max_tokens=150,
            temperature=0,
        )
        data = json.loads(resp.choices[0].message.content)
        seen: list[str] = []
        for v in data.get("vendors", []):
            name = str(v).strip()
            if name and name not in seen:
                seen.append(name)
        return seen[:max_vendors]
    except Exception:
        return []


def detect_category(text: str) -> str:
    """
    Identify the product category that a set of vendor documents belong to,
    as a short phrase (e.g. 'project management software', 'CRM'). "" on failure.
    """
    if not text.strip():
        return ""
    try:
        resp = _client().chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content":
                    "You identify the single product category a set of vendor documents belong "
                    "to — for any kind of product or service."},
                {"role": "user", "content":
                    "What product/service category do these vendor documents describe? "
                    "Answer with a short category phrase only "
                    "(e.g. 'project management software', 'washing machines', "
                    "'commercial refrigerators', 'office chairs').\n\n"
                    f"{text[:4000]}\n\n"
                    'Return JSON: {"category": "<short phrase>"}'},
            ],
            response_format={"type": "json_object"},
            max_tokens=40,
            temperature=0,
        )
        return str(json.loads(resp.choices[0].message.content).get("category", "")).strip()[:80]
    except Exception:
        return ""


def classify_documents(documents: List[dict]) -> dict:
    """
    Classify each uploaded file as a genuine vendor/product proposal or unrelated
    noise (e.g. a recipe). documents: [{"name": str, "content": str}, ...].
    Returns {name: {"is_vendor": bool, "reason": str}}; {} on any failure.
    """
    if not documents:
        return {}
    try:
        listing = "\n\n".join(
            f"[{i}] FILE: {d['name']}\n{d['content'][:1500]}"
            for i, d in enumerate(documents)
        )
        resp = _client().chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content":
                    "You classify whether each uploaded file contains genuine vendor or product "
                    "information (an offer, spec sheet, brochure, or proposal for ANY kind of "
                    "product or service — software, appliances, equipment, machinery, services, "
                    "etc.) that could inform a purchasing decision, or whether it is unrelated "
                    "noise (e.g. a recipe, a personal note, random text). Be strict: mark "
                    "is_vendor true only when the file describes a purchasable product/vendor."},
                {"role": "user", "content":
                    f"Classify each file below.\n\n{listing}\n\n"
                    'Return JSON: {"files": [{"index": 0, "is_vendor": true, '
                    '"reason": "<short reason, max ~12 words>"}]}'},
            ],
            response_format={"type": "json_object"},
            max_tokens=400,
            temperature=0,
        )
        data = json.loads(resp.choices[0].message.content)
        out: dict = {}
        for item in data.get("files", []):
            idx = item.get("index")
            if isinstance(idx, int) and 0 <= idx < len(documents):
                out[documents[idx]["name"]] = {
                    "is_vendor": bool(item.get("is_vendor", True)),
                    "reason": str(item.get("reason", "")).strip()[:160],
                }
        return out
    except Exception:
        return {}


def search_vendors(
    field: str,
    requirements: str = "",
    count: int = 3,
    must_include: Optional[List[str]] = None,
    context_docs: str = "",
) -> List[dict]:
    """
    Find up to `count` (hard-capped at 4) real vendors/products and produce a
    concise factual brief for each. If `field` is empty, the category is inferred
    from `context_docs` (the user's already-uploaded vendor files), and the search
    looks for COMPARABLE additional vendors not already present.
    Tries OpenRouter web search (':online') first, then the model's own knowledge.
    Returns [{"name": str, "info": str}, ...]; [] on failure.
    """
    count = max(1, min(4, count))
    must = ", ".join(m for m in (must_include or []) if m.strip())

    system = (
        "You are a procurement market researcher. You identify real, currently-available "
        "vendors/products in a given category — for ANY kind of product or service (software, "
        "appliances, equipment, machinery, services, etc.) — and write a concise factual brief "
        "for each."
    )

    parts: List[str] = []
    if field.strip():
        parts.append(f"Find up to {count} real vendors/products in this category: {field}.")
    else:
        parts.append(
            f"Find up to {count} real vendors/products in the SAME category as the "
            "uploaded documents shown below."
        )
    if requirements.strip():
        parts.append(f"Buyer's needs/context: {requirements}")
    if context_docs.strip():
        parts.append(
            "The buyer has already shared these vendor documents. Use them to understand the "
            "category, price range, and desired capabilities, and find COMPARABLE additional "
            "vendors. Do NOT repeat any vendor already described here:\n"
            + context_docs[:4000]
        )
    if must:
        parts.append(f"Be sure to include these if they fit: {must}")
    parts.append(
        f"Return AT MOST {count} vendors. For each, give the real product name and a concise brief "
        "covering what it is, typical pricing/tiers, key features, main integrations, and "
        "security/compliance posture. Use well-known public information; if unsure of exact "
        "figures give realistic typical ranges and note they are approximate."
    )
    parts.append('Return JSON: {"vendors": [{"name": "<product name>", "info": "<4-7 sentence brief>"}]}')
    user = "\n\n".join(parts)

    for model in (f"{_MODEL}:online", _MODEL):   # web-search-enabled first, then plain
        try:
            resp = _client().chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                response_format={"type": "json_object"},
                max_tokens=1300,
                temperature=0.3,
            )
            data = json.loads(resp.choices[0].message.content)
            out: List[dict] = []
            seen: set = set()
            for v in data.get("vendors", []):
                name = str(v.get("name", "")).strip()
                info = str(v.get("info", "")).strip()
                if name and name.lower() not in seen:
                    seen.add(name.lower())
                    out.append({"name": name, "info": info})
                if len(out) >= count:
                    break
            if out:
                return out
        except Exception:
            continue
    return []


def draft_negotiation_email(
    vendor: str,
    better_vendor: str,
    category: str = "",
    vendor_context: str = "",
) -> dict:
    """
    Sales-negotiation agent: drafts a firm-but-professional email to `vendor`
    saying a competitor (`better_vendor`) is currently ahead and inviting a
    revised offer (better price/service) sent as a PDF. Also tries to find the
    vendor's public contact email. Returns {vendor, email, email_found, subject, body}.
    """
    system = (
        "You are a procurement sales-negotiation agent. You write concise, firm but professional "
        "negotiation emails to vendors and, when possible, find the vendor's public sales or "
        "contact email address. Only provide an email you are genuinely confident is a real, "
        "current public address; otherwise return null — never invent one."
    )
    user = (
        f"We are selecting a {category or 'vendor'} and evaluated several options. After "
        f"assessment, {better_vendor} currently comes out ahead of {vendor}.\n\n"
        f"Write a concise, professional email to {vendor} that:\n"
        f"- states that, after careful evaluation, a competing vendor is currently the stronger choice;\n"
        f"- invites {vendor} to submit a revised offer with a better price and/or improved service if they want to win our business;\n"
        f"- makes clear we may switch to the competitor;\n"
        f"- asks them to send their new offer as a PDF.\n\n"
        + (f"Context about {vendor}:\n{vendor_context[:1500]}\n\n" if vendor_context.strip() else "")
        + f"Also find {vendor}'s public sales/contact email if you are confident it is real.\n\n"
        'Return JSON: {"email": "<address or null>", "email_found": true or false, '
        '"subject": "<subject line>", "body": "<full email body with a greeting and a '
        '[Your name] sign-off placeholder>"}'
    )

    for model in (f"{_MODEL}:online", _MODEL):   # web search first for the email lookup
        try:
            resp = _client().chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                response_format={"type": "json_object"},
                max_tokens=700,
                temperature=0.4,
            )
            data = json.loads(resp.choices[0].message.content)
            raw_email = data.get("email")
            email = raw_email if isinstance(raw_email, str) and "@" in raw_email else None
            body = str(data.get("body", "")).strip()
            if body:
                return {
                    "vendor":      vendor,
                    "email":       email,
                    "email_found": bool(email) and bool(data.get("email_found", True)),
                    "subject":     str(data.get("subject", "")).strip()[:200]
                                   or f"Revised proposal request — {category or 'our procurement'}",
                    "body":        body[:4000],
                }
        except Exception:
            continue

    # Deterministic fallback if the model is unavailable
    return {
        "vendor":      vendor,
        "email":       None,
        "email_found": False,
        "subject":     f"Revised proposal request — {category or 'our procurement'}",
        "body": (
            f"Dear {vendor} team,\n\n"
            f"Thank you for your proposal. After a careful evaluation of the available options, a "
            f"competing vendor currently represents the stronger choice for our requirements, and we "
            f"are preparing to move forward with them.\n\n"
            f"Before we finalise our decision, we wanted to give you the opportunity to revise your "
            f"offer. If you are able to improve your pricing and/or service, we would be glad to "
            f"reconsider. Please send any updated proposal to us as a PDF.\n\n"
            f"We look forward to hearing from you.\n\nBest regards,\n[Your name]"
        ),
    }


def _dedupe_agents(selected: Optional[List[str]]) -> List[str]:
    ids = selected or ALL_AGENTS
    seen: list[str] = []
    for aid in ids:
        key = aid.lower()
        if key in AGENT_REGISTRY and key not in seen:
            seen.append(key)
    return seen or ALL_AGENTS


def _synthesize(
    requirements: str,
    vendors: List[str],
    transcript: List[dict],
    winner: str,
    confidence: int,
) -> dict:
    """Neutral board-secretary pass: summary + justification + pros/cons."""
    convo = "\n".join(f"{t['name']} ({t['phase']}): {t['message']}" for t in transcript)

    system = (
        "You are a neutral board secretary. You did not take part in the debate. "
        "Summarise it factually and even-handedly, capturing where members agreed "
        "and where they clashed. Do not invent facts not present in the debate."
    )
    schema = """Respond with a single JSON object — no markdown:
{
  "summary": "<3-4 sentence neutral summary of the debate: the main arguments and the key points of disagreement>",
  "justification": "<2-3 sentences explaining why the winning vendor is the recommended choice, grounded in what the board said>",
  "pros": {"<vendor name>": ["<pro>", "<pro>"]},
  "cons": {"<vendor name>": ["<con>", "<con>"]}
}"""
    user = (
        f"PROCUREMENT BRIEF:\n{requirements}\n\n"
        f"VENDORS: {', '.join(vendors)}\n\n"
        f"BOARD DECISION: {winner} (recommended at {confidence}% confidence)\n\n"
        f"FULL DEBATE TRANSCRIPT:\n{convo}\n\n"
        f"Produce the structured summary. Include a pros and cons list for EACH vendor: "
        f"{', '.join(vendors)}.\n\n{schema}"
    )

    try:
        resp = _client().chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            response_format={"type": "json_object"},
            max_tokens=600,
            temperature=0.3,
        )
        raw = json.loads(resp.choices[0].message.content)
        return _normalise_synth(raw, vendors)
    except Exception:
        return _synth_fallback(vendors, transcript, winner)


def _normalise_synth(raw: dict, vendors: List[str]) -> dict:
    def _coerce_map(value) -> dict:
        out: dict[str, list[str]] = {}
        if isinstance(value, dict):
            for k, v in value.items():
                if isinstance(v, list):
                    out[str(k)] = [str(x) for x in v][:5]
                elif v:
                    out[str(k)] = [str(v)]
        return out

    pros = _coerce_map(raw.get("pros"))
    cons = _coerce_map(raw.get("cons"))
    # Guarantee every vendor has an entry so the UI never breaks
    for v in vendors:
        pros.setdefault(v, [])
        cons.setdefault(v, [])

    return {
        "summary":       str(raw.get("summary", "")).strip()[:1200]
                         or "The board reviewed the options across financial, technical, "
                            "strategic and compliance dimensions.",
        "justification": str(raw.get("justification", "")).strip()[:800]
                         or "Selected as the best overall fit given the board's deliberation.",
        "pros":          pros,
        "cons":          cons,
    }


def _synth_fallback(vendors: List[str], transcript: List[dict], winner: str) -> dict:
    return {
        "summary": (
            "The board debated the available options across each member's area of "
            "expertise. (Automated summary unavailable — see the full transcript below.)"
        ),
        "justification": f"{winner} drew the most support across the closing round.",
        "pros": {v: [] for v in vendors},
        "cons": {v: [] for v in vendors},
    }


def run_debate(
    requirements: str,
    vendor_info: str = "",
    selected_agents: Optional[List[str]] = None,
    vendors: Optional[List[str]] = None,
    agent_configs: Optional[dict] = None,
) -> dict:
    """
    Run the full multi-round boardroom debate.

    `agent_configs` is an optional {agent_id: personality_config} map so each agent
    debates and evaluates in the company-configured voice.

    Returns a dict with: vendors, agents (participants), rounds[], decision{}, powered_by.
    """
    agent_ids = _dedupe_agents(selected_agents)
    configs = agent_configs or {}
    agents = [AGENT_REGISTRY[aid](config=configs.get(aid)) for aid in agent_ids]

    vendor_list = vendors or _extract_vendors(requirements + " " + vendor_info)
    if len(vendor_list) < 2:
        vendor_list = (vendor_list + ["Alternative Option"])[:2]

    # ── Run the rounds ──────────────────────────────────────────────────────────
    transcript: List[dict] = []
    rounds: List[dict] = []
    for phase, label in PHASES:
        turns: List[dict] = []
        for agent in agents:
            turn = agent.speak(requirements, vendor_info, transcript, phase, vendor_list)
            transcript.append(turn)
            turns.append(turn)
        rounds.append({"phase": phase, "label": label, "turns": turns})

    # ── Derive the decision from the closing round ──────────────────────────────
    closing = rounds[-1]["turns"]
    winner, confidence = _pick_winner(closing, vendor_list)
    yes_votes = [t for t in closing if t.get("vote") == "YES"]
    no_votes  = [t for t in closing if t.get("vote") == "NO"]

    # Tag each closing turn with the vendor it backed (for the UI)
    for t in closing:
        pv = (t.get("preferred_vendor") or "").lower()
        t["voted_for"] = next(
            (v for v in vendor_list if pv and (pv in v.lower() or v.lower() in pv)),
            winner if t.get("vote") == "YES" else (vendor_list[-1] if vendor_list else ""),
        )

    # ── Quantitative scoring: mathematically-auditable compatibility matrix ──────
    transcript_text = "\n".join(f"{t['name']} ({t['phase']}): {t['message']}" for t in transcript)
    scorecards = score_all_vendors(vendor_list, requirements, vendor_info, transcript_text)
    # build_decision_matrix is the single source of truth: it scores every vendor against
    # the SAME normalized (union) requirement set. Derive each vendor's compatibility_score,
    # the winner, and the no-viable-vendor signal from it so the banner, the matrix table,
    # and the What-If simulator all use identical math and can never contradict each other.
    decision_matrix = build_decision_matrix(scorecards)
    all_constraints_failed = False
    if scorecards:
        totals = decision_matrix.get("totals", {})
        for sc in scorecards:
            sc["compatibility_score"] = round(totals.get(sc["vendor_name"], 0.0) * 100)

        best_idx = max(range(len(scorecards)), key=lambda i: scorecards[i]["compatibility_score"])
        winner = vendor_list[best_idx]
        vote_yes = sum(1 for r in rounds for t in r.get("turns", []) if t.get("vote") == "YES")
        vote_total = sum(1 for r in rounds for t in r.get("turns", []) if t.get("vote") in ("YES", "NO"))
        confidence = compute_derived_confidence(scorecards, vote_yes, vote_total)

        # A vendor "qualifies" iff it fails NO mandatory requirement in the normalized
        # matrix (identical to the frontend DecisionMatrix "no viable vendor" detection).
        # If none qualify, there is no valid winner — signal it instead of crowning the
        # least-bad option.
        mandatory_reqs = [r for r in decision_matrix.get("requirements", []) if r.get("mandatory")]

        def _qualifies(v: str) -> bool:
            return all(not r["scores"].get(v, {}).get("failed", False) for r in mandatory_reqs)

        all_constraints_failed = bool(mandatory_reqs) and not any(_qualifies(v) for v in vendor_list)
        if all_constraints_failed:
            winner = "NONE"
            confidence = 0

    synth = _synthesize(requirements, vendor_list, transcript, winner, confidence)

    agents_meta = [
        {"id": a.agent_id, "name": a.name, "icon": a.icon, "role": a.role}
        for a in agents
    ]

    return {
        "vendors":  vendor_list,
        "agents":   agents_meta,
        "rounds":   rounds,
        "decision": {
            "winner":                winner,
            "runner_up":             next((v for v in vendor_list if v != winner), ""),
            "confidence":            confidence,
            "all_constraints_failed": all_constraints_failed,
            "vote_summary":          {"yes": len(yes_votes), "no": len(no_votes), "total": len(closing)},
            "summary":               synth["summary"],
            "justification":         synth["justification"],
            "pros":                  synth["pros"],
            "cons":                  synth["cons"],
        },
        "scorecards": scorecards,
        "decision_matrix": decision_matrix,
        "powered_by": "real_agents",
    }
