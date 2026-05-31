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
  `step1` (requirements text + summary), `step2` (agents JSON), `step3` (method, vendor_names JSON,
  `vendor_text`). Vendor sources (uploads, AI-found, typed) are ALL stored in `step3.vendor_text` as
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
| `POST /api/debate` | the big one: 3-round debate + scoring; returns rounds, decision, scorecards, inputs |
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
- `agents/{ceo,cfo,cto,cso,procurement}_agent.py` — personas. **Renamed** to CEO/CFO/CSO/CTO
  (display `name`), each with a detailed, user-authored, role-specific `SYSTEM_PROMPT`
  (generalized to "the software/product under consideration"). NOTE: the `agents/` folder also has
  unused leftover files (employee_agent, manager_agent, it_legal_agent, commitment_extractor,
  scoring_agent) — not wired into the debate; ignore unless asked.
- `orchestrator.py` — `run_society()` (one-shot, used by `/api/simulate`), `AGENT_REGISTRY`,
  `_pick_winner`, `_extract_vendors`.
- `debate.py` — the core: `run_debate()` (3 rounds → moderator synth → **scoring drives winner**),
  `extract_vendor_names()` (cap 4, excludes noise), `detect_category()`, `classify_documents()`
  (vendor vs noise, any product type), `search_vendors()` (`:online` first, knowledge fallback,
  context_docs = good files only), `draft_negotiation_email()`.
- `scoring.py` — `score_all_vendors()` / `score_vendor()`: per-vendor auditable scorecard
  (hard_constraints_passed, requirements_matrix 0–1, persona_alignment 1–5, analytical_summary) +
  deterministic `compatibility_score` 0–100 = `(0.5*softMandatoryWeighted + 0.5*personaNorm) *
  hardModifier(1.0 or 0.25) * 100`. The frontend What-If simulator mirrors this formula client-side.

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
  classified docs with flag/delete), animated debate, collapsible reasoning, decision panel,
  **InteractiveSummaryPanel**, print-to-PDF report overlay, negotiation modal. (The old "Motion
  before the board" banner was removed as redundant.)
- `app/dashboard/page.tsx` — older simulator view (still reachable, not in main flow).
- `app/projects/page.tsx`, `app/settings/page.tsx` — from the navbar.

**Components**: `NavBar.tsx` (Clarity brand, New Chat, Projects, Settings, Profile modal),
`InteractiveSummaryPanel.tsx` (What-If simulator), `Sidebar.tsx` (LEGACY — no longer imported).

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

Everything below is **committed and pushed** to `main`. Working tree clean.

Most recent feature work (all type-checked clean and verified over HTTP/the proxy):
- `README.md` — full plain-English rewrite. `requirements.txt` — populated (fastapi, uvicorn,
  pydantic, sqlalchemy, openai, pypdf, python-multipart, requests, reportlab).
- `HANDOVER.md` (this file) — engineering handover; keep it updated with every change.
- `backend/report_generator.py` + `ui/server.py` `/api/decision-report` — formal long-form PDF.
- `frontend/components/InteractiveSummaryPanel.tsx` — What-If simulator; replaced the static
  on-screen Compatibility Matrix in `app/debate/page.tsx` (PDF report's static matrix unchanged).
- `ui/server.py` `/api/sessions/{id}/add-vendor` + `app/page.tsx` "Type Details" card & modal —
  manually typed vendors (stored as standard Document blocks, count toward the 4-source cap).
- `app/debate/page.tsx` — removed the redundant "Motion before the board" banner.

When you make new changes, update this section (and the rest of this file) accordingly.

---

## 11. Known limitations / honest caveats

- **Light mode** only fully themes the navbar/Projects/Settings; the immersive Home & Debate views
  stay dark by design. Full light theming is a follow-up.
- **Language** setting is a stored preference only — no i18n strings are wired (UI stays English).
- **Profile/sign-in** is localStorage only — no real auth backend.
- **Negotiation email lookup** may hallucinate plausible addresses — UI tells the user to verify.
- `:online` web search adds a small per-search $ surcharge (drove the $ spend up vs token count).
- OpenRouter key on the user's account: $100 limit, ~$0.73 spent total as of last check, **expires
  2026-06-05**. Check usage: `curl -s https://openrouter.ai/api/v1/auth/key -H "Authorization: Bearer $OPENROUTER_API_KEY"`.

---

## 12. Possible next steps (not requested yet)
- Wire a "Download formal report" button on the debate page that maps live scorecards/transcript into
  the `/api/py/decision-report` contract.
- Unify Debate/Dashboard backgrounds for full light-mode coverage.
- Capture real user-count/budget in Step 1 (currently the brief only carries requirements + vendors).
- Persist projects server-side (currently localStorage only).
