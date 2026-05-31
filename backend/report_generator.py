"""
Formal long-form "Procurement Decision Report" generator.

Produces a corporate-whitepaper-style PDF (paragraph-driven prose, structured
tables, financial simulation, and an auditable evidence log) intended for
leadership defense — deliberately contrasting with the brief, bulleted web UI.

Built on ReportLab Platypus (flowables), so text wrapping, table pagination and
page breaks are handled by the layout engine — there are no manual coordinates
to overlap.

Public entry point:
    build_decision_report_pdf(payload: dict) -> bytes

Payload contract (generalised, >= 2 vendors):
    {
      "vendors": [{ "id": str, "name": str, "scores": {metric: number}, "features": [str] }, ...],
      "constraints": { "budget": number, "timelineMonths": number },
      "transcript": [{ "agent": str, "role": str, "text": str }, ...]
    }
"""

from __future__ import annotations

from io import BytesIO
from statistics import mean
from typing import Any, Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate,
    Spacer, Table, TableStyle,
)

# ── Page geometry ────────────────────────────────────────────────────────────────
PAGE_SIZE = A4
LEFT_MARGIN = RIGHT_MARGIN = 18 * mm
TOP_MARGIN = 24 * mm
BOTTOM_MARGIN = 20 * mm
CONTENT_WIDTH = PAGE_SIZE[0] - LEFT_MARGIN - RIGHT_MARGIN

# ── Palette (muted, corporate) ───────────────────────────────────────────────────
INK = colors.HexColor("#1a2230")
SUBINK = colors.HexColor("#445064")
ACCENT = colors.HexColor("#2f3a8f")
RULE = colors.HexColor("#c7cede")
HEAD_BG = colors.HexColor("#1f2747")
ROW_ALT = colors.HexColor("#f3f5fb")
GOOD = colors.HexColor("#15803d")
WARN = colors.HexColor("#b45309")


# ── Numeric / formatting helpers ─────────────────────────────────────────────────
def _num(value: Any) -> Optional[float]:
    """Best-effort numeric coercion; returns None for non-numerics."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "").replace("€", "").replace("$", "").replace("%", "")
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _money(amount: float) -> str:
    return f"€{amount:,.0f}"


def _p(text: str) -> str:
    """Escape free text for ReportLab's mini-XML paragraph parser."""
    return escape(str(text or ""))


# ── Styles ───────────────────────────────────────────────────────────────────────
def _styles() -> dict:
    base = getSampleStyleSheet()
    s: dict = {}
    s["title"] = ParagraphStyle(
        "ReportTitle", parent=base["Title"], fontName="Helvetica-Bold",
        fontSize=24, leading=28, textColor=INK, spaceAfter=4,
    )
    s["subtitle"] = ParagraphStyle(
        "ReportSubtitle", parent=base["Normal"], fontName="Helvetica",
        fontSize=11, leading=15, textColor=SUBINK, spaceAfter=2,
    )
    s["section"] = ParagraphStyle(
        "Section", parent=base["Heading1"], fontName="Helvetica-Bold",
        fontSize=14, leading=18, textColor=ACCENT, spaceBefore=18, spaceAfter=6,
    )
    s["subsection"] = ParagraphStyle(
        "SubSection", parent=base["Heading2"], fontName="Helvetica-Bold",
        fontSize=11.5, leading=15, textColor=INK, spaceBefore=10, spaceAfter=4,
    )
    s["body"] = ParagraphStyle(
        "Body", parent=base["Normal"], fontName="Helvetica",
        fontSize=10.5, leading=16, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=8,
    )
    s["quote"] = ParagraphStyle(
        "Quote", parent=base["Normal"], fontName="Helvetica-Oblique",
        fontSize=10, leading=15, textColor=INK, leftIndent=10, spaceAfter=6,
        alignment=TA_LEFT, borderColor=RULE, borderWidth=0,
    )
    s["agent"] = ParagraphStyle(
        "Agent", parent=base["Normal"], fontName="Helvetica-Bold",
        fontSize=10.5, leading=14, textColor=ACCENT, spaceBefore=8, spaceAfter=2,
    )
    s["cell"] = ParagraphStyle(
        "Cell", parent=base["Normal"], fontName="Helvetica", fontSize=8.5,
        leading=11, textColor=INK,
    )
    s["cellhead"] = ParagraphStyle(
        "CellHead", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
        leading=11, textColor=colors.white,
    )
    s["small"] = ParagraphStyle(
        "Small", parent=base["Normal"], fontName="Helvetica", fontSize=8.5,
        leading=12, textColor=SUBINK, spaceAfter=6,
    )
    return s


