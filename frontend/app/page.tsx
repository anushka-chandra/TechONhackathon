'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { ChatEntry } from '@/components/Sidebar'

type Phase = 'intro' | 'expanding' | 'main'
type Step = 1 | 2 | 3

const ALL_AGENTS = ['ceo', 'cto', 'cfo', 'cso'] as const
type AgentId = typeof ALL_AGENTS[number]

const AGENT_META: Record<AgentId, { label: string; sub: string; color: string; icon: React.ReactNode }> = {
  ceo: {
    label: 'CEO',
    sub: 'Strategic Fit & Vision',
    color: 'blue',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/>
        <path d="M5.42 21.44a10.97 10.97 0 0 1 13.16 0"/>
      </svg>
    ),
  },
  cto: {
    label: 'CTO',
    sub: 'Technical Evaluation',
    color: 'emerald',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>
      </svg>
    ),
  },
  cfo: {
    label: 'CFO',
    sub: 'Financial View & ROI',
    color: 'amber',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" x2="12" y1="2" y2="22"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
  cso: {
    label: 'CSO',
    sub: 'Security & Compliance',
    color: 'rose',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
}

const colorMap: Record<string, { bg: string; text: string }> = {
  blue:    { bg: 'rgba(59,130,246,.2)',  text: '#60a5fa' },
  emerald: { bg: 'rgba(16,185,129,.2)',  text: '#34d399' },
  amber:   { bg: 'rgba(245,158,11,.2)',  text: '#fbbf24' },
  rose:    { bg: 'rgba(244,63,94,.2)',   text: '#fb7185' },
}

const SpinnerIcon = () => (
  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
  </svg>
)

export default function LandingPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('intro')
  const [step, setStep] = useState<Step>(1)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentId>>(new Set())
  const [requirements, setRequirements] = useState('')
  const [actionLoading, setActionLoading] = useState<'upload' | 'search' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Intro ──────────────────────────────────────────────────────────
  function handleBubbleClick() {
    if (phase !== 'intro') return
    setPhase('expanding')
    setTimeout(() => {
      setPhase('main')
      setTimeout(() => inputRef.current?.focus(), 600)
    }, 800)
  }

  // ── Instant local summary (no network needed) ────────────────────
  function localSummary(text: string): string {
    const fillers = new Set([
      'a','an','the','is','are','was','were','be','been',
      'have','has','had','do','does','will','would','could',
      'for','with','to','of','in','on','at','by','from',
      'and','or','but','so','that','this','we','i','my',
    ])
    const meaningful = text.split(/\s+/).filter(w => !fillers.has(w.toLowerCase()))
    return (meaningful.slice(0, 6).join(' ') || text.split(/\s+/).slice(0, 6).join(' '))
  }

  // ── Summarise + persist to sidebar history (fire-and-forget) ─────
  async function summarizeAndStore(text: string, agentIds: string) {
    const id = Date.now().toString()

    // ① Write an instant local summary immediately — sidebar updates NOW
    const instantEntry: ChatEntry = {
      id,
      summary: localSummary(text),
      requirements: text,
      agents: agentIds,
      timestamp: Date.now(),
    }
    const existing: ChatEntry[] = JSON.parse(localStorage.getItem('nexus_chats') || '[]')
    localStorage.setItem('nexus_chats', JSON.stringify([...existing, instantEntry]))
    window.dispatchEvent(new Event('nexus_chat_updated'))

    // ② Try to upgrade with a proper summary via the same-origin API route
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.summary && data.summary !== localSummary(text)) {
        // Patch the entry we already stored with the better summary
        const latest: ChatEntry[] = JSON.parse(localStorage.getItem('nexus_chats') || '[]')
        const idx = latest.findIndex(c => c.id === id)
        if (idx !== -1) {
          latest[idx].summary = data.summary
          localStorage.setItem('nexus_chats', JSON.stringify(latest))
          window.dispatchEvent(new Event('nexus_chat_updated'))
        }
      }
    } catch {
      // silent — instant summary is already showing
    }
  }

  // ── Step 1 → 2 ────────────────────────────────────────────────────
  function goToStep2() {
    if (!requirements.trim()) return
    setStep(2)
    summarizeAndStore(requirements, '')   // writes to localStorage synchronously then upgrades async
  }

  // ── Step 2 → 3 ────────────────────────────────────────────────────
  function goToStep3() {
    setIsPanelOpen(false)
    setTimeout(() => setStep(3), 200)
  }

  // ── Agent toggle ──────────────────────────────────────────────────
  const toggleAgent = useCallback((id: AgentId) => {
    setSelectedAgents(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  function handleSelectAll() {
    setSelectedAgents(prev =>
      prev.size === ALL_AGENTS.length ? new Set() : new Set(ALL_AGENTS)
    )
  }

  // ── Step 3 choices ────────────────────────────────────────────────
  function handleVendorChoice(choice: 'upload' | 'search') {
    setActionLoading(choice)
    const agentString = Array.from(selectedAgents).join(',')
    // Patch the most-recent chat entry with the finalised agent list
    try {
      const existing: ChatEntry[] = JSON.parse(
        localStorage.getItem('nexus_chats') || '[]'
      )
      if (existing.length > 0) {
        existing[existing.length - 1].agents = agentString
        localStorage.setItem('nexus_chats', JSON.stringify(existing))
        window.dispatchEvent(new Event('nexus_chat_updated'))
      }
    } catch { /* silent */ }

    setTimeout(() => {
      const params = new URLSearchParams({
        requirements,
        agents: agentString,
      })
      router.push(`/dashboard?${params.toString()}`)
    }, 1800)
  }

  // ── Keyboard ──────────────────────────────────────────────────────
  function handleKeyPress(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && requirements.trim()) goToStep2()
  }

  // ── Render helpers ────────────────────────────────────────────────
  const stepClass = (n: Step) =>
    `step-container ${step === n ? 'step-active' : 'step-hidden'}`

  if (phase === 'intro' || phase === 'expanding') {
    return (
      <div className="relative w-full h-screen flex items-center justify-center overflow-hidden"
        style={{ background: '#050505' }}>
        <div className="bg-mesh" />

        {/* Orb */}
        <div
          id="start-bubble"
          className={`intro-bubble${phase === 'expanding' ? ' expanding' : ''}`}
          onClick={handleBubbleClick}
          title="Click to initialize"
        />

        {/* Label */}
        <div
          className="absolute z-10 pointer-events-none text-center"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, 110px)',
            opacity: phase === 'expanding' ? 0 : 1,
            transition: 'opacity .5s ease',
          }}
        >
          <div className="tap-text">Tap to initialize</div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-screen flex flex-col items-center justify-center overflow-hidden fade-in-up"
      style={{ background: '#050505' }}>
      <div className="bg-mesh" />

      {/* Header */}
      <header className="w-full px-6 py-6 flex justify-between items-center absolute top-0 left-0 z-30">
        <div className="text-xl font-medium tracking-tight"
          style={{ background: 'linear-gradient(to right, #f3f4f6, #6b7280)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Nexus
        </div>
      </header>

      {/* Steps */}
      <main className="flex-1 w-full relative overflow-hidden">

        {/* Step 1 */}
        <div className={stepClass(1)} style={{ padding: '0 1rem' }}>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm mb-6"
            style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: '#9ca3af' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: '#6366f1' }} />
            Step 1 of 3
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-white mb-4">
            Define your requirements.
          </h1>
          <p className="text-lg font-light max-w-2xl mx-auto" style={{ color: '#9ca3af' }}>
            What are you looking to purchase? Describe your budget limits, mandatory features, and what matters most when comparing offers.
          </p>
        </div>

        {/* Step 2 */}
        <div className={stepClass(2)} style={{ padding: '0 1rem' }}>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm mb-6"
            style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: '#9ca3af' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: '#10b981' }} />
            Step 2 of 3
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-white mb-4">
            Select your AI Board.
          </h1>
          <p className="text-lg font-light max-w-2xl mx-auto" style={{ color: '#9ca3af' }}>
            Choose which executive perspectives should evaluate the proposals.
          </p>
          <button
            onClick={() => setIsPanelOpen(true)}
            className="mt-8 inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200"
            style={{
              background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.12)',
              color: '#e5e7eb',
              backdropFilter: 'blur(8px)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.1)'
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,.25)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.06)'
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,.12)'
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Open Board Selection
          </button>
        </div>

        {/* Step 3 */}
        <div className={stepClass(3)}
          style={{ padding: '0 1rem', maxWidth: '80rem' }}>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm mb-6"
            style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: '#9ca3af' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: '#38bdf8' }} />
            Step 3 of 3
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-white mb-4">
            Provide vendor information.
          </h1>
          <p className="text-lg font-light mb-12" style={{ color: '#9ca3af' }}>
            Upload your existing vendor files or let our AI agent search the web for possible vendors and their offers.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Upload */}
            <button
              className="action-card glass-panel p-8 rounded-3xl flex flex-col items-center justify-center text-center gap-4"
              style={{ border: '1px solid rgba(107,114,128,.5)' }}
              onClick={() => handleVendorChoice('upload')}
              disabled={actionLoading !== null}
            >
              <div className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(99,102,241,.1)', color: '#818cf8' }}>
                {actionLoading === 'upload' ? <SpinnerIcon /> : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" x2="12" y1="3" y2="15"/>
                  </svg>
                )}
              </div>
              <div>
                <h3 className="text-xl font-medium text-white mb-2">
                  {actionLoading === 'upload' ? 'Initializing...' : 'Upload Files'}
                </h3>
                <p className="text-sm" style={{ color: '#9ca3af' }}>PDFs, spreadsheets, or text documents.</p>
              </div>
            </button>

            {/* AI Search */}
            <button
              className="action-card glass-panel p-8 rounded-3xl flex flex-col items-center justify-center text-center gap-4"
              style={{ border: '1px solid rgba(107,114,128,.5)' }}
              onClick={() => handleVendorChoice('search')}
              disabled={actionLoading !== null}
            >
              <div className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(56,189,248,.1)', color: '#38bdf8' }}>
                {actionLoading === 'search' ? <SpinnerIcon /> : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" x2="16.65" y1="21" y2="16.65"/>
                    <path d="m11 8 2 2-2 2"/>
                  </svg>
                )}
              </div>
              <div>
                <h3 className="text-xl font-medium text-white mb-2">
                  {actionLoading === 'search' ? 'Initializing...' : 'AI Web Search'}
                </h3>
                <p className="text-sm" style={{ color: '#9ca3af' }}>Let agents automatically find vendors online.</p>
              </div>
            </button>
          </div>
        </div>
      </main>

      {/* Bottom input bar — visible only on step 1 */}
      <div
        id="bottom-bar-container"
        className="absolute bottom-0 w-full p-4 md:p-8 z-30"
        style={{
          background: 'linear-gradient(to top, #050505 60%, transparent)',
          opacity: step === 1 ? 1 : 0,
          transform: step === 1 ? 'translateY(0)' : 'translateY(20px)',
          pointerEvents: step === 1 ? 'auto' : 'none',
          transition: 'opacity .5s ease, transform .5s ease',
        }}
      >
        <div className="max-w-3xl mx-auto flex items-end gap-3">
          <div className="flex-1 input-glass rounded-3xl p-2 md:p-3 flex items-center gap-2 shadow-lg">
            <input
              ref={inputRef}
              type="text"
              value={requirements}
              onChange={e => setRequirements(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your requirements here..."
              className="flex-1 bg-transparent border-none outline-none font-light px-4 py-1.5"
              style={{ color: '#ffffff' }}
              autoComplete="off"
            />
            <button
              onClick={goToStep2}
              disabled={!requirements.trim()}
              className="p-2.5 text-white rounded-full shadow-lg mr-1 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              style={{ background: requirements.trim() ? '#4f46e5' : '#4f46e5' }}
              title="Submit Requirements"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" x2="19" y1="12" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Modal overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{
          background: 'rgba(0,0,0,.6)',
          backdropFilter: 'blur(6px)',
          opacity: isPanelOpen ? 1 : 0,
          pointerEvents: isPanelOpen ? 'auto' : 'none',
          transition: 'opacity .3s ease',
        }}
        onClick={() => setIsPanelOpen(false)}
      />

      {/* Agent Panel — centered modal */}
      <aside
        className="glass-panel fixed z-50 flex flex-col rounded-3xl p-6"
        style={{
          top: '50%',
          left: '50%',
          width: '100%',
          maxWidth: '440px',
          maxHeight: '80vh',
          transform: isPanelOpen
            ? 'translate(-50%, -50%) scale(1)'
            : 'translate(-50%, -50%) scale(0.94)',
          opacity: isPanelOpen ? 1 : 0,
          pointerEvents: isPanelOpen ? 'auto' : 'none',
          transition: 'transform .35s cubic-bezier(.16,1,.3,1), opacity .3s ease',
        }}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-medium">Select Evaluation Board</h2>
          <button
            onClick={() => setIsPanelOpen(false)}
            className="p-2 rounded-full transition-colors"
            style={{ color: '#9ca3af' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pb-6 pr-2">
          {ALL_AGENTS.map(id => {
            const meta = AGENT_META[id]
            const c = colorMap[meta.color]
            const isSelected = selectedAgents.has(id)
            return (
              <button
                key={id}
                className={`agent-card w-full text-left p-4 rounded-2xl flex items-center gap-4 group transition-all${isSelected ? ' selected' : ''}`}
                style={{ border: '1px solid rgba(55,65,81,.5)', background: 'rgba(255,255,255,.05)' }}
                onClick={() => toggleAgent(id)}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: c.bg, color: c.text }}>
                  {meta.icon}
                </div>
                <div>
                  <div className="font-medium" style={{ color: '#e5e7eb' }}>{meta.label}</div>
                  <div className="text-xs" style={{ color: '#9ca3af' }}>{meta.sub}</div>
                </div>
                <div className="ml-auto w-5 h-5 rounded-full border flex items-center justify-center transition-opacity"
                  style={{ borderColor: '#6b7280', opacity: isSelected ? 1 : 0 }}>
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#818cf8' }} />
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(55,65,81,.5)' }}>
          <button
            onClick={handleSelectAll}
            className="w-full p-3 rounded-xl text-sm font-medium transition-colors mb-2"
            style={{ background: '#1f2937' }}
          >
            {selectedAgents.size === ALL_AGENTS.length ? 'Deselect All' : 'Select All Agents'}
          </button>
          <button
            onClick={goToStep3}
            disabled={selectedAgents.size === 0}
            className="w-full p-3 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: '#4f46e5',
              boxShadow: selectedAgents.size > 0 ? '0 0 15px rgba(79,70,229,.4)' : 'none',
            }}
          >
            Apply Selection
          </button>
        </div>
      </aside>
    </div>
  )
}
