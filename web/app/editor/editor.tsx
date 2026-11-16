'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  apply, duplicate, find, html, move, outline, parse, path as pathTo, remove, schema, setAttr, setHTML,
} from '../../../src/stream'
import type { HtmlElement, HtmlRoot, SchemaKind, SchemaNode } from '../../../src/stream'
import { kindOf } from '../../../src/stream/schema'
import { Canvas, type Device } from './canvas'
import type { CanvasRenderer } from './canvas-renderer'
import { FloatingBar, type BarAction } from './floating-bar'
import { COMPUTED_PROPS, Inspector, type ComputedStyles } from './inspector'
import { StructurePanel } from './structure-panel'
import { setStyleValue, textToStyle } from './style-utils'

type SourceKind = 'sample' | 'html' | 'url'
type StreamStats = { bytes: number; chunks: number; ms: number }
type SchemaEntry = { node: SchemaNode; parent: SchemaNode | null }

const EMPTY_ROOT: HtmlRoot = { type: 'root', id: 'root', children: [], open: false }
const SPEEDS = [
  { label: 'LLM pace', cps: 900 },
  { label: 'Fast', cps: 6000 },
  { label: 'Instant', cps: 0 },
]
const INLINE = /^(a|b|i|em|strong|span|small|code|mark|u|s|sub|sup|br|abbr|cite|kbd|time)$/i

