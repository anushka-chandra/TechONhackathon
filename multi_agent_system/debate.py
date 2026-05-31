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

# Three debate rounds, in order
PHASES: list[tuple[str, str]] = [
    ("opening",  "Opening Statements"),
    ("rebuttal", "Rebuttals & Clashes"),
    ("closing",  "Closing Arguments"),
]


def extract_vendor_names(text: str, max_vendors: int = 5) -> List[str]:
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
                    "You identify the distinct software vendors or products being proposed in "
                    "procurement documents. Ignore any document that is NOT a vendor proposal "
                    "(recipes, unrelated notes, etc.)."},
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
) -> dict:
    """
    Run the full multi-round boardroom debate.

    Returns a dict with: vendors, agents (participants), rounds[], decision{}, powered_by.
    """
    agent_ids = _dedupe_agents(selected_agents)
    agents = [AGENT_REGISTRY[aid]() for aid in agent_ids]

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
            "winner":       winner,
            "runner_up":    next((v for v in vendor_list if v != winner), ""),
            "confidence":   confidence,
            "vote_summary": {"yes": len(yes_votes), "no": len(no_votes), "total": len(closing)},
            "summary":      synth["summary"],
            "justification": synth["justification"],
            "pros":         synth["pros"],
            "cons":         synth["cons"],
        },
        "powered_by": "real_agents",
    }
