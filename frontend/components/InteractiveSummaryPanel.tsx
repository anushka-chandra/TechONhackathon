'use client'

import { useMemo, useState } from 'react'
import {
  SlidersHorizontal, CheckCircle2, AlertTriangle, Trophy, RotateCcw,
  ShieldCheck, ShieldAlert, TrendingUp, ArrowUp, ArrowDown, Minus,
} from 'lucide-react'

// ── Backend data shapes (mirrors the debate scorecards) ──────────────────────────
interface MatrixRow { criterion: string; is_mandatory: boolean; score: number; evidence: string }
interface PersonaScore { score: number; evidence: string }
export interface Scorecard {
  vendor_name: string
  hard_constraints_passed: boolean
  compatibility_score: number
  requirements_matrix: MatrixRow[]
  persona_alignment: Record<string, PersonaScore>
  analytical_summary: { primary_growth_driver: string; primary_risk_factor: string }
}

const PERSONAS = ['CEO', 'CTO', 'CFO', 'CSO'] as const
type Persona = typeof PERSONAS[number]

const PERSONA_LABEL: Record<Persona, string> = {
  CEO: 'Strategy', CTO: 'Technical', CFO: 'Financial', CSO: 'Security',
}

const DEFAULT_WEIGHTS: Record<Persona, number> = { CEO: 50, CTO: 50, CFO: 50, CSO: 50 }

// Canonical (union) requirement set across ALL vendors — mirrors the backend
// build_decision_matrix exactly so the What-If base equals the matrix total and
// the backend compatibility_score. A criterion only one vendor lists still counts
// against the others (missing evidence ⇒ 0, mandatory ⇒ fail).
interface CanonReq { mandatory: boolean; byVendor: Record<string, number> }
interface Canon { order: string[]; reqs: Record<string, CanonReq> }

function buildCanon(scorecards: Scorecard[]): Canon {
  const order: string[] = []
  const reqs: Record<string, CanonReq> = {}
  for (const sc of scorecards) {
    for (const m of sc.requirements_matrix ?? []) {
      const name = (m.criterion ?? '').trim()
      if (!name) continue
      const lc = name.toLowerCase()
      if (!reqs[lc]) { reqs[lc] = { mandatory: false, byVendor: {} }; order.push(lc) }
      if (m.is_mandatory) reqs[lc].mandatory = true
      reqs[lc].byVendor[sc.vendor_name] = Math.max(0, Math.min(1, m.score ?? 0))
    }
  }
  return { order, reqs }
}

// Deterministic, client-side recompute. Step 1 is the normalized union-matrix score
// (identical math to backend build_decision_matrix and compatibility_score); the
// hard penalty is toggleable. Step 2 layers a capped persona bonus so the sliders
// stay live but can never lift an all-hard-failed vendor above 20.
function recompute(sc: Scorecard, canon: Canon, weights: Record<Persona, number>, enforceHard: boolean) {
  if (!canon.order.length) return 0

  // Step 1: matrix score over the canonical (union) requirement set
  let totalWeight = 0, weightedSum = 0
  for (const lc of canon.order) {
    const c = canon.reqs[lc]
    const w = c.mandatory ? 2 : 1
    const present = sc.vendor_name in c.byVendor
    const raw = present ? c.byVendor[sc.vendor_name] : 0
    const value = !present
      ? 0
      : (c.mandatory && enforceHard)
        ? (raw >= 0.5 ? 1.0 : 0.0)
        : Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100
    weightedSum += w * value
    totalWeight += w
  }
  const matrixScore = totalWeight === 0 ? 0 : weightedSum / totalWeight

  // Step 2: persona alignment bonus (0.0 to 0.2 range, so sliders matter
  // but cannot override hard requirement failures)
  let pnum = 0, pden = 0
  for (const p of PERSONAS) {
    const w = weights[p] ?? 0
    const s = sc.persona_alignment?.[p]?.score ?? 3
    pnum += w * s; pden += w
  }
  const personaAvg = pden ? pnum / pden : 3
  const personaNorm = Math.max(0, Math.min(1, (personaAvg - 1) / 4))
  const personaBonus = personaNorm * 0.2  // max 20 point bonus

  return Math.min(100, Math.round((matrixScore + personaBonus) * 100))
}