# ── Analytics derived from the generalised payload ───────────────────────────────
def _analyse(payload: dict) -> dict:
    vendors = payload.get("vendors", []) or []
    constraints = payload.get("constraints", {}) or {}
    budget = _num(constraints.get("budget")) or 0.0
    months = int(_num(constraints.get("timelineMonths")) or 12) or 12

    # Union of all metric keys across vendors → the "normalized metric" rows
    metric_keys: list[str] = []
    for v in vendors:
        for k in (v.get("scores") or {}):
            if k not in metric_keys:
                metric_keys.append(k)

    # Per-metric maximum (for relative 0-100 normalisation; higher assumed better)
    max_by_metric: dict[str, float] = {}
    for m in metric_keys:
        vals = [_num((v.get("scores") or {}).get(m)) for v in vendors]
        vals = [x for x in vals if x is not None]
        max_by_metric[m] = max(vals) if vals else 1.0 or 1.0

    norm: dict[str, dict[str, Optional[float]]] = {}
    overall: dict[str, float] = {}
    for v in vendors:
        vid = v.get("id") or v.get("name")
        row: dict[str, Optional[float]] = {}
        for m in metric_keys:
            raw = _num((v.get("scores") or {}).get(m))
            denom = max_by_metric.get(m) or 1.0
            row[m] = (raw / denom * 100.0) if (raw is not None and denom) else None
        norm[vid] = row
        present = [x for x in row.values() if x is not None]
        overall[vid] = mean(present) if present else 0.0

    ranked = sorted(vendors, key=lambda v: overall.get(v.get("id") or v.get("name"), 0.0), reverse=True)

    # Financials per vendor
    costs: dict[str, dict] = {}
    for v in vendors:
        vid = v.get("id") or v.get("name")
        costs[vid] = _vendor_costs(v, budget, months)

    return {
        "vendors": vendors, "ranked": ranked, "metric_keys": metric_keys,
        "max_by_metric": max_by_metric, "norm": norm, "overall": overall,
        "budget": budget, "months": months, "costs": costs,
    }


def _vendor_costs(vendor: dict, budget: float, months: int) -> dict:
    """Derive an onboarding fee + recurring monthly cost from the vendor scores,
    falling back to the budget/timeline envelope when pricing isn't supplied."""
    scores = vendor.get("scores") or {}

    def find(keywords: tuple) -> Optional[float]:
        for k, val in scores.items():
            kl = str(k).lower()
            if any(t in kl for t in keywords):
                n = _num(val)
                if n is not None:
                    return n
        return None

    onboarding = find(("onboard", "setup", "implementation", "one-time", "onetime"))
    monthly = find(("monthly", "per month", "permonth", "subscription", "seat", "license", "price", "/mo"))
    if monthly is None:
        monthly = find(("cost", "fee", "tco"))

    timeline = max(1, months)
    if monthly is None:
        monthly = round(budget / timeline, 2) if budget else 0.0
    if onboarding is None:
        onboarding = round(monthly, 2)  # assume ~one month-equivalent to stand up

    horizon = min(6, timeline)
    return {
        "onboarding": onboarding,
        "monthly": monthly,
        "month1": onboarding + monthly,
        "month6": onboarding + monthly * horizon,
        "horizon": horizon,
        "full_term": onboarding + monthly * timeline,
    }


