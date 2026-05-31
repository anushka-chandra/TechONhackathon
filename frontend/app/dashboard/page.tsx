'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Trophy,
  ShieldCheck,
  DollarSign,
  Cpu,
  Package,
  Users,
  Briefcase,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  TrendingUp,
  BarChart3,
  Sparkles,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
interface Agent {
  id: string
  name: string
  icon: string
  role: string
  stance: string
  reasoning: string
  vote: 'YES' | 'NO'
  confidence: number
  voted_for: string
}

interface ScenarioCase {
  label: string
  adoption: string
  tco: string
  gdpr: string
  note: string
}

interface SimResult {
  winner: string
  confidence: number
  simulation_count: number
  vote_summary: { yes: number; no: number; total: number }
  agents: Agent[]
  metrics: Record<string, string>[]
  scenarios: Record<string, { best: ScenarioCase; expected: ScenarioCase; worst: ScenarioCase }>
  decision_stability: Record<string, number>
  recommendation: string
}

// ── Sub-components ─────────────────────────────────────────────────────────────
const agentIcons: Record<string, React.ReactNode> = {
  ceo:         <Briefcase className="w-6 h-6" />,
  finance:     <DollarSign className="w-6 h-6" />,
  security:    <ShieldCheck className="w-6 h-6" />,
  engineering: <Cpu className="w-6 h-6" />,
  procurement: <Package className="w-6 h-6" />,
}

