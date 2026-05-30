from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

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
