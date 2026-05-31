# HANDOVER — Clarity (AI Purchasing Society)

> Context dump for the next Claude session. Read this first. It captures the architecture,
> conventions, gotchas, current state, and the non-obvious things you can't infer from the code.

Repo: `anushka-chandra/TechONhackathon` (GitHub), branch `main`.
Local path: `/Users/anushka/Hackathon/TechONhackathon`.
A user-facing summary lives in `README.md`; this file is the engineering/working handover.

---

## 1. What this is

Clarity is a hackathon web app for B2B procurement decisions. User defines requirements → picks an
AI board (CEO/CFO/CTO/CSO) → provides vendor info (upload / AI web search / type) → a multi-agent
**3-round debate** runs → user gets a scored, auditable recommendation + a What-If simulator,
downloadable PDF reports, and AI-drafted negotiation emails.

Branding: the app is "**Clarity**" (was "Nexus" / "AI Purchasing Society" earlier — the rename is
done; don't reintroduce "Nexus" in the UI).

---

## 2. Tech stack & versions

- **Frontend**: Next.js **16.2.6** (App Router, Turbopack), React **19.2.4**, Tailwind CSS **v4**
  (no `tailwind.config.ts` — uses `@theme` in `app/globals.css`), framer-motion, lucide-react.
- **Backend**: FastAPI + uvicorn + Pydantic **v2**, SQLAlchemy **2.0** with SQLite.
- **AI**: OpenRouter via the OpenAI SDK. Model = `google/gemini-2.5-flash` (env `AGENT_MODEL`).
  Web search via the `:online` model suffix.
- **PDF**: `pypdf` (extraction), `reportlab` 4.5.1 (formal report generation).

### Critical environment gotcha (will bite you)
There are TWO Pythons on this machine. The bare `uvicorn` on PATH resolves to **anaconda Python
3.12** which does NOT have the deps → `ModuleNotFoundError`. You MUST use **Python 3.9.6** via
`python3 -m uvicorn`. Also you must load `.env` first or the AI key is missing.

**Always start the backend like this (from repo root):**
```bash
set -a && source .env && set +a && python3 -m uvicorn ui.server:app --port 8000 --reload
```
(This is also saved in project memory as `backend-run-command`.)

Frontend:
```bash
cd frontend && npm run dev      # http://localhost:3000
```

---

## 3. Secrets / .env  (IMPORTANT)

- `.env` lives in repo root, is **gitignored**, and contains the user's real OpenRouter key.
  It was created during the session; **NEVER commit it**.
  ```
  OPENROUTER_API_KEY=sk-or-v1-...           # real key, do not echo/commit
  OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
  AGENT_MODEL=google/gemini-2.5-flash
  ```
- `.env` was historically *tracked* (empty) then untracked with `git rm --cached`; the real key was
  verified to have NEVER entered git history.
- There's also a stray `multi_agent_system/.env` the user opened once — the loaded one is the **root**
  `.env` (cwd = repo root when running uvicorn).
- **Before every commit**: stage, then run
  `git diff --cached -S "sk-or-v1" | grep -q "sk-or-v1" && echo ABORT || echo OK`
  and confirm `git check-ignore .env`. This guard has been run on every push so far.

---

## 4. Architecture & data flow

```
Browser ──(/api/py/* same-origin proxy)──> Next.js server ──> FastAPI (:8000) ──> SQLite + OpenRouter
```

- **Same-origin proxy** is key: the browser NEVER calls `:8000` directly (that broke on other
  machines). All frontend fetches go to `/api/py/...`, handled by
  `frontend/app/api/py/[...path]/route.ts`, which forwards (incl. multipart + binary PDFs) to
  `BACKEND_URL` (default `http://localhost:8000`) server-side. Keep using `/api/py/...` for any new
  backend calls. (Exception: `/api/summarize` has its own older proxy route; the requirement
  assistant/summary now use `/api/py/requirement-summary`.)
- **Session model** (SQLite via SQLAlchemy, `backend/database/`): a `Session` has one-to-one
  `step1` (requirements text + summary), `step2` (agents JSON + `configs_json` = per-agent
  personality), `step3` (method, vendor_names JSON, `vendor_text`). `/api/debate` loads
  `step2.configs` and passes them to `run_debate` so agents speak in the company's voice (works even
  with "All perspectives"). Vendor sources (uploads, AI-found, typed) are ALL stored in
  `step3.vendor_text` as
  `=== Document: <name> ===\n<text>` blocks — one standardized format. Parsing/classification keys
  off these headers.
