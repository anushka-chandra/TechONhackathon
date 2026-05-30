import os
import requests as http

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from backend.storage.session_store import store as session_store

app = FastAPI(title="AI Purchasing Society API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Maps landing-page agent IDs to simulation agent IDs
AGENT_ID_MAP = {
    "ceo":         "ceo",
    "cfo":         "finance",
    "cto":         "engineering",
    "cso":         "security",
    "finance":     "finance",
    "engineering": "engineering",
    "security":    "security",
    "procurement": "procurement",
}


class SimulateRequest(BaseModel):
    target: str = "Project Management Software"
    users: int = 100
    budget: float = 30000
    vendors: List[str] = ["Asana", "Monday.com"]
    selected_agents: Optional[List[str]] = None  # IDs from the landing page


@app.get("/")
def root():
    return {"status": "AI Purchasing Society API is running"}


@app.post("/api/simulate")
def simulate(req: SimulateRequest):
    vendor_a = req.vendors[0] if len(req.vendors) > 0 else "Asana"
    vendor_b = req.vendors[1] if len(req.vendors) > 1 else "Monday.com"

    agents = [
        {
            "id": "ceo",
            "name": "CEO Agent",
            "icon": "👔",
            "role": "Strategic Fit Evaluator",
            "stance": "Evaluating Strategic Fit",
            "reasoning": f"{vendor_a} aligns better with long-term growth goals and team scalability for {req.users} users.",
            "vote": "YES",
            "confidence": 82,
            "voted_for": vendor_a,
        },
        {
            "id": "finance",
            "name": "Finance Agent",
            "icon": "💰",
            "role": "3-Year TCO Modeler",
            "stance": "Modeling 3-Year TCO",
            "reasoning": f"{vendor_a} 3-yr TCO is €28,400 vs €31,200 for {vendor_b}. Under the €{req.budget:,.0f} ceiling.",
            "vote": "YES",
            "confidence": 91,
            "voted_for": vendor_a,
        },
        {
            "id": "security",
            "name": "Security Agent",
            "icon": "🔒",
            "role": "GDPR & Compliance Auditor",
            "stance": "Auditing GDPR & Compliance",
            "reasoning": f"{vendor_b} has unresolved EU data residency gaps in its future scaling roadmap. Flagging risk.",
            "vote": "NO",
            "confidence": 68,
            "voted_for": vendor_a,
        },
        {
            "id": "engineering",
            "name": "Engineering Agent",
            "icon": "⚙️",
            "role": "API & Integration Analyst",
            "stance": "Checking API & Integration Friction",
            "reasoning": f"{vendor_a} scores 9.2/10 on API quality. Native Slack/Jira connectors reduce integration overhead.",
            "vote": "YES",
            "confidence": 87,
            "voted_for": vendor_a,
        },
        {
            "id": "procurement",
            "name": "Procurement Agent",
            "icon": "📦",
            "role": "Vendor Pricing Normalizer",
            "stance": "Normalizing Vendor Pricing",
            "reasoning": f"Normalized per-seat cost favours {vendor_a} at €23.7/user/mo vs €26.0 for {vendor_b}.",
            "vote": "YES",
            "confidence": 79,
            "voted_for": vendor_a,
        },
    ]

    metrics = [
        {
            "label": "Human Adoption Rate",
            vendor_a: "87%",
            vendor_b: "79%",
            "winner": vendor_a,
        },
        {
            "label": "Friction Score (lower = better)",
            vendor_a: "2.1 / 10",
            vendor_b: "3.8 / 10",
            "winner": vendor_a,
        },
        {
            "label": "Collaboration Score",
            vendor_a: "8.9 / 10",
            vendor_b: "8.1 / 10",
            "winner": vendor_a,
        },
        {
            "label": "API Integration Quality",
            vendor_a: "9.2 / 10",
            vendor_b: "7.4 / 10",
            "winner": vendor_a,
        },
        {
            "label": "3-Year TCO (100 users)",
            vendor_a: "€28,400",
            vendor_b: "€31,200",
            "winner": vendor_a,
        },
        {
            "label": "GDPR Compliance Rating",
            vendor_a: "96 / 100",
            vendor_b: "88 / 100",
            "winner": vendor_a,
        },
        {
            "label": "Onboarding Time (days)",
            vendor_a: "7",
            vendor_b: "12",
            "winner": vendor_a,
        },
    ]

    scenarios = {
        vendor_a: {
            "best": {
                "label": "Best Case",
                "adoption": "94%",
                "tco": "€25,800",
                "gdpr": "Passed ✓",
                "note": "Full Slack/Jira automation. Adoption exceeds forecast.",
            },
            "expected": {
                "label": "Expected Case",
                "adoption": "87%",
                "tco": "€28,400",
                "gdpr": "Compliant ✓",
                "note": "Minor API friction resolved Q2. On-budget.",
            },
            "worst": {
                "label": "Worst Case",
                "adoption": "71%",
                "tco": "€33,100",
                "gdpr": "Sub-processor audit required",
                "note": "Change fatigue slows adoption. Add-on licensing spikes cost.",
            },
        },
        vendor_b: {
            "best": {
                "label": "Best Case",
                "adoption": "88%",
                "tco": "€29,500",
                "gdpr": "Conditionally compliant ⚠️",
                "note": "EU data residency resolved via new region launch.",
            },
            "expected": {
                "label": "Expected Case",
                "adoption": "79%",
                "tco": "€31,200",
                "gdpr": "Pending review ⏳",
                "note": "Exceeds budget by 4%. API workarounds needed.",
            },
            "worst": {
                "label": "Worst Case",
                "adoption": "62%",
                "tco": "€37,800",
                "gdpr": "High risk — regulatory action ✗",
                "note": "Data residency breach triggers audit. Tier upgrade forced.",
            },
        },
    }

    decision_stability = {
        vendor_a: 74,
        vendor_b: 26,
    }

    cost_trajectory = {
        "years": ["Year 1", "Year 2", "Year 3"],
        vendor_a: {
            "expected": [9200, 9600, 9600],
            "worst": [9200, 10800, 13100],
        },
        vendor_b: {
            "expected": [9800, 10400, 11000],
            "worst": [9800, 12200, 15800],
        },
    }

    # Filter to only the agents chosen on the landing page (if provided)
    if req.selected_agents:
        allowed = {AGENT_ID_MAP.get(a, a) for a in req.selected_agents}
        agents = [a for a in agents if a["id"] in allowed]

    yes_votes = sum(1 for a in agents if a["vote"] == "YES")
    no_votes = sum(1 for a in agents if a["vote"] == "NO")

    return {
        "winner": vendor_a,
        "confidence": 84,
        "simulation_count": 1000,
        "vote_summary": {"yes": yes_votes, "no": no_votes, "total": len(agents)},
        "agents": agents,
        "metrics": metrics,
        "scenarios": scenarios,
        "decision_stability": decision_stability,
        "cost_trajectory": cost_trajectory,
        "recommendation": (
            f"Proceed with {vendor_a} on a 12-month initial contract. "
            "Trigger a GDPR sub-processor re-evaluation at Month 6. "
            f"Re-open vendor comparison if {vendor_a} adoption falls below 80% at the 9-month review."
        ),
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


# ── Session storage endpoints ──────────────────────────────────────────────────
# Each endpoint maps to one step in the frontend onboarding flow.

class Step1Body(BaseModel):
    text: str
    summary: Optional[str] = None


class Step2Body(BaseModel):
    agents: List[str]          # e.g. ["ceo", "cfo"]


class Step3Body(BaseModel):
    method: str                # "upload" | "search"
    vendor_names: Optional[List[str]] = None


@app.post("/api/sessions", status_code=201)
def create_session():
    """Step 0 — open a new session before any step data is submitted."""
    session = session_store.create_session()
    return {"session_id": session.id, "status": session.status}


@app.post("/api/sessions/{session_id}/step1")
def save_step1(session_id: str, body: Step1Body):
    """Step 1 — store the user's free-text requirement."""
    try:
        session = session_store.save_step1(
            session_id, text=body.text, summary=body.summary
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session.id, "status": session.status, "step": 1}


@app.post("/api/sessions/{session_id}/step2")
def save_step2(session_id: str, body: Step2Body):
    """Step 2 — store the selected AI board agents."""
    try:
        session = session_store.save_step2(session_id, agents=body.agents)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"session_id": session.id, "status": session.status, "step": 2}


@app.post("/api/sessions/{session_id}/step3")
def save_step3(session_id: str, body: Step3Body):
    """Step 3 — store the vendor input method and optional vendor names."""
    try:
        session = session_store.save_step3(
            session_id,
            method=body.method,
            vendor_names=body.vendor_names,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"session_id": session.id, "status": session.status, "step": 3}


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    """Retrieve the full state of a session."""
    session = session_store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.model_dump()


@app.get("/api/sessions")
def list_sessions():
    """Return the lightweight index of all sessions."""
    return session_store.list_all()


@app.delete("/api/sessions/{session_id}", status_code=204)
def delete_session(session_id: str):
    """Remove a session from disk."""
    found = session_store.delete(session_id)
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")
