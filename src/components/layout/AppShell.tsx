import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAppStore } from '../../store/useAppStore'
import { useRegisterSW } from 'virtual:pwa-register/react'

// ─── Nav structure ─────────────────────────────────────────────────────────────

const GROUPS = [
  {
    id: 'people',
    label: 'People',
    icon: PeopleGroupIcon,
    items: [
      { to: '/contacts', label: 'Contacts', icon: ContactsIcon },
      { to: '/org',      label: 'Org Charts', icon: OrgIcon },
    ],
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: ProjectsGroupIcon,
    items: [
      { to: '/meetings',   label: 'Meetings',   icon: MeetingsIcon },
      { to: '/tasks',      label: 'Tasks',       icon: TasksIcon },
      { to: '/timelines',  label: 'Timelines',   icon: TimelinesIcon },
      { to: '/diagrams',   label: 'Diagrams',    icon: DiagramsIcon },
    ],
  },
  {
    id: 'selling',
    label: 'Selling',
    icon: SellingGroupIcon,
    items: [
      { to: '/deals',      label: 'Deal Engine', icon: DealsIcon },
      { to: '/configs',    label: 'Products',    icon: ConfigsIcon },
      { to: '/pricebooks', label: 'Pricebooks',  icon: PricebookIcon },
      { to: '/contracts',  label: 'Contracts',   icon: ContractsIcon },
    ],
  },
]

// All item paths → which group they belong to
function groupForPath(pathname: string): string | null {
  for (const g of GROUPS) {
    if (g.items.some(item => pathname === item.to || pathname.startsWith(item.to + '/'))) {
      return g.id
    }
  }
  return null
}

// ─── AppShell ──────────────────────────────────────────────────────────────────

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Which sidebar groups are expanded (desktop)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['people', 'projects', 'selling']))
  // Mobile bottom nav: null = top-level groups, string = drilled into a group
  const [mobileGroup, setMobileGroup] = useState<string | null>(null)
  // Version update state
  const [checking, setChecking] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()

  const syncing = useAppStore(s => s.syncing)
  const version = __APP_VERSION__
  const location = useLocation()
  const activeGroup = groupForPath(location.pathname)

  useEffect(() => {
    if (needRefresh) setUpdateReady(true)
  }, [needRefresh])

  async function handleVersionClick() {
    if (updateReady) {
      updateServiceWorker(true)
      return
    }
    setChecking(true)
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
    } catch { /* ignore */ }
    setTimeout(() => setChecking(false), 1200)
  }

  function toggleGroup(id: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Close sidebar on mobile nav click — but keep mobileGroup so the bottom
  // bar stays drilled into the active group
  function handleNavClick() {
    setSidebarOpen(false)
  }

  // Derived: which group panel is showing in the mobile bottom bar.
  // '__back__' is a sentinel meaning "user explicitly went back to top level".
  // Otherwise: if user drilled in manually use that; if they navigated via
  // sidebar/deep-link to a known group, follow it automatically.
  const atTopLevel = mobileGroup === '__back__' || (mobileGroup === null && activeGroup === null)
  const effectiveMobileGroup = atTopLevel ? null : (mobileGroup && mobileGroup !== '__back__' ? mobileGroup : activeGroup)
  const currentMobileGroup = effectiveMobileGroup ? GROUPS.find(g => g.id === effectiveMobileGroup) : null

  return (
    <div className="flex h-dvh bg-slate-100 overflow-hidden">

      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-56 bg-slate-900 flex flex-col
        transition-transform duration-250 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-5 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 28 28" fill="none">
                <rect x="3" y="3" width="9" height="9" rx="2" fill="white"/>
                <rect x="16" y="3" width="9" height="9" rx="2" fill="white" opacity=".7"/>
                <rect x="3" y="16" width="9" height="9" rx="2" fill="white" opacity=".7"/>
                <rect x="16" y="16" width="9" height="9" rx="2" fill="white" opacity=".4"/>
              </svg>
            </div>
            <span className="text-white font-bold text-base tracking-tight">NimWizard</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white/40 hover:text-white p-1 rounded">✕</button>
        </div>

        {/* Grouped nav */}
        <nav className="flex-1 p-2 flex flex-col gap-1 overflow-y-auto">
          {GROUPS.map(group => {
            const isExpanded = expandedGroups.has(group.id)
            const isGroupActive = activeGroup === group.id
            return (
              <div key={group.id}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                    isGroupActive ? 'text-blue-300' : 'text-white/30 hover:text-white/60'
                  }`}>
                  <group.icon />
                  <span className="flex-1 text-left">{group.label}</span>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                    className={`flex-shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`}>
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {/* Group items */}
                {isExpanded && (
                  <div className="flex flex-col gap-0.5 pl-2 mt-0.5 mb-1">
                    {group.items.map(({ to, label, icon: Icon }) => (
                      <NavLink key={to} to={to} onClick={handleNavClick}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[40px] ${
                            isActive ? 'bg-blue-500/20 text-blue-300' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                          }`
                        }>
                        <Icon />
                        {label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Footer — Setup + version */}
        <div className="p-3 border-t border-white/5 flex flex-col gap-0.5">
          <NavLink to="/setup" onClick={handleNavClick}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                isActive ? 'bg-blue-500/20 text-blue-300' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`
            }>
            <SetupIcon />
            Settings
          </NavLink>
          <div className="flex items-center justify-between px-3 pt-1">
            <button
              onClick={handleVersionClick}
              className={`text-xs font-mono px-2 py-1 rounded-md transition-colors ${
                updateReady
                  ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 animate-pulse'
                  : checking
                  ? 'text-white/40'
                  : 'text-white/30 hover:text-white/60 hover:bg-white/5'
              }`}
              title={updateReady ? 'Update available — click to reload' : 'Check for updates'}>
              {updateReady ? '↑ Update' : checking ? 'Checking…' : `v${version}`}
            </button>
            {syncing && <span className="text-[10px] text-white/20">Syncing…</span>}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 bg-slate-900 border-b border-white/5 flex-shrink-0"
          style={{ minHeight: '48px', paddingTop: 'env(safe-area-inset-top)' }}>
          <button onClick={() => setSidebarOpen(true)}
            className="text-white/70 hover:text-white p-2 -ml-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/>
            </svg>
          </button>
          <span className="text-white font-bold text-base">NimWizard</span>
          <button
            onClick={handleVersionClick}
            className={`text-xs font-mono pr-1 px-2 py-1 rounded-md transition-colors ${
              updateReady ? 'text-blue-300 animate-pulse' : checking ? 'text-white/40' : 'text-white/40 hover:text-white/70'
            }`}
            title={updateReady ? 'Update available' : 'Check for updates'}>
            {updateReady ? '↑ Update' : checking ? '…' : `v${version}`}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden flex bg-slate-900 border-t border-white/5 flex-shrink-0"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>

          {currentMobileGroup ? (
            // ── Drilled into a group — show group items + Back ─────────────────
            <>
              {/* Back — explicitly returns to top-level view */}
              <button
                onClick={() => setMobileGroup('__back__')}
                className="flex-1 flex flex-col items-center justify-center py-2 text-[10px] font-medium gap-1 transition-colors min-h-[52px] text-white/40 hover:text-white/70">
                <BackIcon />
                Back
              </button>
              {currentMobileGroup.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={handleNavClick}
                  className={({ isActive }) =>
                    `flex-1 flex flex-col items-center justify-center py-2 text-[10px] font-medium gap-1 transition-colors min-h-[52px] ${
                      isActive ? 'text-blue-400' : 'text-white/40'
                    }`
                  }>
                  <Icon />
                  {label}
                </NavLink>
              ))}
            </>
          ) : (
            // ── Top-level: 3 group buttons + Settings ──────────────────────────
            <>
              {GROUPS.map(group => (
                <button key={group.id}
                  onClick={() => setMobileGroup(group.id)}
                  className={`flex-1 flex flex-col items-center justify-center py-2 text-[10px] font-medium gap-1 transition-colors min-h-[52px] ${
                    activeGroup === group.id ? 'text-blue-400' : 'text-white/40'
                  }`}>
                  <group.icon />
                  {group.label}
                </button>
              ))}
              <NavLink to="/setup" onClick={handleNavClick}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center py-2 text-[10px] font-medium gap-1 transition-colors min-h-[52px] ${
                    isActive ? 'text-blue-400' : 'text-white/40'
                  }`
                }>
                <SetupIcon />
                Settings
              </NavLink>
            </>
          )}
        </nav>
      </div>
    </div>
  )
}