- **4-source cap** (`MAX_VENDORS = 4` in `ui/server.py`): counts ALL sources (files + AI + typed)
  together. Enforced in upload (slices files), vendor-search (remaining slots), and add-vendor.

---

## 5. Backend (`ui/server.py`) — endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/sessions`, `/{id}/step1\|step2\|step3`, `GET /api/sessions[/{id}]`, `DELETE` | session CRUD |
| `POST /api/requirements-assistant` | Step 1 helper chatbot (Gemini, plain text reply) |
| `POST /api/requirement-summary` | requirements → {summary, bullets} (Gemini) |
| `POST /api/upload/{id}` | multi-file upload (`files`), extract, classify, store, detect vendors+category |
| `POST /api/vendor-search/{id}` | AI web search (`:online`) for vendors; appends; respects cap |
| `POST /api/sessions/{id}/add-vendor` | manually typed vendor → stored as a Document block |
| `POST /api/sessions/{id}/remove-document` | remove a source by name, reclassify |
| `POST /api/context` | returns brief + vendor_text + classified `documents` + suggested_vendors + category (NO debate run) |
| `POST /api/debate` | the big one: 3-round debate + scoring; returns rounds, decision, scorecards, decision_matrix, inputs |
| `POST /api/simulate` | older one-shot eval (legacy `/dashboard` page) |
| `POST /api/negotiate/{id}` | per-vendor negotiation email drafts (+ email lookup via `:online`) |
| `POST /api/decision-report` | formal long-form PDF (reportlab); accepts generalized payload |
| `POST /api/summarize` | legacy HF/truncation summary (mostly superseded) |

Shared helpers in `server.py`: `_build_brief`, `_session_vendor_text`, `_resolve_vendors`
(documents are source of truth for vendor names), `parse_documents`, `_good_text`,
`_build_step3_summary` (classify + extract vendors + detect category, persists vendor_names).

---

## 6. multi_agent_system/

- `agents/base_agent.py` — `BaseAgent`: wraps OpenRouter. `evaluate()` (one-shot JSON) and
  `speak()` (debate turn per phase: opening/rebuttal/closing). `_MODEL` from `AGENT_MODEL`. Has
  deterministic fallbacks when the API is down. `_RESPONSE_SCHEMA` and debate schemas defined here.
  **Personality:** `BaseAgent(config={tone,risk,decision,priority,communication})` →
  `_build_style_directive()` appends a "Behavioural Profile" block to `_persona()`, so the company's
  configured voice applies to BOTH the debate and the one-shot evaluate. (Note: this file now starts
  with `from __future__ import annotations` — Python 3.9 can't evaluate `X | None` at runtime.)
- `agents/{ceo,cfo,cto,cso,procurement}_agent.py` — personas. Display `name` = CEO/CFO/CTO/CSO; each
  `SYSTEM_PROMPT` is the user's **latest concise persona** (CEO = long-term direction / competitive
  position / execution at scale; CFO = cost structure / TCO / ROI / fiscal responsibility; CTO =
  technical integrity / integration depth / reliability / low lock-in; CSO = risk exposure /
  compliance / resilience / asset protection), each ending with `{_RESPONSE_SCHEMA}`. If the user
  sends a new persona prompt, replace the whole `SYSTEM_PROMPT` body (keep name/role/icon + the
  trailing `{_RESPONSE_SCHEMA}`). NOTE: the `agents/` folder also has unused leftover files
  (employee_agent, manager_agent, it_legal_agent, commitment_extractor, scoring_agent) — not wired
  into the debate; ignore unless asked.
- `orchestrator.py` — `run_society()` (one-shot, used by `/api/simulate`), `AGENT_REGISTRY`,
  `_pick_winner`, `_extract_vendors`.