const scoreColor = (s: number) => (s >= 60 ? '#3fb950' : s >= 35 ? '#d29922' : '#f85149')

// ── Small UI atoms ───────────────────────────────────────────────────────────────
function WeightSlider({ label, sub, value, onChange }: {
  label: string; sub: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>
          {label} <span className="font-normal" style={{ color: '#6b7280' }}>· {sub}</span>
        </span>
        <span className="text-xs font-bold" style={{ color: '#818cf8' }}>{value}%</span>
      </div>
      <input type="range" min={0} max={100} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full cursor-pointer"
        style={{ accentColor: '#818cf8', background: '#21262d' }} />
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return (
    <span className="inline-flex items-center gap-0.5 text-[11px]" style={{ color: '#8b949e' }}>
      <Minus className="w-3 h-3" /> 0
    </span>
  )
  const up = delta > 0
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold"
      style={{ color: up ? '#3fb950' : '#f85149' }}>
      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}{Math.abs(delta)}
    </span>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────────
export default function InteractiveSummaryPanel({
  scorecards, winner,
}: { scorecards: Scorecard[]; winner?: string }) {
  const [weights, setWeights] = useState<Record<Persona, number>>(DEFAULT_WEIGHTS)
  const [threshold, setThreshold] = useState(50)        // min score (%) for a requirement to "pass"
  const [enforceHard, setEnforceHard] = useState(true)

  const canon = useMemo(() => buildCanon(scorecards), [scorecards])

  const ranked = useMemo(() =>
    scorecards
      .map(sc => ({ sc, score: recompute(sc, canon, weights, enforceHard) }))
      .map(r => ({ ...r, delta: r.score - r.sc.compatibility_score }))
      .sort((a, b) => b.score - a.score),
    [scorecards, canon, weights, enforceHard],
  )

  const dirty = PERSONAS.some(p => weights[p] !== DEFAULT_WEIGHTS[p]) || threshold !== 50 || !enforceHard
  const liveWinner = ranked[0]?.sc.vendor_name

  function reset() {
    setWeights(DEFAULT_WEIGHTS); setThreshold(50); setEnforceHard(true)
  }

  if (!scorecards.length) return null

  return (
    <div>
      <h3 className="font-bold text-lg mb-1 flex items-center gap-2" style={{ color: '#e6edf3' }}>
        <SlidersHorizontal className="w-5 h-5" style={{ color: '#a371f7' }} />
        What-If Sensitivity Simulator
      </h3>
      <p className="text-xs mb-4" style={{ color: '#8b949e' }}>
        Re-weight the board&rsquo;s priorities and tighten constraints to stress-test the decision —
        scores and flags update instantly, no re-run of the AI debate.
      </p>

      {/* Controls */}
      <div className="rounded-xl border p-5 mb-5" style={{ background: '#161b22', borderColor: '#30363d' }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#8b949e' }}>
            Board priority weights
          </span>
          <button onClick={reset} disabled={!dirty}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-40"
            style={{ background: '#21262d', color: '#c9d1d9' }}>
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-5">
          {PERSONAS.map(p => (
            <WeightSlider key={p} label={p} sub={PERSONA_LABEL[p]}
              value={weights[p]} onChange={v => setWeights(w => ({ ...w, [p]: v }))} />
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 pt-4"
          style={{ borderTop: '1px solid #21262d' }}>
          {/* Requirement pass bar */}
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>
                Minimum requirement bar
              </span>
              <span className="text-xs font-bold" style={{ color: '#818cf8' }}>{threshold}%</span>
            </div>
            <input type="range" min={0} max={100} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-full h-1.5 rounded-full cursor-pointer"
              style={{ accentColor: '#818cf8', background: '#21262d' }} />
            <p className="text-[10px] mt-1" style={{ color: '#6b7280' }}>
              Criteria scoring below this are flagged as warnings.
            </p>
          </div>

          {/* Hard constraint toggle */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold block" style={{ color: '#e6edf3' }}>
                Enforce hard constraints
              </span>
              <span className="text-[10px]" style={{ color: '#6b7280' }}>
                Heavily penalise vendors that fail a must-have.
              </span>
            </div>
            <button onClick={() => setEnforceHard(v => !v)}
              className="relative w-11 h-6 rounded-full shrink-0 transition-colors"
              style={{ background: enforceHard ? '#4f46e5' : '#30363d' }}>
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                style={{ left: enforceHard ? '22px' : '2px' }} />
            </button>
          </div>
        </div>
      </div>

      {/* Live re-ranking notice */}
      {dirty && liveWinner && liveWinner !== winner && (
        <div className="rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2 text-sm"
          style={{ background: 'rgba(210,153,34,.12)', border: '1px solid rgba(210,153,34,.4)', color: '#e6edf3' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: '#d29922' }} />
          With these priorities, <b className="mx-1">{liveWinner}</b> overtakes the board&rsquo;s pick
          (<span style={{ color: '#8b949e' }}>{winner}</span>).
        </div>
      )}

      {/* Vendor scorecards (re-ranked) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {ranked.map(({ sc, score, delta }, i) => {
          const isTop = i === 0
          return (
            <div key={sc.vendor_name} className="rounded-xl border p-5"
              style={{ background: '#161b22', borderColor: isTop ? '#3fb950' : '#30363d' }}>
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  {isTop && <Trophy className="w-4 h-4 shrink-0" style={{ color: '#d29922' }} />}
                  <span className="font-bold text-sm truncate" style={{ color: '#e6edf3' }}>{sc.vendor_name}</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-black leading-none" style={{ color: scoreColor(score) }}>
                    {score}<span className="text-xs font-normal" style={{ color: '#8b949e' }}>/100</span>
                  </div>
                  <DeltaBadge delta={delta} />
                </div>
              </div>

              {/* Score bar */}
              <div className="h-2 rounded-full mb-3" style={{ background: '#21262d' }}>
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${score}%`, background: scoreColor(score) }} />
              </div>

              {/* Hard constraint */}
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 mb-3"
                style={{
                  background: sc.hard_constraints_passed ? '#1f4a2a' : '#4a1f1f',
                  color: sc.hard_constraints_passed ? '#3fb950' : '#f85149',
                }}>
                {sc.hard_constraints_passed ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                {sc.hard_constraints_passed ? 'Hard constraints passed' : 'Hard constraint failed'}
              </span>

              {/* Requirement bullets — pass/warn driven by the threshold slider */}
              <ul className="space-y-1.5 mb-3">
                {(sc.requirements_matrix ?? []).map((m, idx) => {
                  const pass = Math.round(m.score * 100) >= threshold
                  return (
                    <li key={idx} className="flex items-start gap-2 text-xs" title={m.evidence}>
                      {pass
                        ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#3fb950' }} />
                        : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#d29922' }} />}
                      <span className="flex-1" style={{ color: pass ? '#c9d1d9' : '#e6edf3' }}>
                        {m.criterion}
                        {m.is_mandatory && <span title="mandatory" style={{ color: '#f85149' }}> *</span>}
                      </span>
                      <span className="font-bold shrink-0" style={{ color: pass ? '#3fb950' : '#d29922' }}>
                        {m.score.toFixed(1)}
                      </span>
                    </li>
                  )
                })}
              </ul>

              {/* Analytical bullets */}
              {sc.analytical_summary?.primary_growth_driver && (
                <p className="flex items-start gap-1.5 text-xs mb-1" style={{ color: '#8b949e' }}>
                  <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#3fb950' }} />
                  {sc.analytical_summary.primary_growth_driver}
                </p>
              )}
              {sc.analytical_summary?.primary_risk_factor && (
                <p className="flex items-start gap-1.5 text-xs" style={{ color: '#8b949e' }}>
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#f85149' }} />
                  {sc.analytical_summary.primary_risk_factor}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] mt-3" style={{ color: '#6b7280' }}>
        * mandatory (hard) constraint · scores re-weighted locally from the existing analysis
      </p>
    </div>
  )
}
