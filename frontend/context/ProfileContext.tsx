'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface Profile {
  name: string
  company: string
  sector: string
  email: string
}

interface ProfileContextValue {
  profile: Profile | null
  saveProfile: (p: Profile) => void
  clearProfile: () => void
}

const ProfileContext = createContext<ProfileContextValue | null>(null)
const KEY = 'clarity_profile'

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setProfile(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  const saveProfile = (p: Profile) => {
    setProfile(p)
    try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* ignore */ }
  }
  const clearProfile = () => {
    setProfile(null)
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  }

  return (
    <ProfileContext.Provider value={{ profile, saveProfile, clearProfile }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>')
  return ctx
}
