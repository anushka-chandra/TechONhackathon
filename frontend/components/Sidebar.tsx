'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  Home,
  Settings,
  Plus,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Trash2,
} from 'lucide-react'
import { useChat, type ChatEntry } from '@/context/ChatContext'

// ── Nav item ──────────────────────────────────────────────────────────────────
function NavItem({
  icon, label, active, expanded, onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  expanded: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={!expanded ? label : undefined}
      className="flex items-center gap-3 w-full rounded-xl px-2.5 py-2 transition-all duration-150"
      style={{
        background: active ? 'rgba(168,85,247,0.12)' : 'transparent',
        color: active ? '#9b6cf5' : '#8a7ca0',
      }}
      onMouseEnter={e => {
        if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.05)'
        ;(e.currentTarget as HTMLElement).style.color = active ? '#9b6cf5' : '#4a3a5e'
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLElement).style.color = active ? '#9b6cf5' : '#8a7ca0'
      }}
    >
      <span className="shrink-0 w-5 h-5 flex items-center justify-center">{icon}</span>
      {expanded && <span className="text-sm font-medium truncate">{label}</span>}
    </button>
  )
}

// ── Chat item ─────────────────────────────────────────────────────────────────
function ChatItem({ entry, onOpen, onDelete }: {
  entry: ChatEntry
  onOpen: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="relative flex items-start gap-2 w-full rounded-xl px-3 py-2 cursor-pointer transition-all"
      style={{ background: hovered ? 'rgba(124,58,237,0.05)' : 'transparent' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
    >
      <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#6f6385' }} />
      <div className="flex-1 min-w-0">
        <span className="text-sm block truncate leading-snug font-medium" style={{ color: '#4a3a5e' }}>
          {entry.summary}
        </span>
        {entry.bullets && entry.bullets.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {entry.bullets.map((b, i) => (
              <li key={i} className="flex gap-1.5 text-xs leading-snug" style={{ color: '#8a7ca0' }}>
                <span className="shrink-0" style={{ color: '#9b6cf5' }}>•</span>
                <span className="flex-1 break-words">{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hovered && (
        <button
          title="Delete"
          className="p-1 rounded-md shrink-0"
          style={{ color: '#6f6385' }}
          onClick={e => { e.stopPropagation(); onDelete() }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#e5484d')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#6f6385')}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const [expanded, setExpanded] = useState(true)
  const { chats, removeChat } = useChat()           // ← directly from React Context
  const router = useRouter()
  const pathname = usePathname()

  const reversedChats = [...chats].reverse()

  function openChat(entry: ChatEntry) {
    const params = new URLSearchParams({
      requirements: entry.requirements,
      agents: entry.agents,
    })
    if (entry.sessionId) params.set('session_id', entry.sessionId)
    router.push(`/debate?${params.toString()}`)
  }

  return (
    <div
      className="flex flex-col shrink-0 border-r"
      style={{
        width: expanded ? '256px' : '64px',
        minWidth: expanded ? '256px' : '64px',
        background: '#f4eefb',
        borderColor: '#f3ecfb',
        height: '100vh',
        position: 'sticky',
        top: 0,
        transition: 'width 0.3s cubic-bezier(0.16,1,0.3,1), min-width 0.3s cubic-bezier(0.16,1,0.3,1)',
        zIndex: 20,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center px-3 py-4 shrink-0"
        style={{ borderBottom: '1px solid #f3ecfb', minHeight: '60px' }}
      >
        {expanded && (
          <span className="text-sm font-semibold tracking-tight mr-auto pl-1 whitespace-nowrap"
            style={{ color: '#2b1d3f' }}>
            Nexus
          </span>
        )}
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ color: '#8a7ca0', marginLeft: expanded ? 0 : 'auto' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
            ;(e.currentTarget as HTMLElement).style.color = '#2b1d3f'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLElement).style.color = '#8a7ca0'
          }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 p-2 shrink-0">
        <NavItem icon={<Home className="w-[18px] h-[18px]" />} label="Home"
          active={pathname === '/'} expanded={expanded} onClick={() => router.push('/')} />
        <NavItem icon={<Plus className="w-[18px] h-[18px]" />} label="New Chat"
          expanded={expanded} onClick={() => router.push('/')} />
        <NavItem icon={<Settings className="w-[18px] h-[18px]" />} label="Settings"
          active={pathname === '/settings'} expanded={expanded} onClick={() => {}} />
      </nav>

      <div style={{ height: '1px', background: '#f3ecfb', margin: '4px 12px' }} />

      {/* Chat history — expanded only */}
      {expanded && (
        <div className="flex-1 overflow-y-auto p-2">
          {reversedChats.length === 0 ? (
            <p className="text-xs px-3 py-4 text-center leading-relaxed"
              style={{ color: '#8a7ca0' }}>
              Submit a requirement in Step&nbsp;1 and it will appear here.
            </p>
          ) : (
            <>
              <p className="text-xs px-3 pb-2 font-semibold uppercase tracking-wider"
                style={{ color: '#8a7ca0' }}>
                Recent
              </p>
              {reversedChats.map(entry => (
                <ChatItem
                  key={entry.id}
                  entry={entry}
                  onOpen={() => openChat(entry)}
                  onDelete={() => removeChat(entry.id)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Collapsed: badge */}
      {!expanded && chats.length > 0 && (
        <div className="flex flex-col items-center pt-1 px-2">
          <div
            className="w-full flex items-center justify-center py-2 rounded-xl cursor-pointer relative"
            style={{ color: '#8a7ca0' }}
            title={`${chats.length} session${chats.length !== 1 ? 's' : ''} — expand to view`}
            onClick={() => setExpanded(true)}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.05)'
              ;(e.currentTarget as HTMLElement).style.color = '#8a7ca0'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#8a7ca0'
            }}
          >
            <div className="relative">
              <MessageSquare className="w-[18px] h-[18px]" />
              <span
                className="absolute -top-1.5 -right-1.5 text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center"
                style={{ background: '#9b6cf5', color: '#f4eefb' }}
              >
                {chats.length > 9 ? '9+' : chats.length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
