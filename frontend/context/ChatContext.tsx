'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export interface ChatEntry {
  id: string
  summary: string
  requirements: string
  agents: string
  timestamp: number
}

interface ChatContextValue {
  chats: ChatEntry[]
  addChat: (entry: Omit<ChatEntry, 'id' | 'timestamp'>) => string   // returns id
  updateChat: (id: string, patch: Partial<ChatEntry>) => void
  removeChat: (id: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

const STORAGE_KEY = 'nexus_chats'

function readStorage(): ChatEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function writeStorage(chats: ChatEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))
  } catch { /* quota errors — ignore */ }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatEntry[]>([])

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    setChats(readStorage())
  }, [])

  const addChat = useCallback((entry: Omit<ChatEntry, 'id' | 'timestamp'>): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const full: ChatEntry = { ...entry, id, timestamp: Date.now() }
    setChats(prev => {
      const next = [...prev, full]
      writeStorage(next)
      return next
    })
    return id
  }, [])

  const updateChat = useCallback((id: string, patch: Partial<ChatEntry>) => {
    setChats(prev => {
      const next = prev.map(c => (c.id === id ? { ...c, ...patch } : c))
      writeStorage(next)
      return next
    })
  }, [])

  const removeChat = useCallback((id: string) => {
    setChats(prev => {
      const next = prev.filter(c => c.id !== id)
      writeStorage(next)
      return next
    })
  }, [])

  return (
    <ChatContext.Provider value={{ chats, addChat, updateChat, removeChat }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>')
  return ctx
}
