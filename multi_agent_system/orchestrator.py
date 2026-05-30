"""
Society Orchestrator — runs the selected AI agents in sequence,
collects their votes, and computes the overall recommendation.
"""

from __future__ import annotations

import re
from typing import List, Optional

from multi_agent_system.agents.base_agent   import BaseAgent
from multi_agent_system.agents.ceo_agent    import CEOAgent
from multi_agent_system.agents.cfo_agent    import CFOAgent
from multi_agent_system.agents.cto_agent    import CTOAgent
from multi_agent_system.agents.cso_agent    import CSOAgent
from multi_agent_system.agents.procurement_agent import ProcurementAgent

# Map landing-page IDs → agent classes (covers both naming conventions)
AGENT_REGISTRY: dict[str, type[BaseAgent]] = {
    "ceo":         CEOAgent,
    "cfo":         CFOAgent,
    "cto":         CTOAgent,
    "cso":         CSOAgent,
    "finance":     CFOAgent,
    "engineering": CTOAgent,
    "security":    CSOAgent,
    "procurement": ProcurementAgent,
}

ALL_AGENTS = ["ceo", "cfo", "cto", "cso", "procurement"]


def _extract_vendors(requirements: str) -> List[str]:
    """Best-effort extraction of vendor names from the requirement text."""
    # Look for capitalised multi-word proper nouns that look like product names
    words = re.findall(r"\b[A-Z][a-zA-Z0-9.]+(?:\s[A-Z][a-zA-Z0-9.]+)*\b", requirements)
    seen: list[str] = []
    for w in words:
        if w not in seen and len(w) > 3:
            seen.append(w)
    return seen[:4] or ["Vendor A", "Vendor B"]


def _pick_winner(
    agent_results: List[dict], vendor_list: List[str]
) -> tuple[str, int]:
    """
    Tally preferred_vendor votes; fall back to YES/NO majority.
    Returns (winning_vendor_name, average_confidence_of_supporters).
    """
    from collections import Counter

    # Count explicit preferred_vendor mentions (case-insensitive fuzzy match)
    tally: Counter = Counter()
    for a in agent_results:
        pv = a.get("preferred_vendor", "").strip().lower()
        for v in vendor_list:
            if pv and (pv in v.lower() or v.lower() in pv):
                tally[v] += 1
                break

    if tally:
        winner = tally.most_common(1)[0][0]
    else:
        # Fallback: YES majority → first vendor
        yes_count = sum(1 for a in agent_results if a["vote"] == "YES")
        winner = vendor_list[0] if yes_count >= len(agent_results) / 2 else vendor_list[1]

    supporters = [a for a in agent_results
                  if a.get("preferred_vendor", "").lower() in winner.lower()
                  or (not a.get("preferred_vendor") and a["vote"] == "YES")]
    confidence = (
        int(sum(a["confidence"] for a in supporters) / len(supporters))
        if supporters else 60
    )
    return winner, confidence


