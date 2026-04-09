import { useState } from 'react'
import { signOut, linkWithPopup, unlink, EmailAuthProvider, linkWithCredential } from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'
import { useAppStore } from '../store/useAppStore'
import { showToast } from '../components/ui/Toast'

export default function SetupPage() {
  const uid_user = useAppStore(s => s.uid)

  const user = auth.currentUser
  const providers = user?.providerData.map(p => p.providerId) ?? []
  const hasGoogle = providers.includes('google.com')
  const hasEmail  = providers.includes('password')

  const [linkEmail, setLinkEmail]   = useState('')
  const [linkPassword, setLinkPassword] = useState('')
  const [linkError, setLinkError]   = useState('')
  const [linkLoading, setLinkLoading] = useState(false)
  const [showLinkForm, setShowLinkForm] = useState(false)

  const handleSignOut = async () => {
    if (!confirm('Sign out?')) return
    await signOut(auth)
  }

  const handleLinkGoogle = async () => {
    try {
      await linkWithPopup(auth.currentUser!, googleProvider)
      showToast('Google account linked', 'success')
    } catch (err: any) {
      if (err.code === 'auth/credential-already-in-use') {
        showToast('That Google account is already linked to another user')
      } else if (err.code === 'auth/popup-closed-by-user') {
        // silently ignore
      } else {
        showToast('Could not link Google account')
      }
    }
  }

  const handleUnlinkGoogle = async () => {
    if (!hasEmail) {
      showToast('Add email/password first before unlinking Google')
      return
    }
    if (!confirm('Unlink Google account?')) return
    try {
      await unlink(auth.currentUser!, 'google.com')
      showToast('Google account unlinked')
    } catch {
      showToast('Could not unlink Google account')
    }
  }

  const handleLinkEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!linkEmail || !linkPassword) return
    setLinkLoading(true)
    setLinkError('')
    try {
      const credential = EmailAuthProvider.credential(linkEmail, linkPassword)
      await linkWithCredential(auth.currentUser!, credential)
      showToast('Email/password added to your account', 'success')
      setShowLinkForm(false)
      setLinkEmail('')
      setLinkPassword('')
    } catch (err: any) {
      setLinkError(
        err.code === 'auth/email-already-in-use' ? 'That email is already used by another account.'
        : err.code === 'auth/weak-password' ? 'Password must be at least 6 characters.'
        : err.code === 'auth/invalid-email' ? 'Enter a valid email address.'
        : 'Could not add email/password. Try again.'
      )
    } finally {
      setLinkLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-3">
        <h1 className="text-xl font-bold text-slate-900">Setup</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scroll-touch px-4 py-4 flex flex-col gap-6 max-w-lg">

        {/* ── Account ──────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Account</h2>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">

            {/* Current user info */}
            <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="7" r="3.5" stroke="#7c3aed" strokeWidth="1.5"/>
                  <path d="M2 16c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {user?.displayName || user?.email || 'Signed in'}
                </p>
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
            </div>

            {/* Linked sign-in methods */}
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2.5">Sign-in methods</p>

              {/* Google */}
              <div className="flex items-center gap-3 py-2">
                <svg width="16" height="16" viewBox="0 0 24 24" className="flex-shrink-0">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="flex-1 text-sm text-slate-700">Google</span>
                {hasGoogle ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Linked</span>
                    {providers.length > 1 && (
                      <button onClick={handleUnlinkGoogle}
                        className="text-xs text-slate-400 hover:text-red-500 transition-colors">
                        Unlink
                      </button>
                    )}
                  </div>
                ) : (
                  <button onClick={handleLinkGoogle}
                    className="text-xs font-semibold text-blue-500 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-50 min-h-[32px] transition-colors">
                    Link
                  </button>
                )}
              </div>

              {/* Email/password */}
              <div className="flex items-center gap-3 py-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
                  <rect x="1" y="3" width="14" height="10" rx="2" stroke="#94a3b8" strokeWidth="1.4"/>
                  <path d="M1 5l7 5 7-5" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="flex-1 text-sm text-slate-700">Email / Password</span>
                {hasEmail ? (
                  <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Linked</span>
                ) : (
                  <button onClick={() => setShowLinkForm(f => !f)}
                    className="text-xs font-semibold text-blue-500 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-50 min-h-[32px] transition-colors">
                    {showLinkForm ? 'Cancel' : 'Add'}
                  </button>
                )}
              </div>

              {/* Add email form */}
              {showLinkForm && !hasEmail && (
                <form onSubmit={handleLinkEmail} className="mt-2 flex flex-col gap-2 pb-1">
                  <input type="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                    placeholder="Email address" required autoComplete="email"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
                  <input type="password" value={linkPassword} onChange={e => setLinkPassword(e.target.value)}
                    placeholder="Password (min 6 characters)" required autoComplete="new-password"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
                  {linkError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{linkError}</p>}
                  <button type="submit" disabled={linkLoading}
                    className="w-full py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 min-h-[44px] disabled:opacity-60 transition-colors">
                    {linkLoading ? 'Saving…' : 'Add email & password'}
                  </button>
                </form>
              )}
            </div>

            {/* Sign out */}
            <button onClick={handleSignOut}
              className="w-full text-left px-4 py-3 text-sm text-red-500 font-medium hover:bg-red-50 active:bg-red-100 transition-colors min-h-[48px]">
              Sign out
            </button>
          </div>
        </section>

        {/* ── Data ─────────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Data</h2>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3.5 flex items-center gap-3 min-h-[52px]">
              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="#94a3b8" strokeWidth="1.5"/>
                  <path d="M7 4v3.5l2 2" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-slate-800">Sync</p>
                <p className="text-xs text-slate-400">Data syncs automatically via Firebase</p>
              </div>
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">Live</span>
            </div>
          </div>
        </section>

        {/* ── App info ──────────────────────────────────────────────────────── */}
        <section>
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">NimWizard</p>
                <p className="text-xs text-slate-400 mt-0.5">Your relationship intelligence app</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">User ID</p>
                <p className="text-[10px] font-mono text-slate-300 truncate max-w-[120px]">{uid_user ?? '—'}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="h-4 lg:hidden" />
      </div>
    </div>
  )
}