- `debate.py` — the core: `run_debate(... agent_configs={id:config})` instantiates each agent with
  its company-set personality. `run_debate()` (3 rounds → moderator synth → **scoring drives winner**;
  the decision **confidence is now `compute_derived_confidence(scorecards, vote_yes, vote_total)`**,
  i.e. an auditable formula, NOT the LLM's self-reported number; if EVERY vendor fails a hard
  constraint, `decision.winner = "NONE"`, `confidence = 0`, and `decision.all_constraints_failed =
  true` — no "least-bad" vendor is crowned. The frontend now reads `decision.all_constraints_failed`
  and renders a dedicated red "No qualifying vendor" treatment (live summary banner + PDF/print report
  hero) instead of a green `NONE 🏆` trophy — see `frontend/app/debate/page.tsx` (`noWinner` flag)),
  `extract_vendor_names()` (cap 4, excludes noise), `detect_category()`, `classify_documents()`
  (vendor vs noise, any product type), `search_vendors()` (`:online` first, knowledge fallback,
  context_docs = good files only), `draft_negotiation_email()`.
- `scoring.py` — `build_decision_matrix(scorecards)`: deterministic normalized purchase-decision
  matrix across all vendors (weights: hard=2x/soft=1x normalized to sum 1; hard = pass/fail with 0 +
  FAILED flag; soft = proportional credit; per-requirement justification; totals + ranking +
  top-vendor explanation). Included in `run_debate` result as `decision_matrix`. Also:
  `score_all_vendors()` / `score_vendor()`: per-vendor auditable scorecard
  (hard_constraints_passed, requirements_matrix 0–1, persona_alignment 1–5, analytical_summary) +
  deterministic `compatibility_score` 0–100 = `(0.5*softMandatoryWeighted + 0.5*personaNorm) *
  hardModifier(1.0 or 0.25) * 100`. The frontend What-If simulator mirrors this formula client-side.
  Scoring rigor: `SCORING_SYSTEM_PROMPT` starts with an **Evidence-First rule** (rule 0 — no
  evidence in `<vendor_data>` ⇒ soft score 0.0 / mandatory `hard_constraints_passed=false`; never
  infer features); `score_vendor` runs at **temperature=0** (deterministic) and feeds up to **10k**
  chars each of vendor_data and the transcript. `score_vendor` also runs a cheap
  `_detect_evidence_gaps()` pass first and injects a `<evidence_gaps>` block into the prompt to
  pre-warn the scorer. `hard_constraints_passed` is **computed in Python** (`all(mandatory rows ≥
  0.5)`) — the LLM's top-level boolean is NOT trusted; and `_compute_score` defaults the hard
  modifier to the 0.25× penalty when the flag is missing. `compute_derived_confidence(scorecards, vote_yes, vote_total)` returns an
  auditable 10–97 confidence = 0.4·(winner−runner score gap) + 0.3·vote consensus + 0.3·winner score
  (used by `run_debate` for `decision.confidence`).

---

## 7. backend/

- `database/` — `engine.py` (SQLite at `backend/data/nexus.db`), `models.py`, `crud.py`.
- `pdf_extractor.py` — `extract_text(bytes|path)` via pypdf, MAX_CHARS 12000.
- `report_generator.py` — `build_decision_report_pdf(payload) -> bytes`. Formal whitepaper via
  ReportLab Platypus (auto wrapping/pagination — no manual coords). Sections: Executive Summary
  (essay), Normalized Catalog Matrix + Feature Coverage, Financial Simulation (TCO Month1/Month6),
  Auditable Evidence Log (verbatim transcript by agent). Accepts the generalized contract
  `{vendors:[{id,name,scores,features}], constraints:{budget,timelineMonths}, transcript:[{agent,role,text}]}`.

---

## 8. Frontend (`frontend/`)

**Pages**
- `app/page.tsx` — landing hero + 3-step wizard, all in one component. Key state: `hasStartedAnalysis`
  (hero→wizard gate), `fadingOut` (cross-fade transition), `phase`, `step`, `requirements`,
  `selectedAgents`, `sessionId`, `documents` (classified sources), `detectedCategory`, plus modal
  state for AI search / type-vendor / assistant chat. Single `return` renders `content` (hero / intro
  / wizard) wrapped in an opacity cross-fade div. `/?new=1` (from navbar New Chat) deep-links to Step 1.
