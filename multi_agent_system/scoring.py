"""
Strategic Procurement Scoring Engine.

Turns the board debate transcript + user requirements + vendor data into a
structured, mathematically-auditable compatibility scorecard per vendor:
hard constraints (pass/fail), a soft requirements matrix (0-1), persona
alignment scores (1-5), and evidence strings. The final compatibility score
is computed deterministically in Python from the LLM's structured output.
"""

from __future__ import annotations

import json
from typing import List

from multi_agent_system.agents.base_agent import _client, _MODEL


SCORING_SYSTEM_PROMPT = """\
You are the core quantitative analysis module of an enterprise purchasing engine. Your job is to \
translate qualitative boardroom debate transcripts, explicit user requirements, and vendor \
documentation into a structured, highly reliable, and mathematically auditable compatibility matrix.

INPUTS PROVIDED
1. <user_requirements>: mandatory (hard) and preferred (soft) constraints.
2. <vendor_data>: extracted facts from vendor documentation (pricing, features, hosting location).
3. <board_debate_transcript>: the conversation between the CEO, CTO, CFO, and CSO personas.

INSTRUCTIONS & LOGIC CONSTRAINTS
1. HARD CONSTRAINTS (Pass/Fail): identify critical requirements (e.g. "Must be EU-hosted",
   "Budget max 400€/month"). If the vendor violates a hard constraint, set hard_constraints_passed
   to false.
2. SOFT REQUIREMENTS MATRIX (0.0-1.0): rate feature alignment from evidence.
   1.0 = fully satisfies/exceeds; 0.5 = partially / has limitations; 0.0 = missing/unviable.
3. PERSONA ALIGNMENT SCORES (1-5): extract each board member's conclusion from the transcript
   (CEO: strategic fit/scalability; CTO: architecture/API/integration; CFO: TCO/ROI/budget;
   CSO: compliance/data protection/access controls).
4. CONFIDENCE & JUSTIFICATION: every score MUST include a 1-sentence evidence string citing the
   specific data point or agent argument used. No scores without evidence.

OUTPUT FORMAT — respond ONLY with a valid JSON object matching this schema, no prose, no markdown:
{
  "vendor_name": "String",
  "hard_constraints_passed": true,
  "requirements_matrix": [
    {"criterion": "String", "is_mandatory": true, "score": 0.0, "evidence": "String"}
  ],
  "persona_alignment": {
    "CEO": {"score": 5, "evidence": "String"},
    "CTO": {"score": 4, "evidence": "String"},
    "CFO": {"score": 2, "evidence": "String"},
    "CSO": {"score": 5, "evidence": "String"}
  },
  "analytical_summary": {
    "primary_growth_driver": "String",
    "primary_risk_factor": "String"
  }
}"""

_PERSONAS = ("CEO", "CTO", "CFO", "CSO")


def _clamp(v, lo, hi, default):
    try:
        return max(lo, min(hi, type(default)(v)))
    except (TypeError, ValueError):
        return default


def _normalise_card(raw: dict, vendor_name: str) -> dict:
    matrix = []
    for m in raw.get("requirements_matrix", []) or []:
        if not isinstance(m, dict):
            continue
        matrix.append({
            "criterion":    str(m.get("criterion", "")).strip()[:120],
            "is_mandatory": bool(m.get("is_mandatory", False)),
            "score":        round(_clamp(m.get("score", 0.0), 0.0, 1.0, 0.0), 2),
            "evidence":     str(m.get("evidence", "")).strip()[:300],
        })

    personas = {}
    raw_personas = raw.get("persona_alignment", {}) or {}
    for p in _PERSONAS:
        entry = raw_personas.get(p, {}) if isinstance(raw_personas, dict) else {}
        entry = entry if isinstance(entry, dict) else {}
        personas[p] = {
            "score":    _clamp(entry.get("score", 3), 1, 5, 3),
            "evidence": str(entry.get("evidence", "")).strip()[:300],
        }

    summary = raw.get("analytical_summary", {}) or {}
    summary = summary if isinstance(summary, dict) else {}

    return {
        "vendor_name":             vendor_name,
        "hard_constraints_passed": bool(raw.get("hard_constraints_passed", True)),
        "requirements_matrix":     matrix,
        "persona_alignment":       personas,
        "analytical_summary": {
            "primary_growth_driver": str(summary.get("primary_growth_driver", "")).strip()[:400],
            "primary_risk_factor":   str(summary.get("primary_risk_factor", "")).strip()[:400],
        },
    }


def _compute_score(card: dict) -> int:
    """
    Deterministic, auditable compatibility score (0-100):
      soft   = mandatory-weighted average of the requirements matrix (0-1)
      persona= normalised average of the four persona scores (0-1)
      base   = 0.5*soft + 0.5*persona
      score  = round(base * hard_modifier * 100), hard_modifier = 1.0 (pass) or 0.25 (fail)
    """
    matrix = card.get("requirements_matrix", [])
    if matrix:
        num = den = 0.0
        for m in matrix:
            w = 2.0 if m.get("is_mandatory") else 1.0
            num += w * float(m.get("score", 0.0))
            den += w
        soft = num / den if den else 0.5
    else:
        soft = 0.5

    pvals = [p["score"] for p in card.get("persona_alignment", {}).values() if isinstance(p, dict)]
    persona = (sum(pvals) / len(pvals) - 1) / 4 if pvals else 0.5
    persona = max(0.0, min(1.0, persona))

    base = 0.5 * soft + 0.5 * persona
    hard_modifier = 1.0 if card.get("hard_constraints_passed", True) else 0.25
    return round(base * hard_modifier * 100)


def _fallback_card(vendor_name: str) -> dict:
    return {
        "vendor_name":             vendor_name,
        "hard_constraints_passed": True,
        "requirements_matrix":     [],
        "persona_alignment":       {p: {"score": 3, "evidence": "Scoring engine unavailable."} for p in _PERSONAS},
        "analytical_summary": {
            "primary_growth_driver": "",
            "primary_risk_factor":   "Automated scorecard unavailable — see the debate transcript.",
        },
    }


def score_vendor(vendor_name: str, requirements: str, vendor_data: str, transcript: str) -> dict:
    """Score a single vendor; returns the normalised scorecard + compatibility_score."""
    user = (
        f"<user_requirements>\n{requirements}\n</user_requirements>\n\n"
        f"<vendor_data>\n{(vendor_data or 'No vendor documents provided.')[:4000]}\n</vendor_data>\n\n"
        f"<board_debate_transcript>\n{transcript[:6000]}\n</board_debate_transcript>\n\n"
        f"Target vendor to score: {vendor_name}\n"
        f"Return the JSON scorecard for THIS vendor only."
    )
    try:
        resp = _client().chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": SCORING_SYSTEM_PROMPT},
                {"role": "user",   "content": user},
            ],
            response_format={"type": "json_object"},
            max_tokens=1100,
            temperature=0.2,
        )
        card = _normalise_card(json.loads(resp.choices[0].message.content), vendor_name)
    except Exception:
        card = _fallback_card(vendor_name)

    card["compatibility_score"] = _compute_score(card)
    return card


def score_all_vendors(vendors: List[str], requirements: str, vendor_data: str, transcript: str) -> List[dict]:
    return [score_vendor(v, requirements, vendor_data, transcript) for v in vendors]
