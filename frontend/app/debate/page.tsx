'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Download, FastForward, Loader2, Trophy,
  CheckCircle2, XCircle, Gavel, RefreshCw, Users, FileText,
  Brain, ChevronDown, AlertTriangle, Trash2, Pencil, Check, Plus, Mail, Copy, BarChart3,
} from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────────────
interface Turn {
  id: string; name: string; icon: string; role: string; phase: string
  message: string; preferred_vendor: string
  vote: 'YES' | 'NO' | ''; confidence: number | null; voted_for?: string
}
interface Round { phase: string; label: string; turns: Turn[] }
interface Decision {
  winner: string; runner_up: string; confidence: number
  vote_summary: { yes: number; no: number; total: number }
  summary: string; justification: string
  pros: Record<string, string[]>; cons: Record<string, string[]>
}
interface MatrixRow { criterion: string; is_mandatory: boolean; score: number; evidence: string }
interface PersonaScore { score: number; evidence: string }
interface Scorecard {
  vendor_name: string
  hard_constraints_passed: boolean
  compatibility_score: number
  requirements_matrix: MatrixRow[]
  persona_alignment: Record<string, PersonaScore>
  analytical_summary: { primary_growth_driver: string; primary_risk_factor: string }
}
interface DebateResult {
  vendors: string[]
  agents: { id: string; name: string; icon: string; role: string }[]
  rounds: Round[]
  decision: Decision
  scorecards?: Scorecard[]
  powered_by: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const AGENT_COLOR: Record<string, string> = {
  ceo: '#58a6ff', cto: '#3fb950', cfo: '#d29922', cso: '#f85149', procurement: '#a371f7',
}
const colorFor = (id: string) => AGENT_COLOR[id] ?? '#58a6ff'

const PHASE_COLOR: Record<string, string> = {
  opening: '#58a6ff', rebuttal: '#d29922', closing: '#3fb950',
}

// Derive up to two candidate vendor names from the free-text requirement
function deriveVendors(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-zA-Z0-9.]+(?:\s[A-Z][a-zA-Z0-9.]+)*\b/g) ?? []
  const stop = new Set(['I', 'The', 'We', 'Our', 'My', 'A', 'An', 'It', 'Need', 'Want', 'Looking'])
  const uniq: string[] = []
  for (const m of matches) {
    if (m.length > 3 && !stop.has(m) && !uniq.includes(m)) uniq.push(m)
    if (uniq.length === 2) break
  }
  while (uniq.length < 2) uniq.push(uniq.length === 0 ? 'Option A' : 'Option B')
  return uniq
}

// One uploaded document, with the backend's vendor/noise classification
interface DocItem {
  name: string
  content: string
  chars?: number
  is_vendor?: boolean   // false → flagged as likely-not-a-vendor noise
  reason?: string
}

// A negotiation email draft for one vendor
interface NegoDraft {
  vendor: string
  email: string | null
  email_found: boolean
  subject: string
  body: string
}

// The exact context the backend forwards to every agent
interface ContextInputs {
  requirements: string
  brief: string
  vendor_text: string
  has_documents: boolean
  suggested_vendors?: string[]   // real vendors detected from the uploaded PDFs
  documents?: DocItem[]          // per-file content + classification
}

// Split combined vendor text (stored with "=== Document: name ===" headers) into docs
function parseDocuments(vendorText: string): { name: string; content: string }[] {
  if (!vendorText.trim()) return []
  const parts = vendorText.split(/=== Document: (.+?) ===\n?/g)
  const docs: { name: string; content: string }[] = []
  for (let i = 1; i < parts.length; i += 2) {
    docs.push({ name: parts[i].trim(), content: (parts[i + 1] ?? '').trim() })
  }
  if (docs.length === 0) docs.push({ name: 'Document', content: vendorText.trim() })
  return docs
}

// ── Chart primitives (inline SVG/CSS — print-safe, no extra deps) ────────────────
function Donut({
  value, size = 110, stroke = 11, color = '#16a34a', track = '#e5e7eb', textColor = '#111827',
}: {
  value: number; size?: number; stroke?: number; color?: string; track?: string; textColor?: string
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.max(0, Math.min(100, value)) / 100)
  const mid = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={mid} cy={mid} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle cx={mid} cy={mid} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${mid} ${mid})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        fontSize={size * 0.26} fontWeight="800" fill={textColor}>{value}%</text>
    </svg>
  )
}

function HBar({
  label, value, max, color, suffix = '', trackColor = '#eceff3', labelColor = '#374151',
}: {
  label: string; value: number; max: number; color: string
  suffix?: string; trackColor?: string; labelColor?: string
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="flex justify-between text-xs" style={{ marginBottom: 4 }}>
        <span style={{ color: labelColor }}>{label}</span>
        <span style={{ fontWeight: 700, color: '#111827' }}>{value}{suffix}</span>
      </div>
      <div style={{ height: 9, background: trackColor, borderRadius: 9999 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 9999 }} />
      </div>
    </div>
  )
}

