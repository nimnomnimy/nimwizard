import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { uid } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import type { Diagram } from '../types'

const EMBED_URL = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&libraries=1&lang=en'

type View = 'list' | 'editor'

export default function DiagramsPage() {
  const diagrams = useAppStore(s => s.diagrams)
  const addDiagram = useAppStore(s => s.addDiagram)
  const updateDiagram = useAppStore(s => s.updateDiagram)
  const deleteDiagram = useAppStore(s => s.deleteDiagram)

  const [view, setView] = useState<View>('list')
  const [activeDiagram, setActiveDiagram] = useState<Diagram | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingXmlRef = useRef<string | null>(null)
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [embedError, setEmbedError] = useState(false)

  // ── postMessage handling ──────────────────────────────────────────────────
  const handleMessage = useCallback((e: MessageEvent) => {
    if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
    let msg: { event: string; xml?: string; exit?: boolean }
    try { msg = JSON.parse(e.data) } catch { return }

    if (msg.event === 'init') {
      // draw.io loaded — clear the error timeout
      if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null }
      setEmbedError(false)
      // Send the current diagram XML to the editor
      const xml = pendingXmlRef.current ?? ''
      pendingXmlRef.current = null
      iframeRef.current.contentWindow?.postMessage(
        JSON.stringify({ action: 'load', autosave: 1, xml }),
        '*'
      )
    }

    if (msg.event === 'save' && msg.xml && activeDiagram) {
      const updated: Diagram = { ...activeDiagram, xml: msg.xml, updatedAt: Date.now() }
      setActiveDiagram(updated)
      updateDiagram(updated)
      // Tell draw.io to clear the modified indicator
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ action: 'status', modified: false }),
        '*'
      )
    }

    if (msg.event === 'exit') {
      if (loadTimerRef.current) { clearTimeout(loadTimerRef.current); loadTimerRef.current = null }
      setView('list')
      setActiveDiagram(null)
    }
  }, [activeDiagram, updateDiagram])

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  // ── Open a diagram ────────────────────────────────────────────────────────
  const openDiagram = (d: Diagram) => {
    pendingXmlRef.current = d.xml
    setActiveDiagram(d)
    setEmbedError(false)
    setView('editor')
    // If draw.io doesn't fire 'init' within 10s, show the error state
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
    loadTimerRef.current = setTimeout(() => setEmbedError(true), 10000)
  }

  // ── Create ────────────────────────────────────────────────────────────────
  const handleCreate = () => {
    if (!newName.trim()) return
    const d: Diagram = {
      id: uid(),
      name: newName.trim(),
      xml: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    addDiagram(d)
    showToast(`"${d.name}" created`, 'success')
    setShowNewModal(false)
    setNewName('')
    openDiagram(d)
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = (e: React.MouseEvent, d: Diagram) => {
    e.stopPropagation()
    if (!confirm(`Delete "${d.name}"?`)) return
    deleteDiagram(d.id)
    showToast(`"${d.name}" deleted`)
  }

  // ── Rename ────────────────────────────────────────────────────────────────
  const startRename = (e: React.MouseEvent, d: Diagram) => {
    e.stopPropagation()
    setRenaming(d.id)
    setRenameValue(d.name)
  }

  const commitRename = (d: Diagram) => {
    if (renameValue.trim() && renameValue.trim() !== d.name) {
      updateDiagram({ ...d, name: renameValue.trim(), updatedAt: Date.now() })
    }
    setRenaming(null)
    setRenameValue('')
  }

  // ── Editor view ───────────────────────────────────────────────────────────
  if (view === 'editor') {
    return (
      <div className="h-full flex flex-col bg-slate-900">
        {/* Thin top bar showing diagram name + back */}
        <div className="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-white/10 flex-shrink-0 min-h-[48px]">
          <button
            onClick={() => { setView('list'); setActiveDiagram(null) }}
            className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm transition-colors min-h-[36px] px-2 rounded-lg hover:bg-white/10">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Diagrams
          </button>
          <span className="text-white/30">/</span>
          <span className="text-white font-medium text-sm truncate">{activeDiagram?.name}</span>
        </div>
        <div className="flex-1 relative">
          <iframe
            ref={iframeRef}
            src={EMBED_URL}
            className="absolute inset-0 w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title="draw.io diagram editor"
          />
          {embedError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 gap-4">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-slate-500">
                <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2"/>
                <path d="M24 16v10M24 32v1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <div className="text-center">
                <p className="text-white font-semibold text-base">Diagram editor unavailable</p>
                <p className="text-slate-400 text-sm mt-1">Could not reach embed.diagrams.net — check your connection and try again.</p>
              </div>
              <button
                onClick={() => {
                  setEmbedError(false)
                  if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
                  loadTimerRef.current = setTimeout(() => setEmbedError(true), 10000)
                  // Force iframe reload by briefly clearing src
                  if (iframeRef.current) {
                    iframeRef.current.src = ''
                    setTimeout(() => { if (iframeRef.current) iframeRef.current.src = EMBED_URL }, 100)
                  }
                }}
                className="px-5 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors min-h-[44px]">
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────
  const sorted = [...diagrams].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">
            Diagrams
            <span className="ml-2 text-sm font-normal text-slate-400">{diagrams.length}</span>
          </h1>
          <button
            onClick={() => { setShowNewModal(true); setNewName('') }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[44px] transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            New Diagram
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto scroll-touch px-4 py-4">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" strokeWidth="2"/>
              <path d="M16 24h16M24 16v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <div className="text-center">
              <p className="font-semibold text-slate-600">No diagrams yet</p>
              <p className="text-sm mt-1">Create a diagram to get started</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {sorted.map(d => (
              <div
                key={d.id}
                onClick={() => openDiagram(d)}
                className="bg-white border border-slate-200 rounded-xl p-4 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all group">

                {/* Preview area */}
                <div className="w-full h-28 bg-slate-50 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                  {d.xml ? (
                    <DiagramPreview xml={d.xml} />
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-slate-300">
                      <rect x="4" y="4" width="24" height="24" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M10 16h12M16 10v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  )}
                </div>

                {/* Name row */}
                {renaming === d.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(d)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename(d)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onClick={e => e.stopPropagation()}
                    className="w-full text-sm font-medium text-slate-800 border border-blue-400 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ) : (
                  <p className="text-sm font-medium text-slate-800 truncate">{d.name}</p>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  {new Date(d.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>

                {/* Actions (appear on hover) */}
                <div className="flex gap-1.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={e => startRename(e, d)}
                    className="flex-1 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors min-h-[32px]">
                    Rename
                  </button>
                  <button
                    onClick={e => handleDelete(e, d)}
                    className="flex-1 px-2 py-1.5 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors min-h-[32px]">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="h-4 lg:hidden" />
      </div>

      {/* New Diagram modal */}
      {showNewModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowNewModal(false)} />
          <div className="fixed z-50 inset-x-4 top-[30%] sm:inset-auto sm:left-1/2 sm:-translate-x-1/2 sm:top-[30%] sm:w-80 bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
            <h2 className="text-base font-bold text-slate-900">New Diagram</h2>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNewModal(false) }}
              placeholder="Diagram name…"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px]"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowNewModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors min-h-[44px]">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={!newName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-40 transition-colors min-h-[44px]">
                Create
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tiny SVG thumbnail from draw.io XML ──────────────────────────────────────
// draw.io XML contains an <mxGraphModel> with child elements.
// We render a simple placeholder showing there is content.
function DiagramPreview({ xml }: { xml: string }) {
  // Count how many shapes are in the XML as a rough indicator
  const shapeCount = (xml.match(/<mxCell[^>]*vertex="1"/g) ?? []).length

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="text-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-blue-400 mx-auto mb-1">
          <rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M7 12h10M12 7v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        {shapeCount > 0 && (
          <p className="text-xs text-slate-400">{shapeCount} shape{shapeCount !== 1 ? 's' : ''}</p>
        )}
      </div>
    </div>
  )
}