// ─── Group icons ───────────────────────────────────────────────────────────────

function PeopleGroupIcon() {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>
}
function ProjectsGroupIcon() {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 4a1 1 0 000 2h14a1 1 0 100-2H3zm0 4a1 1 0 000 2h8a1 1 0 100-2H3zm0 4a1 1 0 000 2h11a1 1 0 100-2H3zm0 4a1 1 0 000 2h5a1 1 0 100-2H3z" clipRule="evenodd"/></svg>
}
function SellingGroupIcon() {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" clipRule="evenodd"/></svg>
}
function BackIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/></svg>
}

// ─── Item icons ────────────────────────────────────────────────────────────────

function ContactsIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>
}
function OrgIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 6V5a3 3 0 013-3h2a3 3 0 013 3v1h2a2 2 0 012 2v3.57A22.952 22.952 0 0110 13a22.95 22.95 0 01-8-1.43V8a2 2 0 012-2h2zm2-1a1 1 0 011-1h2a1 1 0 011 1v1H8V5zm1 5a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clipRule="evenodd"/><path d="M2 13.692V16a2 2 0 002 2h12a2 2 0 002-2v-2.308A24.974 24.974 0 0110 15c-2.796 0-5.487-.46-8-1.308z"/></svg>
}
function MeetingsIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
}
function TasksIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M2 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V4zM8 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1H9a1 1 0 01-1-1V4zM15 3a1 1 0 00-1 1v12a1 1 0 001 1h2a1 1 0 001-1V4a1 1 0 00-1-1h-2z"/></svg>
}
function TimelinesIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 4a1 1 0 000 2h14a1 1 0 100-2H3zm0 4a1 1 0 000 2h8a1 1 0 100-2H3zm0 4a1 1 0 000 2h11a1 1 0 100-2H3zm0 4a1 1 0 000 2h5a1 1 0 100-2H3z" clipRule="evenodd"/></svg>
}
function DiagramsIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M2 4a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V4zm2 0v12h12V4H4zm3 5a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm0 4a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z"/></svg>
}
function DealsIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" clipRule="evenodd"/></svg>
}
function SetupIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/></svg>
}
function ConfigsIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
}
function PricebookIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/></svg>
}
function ContractsIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 10a1 1 0 100 2h4a1 1 0 100-2H8zm0-4a1 1 0 100 2h4a1 1 0 100-2H8zm2-4a1 1 0 00-1 1v.586l2 2V5a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
}