function VoteBar({ yes, no }: { yes: number; no: number }) {
  const total = Math.max(yes + no, 1)
  const yesPct = (yes / total) * 100
  return (
    <div>
      <div style={{ display: 'flex', height: 16, borderRadius: 9999, overflow: 'hidden', background: '#eceff3' }}>
        <div style={{ width: `${yesPct}%`, background: '#16a34a' }} />
        <div style={{ width: `${100 - yesPct}%`, background: '#dc2626' }} />
      </div>
      <div className="flex justify-between text-xs" style={{ marginTop: 6 }}>
        <span style={{ color: '#16a34a', fontWeight: 600 }}>● {yes} For</span>
        <span style={{ color: '#dc2626', fontWeight: 600 }}>{no} Against ●</span>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────────
function DebateContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const requirements = searchParams.get('requirements') ?? ''
  const sessionId = searchParams.get('session_id') ?? ''
  const agents = useMemo(
    () => (searchParams.get('agents') ?? '').split(',').map(a => a.trim()).filter(Boolean),
    [searchParams],
  )

  const [vendors, setVendors] = useState<string[]>(() => deriveVendors(requirements))
  const [vendorsInput, setVendorsInput] = useState(() => deriveVendors(requirements).join(', '))

  // Editable Step 1 requirements (user can add missing requirements before the debate)
  const [requirementsText, setRequirementsText] = useState(requirements)
  const [editingReqs, setEditingReqs] = useState(false)

  const [data, setData] = useState<DebateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-debate context review
  const [context, setContext] = useState<ContextInputs | null>(null)
  const [loadingContext, setLoadingContext] = useState(true)
  const [contextError, setContextError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [showContext, setShowContext] = useState(true)

  const [revealed, setRevealed] = useState(0)
  const [typing, setTyping] = useState(false)
  const [done, setDone] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)   // collapsed by default once done
  const [showReport, setShowReport] = useState(false)

  // Negotiation emails
  const [negoOpen, setNegoOpen] = useState(false)
  const [negoLoading, setNegoLoading] = useState(false)
  const [negoError, setNegoError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<NegoDraft[]>([])

  const skipRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const decisionRef = useRef<HTMLDivElement>(null)

  // Flatten rounds → ordered turn list, tagging the first turn of each round
  const flatTurns = useMemo(() => {
    if (!data) return [] as { turn: Turn; roundLabel: string; phase: string; firstOfRound: boolean }[]
    const out: { turn: Turn; roundLabel: string; phase: string; firstOfRound: boolean }[] = []
    data.rounds.forEach(rd =>
      rd.turns.forEach((turn, i) =>
        out.push({ turn, roundLabel: rd.label, phase: rd.phase, firstOfRound: i === 0 }),
      ),
    )
    return out
  }, [data])

  // ── Fetch the debate ──────────────────────────────────────────────────────────
  async function runDebate(vendorList: string[]) {
    setLoading(true); setError(null); setData(null); setDone(false); setRevealed(0)
    try {
      const body: Record<string, unknown> = {
        target: requirementsText || 'Procurement decision',
        users: 100,
        budget: 30000,
        vendors: vendorList,
      }
      if (agents.length) body.selected_agents = agents
      if (sessionId) body.session_id = sessionId

      const res = await fetch('/api/py/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      setData(await res.json())
    } catch (e: unknown) {
      setError(
        `Could not reach the FastAPI backend on port 8000.\n${e instanceof Error ? e.message : ''}`,
      )
    } finally {
      setLoading(false)
    }
  }

  // ── Fetch the pre-debate context (cheap; no LLM calls) ─────────────────────────
  async function fetchContext() {
    setLoadingContext(true); setContextError(null)
    try {
      const body: Record<string, unknown> = {
        target: requirementsText || 'Procurement decision',
        users: 100, budget: 30000, vendors,
      }
      if (agents.length) body.selected_agents = agents
      if (sessionId) body.session_id = sessionId
      const res = await fetch('/api/py/context', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const ctx: ContextInputs = await res.json()
      setContext(ctx)
      // Adopt the real vendors detected from the uploaded documents
      if (Array.isArray(ctx.suggested_vendors) && ctx.suggested_vendors.length >= 2) {
        const detected = ctx.suggested_vendors.slice(0, 4)
        setVendors(detected)
        setVendorsInput(detected.join(', '))
      }
    } catch (e: unknown) {
      setContextError(
        `Could not reach the FastAPI backend on port 8000.\n${e instanceof Error ? e.message : ''}`,
      )
    } finally {
      setLoadingContext(false)
    }
  }

  // Load context on mount; the debate runs only after the user reviews & clicks Start
  useEffect(() => { fetchContext() /* eslint-disable-next-line */ }, [])

  function handleStart() {
    setShowContext(false)   // collapse the context panel while the debate plays
    setStarted(true)
    runDebate(vendors)
  }

  // Remove a flagged (non-vendor) document, then re-read context & vendors
  async function deleteDocument(name: string) {
    if (!sessionId) return
    try {
      await fetch(`/api/py/sessions/${sessionId}/remove-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name }),
      })
    } catch { /* ignore — refresh will reflect current state */ }
    fetchContext()
  }

  // ── Animate the reveal whenever new data arrives ───────────────────────────────
  useEffect(() => {
    if (!data) return
    skipRef.current = false
    setRevealed(0); setDone(false); setTyping(false); setShowReasoning(false)
    let cancelled = false
    const total = flatTurns.length

    async function play() {
      for (let i = 0; i < total; i++) {
        if (cancelled) return
        if (skipRef.current) break
        setTyping(true)
        await sleep(850)
        if (cancelled) return
        if (skipRef.current) break
        setTyping(false)
        setRevealed(i + 1)
        await sleep(650)
      }
      if (!cancelled) { setTyping(false); setRevealed(total); setDone(true) }
    }
    play()
    return () => { cancelled = true }
  }, [data, flatTurns])

  // Auto-scroll: follow the live debate, then jump to the final decision when done
  useEffect(() => {
    if (done) {
      decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [revealed, typing, done])

  function handleSkip() {
    skipRef.current = true
    setTyping(false)
    setRevealed(flatTurns.length)
    setDone(true)
  }

  function handleRerun() {
    const parsed = vendorsInput.split(',').map(v => v.trim()).filter(Boolean).slice(0, 4)
    const finalVendors = parsed.length >= 2 ? parsed : deriveVendors(requirementsText)
    setVendors(finalVendors)
    setStarted(true)
    runDebate(finalVendors)
  }

  // ── Negotiation emails ─────────────────────────────────────────────────────────
  async function openNegotiation() {
    setNegoOpen(true); setNegoLoading(true); setNegoError(null); setDrafts([])
    try {
      const res = await fetch(`/api/py/negotiate/${sessionId || 'none'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winner: dec?.winner ?? '',
          vendors: data?.vendors ?? vendors,
          requirements: requirementsText,
        }),
      })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const d = await res.json()
      setDrafts(Array.isArray(d.drafts) ? d.drafts : [])
    } catch {
      setNegoError('Could not draft the emails. Make sure the backend is running on port 8000.')
    } finally {
      setNegoLoading(false)
    }
  }

  function updateDraft(i: number, patch: Partial<NegoDraft>) {
    setDrafts(prev => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }

  function mailtoHref(d: NegoDraft) {
    const to = encodeURIComponent(d.email ?? '')
    const subject = encodeURIComponent(d.subject)
    const body = encodeURIComponent(d.body)
    return `mailto:${to}?subject=${subject}&body=${body}`
  }

  const dec = data?.decision
  const reportDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  // Derived data for the report charts
  const closingTurns: Turn[] = data?.rounds.find(r => r.phase === 'closing')?.turns ?? []
  const vendorSupport = (data?.vendors ?? []).map(v => ({
    vendor: v,
    count: closingTurns.filter(t => (t.voted_for ?? '') === v).length,
  }))
  const maxSupport = Math.max(1, ...vendorSupport.map(s => s.count))
  const scorecards = data?.scorecards ?? []
  const PERSONA_KEYS = ['CEO', 'CTO', 'CFO', 'CSO']

  // Documents read from Step 3 — prefer the backend's classified list
  const docs: DocItem[] = context?.documents
    ?? parseDocuments(context?.vendor_text ?? '').map(d => ({ ...d, is_vendor: true }))
  const flaggedCount = docs.filter(d => d.is_vendor === false).length

  // ── Context loading / error (before the user starts) ───────────────────────────
  if (loadingContext) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: '#0d1117' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#58a6ff' }} />
        <p className="text-sm" style={{ color: '#8b949e' }}>Reading your Step 1 &amp; Step 3 inputs…</p>
      </main>
    )
  }
  if (contextError && !context) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6" style={{ background: '#0d1117' }}>
        <p className="text-sm whitespace-pre-wrap text-center max-w-md rounded-lg p-4"
          style={{ background: '#4a1f1f', color: '#f85149', border: '1px solid rgba(248,81,73,.3)' }}>
          {contextError}
        </p>
        <button onClick={fetchContext}
          className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
          style={{ background: '#238636', color: '#fff' }}>
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </main>
    )
  }

  // ── Debate generation loader ───────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-5" style={{ background: '#0d1117' }}>
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center glow-pulse"
            style={{ background: 'linear-gradient(135deg,#58a6ff,#a371f7)' }}>
            <Gavel className="w-7 h-7 text-white" />
          </div>
        </div>
        <p className="text-lg font-semibold" style={{ color: '#e6edf3' }}>Convening the board…</p>
        <p className="text-sm flex items-center gap-2" style={{ color: '#8b949e' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Agents are preparing their opening statements
        </p>
      </main>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6" style={{ background: '#0d1117' }}>
        <p className="text-sm whitespace-pre-wrap text-center max-w-md rounded-lg p-4"
          style={{ background: '#4a1f1f', color: '#f85149', border: '1px solid rgba(248,81,73,.3)' }}>
          {error}
        </p>
        <button onClick={() => runDebate(vendors)}
          className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
          style={{ background: '#238636', color: '#fff' }}>
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </main>
    )
  }

  // ── Context card: the exact inputs forwarded to the agents ─────────────────────
  const contextCard = context && (
    <div className="rounded-xl border mb-6" style={{ background: '#161b22', borderColor: '#30363d' }}>
      <button onClick={() => setShowContext(v => !v)} aria-expanded={showContext}
        className="w-full flex items-center gap-2 px-4 py-3">
        <FileText className="w-4 h-4 shrink-0" style={{ color: '#58a6ff' }} />
        <span className="text-sm font-semibold" style={{ color: '#e6edf3' }}>Context fed to the board</span>
        <span className="hidden sm:inline text-xs" style={{ color: '#8b949e' }}>
          Step 1 requirements · {docs.length} document{docs.length !== 1 ? 's' : ''} from Step 3
        </span>
        <ChevronDown className="w-4 h-4 ml-auto shrink-0"
          style={{ color: '#8b949e', transition: 'transform .25s ease', transform: showContext ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>

      {showContext && (
        <div className="px-4 pb-4 space-y-4" style={{ borderTop: '1px solid #21262d' }}>
          {/* Step 1 — editable requirements */}
          <div className="pt-3">
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#8b949e' }}>
                Step 1 — Requirements (forwarded to every agent)
              </p>
              <button onClick={() => setEditingReqs(v => !v)}
                className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold"
                style={{ background: editingReqs ? 'rgba(63,185,80,0.15)' : 'rgba(88,166,255,0.12)', color: editingReqs ? '#3fb950' : '#58a6ff' }}>
                {editingReqs ? <><Check className="w-3 h-3" /> Done</> : <><Pencil className="w-3 h-3" /> Edit</>}
              </button>
            </div>

            {editingReqs ? (
              <>
                <textarea
                  value={requirementsText}
                  onChange={e => setRequirementsText(e.target.value)}
                  rows={6}
                  placeholder="Describe the requirements the board must discuss…"
                  className="w-full text-sm rounded-lg p-3 outline-none resize-y"
                  style={{ background: '#0d1117', border: '1px solid #388bfd', color: '#e6edf3' }}
                />
                <p className="text-[11px] mt-1.5 flex items-center gap-1" style={{ color: '#8b949e' }}>
                  <Plus className="w-3 h-3" /> Add any missing requirements (budget, must-have features,
                  compliance, integrations) — the agents will debate exactly this text.
                </p>
              </>
            ) : (
              <p className="text-sm rounded-lg p-3 whitespace-pre-wrap"
                style={{ background: '#0d1117', border: '1px solid #21262d', color: requirementsText ? '#c9d1d9' : '#6b7280' }}>
                {requirementsText || 'No requirements provided yet — click Edit to add them.'}
              </p>
            )}
          </div>

          {/* Step 3 documents */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#8b949e' }}>
              Step 3 — Document text read ({docs.length})
              {flaggedCount > 0 && (
                <span style={{ color: '#f85149' }}> · {flaggedCount} flagged as non-vendor</span>
              )}
            </p>
            {docs.length === 0 ? (
              <p className="text-sm rounded-lg p-3" style={{ background: '#0d1117', border: '1px dashed #30363d', color: '#8b949e' }}>
                No documents uploaded — the agents rely on general market knowledge.
              </p>
            ) : (
              <div className="space-y-2">
                {docs.map((d, i) => {
                  const noise = d.is_vendor === false
                  return (
                    <div key={i} className="rounded-lg overflow-hidden"
                      style={{ border: `1px solid ${noise ? 'rgba(248,81,73,0.55)' : '#21262d'}` }}>
                      <div className="flex items-center gap-2 px-3 py-1.5"
                        style={{ background: noise ? 'rgba(248,81,73,0.12)' : '#0d1117' }}>
                        <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: noise ? '#f85149' : '#a371f7' }} />
                        <span className="text-xs font-semibold truncate" style={{ color: noise ? '#f85149' : '#e6edf3' }}>
                          {d.name}
                        </span>
                        <span className="text-[10px] ml-auto shrink-0" style={{ color: '#6b7280' }}>
                          {(d.chars ?? d.content.length).toLocaleString()} chars
                        </span>
                      </div>

                      {noise && (
                        <div className="flex items-start gap-2 px-3 py-2"
                          style={{ background: 'rgba(248,81,73,0.08)', borderTop: '1px solid rgba(248,81,73,0.3)' }}>
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#f85149' }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold" style={{ color: '#f85149' }}>
                              Likely not a vendor document
                            </p>
                            <p className="text-[11px]" style={{ color: '#c9d1d9' }}>
                              {d.reason || 'This file does not appear to describe a vendor or product offer.'} It will skew the debate — consider removing it.
                            </p>
                          </div>
                          <button onClick={() => deleteDocument(d.name)} title="Remove this file"
                            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold"
                            style={{ background: 'rgba(248,81,73,0.18)', color: '#f85149' }}>
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </div>
                      )}

                      <pre className="text-xs whitespace-pre-wrap px-3 py-2 m-0 overflow-y-auto"
                        style={{ maxHeight: 160, background: '#0d1117', color: '#9ca3af', fontFamily: 'inherit' }}>
                        {d.content || '(no extractable text found in this file)'}
                      </pre>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Exact brief string */}
          <details>
            <summary className="text-xs cursor-pointer" style={{ color: '#58a6ff' }}>
              View the exact brief string sent to each agent
            </summary>
            <pre className="text-xs whitespace-pre-wrap mt-2 rounded-lg p-3"
              style={{ background: '#0d1117', border: '1px solid #21262d', color: '#9ca3af', fontFamily: 'inherit' }}>
              {`Requirements: ${requirementsText || 'Procurement decision'}\nVendors under consideration: ${vendors.join(', ')}`}
            </pre>
          </details>

          <p className="text-[11px] leading-relaxed" style={{ color: '#6b7280' }}>
            Every agent receives the same requirements and documents above, plus its own role lens
            (CEO → strategy, CFO → 3-year TCO, CTO → integration, CSO → security, Procurement → pricing).
          </p>
        </div>
      )}
    </div>
  )

  // ── Main ───────────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen" style={{ background: '#0d1117' }}>
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b no-print"
        style={{ background: 'rgba(13,17,23,.85)', borderColor: '#21262d', backdropFilter: 'blur(10px)' }}>
        <div className="max-w-4xl mx-auto px-5 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/')} title="Home"
            className="p-2 rounded-lg" style={{ color: '#8b949e' }}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 mr-auto">
            <Gavel className="w-5 h-5" style={{ color: '#a371f7' }} />
            <span className="font-bold" style={{ color: '#e6edf3' }}>Boardroom Debate</span>
          </div>

          {/* Vendors editor */}
          <div className="hidden sm:flex items-center gap-2">
            <input
              value={vendorsInput}
              onChange={e => setVendorsInput(e.target.value)}
              placeholder="Vendor A, Vendor B"
              className="rounded-lg px-3 py-1.5 text-xs border outline-none w-52"
              style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
            />
            <button onClick={handleRerun} title="Re-run with these vendors"
              className="p-2 rounded-lg" style={{ background: '#21262d', color: '#8b949e' }}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {started && !done && (
            <button onClick={handleSkip}
              className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{ background: '#21262d', color: '#c9d1d9' }}>
              <FastForward className="w-3.5 h-3.5" /> Skip
            </button>
          )}
          {done && (
            <button onClick={() => setShowReport(true)}
              className="px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
              style={{ background: 'linear-gradient(135deg,#238636,#2ea043)', color: '#fff' }}>
              <Download className="w-3.5 h-3.5" /> Decision Report
            </button>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 py-8">
        {/* Brief banner */}
        <div className="rounded-xl border p-4 mb-8 flex items-start gap-3"
          style={{ background: '#161b22', borderColor: '#30363d' }}>
          <FileText className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#58a6ff' }} />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#8b949e' }}>
              The motion before the board
            </p>
            <p className="text-sm" style={{ color: '#c9d1d9' }}>
              {requirementsText || 'Procurement decision'}
            </p>
            <p className="text-xs mt-2" style={{ color: '#8b949e' }}>
              Evaluating <b style={{ color: '#e6edf3' }}>{vendors.join(' vs ')}</b>
              {data && <> · {data.agents.length} board members in session</>}
            </p>
          </div>
        </div>

        {/* Context the agents receive (Step 1 + Step 3) */}
        {contextCard}

        {/* Pre-debate gate: review inputs, then start */}
        {!started && (
          <div className="flex flex-col items-center gap-3 py-6">
            <button onClick={handleStart}
              className="px-6 py-3.5 rounded-xl text-sm font-bold flex items-center gap-2"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff', boxShadow: '0 0 24px rgba(124,58,237,.35)' }}>
              <Gavel className="w-4 h-4" /> Start the Debate
            </button>
            <p className="text-xs" style={{ color: '#8b949e' }}>
              The board will deliberate over 3 rounds using the context above.
            </p>
          </div>
        )}

        {started && (<>
        {/* ── Final decision — surfaced on top once the board concludes ── */}
        {done && dec && (
          <div ref={decisionRef} className="turn-in space-y-6 mb-8">
            {/* Winner banner */}
            <div className="rounded-2xl border p-8 text-center"
              style={{
                background: 'linear-gradient(135deg,#1a3a1a,#0f2a0f)',
                borderColor: '#3fb950', boxShadow: '0 0 40px rgba(63,185,80,.15)',
              }}>
              <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: '#3fb950' }}>
                The board has reached a decision
              </p>
              <div className="flex items-center justify-center gap-3 mb-1">
                <Trophy className="w-8 h-8" style={{ color: '#d29922' }} />
                <h2 className="text-4xl font-black" style={{ color: '#3fb950' }}>{dec.winner}</h2>
              </div>
              <p className="text-lg" style={{ color: '#7ee787' }}>
                {dec.confidence}% Confidence · {dec.vote_summary.yes}/{dec.vote_summary.total} in favor
              </p>
              <p className="text-sm mt-3 max-w-2xl mx-auto" style={{ color: '#c9d1d9' }}>
                {dec.justification}
              </p>
            </div>

            {/* Debate summary */}
            <div className="rounded-xl border p-6" style={{ background: '#161b22', borderColor: '#30363d' }}>
              <h3 className="font-bold mb-3 flex items-center gap-2" style={{ color: '#e6edf3' }}>
                <Users className="w-5 h-5" style={{ color: '#58a6ff' }} /> Debate Summary
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: '#c9d1d9' }}>{dec.summary}</p>
            </div>

            {/* Pros / cons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {(data?.vendors ?? []).map(v => (
                <div key={v} className="rounded-xl border p-5"
                  style={{
                    background: '#161b22',
                    borderColor: v === dec.winner ? '#3fb950' : '#30363d',
                  }}>
                  <p className="font-bold mb-3" style={{ color: v === dec.winner ? '#3fb950' : '#e6edf3' }}>
                    {v} {v === dec.winner && '🏆'}
                  </p>
                  <ul className="space-y-1.5 mb-3">
                    {(dec.pros[v] ?? []).map((p, i) => (
                      <li key={i} className="flex gap-2 text-xs" style={{ color: '#c9d1d9' }}>
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#3fb950' }} />{p}
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-1.5">
                    {(dec.cons[v] ?? []).map((p, i) => (
                      <li key={i} className="flex gap-2 text-xs" style={{ color: '#c9d1d9' }}>
                        <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#f85149' }} />{p}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Compatibility matrix (quantitative, auditable scoring) */}
            {scorecards.length > 0 && (
              <div>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2" style={{ color: '#e6edf3' }}>
                  <BarChart3 className="w-5 h-5" style={{ color: '#58a6ff' }} /> Compatibility Matrix
                  <span className="text-xs font-normal" style={{ color: '#8b949e' }}>· quantitative score</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {[...scorecards].sort((a, b) => b.compatibility_score - a.compatibility_score).map(sc => (
                    <div key={sc.vendor_name} className="rounded-xl border p-5"
                      style={{ background: '#161b22', borderColor: sc.vendor_name === dec.winner ? '#3fb950' : '#30363d' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-sm" style={{ color: '#e6edf3' }}>{sc.vendor_name}</span>
                        <span className="text-2xl font-black"
                          style={{ color: sc.compatibility_score >= 60 ? '#3fb950' : sc.compatibility_score >= 35 ? '#d29922' : '#f85149' }}>
                          {sc.compatibility_score}
                          <span className="text-xs font-normal" style={{ color: '#8b949e' }}>/100</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full mb-3" style={{ background: '#21262d' }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${sc.compatibility_score}%`,
                            background: sc.compatibility_score >= 60 ? '#3fb950' : sc.compatibility_score >= 35 ? '#d29922' : '#f85149' }} />
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 mb-3"
                        style={{ background: sc.hard_constraints_passed ? '#1f4a2a' : '#4a1f1f',
                          color: sc.hard_constraints_passed ? '#3fb950' : '#f85149' }}>
                        {sc.hard_constraints_passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {sc.hard_constraints_passed ? 'Hard constraints passed' : 'Hard constraint failed'}
                      </span>
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {PERSONA_KEYS.map(p => (
                          <div key={p} className="text-center rounded-lg py-1.5" style={{ background: '#0d1117' }}
                            title={sc.persona_alignment?.[p]?.evidence}>
                            <p className="text-[10px]" style={{ color: '#8b949e' }}>{p}</p>
                            <p className="text-sm font-bold" style={{ color: '#c9d1d9' }}>
                              {sc.persona_alignment?.[p]?.score ?? '—'}<span className="text-[9px]" style={{ color: '#6b7280' }}>/5</span>
                            </p>
                          </div>
                        ))}
                      </div>
                      {sc.analytical_summary?.primary_risk_factor && (
                        <p className="text-xs" style={{ color: '#8b949e' }}>
                          <span style={{ color: '#f85149' }}>Risk:</span> {sc.analytical_summary.primary_risk_factor}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-center flex-wrap gap-3 pt-2">
              <button onClick={() => setShowReport(true)}
                className="px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg,#238636,#2ea043)', color: '#fff' }}>
                <Download className="w-4 h-4" /> Download Decision Report
              </button>
              <button onClick={openNegotiation}
                className="px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff' }}>
                <Mail className="w-4 h-4" /> Draft negotiation emails
              </button>
            </div>
          </div>
        )}

        {/* ── Full debate & reasoning ── live while generating, collapsible after ── */}
        <section>
          {/* Toggle appears only once the debate is over */}
          {done && (
            <button
              onClick={() => setShowReasoning(v => !v)}
              aria-expanded={showReasoning}
              className="w-full flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
              style={{ background: '#161b22', borderColor: '#30363d' }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = '#3d444d')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = '#30363d')}
            >
              <Brain className="w-4 h-4 shrink-0" style={{ color: '#a371f7' }} />
              <span className="text-sm font-semibold" style={{ color: '#e6edf3' }}>
                {showReasoning ? 'Hide' : 'Show'} the board&rsquo;s full debate
              </span>
              <span className="hidden sm:inline text-xs" style={{ color: '#8b949e' }}>
                {data?.agents.length ?? 0} agents · {flatTurns.length} statements · 3 rounds
              </span>
              <ChevronDown className="w-4 h-4 ml-auto shrink-0"
                style={{
                  color: '#8b949e',
                  transition: 'transform .25s ease',
                  transform: showReasoning ? 'rotate(180deg)' : 'rotate(0deg)',
                }} />
            </button>
          )}

          {/* Transcript: always shown while generating; on demand after */}
          {(!done || showReasoning) && (
            <div className="space-y-4" style={{ marginTop: done ? 16 : 0 }}>
              {!done && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                      style={{ background: '#a371f7' }} />
                    <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#a371f7' }} />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#a371f7' }}>
                    Live debate in progress
                  </span>
                </div>
              )}

              {flatTurns.slice(0, revealed).map((item, i) => {
                const t = item.turn
                const c = colorFor(t.id)
                return (
                  <div key={i}>
                    {item.firstOfRound && (
                      <div className="flex items-center gap-3 my-6">
                        <div className="h-px flex-1" style={{ background: '#21262d' }} />
                        <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full"
                          style={{ color: PHASE_COLOR[item.phase], background: `${PHASE_COLOR[item.phase]}1a` }}>
                          {item.roundLabel}
                        </span>
                        <div className="h-px flex-1" style={{ background: '#21262d' }} />
                      </div>
                    )}
                    <div className="turn-in flex gap-3">
                      <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-lg"
                        style={{ background: `${c}22`, border: `1px solid ${c}55` }}>
                        {t.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-sm" style={{ color: '#e6edf3' }}>{t.name}</span>
                          <span className="text-xs" style={{ color: '#8b949e' }}>{t.role}</span>
                          {t.phase === 'closing' && t.vote && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                              style={{
                                background: t.vote === 'YES' ? '#1f4a2a' : '#4a1f1f',
                                color: t.vote === 'YES' ? '#3fb950' : '#f85149',
                              }}>
                              {t.vote === 'YES' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {t.vote}{t.confidence != null && ` · ${t.confidence}%`}
                            </span>
                          )}
                        </div>
                        <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed"
                          style={{ background: '#161b22', border: '1px solid #21262d', color: '#c9d1d9' }}>
                          {t.message}
                          {t.preferred_vendor && (
                            <span className="block mt-1.5 text-xs font-semibold" style={{ color: c }}>
                              → favors {t.preferred_vendor}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Typing indicator for the next speaker */}
              {typing && revealed < flatTurns.length && (
                <div className="flex gap-3 turn-in">
                  <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-lg"
                    style={{
                      background: `${colorFor(flatTurns[revealed].turn.id)}22`,
                      border: `1px solid ${colorFor(flatTurns[revealed].turn.id)}55`,
                    }}>
                    {flatTurns[revealed].turn.icon}
                  </div>
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 flex items-center gap-1.5"
                    style={{ background: '#161b22', border: '1px solid #21262d' }}>
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
        </>)}

        <div ref={bottomRef} />
      </div>

      {/* ── Report overlay (styled, paginating print-to-PDF) ──────────────────── */}
      {showReport && dec && data && (
        <div className="report-overlay fixed inset-0 z-50 overflow-y-auto" style={{ background: 'rgba(0,0,0,.7)' }}>
          <div className="report-scroll min-h-full py-8 px-4 flex justify-center">
            <div id="decision-report"
              className="w-full max-w-3xl rounded-xl shadow-2xl overflow-hidden"
              style={{
                background: '#ffffff', color: '#111827',
                printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact',
              }}>

              {/* Floating controls (never printed) */}
              <div className="no-print sticky top-0 z-10 flex justify-end gap-2 px-6 py-3"
                style={{ background: 'rgba(255,255,255,.9)', backdropFilter: 'blur(6px)', borderBottom: '1px solid #e5e7eb' }}>
                <button onClick={() => window.print()}
                  className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                  style={{ background: '#238636', color: '#fff' }}>
                  <Download className="w-4 h-4" /> Save as PDF
                </button>
                <button onClick={() => setShowReport(false)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: '#e5e7eb', color: '#111827' }}>
                  Close
                </button>
              </div>

              {/* Letterhead band */}
              <div className="report-section flex items-center justify-between px-10 py-8"
                style={{ background: 'linear-gradient(135deg,#0f172a,#1e293b)', color: '#fff' }}>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#7dd3fc' }}>
                    Procurement Decision Report
                  </p>
                  <h1 className="text-2xl font-black tracking-tight mt-1">Nexus · AI Purchasing Society</h1>
                  <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>{reportDate}</p>
                </div>
                <div className="text-center">
                  <Donut value={dec.confidence} color="#34d399" track="rgba(255,255,255,.18)" textColor="#fff" />
                  <p className="text-[10px] uppercase tracking-widest mt-1" style={{ color: '#94a3b8' }}>Confidence</p>
                </div>
              </div>

              <div className="px-10 py-8 space-y-8">

                {/* Decision hero */}
                <section className="report-section rounded-xl p-6"
                  style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                  <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#15803d' }}>
                    Recommended Decision
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <Trophy className="w-7 h-7" style={{ color: '#ca8a04' }} />
                    <span className="text-3xl font-black" style={{ color: '#15803d' }}>{dec.winner}</span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: '#374151' }}>{dec.justification}</p>
                  {/* Stat chips */}
                  <div className="grid grid-cols-3 gap-3 mt-4">
                    {[
                      { k: 'In Favor', v: `${dec.vote_summary.yes}/${dec.vote_summary.total}`, c: '#15803d' },
                      { k: 'Confidence', v: `${dec.confidence}%`, c: '#0369a1' },
                      { k: 'Runner-up', v: dec.runner_up || '—', c: '#6b7280' },
                    ].map(s => (
                      <div key={s.k} className="rounded-lg px-3 py-2 text-center" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: '#9ca3af' }}>{s.k}</p>
                        <p className="text-sm font-black" style={{ color: s.c }}>{s.v}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Charts row */}
                <section className="report-section grid grid-cols-2 gap-8">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
                      Board Support by Vendor
                    </h3>
                    {vendorSupport.map(s => (
                      <HBar key={s.vendor} label={s.vendor} value={s.count} max={maxSupport}
                        suffix=" votes" color={s.vendor === dec.winner ? '#16a34a' : '#94a3b8'} />
                    ))}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
                      Final Vote Breakdown
                    </h3>
                    <VoteBar yes={dec.vote_summary.yes} no={dec.vote_summary.no} />
                  </div>
                </section>

                {/* Per-agent confidence */}
                {closingTurns.length > 0 && (
                  <section className="report-section">
                    <h3 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
                      Board Member Confidence
                    </h3>
                    {closingTurns.map((t, i) => (
                      <HBar key={i} label={`${t.name} · ${t.vote || '—'}`} value={t.confidence ?? 0} max={100}
                        suffix="%" color={t.vote === 'YES' ? '#16a34a' : t.vote === 'NO' ? '#dc2626' : '#94a3b8'} />
                    ))}
                  </section>
                )}

                {/* Requirement */}
                <section className="report-section">
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#6b7280' }}>Requirement</h2>
                  <p className="text-sm rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid #e5e7eb', color: '#374151' }}>
                    {requirementsText || 'Procurement decision'}
                  </p>
                </section>

                {/* Executive summary */}
                <section className="report-section">
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#6b7280' }}>Executive Summary</h2>
                  <p className="text-sm leading-relaxed" style={{ color: '#374151' }}>{dec.summary}</p>
                </section>

                {/* Pros & cons */}
                <section className="report-section grid grid-cols-2 gap-5">
                  {data.vendors.map(v => (
                    <div key={v} className="rounded-xl p-4"
                      style={{ background: v === dec.winner ? '#f0fdf4' : '#f8fafc', border: `1px solid ${v === dec.winner ? '#bbf7d0' : '#e5e7eb'}` }}>
                      <h3 className="font-black text-sm mb-3" style={{ color: v === dec.winner ? '#15803d' : '#111827' }}>
                        {v}{v === dec.winner && ' 🏆'}
                      </h3>
                      {(dec.pros[v] ?? []).map((p, i) => (
                        <p key={`p${i}`} className="text-xs mb-1.5 flex gap-1.5" style={{ color: '#374151' }}>
                          <span style={{ color: '#16a34a', fontWeight: 700 }}>+</span>{p}
                        </p>
                      ))}
                      {(dec.cons[v] ?? []).map((p, i) => (
                        <p key={`c${i}`} className="text-xs mb-1.5 flex gap-1.5" style={{ color: '#374151' }}>
                          <span style={{ color: '#dc2626', fontWeight: 700 }}>−</span>{p}
                        </p>
                      ))}
                    </div>
                  ))}
                </section>

                {/* Compatibility matrix (auditable scoring) */}
                {scorecards.length > 0 && (
                  <section className="report-section">
                    <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
                      Compatibility Matrix (quantitative scoring)
                    </h2>
                    {[...scorecards].sort((a, b) => b.compatibility_score - a.compatibility_score).map(sc => (
                      <div key={sc.vendor_name} className="mb-4 rounded-lg p-3"
                        style={{ border: `1px solid ${sc.vendor_name === dec.winner ? '#bbf7d0' : '#e5e7eb'}`,
                          background: sc.vendor_name === dec.winner ? '#f0fdf4' : '#ffffff' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm">{sc.vendor_name}</span>
                          <span className="text-sm font-black"
                            style={{ color: sc.compatibility_score >= 60 ? '#15803d' : sc.compatibility_score >= 35 ? '#b45309' : '#b91c1c' }}>
                            {sc.compatibility_score}/100 · {sc.hard_constraints_passed ? 'hard constraints passed' : 'hard constraint FAILED'}
                          </span>
                        </div>
                        <p className="text-[11px] mb-2" style={{ color: '#6b7280' }}>
                          {PERSONA_KEYS.map(p => `${p} ${sc.persona_alignment?.[p]?.score ?? '—'}/5`).join('  ·  ')}
                        </p>
                        {sc.requirements_matrix.length > 0 && (
                          <table className="w-full text-[11px]" style={{ color: '#374151' }}>
                            <tbody>
                              {sc.requirements_matrix.map((m, i) => (
                                <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                                  <td className="py-1 pr-2 align-top" style={{ width: '32%' }}>
                                    {m.criterion}{m.is_mandatory && <span style={{ color: '#b91c1c' }}> *</span>}
                                  </td>
                                  <td className="py-1 pr-2 align-top font-bold" style={{ width: '8%' }}>{m.score.toFixed(1)}</td>
                                  <td className="py-1 align-top" style={{ color: '#6b7280' }}>{m.evidence}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {sc.analytical_summary?.primary_risk_factor && (
                          <p className="text-[11px] mt-2" style={{ color: '#374151' }}>
                            <b>Risk:</b> {sc.analytical_summary.primary_risk_factor}
                          </p>
                        )}
                      </div>
                    ))}
                    <p className="text-[10px]" style={{ color: '#9ca3af' }}>* mandatory (hard) constraint</p>
                  </section>
                )}

                {/* Full transcript */}
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
                    Full Deliberation Transcript
                  </h2>
                  {data.rounds.map(rd => (
                    <div key={rd.phase} className="report-section mb-5">
                      <p className="text-sm font-black mb-2 inline-block px-2 py-0.5 rounded"
                        style={{ background: '#eef2ff', color: '#4338ca' }}>{rd.label}</p>
                      {rd.turns.map((t, i) => (
                        <div key={i} className="mb-2.5 pl-3" style={{ borderLeft: '3px solid #e5e7eb' }}>
                          <p className="text-xs font-bold">
                            {t.name} <span style={{ color: '#9ca3af', fontWeight: 400 }}>· {t.role}</span>
                            {t.vote && <span style={{ color: t.vote === 'YES' ? '#15803d' : '#b91c1c' }}> · {t.vote} ({t.confidence}%)</span>}
                          </p>
                          <p className="text-xs leading-relaxed mt-0.5" style={{ color: '#374151' }}>{t.message}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>

                <p className="text-[10px] pt-4" style={{ borderTop: '1px solid #e5e7eb', color: '#9ca3af' }}>
                  Generated by Nexus AI Purchasing Society on {reportDate}. This report documents the AI board's
                  deliberation and is intended as supporting evidence for the procurement decision above.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Negotiation emails overlay ────────────────────────────────────────── */}
      {negoOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }}>
          <div className="min-h-full py-8 px-4 flex justify-center">
            <div className="w-full max-w-2xl rounded-2xl p-6"
              style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <div className="flex items-center gap-2 mb-1">
                <Mail className="w-5 h-5" style={{ color: '#a371f7' }} />
                <h2 className="text-lg font-bold" style={{ color: '#e6edf3' }}>Vendor negotiation emails</h2>
                <button onClick={() => setNegoOpen(false)} className="ml-auto p-2 rounded-lg" style={{ color: '#8b949e' }}>
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs mb-5" style={{ color: '#8b949e' }}>
                One draft per vendor — each is told a competitor is ahead and invited to send a better
                offer as a PDF. Review, edit, and send. Verify each email address before sending.
              </p>

              {negoLoading && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#a371f7' }} />
                  <p className="text-sm" style={{ color: '#8b949e' }}>Sales agent is drafting the emails…</p>
                </div>
              )}

              {negoError && (
                <p className="text-sm rounded-lg p-3 mb-3" style={{ background: '#4a1f1f', color: '#f85149' }}>{negoError}</p>
              )}

              {!negoLoading && drafts.map((d, i) => (
                <div key={i} className="rounded-xl border p-4 mb-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-bold text-sm" style={{ color: '#e6edf3' }}>{d.vendor}</span>
                    {!d.email_found && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{ background: 'rgba(210,153,34,.15)', color: '#d29922' }}>
                        <AlertTriangle className="w-3 h-3" /> email not found — enter it below
                      </span>
                    )}
                  </div>

                  <label className="block text-[11px] font-semibold mb-1" style={{ color: '#8b949e' }}>To</label>
                  <input
                    value={d.email ?? ''}
                    onChange={e => updateDraft(i, { email: e.target.value })}
                    placeholder="vendor contact email"
                    className="w-full rounded-lg px-3 py-2 text-sm border outline-none mb-3"
                    style={{ background: '#0d1117', borderColor: d.email ? '#30363d' : '#d29922', color: '#e6edf3' }}
                  />

                  <label className="block text-[11px] font-semibold mb-1" style={{ color: '#8b949e' }}>Subject</label>
                  <input
                    value={d.subject}
                    onChange={e => updateDraft(i, { subject: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-sm border outline-none mb-3"
                    style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
                  />

                  <label className="block text-[11px] font-semibold mb-1" style={{ color: '#8b949e' }}>Message</label>
                  <textarea
                    value={d.body}
                    onChange={e => updateDraft(i, { body: e.target.value })}
                    rows={8}
                    className="w-full rounded-lg px-3 py-2 text-sm border outline-none resize-y mb-3"
                    style={{ background: '#0d1117', borderColor: '#30363d', color: '#c9d1d9' }}
                  />

                  <div className="flex gap-2">
                    <a href={mailtoHref(d)}
                      className="px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
                      style={{ background: d.email ? 'linear-gradient(135deg,#7c3aed,#4f46e5)' : '#21262d',
                        color: d.email ? '#fff' : '#6b7280', pointerEvents: d.email ? 'auto' : 'none' }}>
                      <Mail className="w-3.5 h-3.5" /> Open in email
                    </a>
                    <button onClick={() => navigator.clipboard?.writeText(d.body)}
                      className="px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                      style={{ background: '#21262d', color: '#c9d1d9' }}>
                      <Copy className="w-3.5 h-3.5" /> Copy message
                    </button>
                  </div>
                </div>
              ))}

              {!negoLoading && (
                <button onClick={() => setNegoOpen(false)}
                  className="w-full p-2.5 rounded-xl text-sm font-medium mt-1"
                  style={{ background: '#21262d', color: '#c9d1d9' }}>
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default function DebatePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center" style={{ background: '#0d1117' }}>
        <p style={{ color: '#8b949e' }}>Loading…</p>
      </main>
    }>
      <DebateContent />
    </Suspense>
  )
}
