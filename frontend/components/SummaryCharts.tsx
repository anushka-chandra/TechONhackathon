'use client'

import { useMemo, useState } from 'react'
import { Radar, LineChart as LineIcon } from 'lucide-react'
import type { Scorecard } from './InteractiveSummaryPanel'

// Vendor colour palette (by index)
const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#a371f7', '#f85149']

// Radar categories → persona key (Requirements Fit is derived from the soft matrix)
const CATEGORIES = ['Strategy', 'Technical', 'Financial', 'Security', 'Requirements Fit'] as const
const CAT_PERSONA: Record<string, string | null> = {
  Strategy: 'CEO', Technical: 'CTO', Financial: 'CFO', Security: 'CSO', 'Requirements Fit': null,
}

// 0–5 value for a category from a scorecard
function catValue(sc: Scorecard, cat: string): number {
  const key = CAT_PERSONA[cat]
  if (key) return Math.max(0, Math.min(5, sc.persona_alignment?.[key]?.score ?? 0))
  const m = sc.requirements_matrix ?? []
  const avg = m.length ? m.reduce((s, r) => s + (r.score ?? 0), 0) / m.length : 0
  return Math.max(0, Math.min(5, avg * 5)) // soft matrix is 0–1 → scale to 0–5
}

// Illustrative cost-sensitivity model: a fixed monthly base + a per-seat rate.
// Bases rise and per-seat rates fall across vendors so the lines genuinely cross
// (producing visible tipping points) — clearly a sensitivity simulation.
function costModel(index: number) {
  return { base: 150 + index * 230, perSeat: Math.max(4, 18 - index * 5) }
}
const MAX_USERS = 400

