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
        background: active ? 'rgba(88,166,255,0.12)' : 'transparent',
        color: active ? '#58a6ff' : '#8b949e',
      }}
      onMouseEnter={e => {
        if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
        ;(e.currentTarget as HTMLElement).style.color = active ? '#58a6ff' : '#c9d1d9'
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLElement).style.color = active ? '#58a6ff' : '#8b949e'
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
      style={{ background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
    >
      <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: '#6b7280' }} />
      <span className="text-sm truncate flex-1 leading-snug" style={{ color: '#c9d1d9' }}>
        {entry.summary}
      </span>
      {hovered && (
        <button
          title="Delete"
          className="p-1 rounded-md shrink-0"
          style={{ color: '#6b7280' }}
          onClick={e => { e.stopPropagation(); onDelete() }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#f85149')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#6b7280')}
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
    router.push(`/dashboard?${params.toString()}`)
  }

  return (
    <div
      className="flex flex-col shrink-0 border-r"
      style={{
        width: expanded ? '256px' : '64px',
        minWidth: expanded ? '256px' : '64px',
        background: '#0d1117',
        borderColor: '#21262d',
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
        style={{ borderBottom: '1px solid #21262d', minHeight: '60px' }}
      >
        {expanded && (
          <span className="text-sm font-semibold tracking-tight mr-auto pl-1 whitespace-nowrap"
            style={{ color: '#e6edf3' }}>
            Nexus
          </span>
        )}
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ color: '#8b949e', marginLeft: expanded ? 0 : 'auto' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
            ;(e.currentTarget as HTMLElement).style.color = '#e6edf3'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
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

      <div style={{ height: '1px', background: '#21262d', margin: '4px 12px' }} />

      {/* Chat history — expanded only */}
      {expanded && (
        <div className="flex-1 overflow-y-auto p-2">
          {reversedChats.length === 0 ? (
            <p className="text-xs px-3 py-4 text-center leading-relaxed"
              style={{ color: '#484f58' }}>
              Submit a requirement in Step&nbsp;1 and it will appear here.
            </p>
          ) : (
            <>
              <p className="text-xs px-3 pb-2 font-semibold uppercase tracking-wider"
                style={{ color: '#484f58' }}>
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
            style={{ color: '#484f58' }}
            title={`${chats.length} session${chats.length !== 1 ? 's' : ''} — expand to view`}
            onClick={() => setExpanded(true)}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
              ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#484f58'
            }}
          >
            <div className="relative">
              <MessageSquare className="w-[18px] h-[18px]" />
              <span
                className="absolute -top-1.5 -right-1.5 text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center"
                style={{ background: '#58a6ff', color: '#0d1117' }}
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