def _name(vendor: dict) -> str:
    return vendor.get("name") or vendor.get("id") or "Unnamed Vendor"


def _scalability_leader(a: dict) -> Optional[dict]:
    """Vendor strongest on architecture/scalability/integration-type metrics."""
    keys = [m for m in a["metric_keys"]
            if any(t in m.lower() for t in ("scal", "architect", "integrat", "growth", "technical", "strateg"))]
    if not keys:
        return a["ranked"][0] if a["ranked"] else None
    best, best_val = None, -1.0
    for v in a["vendors"]:
        vid = v.get("id") or v.get("name")
        vals = [a["norm"][vid].get(k) for k in keys if a["norm"][vid].get(k) is not None]
        score = mean(vals) if vals else 0.0
        if score > best_val:
            best, best_val = v, score
    return best


def _budget_leader(a: dict) -> Optional[dict]:
    """Vendor with the lowest 6-month cumulative expenditure."""
    if not a["vendors"]:
        return None
    return min(a["vendors"], key=lambda v: a["costs"][v.get("id") or v.get("name")]["month6"])


# ── Section builders ─────────────────────────────────────────────────────────────
def _executive_summary(a: dict, st: dict) -> list:
    flow: list = []
    flow.append(Paragraph("1.&nbsp;&nbsp;Executive Summary", st["section"]))

    ranked = a["ranked"]
    if not ranked:
        flow.append(Paragraph("No vendors were supplied for evaluation.", st["body"]))
        return flow

    recommended = ranked[0]
    runner = ranked[1] if len(ranked) > 1 else None
    rec_name = _name(recommended)
    rec_id = recommended.get("id") or rec_name
    rec_score = a["overall"].get(rec_id, 0.0)

    scal = _scalability_leader(a)
    budg = _budget_leader(a)
    scal_name = _name(scal) if scal else rec_name
    budg_name = _name(budg) if budg else rec_name
    budget = a["budget"]
    months = a["months"]

    para1 = (
        f"This report documents the formal evaluation of {len(a['vendors'])} candidate vendors against the "
        f"organisation&rsquo;s stated procurement constraints — a capital envelope of {_money(budget)} assessed over a "
        f"{months}-month planning horizon. Following a structured, multi-perspective deliberation, "
        f"<b>{_p(rec_name)}</b> emerges as the recommended counterparty, achieving the highest normalised composite "
        f"rating of {rec_score:.0f} of 100 across the evaluated dimensions. The recommendation is advanced not as an "
        f"unconditional endorsement, but as the optimal resolution of a genuine strategic tension that surfaced "
        f"during the assessment."
    )
    flow.append(Paragraph(para1, st["body"]))

    if scal_name != budg_name:
        para2 = (
            f"That tension is most precisely characterised as a conflict between long-term architectural "
            f"scalability and short-term budgetary discipline. <b>{_p(scal_name)}</b> presents the stronger "
            f"long-horizon profile, offering the architectural headroom and integration depth required to absorb "
            f"future organisational complexity without a disruptive re-platforming event. <b>{_p(budg_name)}</b>, by "
            f"contrast, exerts materially less pressure on the {_money(budget)} envelope, preserving near-term cash "
            f"flexibility at the cost of a comparatively constrained capability ceiling. Leadership is therefore "
            f"asked to adjudicate between deferred-risk avoidance and immediate cost containment."
        )
    else:
        para2 = (
            f"Notably, <b>{_p(rec_name)}</b> reconciles the two competing imperatives of the evaluation — long-term "
            f"architectural scalability and short-term budgetary discipline — within a single proposition, "
            f"simultaneously leading on capability headroom while remaining defensible against the {_money(budget)} "
            f"constraint. This convergence materially de-risks the decision and underpins the strength of the "
            f"recommendation."
        )
    flow.append(Paragraph(para2, st["body"]))

    if runner:
        para3 = (
            f"On balance, the evaluation favours {_p(rec_name)} over the principal alternative, "
            f"{_p(_name(runner))}, on the strength of its composite alignment with the organisation&rsquo;s "
            f"requirements. The sections that follow substantiate this position through a normalised capability "
            f"matrix, a quantified total-cost-of-ownership simulation, and a verbatim record of the deliberation "
            f"that informed the conclusion, such that the decision remains fully auditable and defensible to "
            f"executive stakeholders."
        )
        flow.append(Paragraph(para3, st["body"]))
    return flow