- `app/debate/page.tsx` — the results experience: pre-debate **context review** (editable Step 1 +
  classified docs with flag/delete), animated debate, collapsible reasoning, decision panel. The
  Summary section renders (in order): winner banner → Debate Summary text → **SummaryCharts** (radar
  + cost-sensitivity) → **DecisionMatrix** (static) → pros/cons → **InteractiveSummaryPanel**
  (What-If). Also: print-to-PDF report overlay (`#decision-report`, includes a print-variant
  DecisionMatrix) and the negotiation modal. (The old "Motion before the board" banner was removed.)
  Reads `data.decision_matrix` / `data.scorecards` from the debate response.
- `app/dashboard/page.tsx` — older simulator view (still reachable, not in main flow).
- `app/projects/page.tsx`, `app/settings/page.tsx` — from the navbar.

**Components**: `NavBar.tsx` (Clarity brand, New Chat, Projects, Settings, Profile modal),
`InteractiveSummaryPanel.tsx` (interactive What-If simulator; exports the `Scorecard` type used by
others), `SummaryCharts.tsx` (inline-SVG Value Alignment Radar with vendor toggles + custom hover
tooltips, and a Tipping Point / Cost Sensitivity line chart with a team-size slider — isolated
state), `DecisionMatrix.tsx` (STATIC, non-interactive normalized matrix; `variant: 'dark' | 'print'`
— renders from `data.decision_matrix` in both the UI and the PDF report), `Sidebar.tsx` (LEGACY — no
longer imported).

**Contexts**: `ChatContext` (saved analyses in localStorage), `ThemeContext` (dark/light + language,
toggles `html.light`), `ProfileContext` (company info in localStorage). All wrap the app in
`app/layout.tsx`.

**Styling**: dark palette `#050505`/`#0d1117`/`#161b22`/`#30363d`, text `#e6edf3`/`#8b949e`/`#c9d1d9`,
accents `#58a6ff`/`#818cf8`/`#a371f7`, green `#3fb950`, red `#f85149`, amber `#d29922`. Theme CSS
vars (`--app-bg`, `--nav-bg`, `--panel`, etc.) in `globals.css` flip on `html.light`. The navbar +
app shell share `--app-bg = #050505` (seamless, no border). Reusable keyframes: `breathe`,
`pulse-ring`, `float`, `core-glow`, `node-twinkle`, `fade-in-up`, `turn-in`, `typing-bounce`.

---

## 9. Conventions / how to work here

- **Always** type-check the frontend after edits: `cd frontend && npx tsc --noEmit`
  (run from the `frontend/` dir — running elsewhere hits the wrong `tsc`).
- New backend calls from the browser → use `/api/py/<path>` (the proxy), not `http://localhost:8000`.
- After backend code changes, **restart uvicorn** (the run command above) — `--reload` helps but
  config/`.env` changes need a full restart.
