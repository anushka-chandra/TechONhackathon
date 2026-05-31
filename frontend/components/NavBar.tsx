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
      style={{ color: active ? 'var(--text)' : 'var(--text-dim)', background: active ? 'var(--panel)' : 'transparent' }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text)')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = active ? 'var(--text)' : 'var(--text-dim)')}
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
        className="w-full flex items-center gap-2 px-4 h-14 shrink-0 sticky top-0 z-30"
        style={{ background: 'var(--nav-bg)', borderBottom: '1px solid var(--nav-border)' }}
      >
        {/* Brand */}
        <button onClick={() => router.push('/')} className="flex items-center gap-2 mr-3">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-black"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>C</span>
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
            background: profile ? 'linear-gradient(135deg,#4f46e5,#7c3aed)' : 'var(--panel)',
            border: '1px solid var(--panel-border)', color: profile ? '#fff' : 'var(--text-dim)',
          }}>
          {initials || <User className="w-4 h-4" />}
        </button>
      </header>

      {/* Profile / sign-in modal */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }}
          onClick={() => setProfileOpen(false)}>
          <div className="w-full max-w-md rounded-2xl p-6"
            style={{ background: 'var(--panel)', border: '1px solid var(--panel-border)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <User className="w-5 h-5" style={{ color: '#818cf8' }} />
              <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>
                {profile ? 'Company profile' : 'Sign in'}
              </h2>
            </div>
            <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>
              Save your company details so the board can tailor its evaluation to your organization.
            </p>

            {([
              { k: 'name', label: 'Your name', ph: 'Jane Doe' },
              { k: 'company', label: 'Company name', ph: 'Acme Inc.' },
              { k: 'sector', label: 'Company sector', ph: 'e.g. SaaS, manufacturing, healthcare' },
              { k: 'email', label: 'Email address', ph: 'jane@acme.com' },
            ] as const).map(f => (
              <div key={f.k} className="mb-3">
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-dim)' }}>{f.label}</label>
                <input
                  value={form[f.k]}
                  onChange={e => setForm(prev => ({ ...prev, [f.k]: e.target.value }))}
                  placeholder={f.ph}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--app-bg)', border: '1px solid var(--panel-border)', color: 'var(--text)' }}
                />
              </div>
            ))}

            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveProfile}
                className="flex-1 p-2.5 rounded-xl text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                {profile ? 'Save changes' : 'Sign in & save'}
              </button>
              {profile && (
                <button onClick={() => { clearProfile(); setProfileOpen(false) }}
                  className="px-4 p-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--app-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-dim)' }}>
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
