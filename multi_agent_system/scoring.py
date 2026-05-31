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
0. EVIDENCE-FIRST RULE: Before assigning any score, locate the exact sentence or data point in \
<vendor_data> that supports it. If no direct evidence exists in the vendor document, the score MUST \
be 0.0 for soft requirements and hard_constraints_passed must be set to false for mandatory ones. \
Never infer, assume, or guess that a feature exists unless it is explicitly stated in the vendor data.
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


def _detect_evidence_gaps(requirements: str, vendor_data: str, vendor_name: str) -> list[str]:
    """
    Returns a list of requirement topics that have no supporting evidence in the
    vendor document. Used to pre-warn the scoring prompt. Returns [] on any
    failure so it never blocks the pipeline.
    """
    if not vendor_data.strip() or not requirements.strip():
        return []
    try:
        resp = _client().chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": "You identify missing information in vendor documents."},
                {"role": "user", "content": (
                    f"User requirements:\n{requirements[:3000]}\n\n"
                    f"Vendor document for {vendor_name}:\n{vendor_data[:6000]}\n\n"
                    "List every requirement topic from the user requirements that is NOT addressed "
                    "anywhere in the vendor document. Be specific. "
                    'Return JSON only: {"gaps": ["topic 1", "topic 2"]}'
                )},
            ],
            response_format={"type": "json_object"},
            max_tokens=300,
            temperature=0,
        )
        result = json.loads(resp.choices[0].message.content)
        return [str(g).strip() for g in result.get("gaps", []) if str(g).strip()]
    except Exception:
        return []


def score_vendor(vendor_name: str, requirements: str, vendor_data: str, transcript: str) -> dict:
    """Score a single vendor; returns the normalised scorecard + compatibility_score."""
    gaps = _detect_evidence_gaps(requirements, vendor_data or "", vendor_name)
    gap_block = (
        "\n\n<evidence_gaps>\nThe following requirement topics have NO supporting evidence "
        "in the vendor document. You MUST score them 0.0 (soft) or mark hard_constraints_passed "
        "= false (mandatory):\n"
        + "\n".join(f"- {g}" for g in gaps)
        + "\n</evidence_gaps>"
        if gaps else ""
    )
    user = (
        f"<user_requirements>\n{requirements}\n</user_requirements>\n\n"
        f"<vendor_data>\n{(vendor_data or 'No vendor documents provided.')[:10000]}\n</vendor_data>\n\n"
        f"<board_debate_transcript>\n{transcript[:10000]}\n</board_debate_transcript>\n\n"
        f"{gap_block}"
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
            temperature=0,
        )
        card = _normalise_card(json.loads(resp.choices[0].message.content), vendor_name)
    except Exception:
        card = _fallback_card(vendor_name)

    card["compatibility_score"] = _compute_score(card)
    return card


def score_all_vendors(vendors: List[str], requirements: str, vendor_data: str, transcript: str) -> List[dict]:
    return [score_vendor(v, requirements, vendor_data, transcript) for v in vendors]


def _one_sentence(text: str, limit: int = 200) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    first = text.split(". ")[0].rstrip(".")
    return (first + ".")[:limit]


