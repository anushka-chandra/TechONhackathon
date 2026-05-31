// Static (non-interactive) purchase-decision matrix.
// Renders the backend-computed normalized matrix identically for the dark UI
// and the light PDF report (variant="print"). No state, no interactivity.

import { Grid3x3, Trophy } from 'lucide-react'

interface MatrixReq {
  name: string
  mandatory: boolean
  weight: number
  scores: Record<string, { score: number; failed: boolean }>
  justification: string
}
export interface DecisionMatrixData {
  vendors: string[]
  requirements: MatrixReq[]
  totals: Record<string, number>
  ranking: { vendor: string; total: number }[]
  explanation: string
}

export default function DecisionMatrix({
  matrix, winner, variant = 'dark',
}: { matrix?: DecisionMatrixData; winner?: string; variant?: 'dark' | 'print' }) {
  if (!matrix || !matrix.requirements?.length) return null
  const { vendors, requirements, totals, ranking, explanation } = matrix
  const print = variant === 'print'

  // Palette per variant
  const c = print
    ? { card: '#ffffff', border: '#e5e7eb', head: '#1f2747', headText: '#ffffff', text: '#111827',
        dim: '#6b7280', sub: '#374151', good: '#15803d', fail: '#b91c1c', mand: '#b45309',
        rowAlt: '#f6f8fb', win: '#f0fdf4', winBorder: '#bbf7d0' }
    : { card: '#161b22', border: '#30363d', head: '#0d1117', headText: '#e6edf3', text: '#e6edf3',
        dim: '#8b949e', sub: '#c9d1d9', good: '#3fb950', fail: '#f85149', mand: '#d29922',
        rowAlt: 'rgba(255,255,255,.02)', win: 'rgba(63,185,80,.08)', winBorder: '#3fb950' }

  const th: React.CSSProperties = {
    background: c.head, color: c.headText, fontSize: print ? 9 : 11, fontWeight: 700,
    padding: '7px 8px', textAlign: 'center', borderBottom: `1px solid ${c.border}`,
  }
  const td: React.CSSProperties = {
    fontSize: print ? 9 : 12, padding: '7px 8px', borderBottom: `1px solid ${c.border}`,
    color: c.sub, verticalAlign: 'top',
  }

  const table = (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left', width: print ? '24%' : '22%' }}>Requirement</th>
          <th style={{ ...th, width: '9%' }}>Weight</th>
          {vendors.map(v => (
            <th key={v} style={{ ...th, background: v === winner ? (print ? '#15803d' : '#1f4a2a') : c.head }}>
              {v}{v === winner ? ' 🏆' : ''}
            </th>
          ))}
          <th style={{ ...th, textAlign: 'left', width: print ? '30%' : '28%' }}>Justification</th>
        </tr>
      </thead>
      <tbody>
        {requirements.map((r, i) => (
          <tr key={r.name} style={{ background: i % 2 ? c.rowAlt : 'transparent' }}>
            <td style={{ ...td, color: c.text, fontWeight: 600 }}>
              {r.name}
              {r.mandatory && (
                <span style={{ color: c.mand, fontWeight: 700, fontSize: print ? 8 : 10 }}> · HARD</span>
              )}
            </td>
            <td style={{ ...td, textAlign: 'center', color: c.dim }}>{Math.round(r.weight * 100)}%</td>
            {vendors.map(v => {
              const cell = r.scores[v]
              return (
                <td key={v} style={{ ...td, textAlign: 'center', background: v === winner ? c.win : undefined }}>
                  <span style={{ fontWeight: 700, color: cell.failed ? c.fail : c.text }}>
                    {cell.score.toFixed(2)}
                  </span>
                  {cell.failed && (
                    <span style={{ display: 'block', color: c.fail, fontSize: print ? 7.5 : 9, fontWeight: 700 }}>
                      FAILED
                    </span>
                  )}
                </td>
              )
            })}
            <td style={{ ...td, color: c.dim, fontSize: print ? 8.5 : 11 }}>{r.justification}</td>
          </tr>
        ))}
        {/* Totals */}
        <tr style={{ borderTop: `2px solid ${print ? '#1f2747' : '#3fb950'}` }}>
          <td style={{ ...td, fontWeight: 800, color: c.text }}>Total weighted score</td>
          <td style={{ ...td }} />
          {vendors.map(v => (
            <td key={v} style={{ ...td, textAlign: 'center', fontWeight: 800, color: v === winner ? c.good : c.text,
              background: v === winner ? c.win : undefined }}>
              {(totals[v] ?? 0).toFixed(2)}
            </td>
          ))}
          <td style={{ ...td }} />
        </tr>
      </tbody>
    </table>
  )

  return (
    <div
      className={print ? 'report-section' : 'rounded-xl border'}
      style={print
        ? {}
        : { background: c.card, borderColor: c.border, overflow: 'hidden' }}>
      <div style={{ padding: print ? '0' : '16px 16px 0' }}>
        <h3 style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: print ? 11 : 16, fontWeight: 700,
          color: print ? '#6b7280' : c.text,
          textTransform: print ? 'uppercase' : 'none',
          letterSpacing: print ? '0.06em' : undefined,
          marginBottom: print ? 8 : 12,
        }}>
          {!print && <Grid3x3 className="w-5 h-5" style={{ color: '#58a6ff' }} />}
          Purchase Decision Matrix
        </h3>
      </div>

      <div style={print ? {} : { overflowX: 'auto', padding: '0 16px' }}>
        {table}
      </div>

      {/* Ranking + explanation */}
      <div style={{ padding: print ? '8px 0 0' : '14px 16px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: print ? 10 : 14, marginBottom: 8 }}>
          {ranking.map((r, i) => (
            <span key={r.vendor} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: print ? 9 : 12, color: c.text, fontWeight: i === 0 ? 700 : 500,
            }}>
              {i === 0
                ? <Trophy style={{ width: print ? 11 : 14, height: print ? 11 : 14, color: c.mand }} />
                : <span style={{ color: c.dim }}>{i + 1}.</span>}
              {r.vendor}
              <span style={{ color: i === 0 ? c.good : c.dim, fontWeight: 700 }}>{r.total.toFixed(2)}</span>
            </span>
          ))}
        </div>
        {explanation && (
          <p style={{ fontSize: print ? 9 : 12, lineHeight: 1.5, color: c.dim, margin: 0 }}>
            {explanation}
          </p>
        )}
      </div>
    </div>
  )
}
