'use client'

import { useRouter } from 'next/navigation'
import { FolderKanban, MessageSquare, Trash2, ArrowRight, Plus } from 'lucide-react'
import { useChat, type ChatEntry } from '@/context/ChatContext'

export default function ProjectsPage() {
  const router = useRouter()
  const { chats, removeChat } = useChat()
  const ordered = [...chats].reverse()

  function open(entry: ChatEntry) {
    const params = new URLSearchParams({ requirements: entry.requirements, agents: entry.agents })
    if (entry.sessionId) params.set('session_id', entry.sessionId)
    router.push(`/debate?${params.toString()}`)
  }

  return (
    <main className="min-h-full" style={{ background: 'var(--app-bg)' }}>
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-1">
          <FolderKanban className="w-6 h-6" style={{ color: '#818cf8' }} />
          <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--text)' }}>Projects</h1>
        </div>
        <p className="text-sm mb-8" style={{ color: 'var(--text-dim)' }}>
          Your saved procurement analyses. Open one to revisit the boardroom debate and decision.
        </p>

        {ordered.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-16 text-center"
            style={{ borderColor: 'var(--panel-border)' }}>
            <FolderKanban className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-dim)' }} />
            <p className="font-semibold mb-1" style={{ color: 'var(--text)' }}>No projects yet</p>
            <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>
              Start a new analysis and it will be saved here automatically.
            </p>
            <button onClick={() => (window.location.href = '/?new=1')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
              <Plus className="w-4 h-4" /> New analysis
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {ordered.map(entry => (
              <div key={entry.id}
                className="group rounded-xl border p-4 flex items-start gap-3 cursor-pointer transition-colors"
                style={{ background: 'var(--panel)', borderColor: 'var(--panel-border)' }}
                onClick={() => open(entry)}>
                <MessageSquare className="w-4 h-4 mt-1 shrink-0" style={{ color: '#818cf8' }} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{entry.summary}</p>
                  {entry.bullets && entry.bullets.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {entry.bullets.slice(0, 4).map((b, i) => (
                        <li key={i} className="flex gap-1.5 text-xs" style={{ color: 'var(--text-dim)' }}>
                          <span style={{ color: '#58a6ff' }}>•</span><span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {entry.agents && (
                    <p className="text-[11px] mt-2 uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
                      Board: {entry.agents.split(',').filter(Boolean).join(' · ') || '—'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button title="Open"
                    onClick={e => { e.stopPropagation(); open(entry) }}
                    className="p-2 rounded-lg" style={{ color: 'var(--text-dim)' }}>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button title="Delete"
                    onClick={e => { e.stopPropagation(); removeChat(entry.id) }}
                    className="p-2 rounded-lg" style={{ color: 'var(--text-dim)' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#f85149')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-dim)')}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