def build_decision_matrix(scorecards: List[dict]) -> dict:
    """
    Build one normalized, mathematically-grounded purchase-decision matrix across
    ALL vendors from their scorecards. Each requirement is weighted (hard = 2x,
    soft = 1x, then normalized to sum to 1). Hard constraints are pass/fail: a
    vendor that does not meet a hard constraint scores 0 and is marked FAILED;
    soft constraints receive proportional partial credit (the 0-1 factual score).
    Aggregation, totals and ranking are computed internally — only final results
    are returned (no formulas/intermediates exposed).
    """
    vendors = [sc.get("vendor_name", "") for sc in scorecards]
    if not vendors:
        return {"vendors": [], "requirements": [], "totals": {}, "ranking": [], "explanation": ""}

    # Merge requirements across vendors by canonical (lowercased) name
    order: List[str] = []
    canon: dict = {}
    for sc in scorecards:
        vn = sc.get("vendor_name", "")
        for m in sc.get("requirements_matrix", []) or []:
            crit = str(m.get("criterion", "")).strip()
            if not crit:
                continue
            lc = crit.lower()
            if lc not in canon:
                canon[lc] = {"name": crit, "mandatory": False, "raw": {}}
                order.append(lc)
            if m.get("is_mandatory"):
                canon[lc]["mandatory"] = True
            canon[lc]["raw"][vn] = {
                "score": max(0.0, min(1.0, float(m.get("score", 0) or 0))),
                "evidence": str(m.get("evidence", "")),
            }

    total_weight = sum(2 if canon[lc]["mandatory"] else 1 for lc in order) or 1
    totals = {v: 0.0 for v in vendors}
    requirements: List[dict] = []

    for lc in order:
        c = canon[lc]
        weight = (2 if c["mandatory"] else 1) / total_weight
        scores: dict = {}
        for v in vendors:
            raw = c["raw"].get(v)
            if raw is None:
                value, failed = 0.0, c["mandatory"]
            elif c["mandatory"]:
                passed = raw["score"] >= 0.5
                value, failed = (1.0 if passed else 0.0), (not passed)
            else:
                value, failed = round(raw["score"], 2), False
            scores[v] = {"score": round(value, 2), "failed": failed}
            totals[v] += weight * value

        best_v = max(vendors, key=lambda v: scores[v]["score"])
        best_ev = (c["raw"].get(best_v) or {}).get("evidence", "")
        justification = _one_sentence(best_ev) or f"Best aligned with {best_v}."
        failed_vendors = [v for v in vendors if scores[v]["failed"]]
        if c["mandatory"] and failed_vendors:
            justification = justification.rstrip(".") + f". Hard constraint failed by {', '.join(failed_vendors)}."

        requirements.append({
            "name": c["name"],
            "mandatory": c["mandatory"],
            "weight": round(weight, 3),
            "scores": scores,
            "justification": justification[:240],
        })

    ranking = sorted(
        ({"vendor": v, "total": round(totals[v], 3)} for v in vendors),
        key=lambda x: x["total"], reverse=True,
    )

    explanation = ""
    if ranking:
        top = ranking[0]["vendor"]
        runner = ranking[1]["vendor"] if len(ranking) > 1 else ""
        top_fails = [r["name"] for r in requirements if r["scores"][top]["failed"]]
        strengths = sorted(
            requirements, key=lambda r: r["weight"] * r["scores"][top]["score"], reverse=True,
        )[:2]
        sname = ", ".join(s["name"] for s in strengths if s["scores"][top]["score"] > 0)
        explanation = (
            f"{top} ranks first with the strongest weighted alignment overall"
            + (f", led by {sname}" if sname else "")
            + ("; it satisfies all hard constraints" if not top_fails
               else f"; note unmet hard constraints: {', '.join(top_fails)}")
            + (f", placing it ahead of {runner}." if runner else ".")
        )

    return {
        "vendors": vendors,
        "requirements": requirements,
        "totals": {v: round(totals[v], 3) for v in vendors},
        "ranking": ranking,
        "explanation": explanation,
    }


def compute_derived_confidence(scorecards: list[dict], vote_yes: int, vote_total: int) -> int:
    """
    Computes a mathematically derived confidence percentage for the winning
    vendor. This replaces the LLM's self-reported confidence so the number is
    fully auditable. Formula (weighted blend of three factors):
    - gap_factor:     how much better the winner scores vs runner-up (weight 0.4)
    - vote_factor:    board vote consensus (yes / total) (weight 0.3)
    - quality_factor: absolute compatibility score of winner (weight 0.3)
    Returns an integer 10-97 (never 0 or 100 — those aren't defensible).
    """
    if not scorecards:
        return 50
    sorted_cards = sorted(scorecards, key=lambda c: c.get("compatibility_score", 0), reverse=True)
    winner_score = sorted_cards[0].get("compatibility_score", 50)
    runner_score = sorted_cards[1].get("compatibility_score", 0) if len(sorted_cards) > 1 else 0
    gap_factor = min((winner_score - runner_score) / 100, 1.0)
    vote_factor = vote_yes / max(vote_total, 1)
    quality_factor = winner_score / 100
    raw = (0.4 * gap_factor + 0.3 * vote_factor + 0.3 * quality_factor) * 100
    return round(min(max(raw, 10), 97))