def _catalog_matrix(a: dict, st: dict) -> list:
    flow: list = []
    flow.append(Paragraph("2.&nbsp;&nbsp;Normalized Catalog Matrix", st["section"]))
    flow.append(Paragraph(
        "The matrix below maps each vendor&rsquo;s raw capability declarations to a normalised 0&ndash;100 scale "
        "(indexed to the strongest performer on each dimension) to permit a like-for-like comparison independent of "
        "the vendors&rsquo; native scoring conventions.", st["body"],
    ))

    vendors = a["vendors"]
    metric_keys = a["metric_keys"]

    # ── Normalised evaluation-metric grid ──
    if metric_keys:
        header = [Paragraph("Evaluation Metric", st["cellhead"])] + \
                 [Paragraph(_p(_name(v)), st["cellhead"]) for v in vendors]
        rows = [header]
        for m in metric_keys:
            line = [Paragraph(_p(m.replace("_", " ").title()), st["cell"])]
            for v in vendors:
                vid = v.get("id") or v.get("name")
                raw = (v.get("scores") or {}).get(m)
                nval = a["norm"][vid].get(m)
                cell = "&mdash;" if nval is None else f"<b>{nval:.0f}</b> <font color='#7a8499'>({_p(raw)})</font>"
                line.append(Paragraph(cell, st["cell"]))
            rows.append(line)
        # Composite row
        comp = [Paragraph("<b>Composite (mean)</b>", st["cell"])]
        for v in vendors:
            vid = v.get("id") or v.get("name")
            comp.append(Paragraph(f"<b>{a['overall'].get(vid, 0):.0f}</b>", st["cell"]))
        rows.append(comp)

        first = 52 * mm
        rest = (CONTENT_WIDTH - first) / max(1, len(vendors))
        tbl = Table(rows, colWidths=[first] + [rest] * len(vendors), repeatRows=1)
        tbl.setStyle(_grid_style(len(rows), composite_row=len(rows) - 1))
        flow.append(tbl)
        flow.append(Paragraph(
            "Each cell reports the normalised index with the vendor&rsquo;s raw declared value in parentheses.",
            st["small"],
        ))

    # ── Feature coverage grid ──
    all_features: list[str] = []
    for v in vendors:
        for f in (v.get("features") or []):
            if f not in all_features:
                all_features.append(f)
    if all_features:
        flow.append(Paragraph("2.1&nbsp;&nbsp;Feature Coverage", st["subsection"]))
        header = [Paragraph("Feature", st["cellhead"])] + \
                 [Paragraph(_p(_name(v)), st["cellhead"]) for v in vendors]
        rows = [header]
        for f in all_features:
            line = [Paragraph(_p(f), st["cell"])]
            for v in vendors:
                present = f in (v.get("features") or [])
                mark = f"<font color='#15803d'><b>&#10003;</b></font>" if present else "<font color='#9aa3b2'>&ndash;</font>"
                line.append(Paragraph(mark, st["cell"]))
            rows.append(line)
        first = 78 * mm
        rest = (CONTENT_WIDTH - first) / max(1, len(vendors))
        tbl = Table(rows, colWidths=[first] + [rest] * len(vendors), repeatRows=1)
        tbl.setStyle(_grid_style(len(rows)))
        flow.append(tbl)

    return flow


