'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, FolderKanban, Settings, User } from 'lucide-react'
import { useProfile, type Profile } from '@/context/ProfileContext'

function NavLink({ label, icon, active, onClick }: {
  label: string; icon: React.ReactNode; active?: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
      style={{ color: active ? '#7c3aed' : 'var(--text-dim)', background: active ? 'rgba(124,58,237,.10)' : 'transparent' }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = active ? '#7c3aed' : 'var(--text)')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = active ? '#7c3aed' : 'var(--text-dim)')}
    >
      <span className="w-4 h-4 flex items-center justify-center">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export default function NavBar() {
  const router = useRouter()
  const pathname = usePathname()
  const { profile, saveProfile, clearProfile } = useProfile()

  const [profileOpen, setProfileOpen] = useState(false)
  const [form, setForm] = useState<Profile>({ name: '', company: '', sector: '', email: '' })

  function openProfile() {
    setForm(profile ?? { name: '', company: '', sector: '', email: '' })
    setProfileOpen(true)
  }
  function handleSaveProfile() {
    saveProfile(form)
    setProfileOpen(false)
  }

  // New chat → fresh start, land directly on Step 1 of the wizard
  function newChat() {
    window.location.href = '/?new=1'
  }

  const initials = profile?.company?.trim()?.[0]?.toUpperCase()
    ?? profile?.name?.trim()?.[0]?.toUpperCase() ?? ''

  return (
    <>
      <header
        className="w-full flex items-center gap-3 px-5 h-14 shrink-0 sticky top-0 z-30"
        style={{
          background: 'rgba(255,255,255,.72)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(124,58,237,.10)',
        }}
      >
        {/* Brand */}
        <button onClick={() => router.push('/')} className="flex items-center gap-2 mr-3">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3 21 12 12 21 3 12z" />
              <circle cx="12" cy="12" r="2.4" fill="#fff" stroke="none" />
            </svg>
          </span>
          <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>Clarity</span>
        </button>

        {/* Primary nav */}
        <nav className="flex items-center gap-1">
          <NavLink label="New Chat" icon={<Plus className="w-4 h-4" />} onClick={newChat} />
          <NavLink label="Projects" icon={<FolderKanban className="w-4 h-4" />}
            active={pathname === '/projects'} onClick={() => router.push('/projects')} />
          <NavLink label="Settings" icon={<Settings className="w-4 h-4" />}
            active={pathname === '/settings'} onClick={() => router.push('/settings')} />
        </nav>

        {/* Profile (far right) */}
        <button onClick={openProfile} title={profile ? 'Your profile' : 'Sign in'}
          className="ml-auto w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: profile ? 'linear-gradient(135deg,#7c3aed,#7c3aed)' : 'var(--panel)',
            border: '1px solid var(--panel-border)', color: profile ? '#fff' : 'var(--text-dim)',
          }}>
          {initials || <User className="w-4 h-4" />}
        </button>
      </header>

      {/* Profile / sign-in modal */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(46,31,71,.42)', backdropFilter: 'blur(6px)' }}
          onClick={() => setProfileOpen(false)}>
          <div className="w-full max-w-md rounded-3xl p-7"
            style={{ background: 'linear-gradient(180deg, #ffffff 0%, #fdfbff 100%)', border: '1px solid rgba(124,58,237,.14)', boxShadow: '0 24px 60px rgba(46,31,71,.22)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1.5">
              <User className="w-5 h-5" style={{ color: '#8b5cf6' }} />
              <h2 className="text-lg font-bold" style={{ color: '#160f24' }}>
                {profile ? 'Company profile' : 'Sign in'}
              </h2>
            </div>
            <p className="text-sm mb-6 leading-relaxed" style={{ color: '#574f63' }}>
              Save your company details so the board can tailor its evaluation to your organization.
            </p>

            {([
              { k: 'name', label: 'Your name', ph: 'Jane Doe' },
              { k: 'company', label: 'Company name', ph: 'Acme Inc.' },
              { k: 'sector', label: 'Company sector', ph: 'e.g. SaaS, manufacturing, healthcare' },
              { k: 'email', label: 'Email address', ph: 'jane@acme.com' },
            ] as const).map(f => (
              <div key={f.k} className="mb-4">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: '#574f63' }}>{f.label}</label>
                <input
                  value={form[f.k]}
                  onChange={e => setForm(prev => ({ ...prev, [f.k]: e.target.value }))}
                  placeholder={f.ph}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: '#faf8fe', border: '1px solid rgba(124,58,237,.22)', color: '#2b1d3f' }}
                />
              </div>
            ))}

            <div className="flex gap-2 mt-6">
              <button onClick={handleSaveProfile}
                className="flex-1 p-3 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.01] hover:brightness-110"
                style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', boxShadow: '0 8px 22px rgba(124,58,237,.28)' }}>
                {profile ? 'Save changes' : 'Sign in & save'}
              </button>
              {profile && (
                <button onClick={() => { clearProfile(); setProfileOpen(false) }}
                  className="px-4 p-3 rounded-xl text-sm font-semibold transition-colors hover:brightness-95"
                  style={{ background: '#f3ecfb', color: '#574f63' }}>
                  Sign out
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