function ConfidenceMeter({ value, color }: { value: number; color: string }) {
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs mb-1" style={{ color: '#8b949e' }}>
        <span>Confidence</span>
        <span style={{ color }}>{value}%</span>
      </div>
      <div className="h-1.5 rounded-full" style={{ background: '#21262d' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

function AgentCard({ agent, index }: { agent: Agent; index: number }) {
  const isYes = agent.vote === 'YES'
  const color = isYes ? '#3fb950' : '#f85149'

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="rounded-xl p-4 border flex flex-col gap-1"
      style={{
        background: 'linear-gradient(135deg, #1c2128 0%, #21262d 100%)',
        borderColor: isYes ? 'rgba(63,185,80,0.4)' : 'rgba(248,81,73,0.4)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ color: '#58a6ff' }}>
          {agentIcons[agent.id] ?? <Users className="w-6 h-6" />}
          <span className="font-bold text-sm" style={{ color: '#e6edf3' }}>{agent.name}</span>
        </div>
        <span
          className="text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1"
          style={{ background: isYes ? '#1f4a2a' : '#4a1f1f', color }}
        >
          {isYes ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {agent.vote}
        </span>
      </div>

      <p className="text-xs mt-1" style={{ color: '#8b949e' }}>{agent.role}</p>
      <p className="text-xs mt-1 leading-relaxed" style={{ color: '#c9d1d9' }}>{agent.reasoning}</p>

      <ConfidenceMeter value={agent.confidence} color={color} />
    </motion.div>
  )
}

function ScenarioCard({
  title, data, accent, bg, delay,
}: {
  title: string; data: ScenarioCase; accent: string; bg: string; delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, delay }}
      className="rounded-xl p-4 border"
      style={{ background: bg, borderColor: accent }}
    >
      <p className="font-bold text-sm mb-3" style={{ color: accent }}>{title}</p>
      <div className="space-y-1.5 text-xs" style={{ color: '#8b949e' }}>
        <div className="flex justify-between">
          <span>Adoption</span>
          <span style={{ color: '#c9d1d9' }}>{data.adoption}</span>
        </div>
        <div className="flex justify-between">
          <span>3-Yr TCO</span>
          <span style={{ color: '#c9d1d9' }}>{data.tco}</span>
        </div>
        <div className="flex justify-between">
          <span>GDPR</span>
          <span style={{ color: '#c9d1d9' }}>{data.gdpr}</span>
        </div>
        <p className="mt-2 pt-2 text-xs leading-relaxed"
          style={{ borderTop: '1px solid #30363d', color: '#8b949e' }}>
          {data.note}
        </p>
      </div>
    </motion.div>
  )
}

function StabilityBar({ vendor, pct, color, delay }: {
  vendor: string; pct: number; color: string; delay: number
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span style={{ color: '#e6edf3' }}>{vendor}</span>
        <span className="font-bold" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-4 rounded-full overflow-hidden" style={{ background: '#21262d' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, ${color}cc)` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.2, delay, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
function DashboardContent() {
  const searchParams = useSearchParams()

  // Seed state from landing-page URL params (requirements + agents)
  const paramRequirements = searchParams.get('requirements') ?? ''
  const paramAgents = searchParams.get('agents') ?? ''           // e.g. "ceo,cfo"
  const paramSessionId = searchParams.get('session_id') ?? ''    // links uploaded PDF
  const fromLanding = Boolean(paramRequirements || paramAgents)

  const [target, setTarget] = useState(
    paramRequirements || 'Project Management Software'
  )
  const [users, setUsers] = useState(100)
  const [budget, setBudget] = useState(30000)
  const [vendors, setVendors] = useState('Asana, Monday.com')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SimResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Parse the comma-separated agent IDs passed from the landing page
  const selectedAgents = paramAgents
    ? paramAgents.split(',').map(a => a.trim()).filter(Boolean)
    : []

  async function runSimulation() {
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        target,
        users,
        budget,
        vendors: vendors.split(',').map((v) => v.trim()).filter(Boolean),
      }
      // Only send selected_agents when they came from the landing page flow
      if (selectedAgents.length > 0) {
        body.selected_agents = selectedAgents
      }
      // Attach the session so the backend feeds the uploaded PDF text to the agents
      if (paramSessionId) {
        body.session_id = paramSessionId
      }
      const res = await fetch('/api/py/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      setResult(await res.json())
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setError(
        `Could not reach the FastAPI backend. Make sure it is running on port 8000.\n\n${msg}`
      )
    } finally {
      setLoading(false)
    }
  }

  // Auto-run when arriving from the landing page with pre-filled params
  useEffect(() => {
    if (fromLanding) runSimulation()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const vendorList = result ? Object.keys(result.decision_stability) : []

  return (
    <main className="min-h-screen" style={{ background: '#0d1117' }}>

      {/* Hero */}
      <div className="border-b" style={{
        borderColor: '#21262d',
        background: 'linear-gradient(180deg, #161b22 0%, #0d1117 100%)',
      }}>
        <div className="max-w-7xl mx-auto px-6 py-10">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center glow-pulse"
                style={{ background: 'linear-gradient(135deg, #58a6ff, #388bfd)' }}
              >
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-3xl font-black tracking-tight" style={{ color: '#e6edf3' }}>
                AI Purchasing Society <span className="text-2xl">🏛️</span>
              </h1>
            </div>
            <p className="text-base ml-[52px]" style={{ color: '#8b949e' }}>
              A Virtual Organization of Specialized AI Agents Simulating Procurement Outcomes.
            </p>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-10">

        {/* Input Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="rounded-2xl border p-6"
          style={{
            background: 'rgba(22, 27, 34, 0.8)',
            borderColor: '#30363d',
            backdropFilter: 'blur(12px)',
          }}
        >
          <h2 className="font-bold text-lg mb-5 flex items-center gap-2" style={{ color: '#e6edf3' }}>
            <BarChart3 className="w-5 h-5" style={{ color: '#58a6ff' }} />
            Procurement Requirements
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: '🎯 Target Category', value: target, setter: setTarget, type: 'text' },
            ].map(({ label, value, setter, type }) => (
              <div key={label}>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: '#8b949e' }}>
                  {label}
                </label>
                <input
                  type={type}
                  className="w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors"
                  style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
                  value={value}
                  onChange={(e) => setter(e.target.value as never)}
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: '#8b949e' }}>👥 Number of Users</label>
              <input
                type="number"
                className="w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors"
                style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
                value={users}
                onChange={(e) => setUsers(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: '#8b949e' }}>💶 Annual Budget (€)</label>
              <input
                type="number"
                className="w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors"
                style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: '#8b949e' }}>🏢 Vendors (comma-separated)</label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors"
                style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
                value={vendors}
                onChange={(e) => setVendors(e.target.value)}
              />
            </div>
          </div>

          <button
            onClick={runSimulation}
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: loading
                ? '#1f4a2a'
                : 'linear-gradient(135deg, #238636, #2ea043)',
              color: '#ffffff',
              boxShadow: loading ? 'none' : '0 0 20px rgba(46,160,67,0.35)',
            }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Simulating 1,000 future organizational outcomes...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Run Society Simulation
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 text-xs rounded-lg p-3 whitespace-pre-wrap"
              style={{
                background: '#4a1f1f',
                color: '#f85149',
                border: '1px solid rgba(248,81,73,0.3)',
              }}
            >
              {error}
            </motion.p>
          )}
        </motion.div>

        {/* Results */}
        <AnimatePresence>
          {result && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-10"
            >

              {/* Winner Banner */}
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="rounded-2xl border p-8 text-center"
                style={{
                  background: 'linear-gradient(135deg, #1a3a1a 0%, #0f2a0f 100%)',
                  borderColor: '#3fb950',
                  boxShadow: '0 0 40px rgba(63,185,80,0.15)',
                }}
              >
                <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: '#3fb950' }}>
                  Society Verdict — {result.simulation_count.toLocaleString()} Paths Simulated
                </p>
                <div className="flex items-center justify-center gap-3 mb-2">
                  <Trophy className="w-8 h-8" style={{ color: '#d29922' }} />
                  <h2 className="text-4xl font-black" style={{ color: '#3fb950' }}>{result.winner}</h2>
                </div>
                <p className="text-lg" style={{ color: '#7ee787' }}>
                  {result.confidence}% Confidence · Recommended Vendor
                </p>
                <p className="text-sm mt-3 max-w-2xl mx-auto" style={{ color: '#8b949e' }}>
                  {result.recommendation}
                </p>
              </motion.div>

              {/* Agent Boardroom */}
              <div>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2" style={{ color: '#e6edf3' }}>
                  <Users className="w-5 h-5" style={{ color: '#58a6ff' }} />
                  AI Boardroom Chamber
                  <span className="text-sm font-normal ml-2 px-2 py-0.5 rounded-full"
                    style={{ background: '#1f4a2a', color: '#3fb950' }}>
                    {result.vote_summary.yes} YES
                  </span>
                  <span className="text-sm font-normal px-2 py-0.5 rounded-full"
                    style={{ background: '#4a1f1f', color: '#f85149' }}>
                    {result.vote_summary.no} NO
                  </span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                  {result.agents.map((agent, i) => (
                    <AgentCard key={agent.id} agent={agent} index={i} />
                  ))}
                </div>
              </div>

              {/* Metrics Table */}
              <div>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2" style={{ color: '#e6edf3' }}>
                  <TrendingUp className="w-5 h-5" style={{ color: '#58a6ff' }} />
                  Vendor Comparison Matrix
                </h3>
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#30363d' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: '#161b22' }}>
                        <th className="text-left px-4 py-3 font-semibold" style={{ color: '#8b949e' }}>
                          Metric
                        </th>
                        {vendorList.map((v) => (
                          <th key={v} className="text-center px-4 py-3 font-semibold"
                            style={{ color: '#58a6ff' }}>
                            {v}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.metrics.map((row, i) => (
                        <tr
                          key={i}
                          style={{
                            background: i % 2 === 0 ? '#0d1117' : '#161b22',
                            borderTop: '1px solid #21262d',
                          }}
                        >
                          <td className="px-4 py-3" style={{ color: '#c9d1d9' }}>{row.label}</td>
                          {vendorList.map((v) => (
                            <td key={v} className="px-4 py-3 text-center font-medium"
                              style={{ color: row.winner === v ? '#3fb950' : '#8b949e' }}>
                              {row[v]}
                              {row.winner === v && <span className="ml-1 text-xs">✓</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Decision Stability */}
              <div>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2" style={{ color: '#e6edf3' }}>
                  <BarChart3 className="w-5 h-5" style={{ color: '#58a6ff' }} />
                  Decision Stability Across {result.simulation_count.toLocaleString()} Simulated Futures
                </h3>
                <div className="rounded-xl border p-6 space-y-5"
                  style={{ background: '#161b22', borderColor: '#30363d' }}>
                  {vendorList.map((v, i) => (
                    <StabilityBar
                      key={v}
                      vendor={v}
                      pct={result.decision_stability[v]}
                      color={i === 0 ? '#3fb950' : '#58a6ff'}
                      delay={i * 0.2}
                    />
                  ))}
                </div>
              </div>

              {/* Scenario Matrix */}
              <div>
                <h3 className="font-bold text-lg mb-4" style={{ color: '#e6edf3' }}>
                  🌐 Future Scenario Matrix
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {vendorList.map((vendor, vi) => (
                    <div key={vendor}>
                      <p className="font-semibold mb-3"
                        style={{ color: vi === 0 ? '#3fb950' : '#58a6ff' }}>
                        {vi === 0 ? '🟢' : '🔵'} {vendor}
                      </p>
                      <div className="space-y-3">
                        <ScenarioCard title="✨ Best Case"
                          data={result.scenarios[vendor].best}
                          accent="#3fb950" bg="rgba(26,58,26,0.6)"
                          delay={0.1 + vi * 0.05} />
                        <ScenarioCard title="📊 Expected Case"
                          data={result.scenarios[vendor].expected}
                          accent="#58a6ff" bg="rgba(26,42,58,0.6)"
                          delay={0.2 + vi * 0.05} />
                        <ScenarioCard title="⚠️ Worst Case"
                          data={result.scenarios[vendor].worst}
                          accent="#f85149" bg="rgba(58,26,26,0.6)"
                          delay={0.3 + vi * 0.05} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

        {!result && !loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-dashed py-16 text-center"
            style={{ borderColor: '#30363d' }}
          >
            <p className="text-4xl mb-3">🏛️</p>
            <p className="font-semibold" style={{ color: '#8b949e' }}>
              Configure your requirements above and click{' '}
              <span style={{ color: '#58a6ff' }}>Run Society Simulation</span> to begin.
            </p>
          </motion.div>
        )}
      </div>

      <footer className="border-t mt-16 py-6 text-center text-xs"
        style={{ borderColor: '#21262d', color: '#484f58' }}>
        AI Purchasing Society · Hackathon Demo · Next.js 16 + FastAPI
      </footer>
    </main>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center" style={{ background: '#0d1117' }}>
        <p style={{ color: '#8b949e' }}>Loading…</p>
      </main>
    }>
      <DashboardContent />
    </Suspense>
  )
}