def _grid_style(nrows: int, composite_row: Optional[int] = None) -> TableStyle:
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), HEAD_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for r in range(1, nrows):
        if r % 2 == 0:
            cmds.append(("BACKGROUND", (0, r), (-1, r), ROW_ALT))
    if composite_row is not None:
        cmds.append(("BACKGROUND", (0, composite_row), (-1, composite_row), colors.HexColor("#e6eafc")))
        cmds.append(("LINEABOVE", (0, composite_row), (-1, composite_row), 1, ACCENT))
    return TableStyle(cmds)


def _financial_simulation(a: dict, st: dict) -> list:
    flow: list = []
    flow.append(Paragraph("3.&nbsp;&nbsp;Quantifiable Financial Simulation", st["section"]))
    budget = a["budget"]
    months = a["months"]
    flow.append(Paragraph(
        f"The following simulation quantifies the total cost of ownership (TCO) for each candidate against the "
        f"{_money(budget)} budgetary ceiling. Two control points are isolated: the <b>Month&nbsp;1 cash outflow</b>, "
        f"which combines first-period recurring charges with any one-time onboarding and implementation fees, and the "
        f"<b>Month&nbsp;6 cumulative expenditure</b>, which establishes the medium-term run-rate trajectory.", st["body"],
    ))

    # Summary table
    header = [Paragraph(t, st["cellhead"]) for t in
              ("Vendor", "Onboarding", "Monthly", "Month 1 Outflow", "Month 6 Cumulative", f"Full Term ({months}m)")]
    rows = [header]
    for v in a["ranked"]:
        vid = v.get("id") or v.get("name")
        c = a["costs"][vid]
        rows.append([
            Paragraph(_p(_name(v)), st["cell"]),
            Paragraph(_money(c["onboarding"]), st["cell"]),
            Paragraph(_money(c["monthly"]), st["cell"]),
            Paragraph(_money(c["month1"]), st["cell"]),
            Paragraph(_money(c["month6"]), st["cell"]),
            Paragraph(_money(c["full_term"]), st["cell"]),
        ])
    col0 = 40 * mm
    rest = (CONTENT_WIDTH - col0) / 5
    tbl = Table(rows, colWidths=[col0] + [rest] * 5, repeatRows=1)
    tbl.setStyle(_grid_style(len(rows)))
    flow.append(tbl)
    flow.append(Spacer(1, 6))

    # Per-vendor narrative
    for v in a["ranked"]:
        vid = v.get("id") or v.get("name")
        c = a["costs"][vid]
        within = c["full_term"] <= budget if budget else None
        verdict = (
            "remains within the approved budgetary envelope over the full planning horizon"
            if within else
            "exceeds the approved budgetary envelope over the full planning horizon and would require either a "
            "budget variance or a negotiated concession"
        ) if budget else "is presented for comparison; no binding budget ceiling was supplied"
        narrative = (
            f"<b>{_p(_name(v))}.</b> Standing the platform up incurs a one-time onboarding and implementation charge "
            f"of {_money(c['onboarding'])}, which, combined with the first recurring period of {_money(c['monthly'])}, "
            f"produces a Month&nbsp;1 cash outflow of <b>{_money(c['month1'])}</b>. By the close of Month&nbsp;6, "
            f"cumulative expenditure reaches <b>{_money(c['month6'])}</b>, settling into a steady-state monthly "
            f"run-rate of {_money(c['monthly'])}. Projected across the {months}-month horizon, total cost of "
            f"ownership is {_money(c['full_term'])}; on this basis the vendor {verdict}."
        )
        flow.append(Paragraph(narrative, st["body"]))

    return flow


