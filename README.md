# Clarity — AI Purchasing Society

**Turn vendor noise into a defensible decision.**

Clarity is a web app that helps companies make B2B purchasing decisions. You describe what you
want to buy, give it information about the candidate vendors (upload files, type details, or let an
AI find them online), and a virtual "boardroom" of specialised AI agents (CEO, CFO, CTO, CSO)
**debates** the options across several rounds. You then get a clear, scored recommendation you can
defend to leadership — plus tools to stress-test the decision and even draft negotiation emails.

It was built for the TechON hackathon.

---

## What it does, step by step

1. **Landing page** — A sleek dark home screen ("Clarity") with an animated decision-core orb and a
   neural-network background. Click **Start Analysis** (or the orb itself) and a smooth cross-fade
   takes you into the workflow.

2. **Step 1 — Define your requirements** — Type what you need to buy (budget, must-have features,
   compliance, etc.). A built-in **chat assistant** ("Need help?") guides you with the right
   questions if you're not sure what to include. Your text is also summarised into short bullet
   points behind the scenes.

3. **Step 2 — Select your AI Board** — Choose which executive perspectives should evaluate the
   options: **CEO** (strategy), **CFO** (finance/TCO), **CTO** (technical/integration), **CSO**
   (security/compliance). Pick any combination.

4. **Step 3 — Provide vendor information** — Three ways to add vendors, and you can **mix them**.
   A maximum of **4 vendor sources** total:
   - **Upload Files** — one or more PDFs / text files. Clarity extracts the text.
   - **AI Web Search** — tell it a category (or leave blank to base it on your uploads) and it finds
     up to 4 real vendors online with details.
   - **Type Details** — manually type each vendor's information if you have no documents.
   - Every source is **screened**: files that don't actually contain vendor/product information
     (e.g. a recipe) are **flagged in red** and can be removed before the debate. You can keep a
     flagged file if you want — its content still feeds the debate.

5. **Review screen (before the debate runs)** — Clarity shows you **exactly what will be sent to the
   agents**: your Step 1 requirements (editable here) and the text read from each vendor source.
   Nothing hits the AI until you click **Start the Debate**, so you can verify everything first.

6. **The Boardroom Debate** — The selected agents argue over **3 rounds** (Opening → Rebuttal →
   Closing), reacting to each other by name. You watch it play out live, turn by turn. When it's
   done, the full transcript collapses into a "Show the board's full debate" toggle so the **final
   decision sits on top**.

7. **The Decision** — You get:
   - A **winner** with a confidence score and a plain-English justification.
   - A **debate summary** and **pros/cons** for each vendor.
   - A **Compatibility Matrix** with a deterministic, auditable score (0–100) per vendor.
   - A **What-If Sensitivity Simulator** — sliders to re-weight the board's priorities
     (CEO/CFO/CTO/CSO), a "minimum requirement bar", and a hard-constraint toggle that
     **instantly re-rank the vendors** without re-running the AI.

8. **After the decision** — Two more tools:
   - **Download Decision Report** — a polished PDF you can take to leadership.
   - **Draft Negotiation Emails** — a sales-negotiation agent writes a tailored email to each
     vendor (telling them a competitor is ahead and inviting a better offer as a PDF), and even
     tries to find their contact email. You review/edit and send via your own mail client.

---

## Full feature list (plain English)

**Inputs & sources**
- Free-text requirement entry with an AI helper chatbot.
- Upload multiple PDF/text files at once; text is extracted automatically.
- AI web search that finds real vendors (uses live web results when available).
- Manual "type a vendor" entry — each typed vendor is treated exactly like an uploaded one.
- All three source types combine and are capped at 4 total.
- Automatic detection of the product **category** and the real **vendor names** from your sources.
- Noise filtering: non-vendor files are flagged with a reason and can be deleted in-app.

**The debate**
- A multi-agent boardroom of CEO, CFO, CTO, CSO (each with a detailed, role-specific personality).
- 3-round debate where agents genuinely respond to each other.
- Live, animated turn-by-turn playback with a typing indicator.
- A neutral moderator that writes the summary, the recommendation, and pros/cons.

**Scoring & analysis**
- A quantitative scoring engine producing an auditable 0–100 compatibility score per vendor
  (hard constraints pass/fail, soft requirements 0–1, persona alignment 1–5, with evidence for
  every score).
- The score — not just the vote — decides the winner.
- Interactive "What-If" simulator to re-weight priorities and re-rank vendors live, client-side.

**Outputs**
- Browser print-to-PDF decision report (with charts) from the debate screen.
- A separate, formal **long-form PDF whitepaper** (executive summary essay, normalized matrix,
  TCO financial simulation, and a verbatim evidence log of the debate) for leadership defense.
