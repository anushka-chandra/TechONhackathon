'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  language: string
  setLanguage: (l: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')
  const [language, setLanguageState] = useState('en')

  // Hydrate persisted preferences after mount
  useEffect(() => {
    try {
      const t = localStorage.getItem('clarity_theme') as Theme | null
      const l = localStorage.getItem('clarity_lang')
      if (t === 'light' || t === 'dark') setThemeState(t)
      if (l) setLanguageState(l)
    } catch { /* ignore */ }
  }, [])

  // Reflect the theme on <html> so CSS variables flip
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    try { localStorage.setItem('clarity_theme', t) } catch { /* ignore */ }
  }
  const setLanguage = (l: string) => {
    setLanguageState(l)
    try { localStorage.setItem('clarity_lang', l) } catch { /* ignore */ }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, language, setLanguage }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