def _evidence_log(a: dict, payload: dict, st: dict) -> list:
    flow: list = []
    flow.append(PageBreak())
    flow.append(Paragraph("4.&nbsp;&nbsp;Auditable Evidence Log", st["section"]))
    flow.append(Paragraph(
        "This section preserves, verbatim and attributed, the logical assumptions and contentions advanced by each "
        "board agent during the deliberation. It is retained to ensure the recommendation is fully traceable to its "
        "supporting argumentation and can withstand subsequent scrutiny.", st["body"],
    ))

    transcript = payload.get("transcript", []) or []
    if not transcript:
        flow.append(Paragraph("No deliberation transcript was supplied.", st["body"]))
        return flow

    # Group by agent, preserving first-seen order
    order: list[str] = []
    grouped: dict[str, dict] = {}
    for entry in transcript:
        agent = str(entry.get("agent") or "Board Member").strip()
        if agent not in grouped:
            grouped[agent] = {"role": entry.get("role") or "", "quotes": []}
            order.append(agent)
        if entry.get("text"):
            grouped[agent]["quotes"].append(str(entry["text"]))
            if not grouped[agent]["role"] and entry.get("role"):
                grouped[agent]["role"] = entry["role"]

    for agent in order:
        g = grouped[agent]
        head = _p(agent) + (f" &mdash; <font color='#445064'>{_p(g['role'])}</font>" if g["role"] else "")
        block: list = [Paragraph(head, st["agent"])]
        for q in g["quotes"]:
            block.append(Paragraph(f"&ldquo;{_p(q)}&rdquo;", st["quote"]))
        # Keep an agent's heading with at least its first quote together
        flow.append(KeepTogether(block[:2]))
        for extra in block[2:]:
            flow.append(extra)

    return flow


# ── Page furniture (header / footer drawn on every page) ──────────────────────────
def _make_page_decorator(title: str):
    def _decorate(canvas, doc):
        canvas.saveState()
        width, height = PAGE_SIZE
        # Header rule + running title
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(SUBINK)
        canvas.drawString(LEFT_MARGIN, height - 14 * mm, title)
        canvas.drawRightString(width - RIGHT_MARGIN, height - 14 * mm, "CONFIDENTIAL")
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(LEFT_MARGIN, height - 16 * mm, width - RIGHT_MARGIN, height - 16 * mm)
        # Footer rule + page number
        canvas.line(LEFT_MARGIN, 14 * mm, width - RIGHT_MARGIN, 14 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(LEFT_MARGIN, 10 * mm, "Clarity · AI Purchasing Society")
        canvas.drawRightString(width - RIGHT_MARGIN, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()
    return _decorate


def _cover(a: dict, st: dict) -> list:
    flow: list = [Spacer(1, 8 * mm)]
    flow.append(Paragraph("Procurement Decision Report", st["title"]))
    flow.append(Paragraph("Formal Evaluation &amp; Recommendation for Executive Review", st["subtitle"]))
    flow.append(Spacer(1, 3))
    rec = a["ranked"][0] if a["ranked"] else None
    if rec:
        flow.append(Paragraph(
            f"Recommended vendor: <b>{_p(_name(rec))}</b> &nbsp;·&nbsp; Candidates evaluated: "
            f"{len(a['vendors'])} &nbsp;·&nbsp; Budget: {_money(a['budget'])} &nbsp;·&nbsp; Horizon: "
            f"{a['months']} months", st["subtitle"],
        ))
    flow.append(Spacer(1, 6))
    flow.append(HRFlowable(width="100%", thickness=1.2, color=ACCENT, spaceAfter=2))
    return flow


# ── Public entry point ───────────────────────────────────────────────────────────
def build_decision_report_pdf(payload: dict) -> bytes:
    """Render the full Procurement Decision Report and return the PDF as bytes."""
    a = _analyse(payload or {})
    st = _styles()

    rec_name = _name(a["ranked"][0]) if a["ranked"] else "Procurement Decision"
    title = f"Procurement Decision Report — {rec_name}"

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=PAGE_SIZE,
        leftMargin=LEFT_MARGIN, rightMargin=RIGHT_MARGIN,
        topMargin=TOP_MARGIN, bottomMargin=BOTTOM_MARGIN,
        title=title, author="Clarity · AI Purchasing Society",
    )

    story: list = []
    story += _cover(a, st)
    story += _executive_summary(a, st)
    story += _catalog_matrix(a, st)
    story += _financial_simulation(a, st)
    story += _evidence_log(a, payload or {}, st)

    decorate = _make_page_decorator(title)
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return buf.getvalue()