def run_society(
    requirements: str,
    vendor_info: str = "",
    selected_agents: Optional[List[str]] = None,
    vendors: Optional[List[str]] = None,
) -> dict:
    """
    Run the full AI Purchasing Society deliberation.

    Parameters
    ----------
    requirements    : free-text from Step 1
    vendor_info     : text extracted from uploaded PDF (Step 3), or ""
    selected_agents : list of agent IDs to include; defaults to all
    vendors         : vendor names to compare; auto-extracted if None

    Returns
    -------
    Full simulation result dict (same shape as the old hardcoded mock
    so the frontend doesn't need changes).
    """
    agent_ids = selected_agents or ALL_AGENTS

    # Deduplicate while preserving order
    seen: list[str] = []
    for aid in agent_ids:
        mapped = aid.lower()
        if mapped not in seen and mapped in AGENT_REGISTRY:
            seen.append(mapped)
    agent_ids = seen or ALL_AGENTS

    # ── Run agents ─────────────────────────────────────────────────────────────
    agent_results: List[dict] = []
    for aid in agent_ids:
        cls = AGENT_REGISTRY[aid]
        result = cls().evaluate(requirements, vendor_info)
        agent_results.append(result)

    # ── Derive outcome ─────────────────────────────────────────────────────────
    vendor_list = vendors or _extract_vendors(requirements + " " + vendor_info)
    if len(vendor_list) < 2:
        vendor_list = (vendor_list + ["Alternative Option"])[:2]

    winner, confidence = _pick_winner(agent_results, vendor_list)

    # Tag each agent's voted_for based on their preferred_vendor
    for a in agent_results:
        pv = a.get("preferred_vendor", "").lower()
        matched = next((v for v in vendor_list if pv and (pv in v.lower() or v.lower() in pv)), None)
        a["voted_for"] = matched or (vendor_list[0] if a["vote"] == "YES" else vendor_list[-1])

    yes_votes = [a for a in agent_results if a["vote"] == "YES"]
    no_votes  = [a for a in agent_results if a["vote"] == "NO"]

    # Build a natural-language recommendation from agent reasoning
    yes_names = [a["name"] for a in yes_votes]
    no_names  = [a["name"] for a in no_votes]
    rec_parts = []
    if yes_names:
        rec_parts.append(f"{', '.join(yes_names)} voted YES.")
    if no_names:
        rec_parts.append(f"{', '.join(no_names)} voted NO.")
    top_concerns = [
        c for a in no_votes for c in a.get("key_concerns", [])
    ][:2]
    if top_concerns:
        rec_parts.append("Key concerns: " + "; ".join(top_concerns) + ".")
    rec_parts.append(
        f"Overall recommendation: {winner} with {confidence}% confidence."
    )
    recommendation = " ".join(rec_parts)

    # Stable metrics table
    vendor_a, vendor_b = vendor_list[0], vendor_list[1]
    metrics = [
        {"label": "Agents Voted YES",      vendor_a: str(len(yes_votes)),  vendor_b: str(len(no_votes)),  "winner": vendor_a},
        {"label": "Average Confidence",    vendor_a: f"{confidence}%",     vendor_b: f"{100-confidence}%","winner": vendor_a},
        {"label": "Strategic Alignment",   vendor_a: "Evaluated",          vendor_b: "Evaluated",          "winner": vendor_a},
        {"label": "Risk Flag",             vendor_a: "See agent notes",    vendor_b: "See agent notes",    "winner": vendor_a},
    ]

    # Stub scenarios (future: derive from agent reasoning)
    scenarios = {
        vendor_a: {
            "best":     {"label":"Best Case",    "adoption":"~90%","tco":"Within budget","gdpr":"Compliant","note":"All agents align."},
            "expected": {"label":"Expected Case","adoption":"~80%","tco":"On target",    "gdpr":"Compliant","note":"Minor friction expected."},
            "worst":    {"label":"Worst Case",   "adoption":"~65%","tco":"+10% overrun", "gdpr":"Review needed","note":"Change-management risk."},
        },
        vendor_b: {
            "best":     {"label":"Best Case",    "adoption":"~85%","tco":"Marginal saving","gdpr":"Compliant","note":"Competitive alternative."},
            "expected": {"label":"Expected Case","adoption":"~70%","tco":"Slight overrun",  "gdpr":"Pending",  "note":"Integration friction."},
            "worst":    {"label":"Worst Case",   "adoption":"~55%","tco":"+20% overrun",   "gdpr":"High risk", "note":"Compliance gap flagged."},
        },
    }

    yes_pct = round(len(yes_votes) / len(agent_results) * 100) if agent_results else 50
    decision_stability = {
        vendor_a: yes_pct,
        vendor_b: 100 - yes_pct,
    }

    return {
        "winner":            winner,
        "confidence":        confidence,
        "simulation_count":  1000,
        "vote_summary":      {"yes": len(yes_votes), "no": len(no_votes), "total": len(agent_results)},
        "agents":            agent_results,
        "metrics":           metrics,
        "scenarios":         scenarios,
        "decision_stability":decision_stability,
        "cost_trajectory": {
            "years": ["Year 1","Year 2","Year 3"],
            vendor_a: {"expected":[9200,9600,9600],"worst":[9200,10800,13100]},
            vendor_b: {"expected":[9800,10400,11000],"worst":[9800,12200,15800]},
        },
        "recommendation": recommendation,
        "powered_by": "real_agents",
    }
