'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useChat } from '@/context/ChatContext'

type Phase = 'intro' | 'expanding' | 'main'
type Step = 1 | 2 | 3

// A source gathered in Step 3 (uploaded file or AI-found vendor), with classification
interface UploadedDoc {
  name: string
  chars: number
  is_vendor: boolean
  reason?: string
}

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
  const { addChat, updateChat } = useChat()
  const [phase, setPhase] = useState<Phase>('intro')
  const [step, setStep] = useState<Step>(1)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentId>>(new Set())
  const [requirements, setRequirements] = useState('')
  const [actionLoading, setActionLoading] = useState<'upload' | 'search' | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Step 3: AI vendor-search modal ─────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchField, setSearchField] = useState('')
  const [searchInclude, setSearchInclude] = useState('')
  const [searchCount, setSearchCount] = useState(3)
  const [searchLoading, setSearchLoading] = useState(false)

  // ── Step 1: requirements assistant chatbot ─────────────────────────
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantMessages, setAssistantMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: "Hi! I'm here to help you define your requirements. What are you looking to purchase? I can suggest things to consider — budget, number of users, must-have features, integrations, security & compliance, and more." },
  ])
  const assistantEndRef = useRef<HTMLDivElement>(null)

  // Sources gathered in Step 3 (uploaded files + AI-found vendors), each classified
  const [documents, setDocuments] = useState<UploadedDoc[]>([])
  const [detectedCategory, setDetectedCategory] = useState('')   // category inferred from uploads
  const MAX_VENDORS = 4
  const goodCount = documents.filter(d => d.is_vendor).length     // vendor sources count toward the cap

  // ── Intro ──────────────────────────────────────────────────────────
  function handleBubbleClick() {
    if (phase !== 'intro') return
    setPhase('expanding')
    setTimeout(() => {
      setPhase('main')
      setTimeout(() => inputRef.current?.focus(), 600)
    }, 800)
  }

  // ── Instant local summary ─────────────────────────────────────────
  function localSummary(text: string): string {
    const fillers = new Set([
      'a','an','the','is','are','was','were','be','been',
      'have','has','had','do','does','will','would','could',
      'for','with','to','of','in','on','at','by','from',
      'and','or','but','so','that','this','we','i','my',
    ])
    const meaningful = text.split(/\s+/).filter(w => !fillers.has(w.toLowerCase()))
    return meaningful.slice(0, 6).join(' ') || text.split(/\s+/).slice(0, 6).join(' ')
  }

  // ── Break the requirement into key bullet points for the sidebar ──
  function localBullets(text: string): string[] {
    const parts = text
      .split(/[.;\n]+|,(?=\s)/)            // split on sentences, semicolons, commas
      .map(s => s.trim())
      .filter(s => s.split(/\s+/).length >= 2)   // drop fragments of <2 words
    const seen = new Set<string>()
    const bullets: string[] = []
    for (const p of parts) {
      const cap = p.charAt(0).toUpperCase() + p.slice(1)
      const short = cap.length > 64 ? cap.slice(0, 61).trimEnd() + '…' : cap
      const key = short.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        bullets.push(short)
      }
      if (bullets.length >= 4) break
    }
    // Always surface at least one bullet so the section never renders empty
    return bullets.length ? bullets : [text.trim().slice(0, 64)]
  }

  // ── Summarise + save to backend (fire-and-forget) ────────────────
  async function summarizeAndStore(text: string, agentIds: string) {
    // ① Sidebar gets an instant smart-truncation entry + bullet points right now
    const chatId = addChat({
      summary: localSummary(text),
      bullets: localBullets(text),
      requirements: text,
      agents: agentIds,
    })

    // ② Create backend session & save step 1 (logs to FastAPI so we can verify)
    try {
      const sessionRes = await fetch('/api/py/sessions', {
        method: 'POST',
      })
      if (sessionRes.ok) {
        const { session_id } = await sessionRes.json()
        setSessionId(session_id)
        updateChat(chatId, { sessionId: session_id })   // link entry → backend session
        await fetch(`/api/py/sessions/${session_id}/step1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, summary: localSummary(text) }),
        })
      }
    } catch { /* backend unreachable — sidebar entry already visible */ }

    // ③ Upgrade entry with an AI-generated title + concise requirement bullets
    try {
      const res = await fetch('/api/py/requirement-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (res.ok) {
        const data = await res.json()
        const patch: { summary?: string; bullets?: string[] } = {}
        if (data.summary) patch.summary = data.summary
        if (Array.isArray(data.bullets) && data.bullets.length) patch.bullets = data.bullets
        if (Object.keys(patch).length) updateChat(chatId, patch)
      }
    } catch { /* local summary already showing */ }
  }

  // ── Step 1 → 2 ────────────────────────────────────────────────────
  function goToStep2() {
    if (!requirements.trim()) return
    setStep(2)
    summarizeAndStore(requirements, '')
  }

  // ── Step 2 → 3 ────────────────────────────────────────────────────
  function goToStep3() {
    setIsPanelOpen(false)
    setTimeout(() => setStep(3), 200)
    // Save step 2 to backend
    if (sessionId) {
      fetch(`/api/py/sessions/${sessionId}/step2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: Array.from(selectedAgents) }),
      }).catch(() => {})
    }
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

  // ── Step 3: navigate to the live debate, carrying session_id along ──
  function goToDashboard() {
    const agentString = Array.from(selectedAgents).join(',')
    const params = new URLSearchParams({ requirements, agents: agentString })
    if (sessionId) params.set('session_id', sessionId)
    router.push(`/debate?${params.toString()}`)
  }

  // ── Step 3: open the AI vendor-search modal ───────────────────────
  function openSearchModal() {
    // Auto-fill the field with the category detected from uploaded files (else empty)
    setSearchField(detectedCategory)
    const remaining = Math.max(1, MAX_VENDORS - documents.length)
    setSearchCount(Math.min(3, remaining))
    setSearchOpen(true)
  }

  // ── Step 3: run the AI vendor search, accumulate the results ──────
  async function handleVendorSearch() {
    if (!searchField.trim() && documents.length === 0) return   // need a field, or files to base on
    setSearchLoading(true)
    if (sessionId) {
      try {
        const must_include = searchInclude.split(',').map(s => s.trim()).filter(Boolean)
        const res = await fetch(`/api/py/vendor-search/${sessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field: searchField.trim(),
            requirements,
            count: searchCount,
            must_include,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.documents)) setDocuments(data.documents)
        }
      } catch { /* keep whatever is already gathered */ }
    }
    setSearchLoading(false)
    setSearchOpen(false)
  }

  // ── Step 3: file upload → POST the file(s), show every file as a source ─
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setActionLoading('upload')

    if (sessionId) {
      try {
        // Record the chosen method
        await fetch(`/api/py/sessions/${sessionId}/step3`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'upload' }),
        })
        // Upload every selected file in one request — backend extracts & classifies
        const fd = new FormData()
        Array.from(files).forEach(f => fd.append('files', f))
        const res = await fetch(`/api/py/upload/${sessionId}`, {
          method: 'POST',
          body: fd,   // NOTE: no Content-Type header — browser sets the multipart boundary
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.documents)) setDocuments(data.documents)
          if (data.category) setDetectedCategory(data.category)
        }
      } catch { /* keep whatever is already gathered */ }
    }

    setActionLoading(null)
    e.target.value = ''   // allow re-selecting the same file later
  }

  // ── Step 3: remove a source (e.g. a flagged non-vendor file) ──────
  async function removeDoc(name: string) {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/py/sessions/${sessionId}/remove-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name }),
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.documents)) setDocuments(data.documents)
        setDetectedCategory(data.category ?? '')
      }
    } catch { /* leave list as-is on failure */ }
  }

  // ── Keyboard (onKeyDown — onKeyPress removed in React 19) ────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && requirements.trim()) goToStep2()
  }

  // ── Requirements assistant chat ────────────────────────────────────
  useEffect(() => {
    assistantEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [assistantMessages, assistantLoading, assistantOpen])

  async function sendAssistant() {
    const text = assistantInput.trim()
    if (!text || assistantLoading) return
    const next = [...assistantMessages, { role: 'user' as const, content: text }]
    setAssistantMessages(next)
    setAssistantInput('')
    setAssistantLoading(true)
    try {
      const res = await fetch('/api/py/requirements-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setAssistantMessages(m => [...m, { role: 'assistant', content: data.reply }])
    } catch {
      setAssistantMessages(m => [...m, { role: 'assistant', content: "Sorry, I couldn't reach the assistant just now — please try again in a moment." }])
    } finally {
      setAssistantLoading(false)
    }
  }

  function addToRequirements(text: string) {
    setRequirements(prev => (prev.trim() ? `${prev.trim()} ${text}` : text))
    inputRef.current?.focus()
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
            Upload vendor files for any product or service, and/or let our AI agent search the web —
            combine both if you like. Up to {MAX_VENDORS} sources in total.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Hidden native file picker driven by the Upload card */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.csv,.md"
              multiple
              className="hidden"
              onChange={handleFileSelected}
            />

            {/* Upload */}
            <button
              className="action-card glass-panel p-8 rounded-3xl flex flex-col items-center justify-center text-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ border: '1px solid rgba(107,114,128,.5)' }}
              onClick={() => fileInputRef.current?.click()}
              disabled={actionLoading !== null || documents.length >= MAX_VENDORS}
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
                <p className="text-sm" style={{ color: '#9ca3af' }}>Select one or more PDFs, spreadsheets, or text files.</p>
              </div>
            </button>

            {/* AI Search */}
            <button
              className="action-card glass-panel p-8 rounded-3xl flex flex-col items-center justify-center text-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ border: '1px solid rgba(107,114,128,.5)' }}
              onClick={openSearchModal}
              disabled={actionLoading !== null || documents.length >= MAX_VENDORS}
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

          {/* Gathered sources (files + AI vendors) + continue */}
          <div className="max-w-3xl mx-auto mt-8">
            {documents.length > 0 && (
              <div className="rounded-2xl p-4 mb-5 text-left"
                style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium text-white">Sources gathered</span>
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: documents.length >= MAX_VENDORS ? 'rgba(244,63,94,.15)' : 'rgba(56,189,248,.15)',
                      color: documents.length >= MAX_VENDORS ? '#fb7185' : '#38bdf8' }}>
                    {documents.length} / {MAX_VENDORS} files · {goodCount} vendor{goodCount !== 1 ? 's' : ''}
                  </span>
                  {documents.length >= MAX_VENDORS && (
                    <span className="text-xs" style={{ color: '#fb7185' }}>Limit of {MAX_VENDORS} reached</span>
                  )}
                </div>
                <div className="space-y-2">
                  {documents.map((d, i) => {
                    const noise = !d.is_vendor
                    return (
                      <div key={i} className="flex items-start gap-2 rounded-xl px-3 py-2"
                        style={{
                          background: noise ? 'rgba(248,63,94,.08)' : 'rgba(255,255,255,.04)',
                          border: `1px solid ${noise ? 'rgba(248,63,94,.4)' : 'rgba(255,255,255,.1)'}`,
                        }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke={noise ? '#fb7185' : '#818cf8'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          className="mt-0.5 shrink-0">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm truncate" style={{ color: noise ? '#fb7185' : '#e5e7eb' }}>{d.name}</span>
                            {noise && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                style={{ background: 'rgba(248,63,94,.18)', color: '#fb7185' }}>likely not a vendor</span>
                            )}
                          </div>
                          {noise && (
                            <p className="text-[11px] mt-0.5" style={{ color: '#9ca3af' }}>
                              {d.reason || 'Does not look like a vendor document.'} Remove it, or keep it to feed its content to the board.
                            </p>
                          )}
                        </div>
                        <button onClick={() => removeDoc(d.name)} title="Remove"
                          className="shrink-0 p-1 rounded-md" style={{ color: '#9ca3af' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {documents.length < 2 && (
              <p className="text-xs text-center mb-2" style={{ color: '#9ca3af' }}>
                Add at least 2 sources (upload files and/or AI search) to start the debate.
              </p>
            )}
            <button
              onClick={goToDashboard}
              disabled={documents.length < 2}
              className="w-full p-3.5 rounded-2xl text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#4f46e5', boxShadow: documents.length >= 2 ? '0 0 15px rgba(79,70,229,.35)' : 'none' }}
            >
              Continue to debate
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" x2="19" y1="12" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
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
              onKeyDown={handleKeyDown}
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

      {/* ── AI vendor-search modal (Step 3) ─────────────────────────────── */}
      <div
        className="fixed inset-0 z-40"
        style={{
          background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)',
          opacity: searchOpen ? 1 : 0,
          pointerEvents: searchOpen ? 'auto' : 'none',
          transition: 'opacity .3s ease',
        }}
        onClick={() => !searchLoading && setSearchOpen(false)}
      />
      <aside
        className="glass-panel fixed z-50 flex flex-col rounded-3xl p-6"
        style={{
          top: '50%', left: '50%', width: '100%', maxWidth: '460px',
          transform: searchOpen ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.94)',
          opacity: searchOpen ? 1 : 0,
          pointerEvents: searchOpen ? 'auto' : 'none',
          transition: 'transform .35s cubic-bezier(.16,1,.3,1), opacity .3s ease',
        }}
      >
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-medium">Find vendors with AI</h2>
          {!searchLoading && (
            <button onClick={() => setSearchOpen(false)} className="p-2 rounded-full" style={{ color: '#9ca3af' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-sm mb-5" style={{ color: '#9ca3af' }}>
          Tell the agent what kind of vendors to look for. It will find up to 4 real options and
          add their details to the brief sent to your AI board.
        </p>

        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#9ca3af' }}>
          What field / category should we search?
          {documents.length > 0 && <span style={{ color: '#6b7280' }}> (optional)</span>}
        </label>
        <input
          value={searchField}
          onChange={e => setSearchField(e.target.value)}
          placeholder="e.g. project management software, CRM, helpdesk"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none mb-1.5"
          style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.15)', color: '#fff' }}
          autoFocus
        />
        {documents.length > 0 && (
          <p className="text-[11px] mb-4" style={{ color: '#818cf8' }}>
            Leave blank to find vendors comparable to your uploaded files (good files only).
          </p>
        )}
        {documents.length === 0 && <div className="mb-4" />}

        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#9ca3af' }}>
          Specific vendors to include <span style={{ color: '#6b7280' }}>(optional, comma-separated)</span>
        </label>
        <input
          value={searchInclude}
          onChange={e => setSearchInclude(e.target.value)}
          placeholder="e.g. Asana, Jira"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none mb-4"
          style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.15)', color: '#fff' }}
        />

        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#9ca3af' }}>
          How many vendors to add?{' '}
          <span style={{ color: '#6b7280' }}>
            {documents.length > 0
              ? `(${MAX_VENDORS - documents.length} slot${MAX_VENDORS - documents.length !== 1 ? 's' : ''} left — already have ${documents.length})`
              : '(max 4)'}
          </span>
        </label>
        <div className="flex gap-2 mb-6">
          {Array.from({ length: Math.max(1, MAX_VENDORS - documents.length) }, (_, i) => i + 1).map(n => (
            <button key={n} onClick={() => setSearchCount(n)}
              className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{
                background: searchCount === n ? '#4f46e5' : 'rgba(255,255,255,.05)',
                border: `1px solid ${searchCount === n ? '#6366f1' : 'rgba(255,255,255,.12)'}`,
                color: '#fff',
              }}>
              {n}
            </button>
          ))}
        </div>

        <button
          onClick={handleVendorSearch}
          disabled={(!searchField.trim() && documents.length === 0) || searchLoading}
          className="w-full p-3 rounded-xl text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#4f46e5', boxShadow: (searchField.trim() || documents.length > 0) ? '0 0 15px rgba(79,70,229,.4)' : 'none' }}
        >
          {searchLoading ? (<><SpinnerIcon /> Searching for vendors…</>) : (<>Find Vendors &amp; Continue</>)}
        </button>
      </aside>

      {/* ── Requirements assistant chatbot (Step 1) ───────────────────────────── */}
      {phase === 'main' && step === 1 && (
        <>
          {/* Launcher bubble */}
          {!assistantOpen && (
            <button
              onClick={() => setAssistantOpen(true)}
              className="fixed z-40 flex items-center gap-2 rounded-full px-4 py-3 shadow-lg transition-transform hover:scale-105"
              style={{ bottom: 24, right: 24, background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff' }}
              title="Need help defining your requirements?"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-sm font-medium hidden sm:inline">Need help?</span>
            </button>
          )}

          {/* Chat panel */}
          {assistantOpen && (
            <div className="glass-panel fixed z-50 flex flex-col rounded-3xl overflow-hidden"
              style={{ bottom: 24, right: 24, width: 'min(380px, calc(100vw - 32px))', height: 'min(560px, 72vh)' }}>
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-3 shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,.1)', background: 'rgba(124,58,237,.12)' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-white">Requirements Assistant</p>
                  <p className="text-[11px]" style={{ color: '#9ca3af' }}>Helps you define what to buy</p>
                </div>
                <button onClick={() => setAssistantOpen(false)} className="ml-auto p-1.5 rounded-lg" style={{ color: '#9ca3af' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {assistantMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[85%]">
                      <div className="rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap"
                        style={m.role === 'user'
                          ? { background: '#4f46e5', color: '#fff', borderBottomRightRadius: 4 }
                          : { background: 'rgba(255,255,255,.06)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,.1)', borderBottomLeftRadius: 4 }}>
                        {m.content}
                      </div>
                      {m.role === 'assistant' && i > 0 && (
                        <button onClick={() => addToRequirements(m.content)}
                          className="mt-1 ml-1 text-[11px] font-medium inline-flex items-center gap-1"
                          style={{ color: '#a78bfa' }}>
                          + Add to requirements
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {assistantLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl px-4 py-3 flex items-center gap-1.5"
                      style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)' }}>
                      <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                    </div>
                  </div>
                )}
                <div ref={assistantEndRef} />
              </div>

              {/* Input */}
              <div className="p-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,.1)' }}>
                <div className="flex items-end gap-2 rounded-2xl p-1.5"
                  style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)' }}>
                  <input
                    value={assistantInput}
                    onChange={e => setAssistantInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendAssistant() }}
                    placeholder="Ask anything about your requirements…"
                    className="flex-1 bg-transparent border-none outline-none text-sm px-2 py-1.5"
                    style={{ color: '#fff' }}
                  />
                  <button onClick={sendAssistant} disabled={!assistantInput.trim() || assistantLoading}
                    className="p-2 rounded-xl text-white shrink-0 disabled:opacity-50"
                    style={{ background: '#4f46e5' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" x2="19" y1="12" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
