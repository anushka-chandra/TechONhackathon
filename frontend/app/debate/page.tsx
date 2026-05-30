'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Download, FastForward, Loader2, Trophy,
  CheckCircle2, XCircle, Gavel, RefreshCw, Users, FileText,
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
interface DebateResult {
  vendors: string[]
  agents: { id: string; name: string; icon: string; role: string }[]
  rounds: Round[]
  decision: Decision
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

  const [data, setData] = useState<DebateResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [revealed, setRevealed] = useState(0)
  const [typing, setTyping] = useState(false)
  const [done, setDone] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const skipRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)

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
        target: requirements || 'Procurement decision',
        users: 100,
        budget: 30000,
        vendors: vendorList,
      }
      if (agents.length) body.selected_agents = agents
      if (sessionId) body.session_id = sessionId

      const res = await fetch('http://localhost:8000/api/debate', {
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

  // Run once on mount
  useEffect(() => { runDebate(vendors) /* eslint-disable-next-line */ }, [])

  // ── Animate the reveal whenever new data arrives ───────────────────────────────
  useEffect(() => {
    if (!data) return
    skipRef.current = false
    setRevealed(0); setDone(false); setTyping(false)
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

  // Auto-scroll as turns appear
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [revealed, typing, done])

  function handleSkip() {
    skipRef.current = true
    setTyping(false)
    setRevealed(flatTurns.length)
    setDone(true)
  }

  function handleRerun() {
    const parsed = vendorsInput.split(',').map(v => v.trim()).filter(Boolean).slice(0, 2)
    const finalVendors = parsed.length === 2 ? parsed : deriveVendors(requirements)
    setVendors(finalVendors)
    runDebate(finalVendors)
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

  // ── Loading state ──────────────────────────────────────────────────────────────
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

          {!done ? (
            <button onClick={handleSkip}
              className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{ background: '#21262d', color: '#c9d1d9' }}>
              <FastForward className="w-3.5 h-3.5" /> Skip
            </button>
          ) : (
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
              {requirements || 'Procurement decision'}
            </p>
            <p className="text-xs mt-2" style={{ color: '#8b949e' }}>
              Evaluating <b style={{ color: '#e6edf3' }}>{vendors.join(' vs ')}</b>
              {data && <> · {data.agents.length} board members in session</>}
            </p>
          </div>
        </div>

        {/* Transcript */}
        <div className="space-y-4">
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

        {/* Decision panel */}
        {done && dec && (
          <div className="turn-in mt-12 space-y-6">
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

            <div className="flex justify-center gap-3 pt-2">
              <button onClick={() => setShowReport(true)}
                className="px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg,#238636,#2ea043)', color: '#fff' }}>
                <Download className="w-4 h-4" /> Download Decision Report
              </button>
            </div>
          </div>
        )}
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
                    {requirements || 'Procurement decision'}
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
