'use client'

import { Settings as SettingsIcon, Moon, Sun, Globe } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'nl', label: 'Nederlands' },
]

export default function SettingsPage() {
  const { theme, setTheme, language, setLanguage } = useTheme()

  return (
    <main className="min-h-full" style={{ background: 'var(--app-bg)' }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-1">
          <SettingsIcon className="w-6 h-6" style={{ color: '#818cf8' }} />
          <h1 className="text-2xl font-black tracking-tight" style={{ color: 'var(--text)' }}>Settings</h1>
        </div>
        <p className="text-sm mb-8" style={{ color: 'var(--text-dim)' }}>
          Personalize how Clarity looks and the language it uses.
        </p>

        {/* Appearance */}
        <section className="rounded-2xl border p-5 mb-5" style={{ background: 'var(--panel)', borderColor: 'var(--panel-border)' }}>
          <h2 className="font-bold mb-1" style={{ color: 'var(--text)' }}>Appearance</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-dim)' }}>Switch between dark and light mode.</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { v: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" /> },
              { v: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
            ] as const).map(opt => (
              <button key={opt.v} onClick={() => setTheme(opt.v)}
                className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors"
                style={{
                  background: theme === opt.v ? 'rgba(99,102,241,.15)' : 'var(--app-bg)',
                  border: `1px solid ${theme === opt.v ? '#6366f1' : 'var(--panel-border)'}`,
                  color: theme === opt.v ? '#818cf8' : 'var(--text-dim)',
                }}>
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Language */}
        <section className="rounded-2xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--panel-border)' }}>
          <h2 className="font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <Globe className="w-4 h-4" style={{ color: '#818cf8' }} /> Language
          </h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-dim)' }}>Choose your preferred language.</p>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: 'var(--app-bg)', border: '1px solid var(--panel-border)', color: 'var(--text)' }}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </section>
      </div>
    </main>
  )
}
