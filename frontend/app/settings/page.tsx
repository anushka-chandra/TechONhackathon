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
    <main className="min-h-full" style={{ background: 'linear-gradient(180deg, #ffffff 0%, #faf7fe 100%)' }}>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-1.5">
          <SettingsIcon className="w-6 h-6" style={{ color: '#8b5cf6' }} />
          <h1 className="text-2xl font-black tracking-tight" style={{ color: '#160f24' }}>Settings</h1>
        </div>
        <p className="text-sm mb-10" style={{ color: '#574f63' }}>
          Personalize how Clarity looks and the language it uses.
        </p>

        {/* Appearance */}
        <section className="rounded-2xl border p-6 mb-7"
          style={{ background: '#ffffff', borderColor: '#e6d8f6', boxShadow: '0 2px 14px rgba(46,31,71,.06)' }}>
          <h2 className="font-bold mb-1" style={{ color: '#160f24' }}>Appearance</h2>
          <p className="text-sm mb-5" style={{ color: '#574f63' }}>Switch between dark and light mode.</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { v: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" /> },
              { v: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
            ] as const).map(opt => (
              <button key={opt.v} onClick={() => setTheme(opt.v)}
                className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold transition-all hover:brightness-[.98]"
                style={{
                  background: theme === opt.v ? 'rgba(124,58,237,.10)' : '#faf8fe',
                  border: `1px solid ${theme === opt.v ? '#8b5cf6' : 'rgba(124,58,237,.16)'}`,
                  color: theme === opt.v ? '#7c3aed' : '#574f63',
                }}>
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Language */}
        <section className="rounded-2xl border p-6"
          style={{ background: '#ffffff', borderColor: '#e6d8f6', boxShadow: '0 2px 14px rgba(46,31,71,.06)' }}>
          <h2 className="font-bold mb-1 flex items-center gap-2" style={{ color: '#160f24' }}>
            <Globe className="w-4 h-4" style={{ color: '#8b5cf6' }} /> Language
          </h2>
          <p className="text-sm mb-5" style={{ color: '#574f63' }}>Choose your preferred language.</p>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none cursor-pointer transition-colors"
            style={{ background: '#faf8fe', border: '1px solid rgba(124,58,237,.22)', color: '#2b1d3f' }}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </section>
      </div>
    </main>
  )
}