- AI-drafted vendor negotiation emails with contact lookup.

**App shell**
- Top navigation bar: **New Chat**, **Projects** (saved analyses), **Settings** (light/dark theme
  + language), and a **Profile** (company info / sign-in saved locally).
- Past analyses are saved and can be reopened from the Projects page.
- Dark, glassy "Clarity" design throughout; responsive on desktop and mobile.

---

## How it's built

**Frontend** — [Next.js](https://nextjs.org) 16 (App Router, React 19) + Tailwind CSS v4, in
`frontend/`. The browser only ever talks to the Next.js server, which **proxies** API calls to the
backend (`/api/py/...`) so the app works from any machine, not just where the backend runs.

**Backend** — [FastAPI](https://fastapi.tiangolo.com) (Python) in `ui/server.py`, with the agent
logic in `multi_agent_system/` and helpers in `backend/`. Data is stored in a local SQLite database
via SQLAlchemy.

**AI** — All AI calls go through [OpenRouter](https://openrouter.ai) using the OpenAI SDK. The model
is **Google Gemini 2.5 Flash** (`google/gemini-2.5-flash`), chosen for being cheap and capable. Web
search uses OpenRouter's `:online` capability. If the AI is unavailable, agents fall back to safe
deterministic responses so the app never crashes.

**PDF** — Document text extraction uses `pypdf`; the formal report is generated with `reportlab`.

---

## Project structure

```
TechONhackathon/
├── frontend/                # Next.js app (the UI)
│   ├── app/
│   │   ├── page.tsx         # Landing hero + 3-step wizard
│   │   ├── debate/page.tsx  # Boardroom debate + decision + report/negotiation
│   │   ├── projects/        # Saved analyses
│   │   ├── settings/        # Theme + language
│   │   └── api/py/[...path] # Proxy to the FastAPI backend
│   ├── components/          # NavBar, InteractiveSummaryPanel, etc.
│   └── context/             # Chat, Theme, Profile React contexts
├── ui/server.py             # FastAPI app — all API endpoints
├── multi_agent_system/
│   ├── agents/              # CEO / CFO / CTO / CSO / Procurement personas
│   ├── orchestrator.py      # One-shot evaluation
│   ├── debate.py            # 3-round debate + vendor search + classification
│   └── scoring.py           # Quantitative compatibility scoring engine
├── backend/
│   ├── database/            # SQLAlchemy models, engine, CRUD (SQLite)
│   ├── pdf_extractor.py     # PDF → text
│   └── report_generator.py  # Formal long-form PDF whitepaper
└── requirements.txt
```

---

## Running it locally

You need **Python 3.9+** and **Node.js 18+**.

### 1. Backend (FastAPI)

Create a `.env` file in the project root (this file is gitignored — never commit it):

```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
AGENT_MODEL=google/gemini-2.5-flash
```

Install dependencies and start the server **(load the .env first, and use `python3 -m uvicorn` so
the right interpreter is used):**

```bash
pip install -r requirements.txt
set -a && source .env && set +a && python3 -m uvicorn ui.server:app --port 8000 --reload
```

The API runs at `http://localhost:8000`.

### 2. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

> To use it from another computer on your network, start Next with `npm run dev -- -H 0.0.0.0` and
> browse to your machine's IP. If the backend runs on a different host, set `BACKEND_URL` in the
> frontend's environment.

---

## Main API endpoints (backend)

| Endpoint | What it does |
|---|---|
| `POST /api/sessions` (+ `/step1`, `/step2`, `/step3`) | Create and update a user session |
| `POST /api/requirements-assistant` | Step 1 helper chatbot |
| `POST /api/requirement-summary` | Summarise requirements into bullets |
| `POST /api/upload/{id}` | Upload & extract vendor files |
| `POST /api/vendor-search/{id}` | AI web search for vendors |
| `POST /api/sessions/{id}/add-vendor` | Add a manually typed vendor |
| `POST /api/sessions/{id}/remove-document` | Remove a source |
| `POST /api/context` | Show exactly what will be sent to the agents |
| `POST /api/debate` | Run the 3-round debate + scoring |
| `POST /api/negotiate/{id}` | Draft vendor negotiation emails |
| `POST /api/decision-report` | Generate the formal long-form PDF |

---

## Notes

- **The OpenRouter API key is required** for the AI features and lives only in `.env` (never
  committed). Running costs are tiny — a full set of analyses costs well under a euro.
- This is a hackathon project: "sign-in" and the company profile are stored in the browser (no real
  authentication), and the AI may occasionally guess a vendor's contact email — always verify before
  sending anything.