export default function SummaryCharts({ scorecards, winner }: { scorecards: Scorecard[]; winner?: string }) {
  const vendors = useMemo(
    () => scorecards.map((sc, i) => ({ name: sc.vendor_name, color: COLORS[i % COLORS.length], sc, index: i })),
    [scorecards],
  )

  // ── Isolated state (only this component re-renders) ──
  const [active, setActive] = useState<Record<string, boolean>>(
    () => Object.fromEntries(vendors.map(v => [v.name, true])),
  )
  const [users, setUsers] = useState(100)
  const [hover, setHover] = useState<{ left: number; top: number; cat: string } | null>(null)

  const shown = vendors.filter(v => active[v.name])
  const toggle = (name: string) => setActive(a => ({ ...a, [name]: !a[name] }))

  if (!scorecards.length) return null

  // ── Radar geometry ──
  const SIZE = 260, C = SIZE / 2, R = 86
  const angle = (i: number) => (-90 + i * (360 / CATEGORIES.length)) * (Math.PI / 180)
  const pt = (i: number, v: number) => {
    const r = (R * v) / 5
    return [C + r * Math.cos(angle(i)), C + r * Math.sin(angle(i))] as const
  }
  const labelPt = (i: number) => {
    const r = R + 16
    return [C + r * Math.cos(angle(i)), C + r * Math.sin(angle(i))] as const
  }

  // ── Line chart geometry ──
  const LW = 360, LH = 240, PAD_L = 44, PAD_B = 30, PAD_T = 10, PAD_R = 12
  const plotW = LW - PAD_L - PAD_R, plotH = LH - PAD_T - PAD_B
  const lineModels = shown.map(v => ({ ...v, ...costModel(v.index) }))
  const maxCost = Math.max(1, ...lineModels.map(m => m.base + m.perSeat * MAX_USERS)) * 1.08
  const xPx = (u: number) => PAD_L + (u / MAX_USERS) * plotW
  const yPx = (c: number) => PAD_T + plotH - (c / maxCost) * plotH

  // Tipping points (pairwise line intersections within range)
  const tips: { x: number; y: number }[] = []
  for (let i = 0; i < lineModels.length; i++) {
    for (let j = i + 1; j < lineModels.length; j++) {
      const a = lineModels[i], b = lineModels[j]
      if (a.perSeat === b.perSeat) continue
      const u = (b.base - a.base) / (a.perSeat - b.perSeat)
      if (u > 1 && u < MAX_USERS) tips.push({ x: xPx(u), y: yPx(a.base + a.perSeat * u) })
    }
  }

  // Cheapest at the current slider position
  const atUsers = lineModels
    .map(m => ({ name: m.name, color: m.color, cost: m.base + m.perSeat * users }))
    .sort((p, q) => p.cost - q.cost)
  const cheapest = atUsers[0]

  const cardStyle = { background: '#161b22', borderColor: '#30363d' } as const

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* ── 1. Value Alignment Radar ── */}
      <div className="rounded-xl border p-5" style={cardStyle}>
        <h4 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: '#e6edf3' }}>
          <Radar className="w-4 h-4" style={{ color: '#58a6ff' }} /> Value Alignment Radar
        </h4>

        <div className="relative">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" style={{ maxHeight: 280 }}>
            {/* concentric grid */}
            {[1, 2, 3, 4, 5].map(level => (
              <polygon key={level}
                points={CATEGORIES.map((_, i) => pt(i, level).join(',')).join(' ')}
                fill="none" stroke="#21262d" strokeWidth="1" />
            ))}
            {/* axes */}
            {CATEGORIES.map((_, i) => {
              const [x, y] = pt(i, 5)
              return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="#21262d" strokeWidth="1" />
            })}
            {/* vendor polygons */}
            {shown.map(v => {
              const poly = CATEGORIES.map((c, i) => pt(i, catValue(v.sc, c)).join(',')).join(' ')
              return (
                <g key={v.name}>
                  <polygon points={poly} fill={v.color} fillOpacity={0.12} stroke={v.color} strokeWidth="2" />
                  {CATEGORIES.map((c, i) => {
                    const [x, y] = pt(i, catValue(v.sc, c))
                    return <circle key={i} cx={x} cy={y} r="2.6" fill={v.color} />
                  })}
                </g>
              )
            })}
            {/* category labels (hover for per-vendor tooltip) */}
            {CATEGORIES.map((c, i) => {
              const [x, y] = labelPt(i)
              const anchor = x < C - 4 ? 'end' : x > C + 4 ? 'start' : 'middle'
              return (
                <text key={c} x={x} y={y} fontSize="8.5" fill="#8b949e" textAnchor={anchor}
                  dominantBaseline="middle" style={{ cursor: 'default' }}
                  onMouseEnter={() => setHover({ left: (x / SIZE) * 100, top: (y / SIZE) * 100, cat: c })}
                  onMouseLeave={() => setHover(null)}>
                  {c}
                </text>
              )
            })}
          </svg>

          {/* custom hover tooltip */}
          {hover && (
            <div className="absolute z-10 pointer-events-none rounded-lg px-3 py-2 text-xs shadow-lg"
              style={{
                left: `${hover.left}%`, top: `${hover.top}%`, transform: 'translate(-50%, -115%)',
                background: '#0d1117', border: '1px solid #30363d', minWidth: 130,
              }}>
              <p className="font-bold mb-1" style={{ color: '#e6edf3' }}>{hover.cat}</p>
              {shown.map(v => (
                <p key={v.name} className="flex items-center justify-between gap-3" style={{ color: '#c9d1d9' }}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: v.color }} />{v.name}
                  </span>
                  <span className="font-bold">{catValue(v.sc, hover.cat).toFixed(1)}/5</span>
                </p>
              ))}
            </div>
          )}
        </div>

        {/* legend toggles */}
        <div className="flex flex-wrap gap-2 mt-2">
          {vendors.map(v => (
            <button key={v.name} onClick={() => toggle(v.name)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-opacity"
              style={{
                background: 'rgba(255,255,255,.05)', border: '1px solid #30363d',
                color: active[v.name] ? '#e6edf3' : '#6b7280', opacity: active[v.name] ? 1 : 0.55,
              }}>
              <span className="w-2.5 h-2.5 rounded-full"
                style={{ background: active[v.name] ? v.color : '#484f58' }} />
              {v.name}{v.name === winner ? ' 🏆' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ── 2. Tipping Point & Cost Sensitivity ── */}
      <div className="rounded-xl border p-5" style={cardStyle}>
        <h4 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: '#e6edf3' }}>
          <LineIcon className="w-4 h-4" style={{ color: '#3fb950' }} /> Tipping Point &amp; Cost Sensitivity
        </h4>

        <svg viewBox={`0 0 ${LW} ${LH}`} className="w-full" style={{ maxHeight: 280 }}>
          {/* y gridlines + labels */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const c = maxCost * f
            return (
              <g key={f}>
                <line x1={PAD_L} y1={yPx(c)} x2={LW - PAD_R} y2={yPx(c)} stroke="#21262d" strokeWidth="1" />
                <text x={PAD_L - 6} y={yPx(c)} fontSize="8" fill="#6b7280" textAnchor="end" dominantBaseline="middle">
                  €{Math.round(c).toLocaleString()}
                </text>
              </g>
            )
          })}
          {/* x labels */}
          {[0, 0.5, 1].map(f => (
            <text key={f} x={xPx(MAX_USERS * f)} y={LH - PAD_B + 14} fontSize="8" fill="#6b7280" textAnchor="middle">
              {Math.round(MAX_USERS * f)}
            </text>
          ))}
          <text x={PAD_L + plotW / 2} y={LH - 2} fontSize="8" fill="#8b949e" textAnchor="middle">Users (seats)</text>

          {/* vendor cost lines */}
          {lineModels.map(m => (
            <line key={m.name}
              x1={xPx(0)} y1={yPx(m.base)} x2={xPx(MAX_USERS)} y2={yPx(m.base + m.perSeat * MAX_USERS)}
              stroke={m.color} strokeWidth="2" />
          ))}

          {/* tipping points */}
          {tips.map((t, i) => (
            <circle key={i} cx={t.x} cy={t.y} r="3.5" fill="#0d1117" stroke="#f0b429" strokeWidth="1.6" />
          ))}

          {/* slider marker */}
          <line x1={xPx(users)} y1={PAD_T} x2={xPx(users)} y2={PAD_T + plotH}
            stroke="#e6edf3" strokeWidth="1" strokeDasharray="3 3" />
          {lineModels.map(m => (
            <circle key={m.name} cx={xPx(users)} cy={yPx(m.base + m.perSeat * users)} r="3" fill={m.color} />
          ))}
        </svg>

        {/* slider */}
        <div className="mt-1">
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: '#8b949e' }}>Team size</span>
            <span className="font-bold" style={{ color: '#e6edf3' }}>{users} users</span>
          </div>
          <input type="range" min={10} max={MAX_USERS} step={10} value={users}
            onChange={e => setUsers(Number(e.target.value))}
            className="w-full h-1.5 rounded-full cursor-pointer"
            style={{ accentColor: '#3fb950', background: '#21262d' }} />
        </div>

        {/* live readout */}
        {cheapest && (
          <p className="text-xs mt-2" style={{ color: '#8b949e' }}>
            At <b style={{ color: '#e6edf3' }}>{users}</b> users, cheapest is{' '}
            <b style={{ color: cheapest.color }}>{cheapest.name}</b> at{' '}
            <b style={{ color: '#e6edf3' }}>€{Math.round(cheapest.cost).toLocaleString()}/mo</b>
            {tips.length > 0 && <> · <span style={{ color: '#f0b429' }}>●</span> = pricing tipping point</>}
          </p>
        )}
        <p className="text-[10px] mt-1" style={{ color: '#6b7280' }}>
          Illustrative base-fee + per-seat sensitivity model.
        </p>
      </div>
    </div>
  )
}