- This Next.js is non-standard (16) — `useSearchParams` needs a Suspense boundary; route handler
  `params` is a `Promise` (`await ctx.params`); `next.config.ts` has `devIndicators: false` (needs a
  dev-server restart to hide the red "N" dev badge — it's not an app error).
- Commit messages end with the Co-Authored-By trailer (see prior commits). Only commit/push when the
  user asks. Verify no `.env`/key staged first (guard above).

---

## 10. Current state (as of this handover)

Everything is committed/pushed to `main`. Most recent work: the frontend "no qualifying vendor"
treatment — the debate page now renders a red `AlertTriangle` banner + red report hero when
`decision.all_constraints_failed` (via the `noWinner` flag) instead of a green `NONE 🏆` trophy,
finishing the NONE backend signal (`c6031e2`). `npx tsc --noEmit` from `frontend/` is clean. Couldn't
live-verify the NONE path because the OpenRouter wallet is depleted (§11, 402s). Configurable agent
personalities (`ab166d7`) and the NONE backend signal (`c6031e2`) are also on `main`.

Feature inventory that exists today (all live on `main`):
- **Landing** — Clarity hero (orb + neural net), opacity cross-fade into the wizard.
- **3-step wizard** — requirements (+ assistant chatbot), board selection (each agent has a
  **"Customize" panel**: tone / risk / decision style / priority slider / communication — persisted
  to `step2.configs` and applied to the debate, scoring justifications and report), vendor sources
  (Upload / AI Web Search / Type Details), pre-debate context review with flag/delete + the 4-source
  cap, all sources stored as standard Document blocks.
- **Debate** — 3-round multi-agent debate, animated playback, collapsible reasoning, moderator synth.
- **Decision/Summary** — winner banner, summary, **SummaryCharts** (radar + cost-sensitivity),
  **DecisionMatrix** (static, also in PDF), pros/cons, **InteractiveSummaryPanel** (What-If).
- **Scoring** — auditable per-vendor `compatibility_score` + `build_decision_matrix` (drives winner).
- **Outputs** — browser print-to-PDF report; formal long-form PDF via `/api/decision-report`
  (`backend/report_generator.py`, reportlab) — NOTE: endpoint exists but is **not yet wired to a UI
  button** (see §12); negotiation emails via `/api/negotiate`.
- **App shell** — top NavBar (New Chat / Projects / Settings / Profile), Projects + Settings pages,
  Theme/Profile/Chat contexts.
- **Docs** — `README.md` (plain-English), this `HANDOVER.md`, `requirements.txt` populated.

When you make new changes, update this section (and the rest of this file) accordingly.

---

## 11. Known limitations / honest caveats

- **Light mode** only fully themes the navbar/Projects/Settings; the immersive Home & Debate views
  stay dark by design. Full light theming is a follow-up.
- **Language** setting is a stored preference only — no i18n strings are wired (UI stays English).
- **Profile/sign-in** is localStorage only — no real auth backend.
- **Negotiation email lookup** may hallucinate plausible addresses — UI tells the user to verify.
- `:online` web search adds a small per-search $ surcharge (drove the $ spend up vs token count).
- OpenRouter: the key has a **$100 spend cap** (`/auth/key` shows usage ~$1.01, "remaining" ~$98.99)
  BUT the **account's actual credit wallet is depleted** — live API calls now return
  **`402 Insufficient credits`**. So as of this handover, ALL AI features silently fall back to
  empties/garbage (e.g. decision matrix shows placeholder vendors). This is NOT a code bug — the user
  must top up credits at https://openrouter.ai/settings/credits. The "remaining $98.99" is the key
  cap, not the wallet. Key expires **2026-06-05**.

---

## 12. Possible next steps (not requested yet)
- Wire a "Download formal report" button on the debate page that maps live scorecards/transcript into
  the `/api/py/decision-report` contract.
- Unify Debate/Dashboard backgrounds for full light-mode coverage.
- Capture real user-count/budget in Step 1 (currently the brief only carries requirements + vendors).
- Persist projects server-side (currently localStorage only).

---

## 13. Deployment (Railway backend + Vercel frontend)

Set up for: **backend → Railway (Docker)**, **frontend → Vercel**.

Files added for deploy:
- `Dockerfile` (repo root) — `python:3.9-slim`, installs `requirements.txt`, copies only
  `ui/ backend/ multi_agent_system/`, runs `uvicorn ui.server:app --host 0.0.0.0 --port ${PORT:-8000}`
  (Railway injects `$PORT`). `.dockerignore` excludes the frontend & cruft.
- `.env.example` (root, committed via a `!.env.example` gitignore exception) — the platform vars.
- `ui/__init__.py` + `multi_agent_system/__init__.py` added so the packages import reliably in-container.

Backend env/persistence:
- `backend/database/engine.py` reads `DATABASE_URL` (default local sqlite) and now creates the
  SQLite file's parent dir for ANY sqlite URL → works with a Railway **Volume**.
- For persistence: attach a Railway Volume mounted at `/data` and set
  `DATABASE_URL=sqlite:////data/nexus.db`. (Uploaded raw files in `backend/data/uploads` are
  ephemeral, but the extracted vendor TEXT lives in the DB, so debates still work after redeploys.)

Frontend proxy:
- `frontend/app/api/py/[...path]/route.ts` now targets
  `NEXT_PUBLIC_BACKEND_URL` (→ `BACKEND_URL` → `http://localhost:8000`), read at request time,
  trailing slash stripped. Set `NEXT_PUBLIC_BACKEND_URL` on Vercel to the live Railway URL.

Railway dashboard env: `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `AGENT_MODEL`,
`DATABASE_URL=sqlite:////data/nexus.db` (+ Volume at `/data`).
Vercel dashboard env: `NEXT_PUBLIC_BACKEND_URL=https://<railway-app>.up.railway.app`,
Root Directory = `frontend`.
Open the **Vercel** URL as the live app.