function isTypingTarget(target: EventTarget | null) {
  // Duck-typed: events forwarded from the canvas iframe come from another realm.
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return Boolean(el.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

function parentOf(root: HtmlRoot, id: string) {
  const nodes = pathTo(root, id)
  const parent = nodes[nodes.length - 2]
  return parent && parent.type === 'element' ? parent : undefined
}

function indexSchema(nodes: SchemaNode[]) {
  const map = new Map<string, SchemaEntry>()
  const visit = (node: SchemaNode, parent: SchemaNode | null) => {
    map.set(node.id, { node, parent })
    node.children.forEach(child => visit(child, node))
  }
  nodes.forEach(node => visit(node, null))
  return map
}

function inlineOnly(node: HtmlElement): boolean {
  return node.children.every(c => c.type !== 'element' || (INLINE.test(c.name) && inlineOnly(c)))
}

export default function Editor() {
  const [root, setRootState] = useState<HtmlRoot>(EMPTY_ROOT)
  const rootRef = useRef(root)
  const [streaming, setStreaming] = useState(false)
  const [stats, setStats] = useState<StreamStats>({ bytes: 0, chunks: 0, ms: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [hovered, setHovered] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [device, setDevice] = useState<Device>('desktop')
  const [structureOpen, setStructureOpen] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)
  const [computed, setComputed] = useState<ComputedStyles>({})
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [toast, setToast] = useState<{ text: string; tone?: 'error' } | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [sourceKind, setSourceKind] = useState<SourceKind>('sample')
  const [pasted, setPasted] = useState('')
  const [url, setUrl] = useState('')
  const [speed, setSpeed] = useState(1)
  const [, setHistoryVersion] = useState(0)
  const history = useRef({ past: [] as HtmlRoot[], future: [] as HtmlRoot[], lastKey: '', lastAt: 0 })
  const abortRef = useRef<AbortController | null>(null)
  const rendererRef = useRef<CanvasRenderer | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const setRoot = useCallback((next: HtmlRoot) => {
    rootRef.current = next
    setRootState(next)
  }, [])

  const notify = useCallback((text: string, tone?: 'error') => {
    setToast({ text, tone })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const commit = useCallback((next: HtmlRoot, key = '') => {
    const current = rootRef.current
    if (next === current) return
    const h = history.current
    const now = Date.now()
    if (!(key && key === h.lastKey && now - h.lastAt < 1200)) {
      h.past.push(current)
      if (h.past.length > 200) h.past.shift()
    }
    h.future = []
    h.lastKey = key
    h.lastAt = now
    setRoot(next)
    setHistoryVersion(v => v + 1)
  }, [setRoot])

  const undo = useCallback(() => {
    const h = history.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push(rootRef.current)
    h.lastKey = ''
    setRoot(prev)
    setHistoryVersion(v => v + 1)
  }, [setRoot])

  const redo = useCallback(() => {
    const h = history.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(rootRef.current)
    h.lastKey = ''
    setRoot(next)
    setHistoryVersion(v => v + 1)
  }, [setRoot])

  // Streaming: keep the text received so far and parse it; parse() continues incrementally.
  const startStream = useCallback(async (kind: SourceKind, payload: { html?: string; url?: string }, cps: number) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    rendererRef.current?.finishEditing(true)
    setSourceOpen(false)
    setSelected(null)
    setHovered(null)
    setPropsOpen(false)
    history.current = { past: [], future: [], lastKey: '', lastAt: 0 }
    setHistoryVersion(v => v + 1)
    setRoot(EMPTY_ROOT)
    setStreaming(true)
    setStats({ bytes: 0, chunks: 0, ms: 0 })

    const started = performance.now()
    let text = ''
    let chunks = 0
    let frame = 0
    const flush = () => {
      frame = 0
      if (controller.signal.aborted) return
      setRoot(parse(text))
      setStats({ bytes: text.length, chunks, ms: performance.now() - started })
    }

    try {
      const res = await fetch('/api/editor/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: kind, ...payload, cps }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Stream failed (${res.status})`)
      }
      setBaseUrl(res.headers.get('x-base-url') || '')
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += value
        chunks++
        if (!frame) frame = requestAnimationFrame(flush)
      }
    } catch (error) {
      if (!controller.signal.aborted) notify(error instanceof Error ? error.message : 'Stream failed', 'error')
    } finally {
      if (frame) cancelAnimationFrame(frame)
      if (abortRef.current === controller) {
        // Stopped or finished: close whatever is still open.
        setRoot(parse(text, { done: true }))
        setStats({ bytes: text.length, chunks, ms: performance.now() - started })
        setStreaming(false)
        abortRef.current = null
      }
    }
  }, [notify, setRoot])

  const stopStream = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  useEffect(() => {
    startStream('sample', {}, SPEEDS[1].cps)
    return () => abortRef.current?.abort()
  }, [startStream])

  // Derived data
  const page = useMemo(() => schema(root), [root])
  const blocks = useMemo(() => indexSchema(page.children), [page])
  const outlineText = useMemo(() => (structureOpen ? outline(root) : ''), [root, structureOpen])
  const selectedNode = useMemo(() => {
    if (!selected) return null
    const node = find(root, selected)
    return node && node.type === 'element' ? node : null
  }, [root, selected])
  const path = useMemo(() => {
    if (!selected) return []
    return pathTo(root, selected).filter((n): n is HtmlElement => n.type === 'element' && !/^(html)$/i.test(n.name))
  }, [root, selected])

  const selectedKind: SchemaKind = useMemo(() => {
    if (!selectedNode) return 'container'
    return blocks.get(selectedNode.id)?.node.kind ?? kindOf(selectedNode)
  }, [selectedNode, blocks])

  /** A card, tier, list item, FAQ entry... — one of several siblings with the same shape. */
  const isItem = useCallback((id: string) => {
    const entry = blocks.get(id)
    const collection = entry?.parent?.collection
    if (!entry || !collection || entry.node.kind === 'section') return false
    const cls = entry.node.classes[0]
    return collection.item === entry.node.tag + (cls ? `.${cls}` : '')
  }, [blocks])

  const collectionItem = useMemo(() => (selectedNode ? isItem(selectedNode.id) : false), [selectedNode, isItem])

  useEffect(() => {
    if (selected && !streaming && !find(root, selected)) setSelected(null)
  }, [root, selected, streaming])

  useEffect(() => {
    if (!selected) setPropsOpen(false)
  }, [selected])

  /**
   * Click picks a block (a schema node), not the deepest element: the nearest repeated item
   * (card, tier, list item) if there is one, otherwise the nearest block. Clicking inside the
   * current selection again drills one level in, preferring the next block.
   */
  const pick = useCallback((chain: string[], clicks: number): string | null => {
    if (!chain.length) return null
    const current = selectedRef.current
    const at = current ? chain.indexOf(current) : -1
    if (at === 0) return current
    if (at > 0 && clicks === 1) {
      for (let i = at - 1; i >= 0; i--) if (blocks.has(chain[i])) return chain[i]
      return chain[at - 1]
    }
    return chain.find(isItem) ?? chain.find(id => blocks.has(id)) ?? chain[0]
  }, [blocks, isItem])

  const readComputed = useCallback(() => {
    const id = selectedRef.current
    const el = id ? rendererRef.current?.getElement(id) : null
    if (!el) {
      setComputed({})
      setSize(null)
      return
    }
    const view = el.ownerDocument.defaultView
    if (!view) return
    const cs = view.getComputedStyle(el)
    const next: ComputedStyles = {}
    for (const prop of COMPUTED_PROPS) next[prop] = cs.getPropertyValue(prop)
    setComputed(next)
    const rect = el.getBoundingClientRect()
    setSize({ width: rect.width, height: rect.height })
  }, [])

  useEffect(() => {
    readComputed()
  }, [selected, readComputed])

  const canEditText = useMemo(() => {
    if (!selectedNode || streaming) return false
    if (/^(svg|img|input|select|textarea|style|script|body|html|head)$/i.test(selectedNode.name)) return false
    return inlineOnly(selectedNode)
  }, [selectedNode, streaming])

  // Edits
  const setStyle = useCallback((prop: string, value: string) => {
    const id = selectedRef.current
    if (!id) return
    const node = find(rootRef.current, id)
    if (!node || node.type !== 'element') return
    const next = setStyleValue(node.attributes.style || '', prop, value)
    commit(setAttr(rootRef.current, id, 'style', next || null), `style:${id}:${prop}`)
  }, [commit])

  const setStyleText = useCallback((text: string) => {
    const id = selectedRef.current
    if (!id) return
    commit(setAttr(rootRef.current, id, 'style', textToStyle(text) || null))
  }, [commit])

  const changeAttr = useCallback((name: string, value: string | null) => {
    const id = selectedRef.current
    if (!id) return
    commit(setAttr(rootRef.current, id, name, value), value === null ? '' : `attr:${id}:${name}`)
  }, [commit])

  const action = useCallback((kind: BarAction) => {
    const id = selectedRef.current
    if (!id || streaming) return
    const current = rootRef.current
    const node = find(current, id)
    const name = node && node.type === 'element' ? node.name : ''
    switch (kind) {
      case 'edit':
        rendererRef.current?.startEditing(id)
        break
      case 'parent': {
        const parent = parentOf(current, id)
        setSelected(parent && !/^(html)$/i.test(parent.name) ? parent.id : null)
        break
      }
      case 'duplicate': {
        const result = duplicate(current, id)
        if (result.id) {
          commit(result.root)
          setSelected(result.id)
        }
        break
      }
      case 'delete': {
        if (/^(body|html|head)$/i.test(name)) return
        const parent = parentOf(current, id)
        commit(remove(current, id))
        setSelected(parent && !/^(body|html)$/i.test(parent.name) ? parent.id : null)
        break
      }
      case 'up':
      case 'down':
        commit(move(current, id, kind === 'up' ? -1 : 1))
        break
    }
  }, [streaming, commit])

  const commitText = useCallback((id: string, source: string) => {
    commit(setHTML(rootRef.current, id, source))
  }, [commit])

  const applyStructure = useCallback((text: string) => {
    const result = apply(rootRef.current, text)
    if (result.root !== rootRef.current) {
      commit(result.root)
      notify('Structure applied')
    }
    return result.errors
  }, [commit, notify])

  const exportHtml = useCallback(async (mode: 'dist' | 'download') => {
    setExportOpen(false)
    const output = html(rootRef.current, { document: true, title: page.title || 'Untitled' })
    if (mode === 'download') {
      const blob = new Blob([output], { type: 'text/html' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = 'index.html'
      a.click()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
      return
    }
    try {
      const res = await fetch('/api/editor/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ html: output }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Export failed')
      notify(`Saved ${data.file} · ${(data.bytes / 1024).toFixed(1)} KB`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed', 'error')
    }
  }, [page.title, notify])

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return
    const mod = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (mod && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    } else if (mod && key === 'y') {
      event.preventDefault()
      redo()
    } else if (mod && key === 's') {
      event.preventDefault()
      exportHtml('dist')
    } else if (mod && event.key === '\\') {
      event.preventDefault()
      setStructureOpen(open => !open)
    } else if (!selectedRef.current) {
      return
    } else if (mod && key === 'i') {
      event.preventDefault()
      setPropsOpen(open => !open)
    } else if (mod && key === 'd') {
      event.preventDefault()
      action('duplicate')
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      action('delete')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      action('parent')
    } else if (event.key === 'Enter' && canEditText) {
      event.preventDefault()
      action('edit')
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      action(event.key === 'ArrowUp' ? 'up' : 'down')
    }
  }, [undo, redo, exportHtml, action, canEditText])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  const canvasCallbacks = useMemo(() => ({
    onSelect: (chain: string[], clicks: number) => setSelected(pick(chain, clicks)),
    onHover: (chain: string[]) => {
      const id = pick(chain, 1)
      setHovered(id === selectedRef.current ? null : id)
    },
    onCommitText: commitText,
    onEditingChange: (id: string | null) => setEditingId(id),
    onKeyDown,
    onViewportChange: () => {},
  }), [pick, commitText, onKeyDown])

  const submitSource = () => {
    const cps = SPEEDS[speed].cps
    if (sourceKind === 'html') {
      if (!pasted.trim()) return notify('Paste some HTML first', 'error')
      startStream('html', { html: pasted }, cps)
    } else if (sourceKind === 'url') {
      if (!url.trim()) return notify('Enter a URL first', 'error')
      startStream('url', { url }, cps)
    } else {
      startStream('sample', {}, cps)
    }
  }

  const canUndo = history.current.past.length > 0
  const canRedo = history.current.future.length > 0
  const kb = (stats.bytes / 1024).toFixed(1)
  const showBar = Boolean(selectedNode && !streaming && !editingId)

  return (
    <div className="h2e">
      <header className="h2e-bar">
        <div className="h2e-bar-group">
          <div className="h2e-brand">
            <span className="h2e-logo">h2</span>
            <span>html2any</span>
          </div>
          <button
            className={`h2e-btn is-ghost${structureOpen ? ' is-on' : ''}`}
            onClick={() => setStructureOpen(open => !open)}
            aria-pressed={structureOpen}
            title="Structure (⌘\)"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M3 3.5h6M5 8h6M5 12.5h8M3 3.5v9" /></svg>
            Structure
          </button>
        </div>

        <div className="h2e-bar-group">
          <div className="h2e-popover-anchor">
            <button className="h2e-btn" onClick={() => setSourceOpen(open => !open)} aria-expanded={sourceOpen}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 8h8M7 4.5 10.5 8 7 11.5M13.5 3v10" /></svg>
              Stream HTML
            </button>
            {sourceOpen ? (
              <div className="h2e-popover" role="dialog" aria-label="Stream source">
                <div className="h2e-tabs">
                  {(['sample', 'html', 'url'] as SourceKind[]).map(kind => (
                    <button key={kind} className={sourceKind === kind ? 'is-on' : ''} onClick={() => setSourceKind(kind)}>
                      {kind === 'sample' ? 'Sample page' : kind === 'html' ? 'Paste HTML' : 'From URL'}
                    </button>
                  ))}
                </div>
                {sourceKind === 'sample' ? (
                  <p className="h2e-muted">A landing page streamed in token-sized chunks, like an LLM response.</p>
                ) : sourceKind === 'html' ? (
                  <textarea className="h2e-paste" value={pasted} onChange={e => setPasted(e.target.value)} placeholder="<section>…</section> or a full document. Markdown ```html fences are fine." spellCheck={false} />
                ) : (
                  <input className="h2e-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" onKeyDown={e => e.key === 'Enter' && submitSource()} />
                )}
                <div className="h2e-popover-foot">
                  <div className="h2e-segmented is-text">
                    {SPEEDS.map((s, i) => (
                      <button key={s.label} className={speed === i ? 'is-on' : ''} onClick={() => setSpeed(i)}>{s.label}</button>
                    ))}
                  </div>
                  <button className="h2e-btn is-primary" onClick={submitSource}>Start stream</button>
                </div>
              </div>
            ) : null}
          </div>
          <div className={`h2e-status${streaming ? ' is-live' : ''}`}>
            <span className="h2e-dot" />
            {streaming ? `Streaming · ${kb} KB` : stats.chunks ? `${kb} KB · ${stats.chunks} chunks · ${(stats.ms / 1000).toFixed(1)}s` : 'Idle'}
            {streaming ? <button className="h2e-link" onClick={stopStream}>Stop</button> : null}
          </div>
        </div>

        <div className="h2e-bar-group">
          <div className="h2e-segmented is-icons" role="group" aria-label="Device width">
            {(['desktop', 'tablet', 'mobile'] as Device[]).map(d => (
              <button key={d} className={device === d ? 'is-on' : ''} onClick={() => setDevice(d)} title={d} aria-label={d}>
                <DeviceIcon kind={d} />
              </button>
            ))}
          </div>
          <button className="h2e-icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo || streaming} onClick={undo}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 3 2.5 6l3 3" /><path d="M2.5 6h7a4 4 0 0 1 0 8H7" /></svg>
          </button>
          <button className="h2e-icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo || streaming} onClick={redo}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 3l3 3-3 3" /><path d="M13.5 6h-7a4 4 0 0 0 0 8H9" /></svg>
          </button>
          <div className="h2e-popover-anchor">
            <div className="h2e-split">
              <button className="h2e-btn is-primary" disabled={streaming} onClick={() => exportHtml('dist')} title="Write web/dist/index.html (⌘S)">Export</button>
              <button className="h2e-btn is-primary is-caret" disabled={streaming} onClick={() => setExportOpen(open => !open)} aria-label="More export options" aria-expanded={exportOpen}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 6l4 4 4-4" /></svg>
              </button>
            </div>
            {exportOpen ? (
              <div className="h2e-popover is-menu is-right" role="menu">
                <button role="menuitem" onClick={() => exportHtml('dist')}>Export to <code>web/dist/index.html</code></button>
                <button role="menuitem" onClick={() => exportHtml('download')}>Download index.html</button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className={`h2e-body${structureOpen ? ' has-structure' : ''}`}>
        {structureOpen ? (
          <StructurePanel
            outline={outlineText}
            streaming={streaming}
            selected={selected}
            hovered={hovered}
            onSelect={setSelected}
            onHover={setHovered}
            onApply={applyStructure}
            onClose={() => setStructureOpen(false)}
          />
        ) : null}

        <main className={`h2e-center${propsOpen && selectedNode ? ' has-props' : ''}`}>
          <Canvas
            root={root}
            streaming={streaming}
            selected={selected}
            hovered={hovered}
            baseUrl={baseUrl}
            device={device}
            rendererRef={rendererRef}
            callbacks={canvasCallbacks}
            onRendered={readComputed}
            toolbar={showBar && selectedNode ? (
              <FloatingBar
                node={selectedNode}
                kind={selectedKind}
                collectionItem={collectionItem}
                canEditText={canEditText}
                computed={computed}
                ancestors={path.slice(0, -1)}
                propsOpen={propsOpen}
                onStyle={setStyle}
                onAttr={changeAttr}
                onAction={action}
                onSelect={setSelected}
                onToggleProps={() => setPropsOpen(open => !open)}
              />
            ) : null}
          />
          {propsOpen && selectedNode ? (
            <Inspector
              node={selectedNode}
              path={path}
              computed={computed}
              size={size}
              onStyle={setStyle}
              onStyleText={setStyleText}
              onAttribute={changeAttr}
              onSelect={setSelected}
              onClose={() => setPropsOpen(false)}
            />
          ) : null}
          <div className="h2e-canvas-foot">
            {editingId ? (
              <span><b>Editing text</b> · <kbd>↵</kbd> save · <kbd>⇧</kbd><kbd>↵</kbd> line break · <kbd>esc</kbd> cancel</span>
            ) : streaming ? (
              <span>Rendering while the HTML streams in…</span>
            ) : selected ? (
              <span>Click again to go deeper · double-click to edit text · <kbd>esc</kbd> parent · <kbd>⌘</kbd><kbd>I</kbd> all properties</span>
            ) : (
              <span>Click any block to edit it · <kbd>⌘</kbd><kbd>\</kbd> structure</span>
            )}
          </div>
        </main>
      </div>

      {toast ? <div className={`h2e-toast${toast.tone === 'error' ? ' is-error' : ''}`} role="status">{toast.text}</div> : null}
    </div>
  )
}

function DeviceIcon({ kind }: { kind: Device }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      {kind === 'desktop' ? <><rect x="1.5" y="2.5" width="13" height="9" rx="1.5" /><path d="M5.5 14h5M8 11.5V14" /></> : null}
      {kind === 'tablet' ? <rect x="3" y="1.5" width="10" height="13" rx="1.5" /> : null}
      {kind === 'mobile' ? <><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7 12.5h2" /></> : null}
    </svg>
  )
}
