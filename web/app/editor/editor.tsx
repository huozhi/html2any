'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyOutline, createIdGenerator, createStreamParser, duplicateNode, findPath, getNode, getParent,
  inferSchema, moveSibling, parseHTML, removeNode, setAttribute, toDocument, toOutline, updateNode, walk,
} from '../../../src/stream'
import type { HtmlElement, HtmlRoot, IdGenerator, SchemaNode } from '../../../src/stream'
import { Canvas, type Device } from './canvas'
import type { CanvasRenderer } from './canvas-renderer'
import { COMPUTED_PROPS, Inspector, type ComputedStyles } from './inspector'
import { StructurePanel } from './structure-panel'
import { setStyleValue, textToStyle } from './style-utils'

type SourceKind = 'sample' | 'html' | 'url'
type StreamStats = { bytes: number; chunks: number; ms: number }

const EMPTY_ROOT: HtmlRoot = { type: 'root', id: 'root', children: [], open: false }
const SPEEDS = [
  { label: 'LLM pace', cps: 900 },
  { label: 'Fast', cps: 6000 },
  { label: 'Instant', cps: 0 },
]

function isTypingTarget(target: EventTarget | null) {
  // Duck-typed: events forwarded from the canvas iframe come from another realm.
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return Boolean(el.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

function countSchema(nodes: SchemaNode[]) {
  let blocks = 0
  let collections = 0
  const visit = (node: SchemaNode) => {
    blocks++
    if (node.collection) collections++
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return { blocks, collections }
}

export default function Editor() {
  const [root, setRootState] = useState<HtmlRoot>(EMPTY_ROOT)
  const rootRef = useRef(root)
  const [streaming, setStreaming] = useState(false)
  const [stats, setStats] = useState<StreamStats>({ bytes: 0, chunks: 0, ms: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [device, setDevice] = useState<Device>('desktop')
  const [computed, setComputed] = useState<ComputedStyles>({})
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [toast, setToast] = useState<{ text: string; tone?: 'error' } | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceKind, setSourceKind] = useState<SourceKind>('sample')
  const [pasted, setPasted] = useState('')
  const [url, setUrl] = useState('')
  const [speed, setSpeed] = useState(1)
  const [, setHistoryVersion] = useState(0)
  const history = useRef({ past: [] as HtmlRoot[], future: [] as HtmlRoot[], lastKey: '', lastAt: 0 })
  const genRef = useRef<IdGenerator>(() => `x${Date.now()}`)
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

  const startStream = useCallback(async (kind: SourceKind, payload: { html?: string; url?: string }, cps: number) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    rendererRef.current?.finishEditing(true)
    setSourceOpen(false)
    setSelected(null)
    setHovered(null)
    history.current = { past: [], future: [], lastKey: '', lastAt: 0 }
    setHistoryVersion(v => v + 1)
    setRoot(EMPTY_ROOT)
    setStreaming(true)
    setStats({ bytes: 0, chunks: 0, ms: 0 })

    const parser = createStreamParser()
    const started = performance.now()
    let bytes = 0
    let chunks = 0
    let frame = 0
    const flush = () => {
      frame = 0
      if (controller.signal.aborted) return
      setRoot(parser.snapshot())
      setStats({ bytes, chunks, ms: performance.now() - started })
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
        parser.write(value)
        bytes += value.length
        chunks++
        if (!frame) frame = requestAnimationFrame(flush)
      }
    } catch (error) {
      if (!controller.signal.aborted) notify(error instanceof Error ? error.message : 'Stream failed', 'error')
    } finally {
      if (frame) cancelAnimationFrame(frame)
      if (abortRef.current === controller) {
        const final = parser.end()
        genRef.current = createIdGenerator(final)
        setRoot(final)
        setStats({ bytes, chunks, ms: performance.now() - started })
        setStreaming(false)
        abortRef.current = null
      }
    }
  }, [notify, setRoot])

  const stopStream = useCallback(() => {
    const controller = abortRef.current
    if (!controller) return
    // Keep what has arrived so far: the parser closes everything that is still open.
    abortRef.current = controller
    controller.abort()
  }, [])

  useEffect(() => {
    startStream('sample', {}, SPEEDS[1].cps)
    return () => abortRef.current?.abort()
  }, [startStream])

  // Derived data
  const schema = useMemo(() => inferSchema(root), [root])
  const outline = useMemo(() => toOutline(schema), [schema])
  const selectedNode = useMemo(() => {
    if (!selected) return null
    const node = getNode(root, selected)
    return node && node.type === 'element' ? node : null
  }, [root, selected])
  const path = useMemo(() => {
    if (!selected) return []
    const entries = findPath(root, selected) || []
    return entries.map(e => e.node).filter((n): n is HtmlElement => n.type === 'element' && !/^(html)$/i.test(n.name))
  }, [root, selected])
  const pageInfo = useMemo(() => {
    let nodes = 0
    walk(root, () => {
      nodes++
    })
    return { title: schema.title, nodes, bytes: stats.bytes, ...countSchema(schema.children) }
  }, [root, schema, stats.bytes])

  // Selection that disappeared (undo, delete, new stream) is cleared.
  useEffect(() => {
    if (selected && !streaming && !getNode(root, selected)) setSelected(null)
  }, [root, selected, streaming])

  const readComputed = useCallback(() => {
    const id = selected
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
  }, [selected])

  useEffect(() => {
    readComputed()
  }, [readComputed])

  // Editing operations
  const canEditText = useMemo(() => {
    if (!selectedNode) return false
    const lower = selectedNode.name.toLowerCase()
    if (/^(svg|img|input|select|textarea|style|script|body|html|head)$/.test(lower)) return false
    const inlineOnly = (n: HtmlElement): boolean =>
      n.children.every(c => c.type === 'text' || (/^(a|b|i|em|strong|span|small|code|mark|u|s|sub|sup|br|abbr|cite|kbd|time)$/i.test(c.name) && inlineOnly(c)))
    return inlineOnly(selectedNode)
  }, [selectedNode])

  const setStyle = useCallback((prop: string, value: string) => {
    if (!selected) return
    const node = getNode(rootRef.current, selected)
    if (!node || node.type !== 'element') return
    const next = setStyleValue(node.attributes.style || '', prop, value)
    commit(setAttribute(rootRef.current, selected, 'style', next || null), `style:${selected}:${prop}`)
  }, [selected, commit])

  const setStyleText = useCallback((text: string) => {
    if (!selected) return
    const next = textToStyle(text)
    commit(setAttribute(rootRef.current, selected, 'style', next || null))
  }, [selected, commit])

  const setAttr = useCallback((name: string, value: string | null) => {
    if (!selected) return
    commit(setAttribute(rootRef.current, selected, name, value), value === null ? '' : `attr:${selected}:${name}`)
  }, [selected, commit])

  const action = useCallback((kind: 'edit' | 'parent' | 'duplicate' | 'delete' | 'up' | 'down') => {
    if (!selected || streaming) return
    const current = rootRef.current
    switch (kind) {
      case 'edit':
        rendererRef.current?.startEditing(selected)
        break
      case 'parent': {
        const parent = getParent(current, selected)
        if (parent && parent.type === 'element' && !/^(html)$/i.test(parent.name)) setSelected(parent.id)
        else setSelected(null)
        break
      }
      case 'duplicate': {
        const result = duplicateNode(current, selected, genRef.current)
        if (result.id) {
          commit(result.root)
          setSelected(result.id)
        }
        break
      }
      case 'delete': {
        const parent = getParent(current, selected)
        if (/^(body|html|head)$/i.test(selectedNode?.name || '')) return
        commit(removeNode(current, selected))
        setSelected(parent && parent.type === 'element' && !/^(body|html)$/i.test(parent.name) ? parent.id : null)
        break
      }
      case 'up':
      case 'down':
        commit(moveSibling(current, selected, kind === 'up' ? -1 : 1))
        break
    }
  }, [selected, streaming, commit, selectedNode])

  const commitText = useCallback((id: string, html: string) => {
    const children = parseHTML(html, { createId: genRef.current, stripCodeFence: false }).children
    commit(updateNode<HtmlElement>(rootRef.current, id, node => ({ ...node, children })))
  }, [commit])

  const applyStructure = useCallback((text: string) => {
    const result = applyOutline(rootRef.current, text, genRef.current)
    commit(result.root)
    if (result.root !== rootRef.current) notify('Structure applied')
    return result.errors
  }, [commit, notify])

  const exportHtml = useCallback(async (mode: 'dist' | 'download') => {
    const html = toDocument(rootRef.current, { title: schema.title || 'Untitled' })
    if (mode === 'download') {
      const blob = new Blob([html], { type: 'text/html' })
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
        body: JSON.stringify({ html }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Export failed')
      notify(`Saved ${data.file} · ${(data.bytes / 1024).toFixed(1)} KB`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed', 'error')
    }
  }, [schema.title, notify])

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
    } else if (!selected) {
      return
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
  }, [undo, redo, exportHtml, selected, action, canEditText])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  const labelFor = useCallback((id: string) => {
    const node = getNode(rootRef.current, id)
    if (!node || node.type !== 'element') return ''
    const cls = (node.attributes.class || '').trim().split(/\s+/)[0]
    return `${node.name}${cls ? '.' + cls : ''}`
  }, [])

  const canvasCallbacks = useMemo(() => ({
    onSelect: (id: string | null) => setSelected(id),
    onHover: (id: string | null) => setHovered(id),
    onCommitText: commitText,
    onEditingChange: (id: string | null) => setEditingId(id),
    onKeyDown,
    onViewportChange: () => {},
  }), [commitText, onKeyDown])

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

  return (
    <div className="h2e">
      <header className="h2e-bar">
        <div className="h2e-brand">
          <span className="h2e-logo">h2</span>
          <span>html2any</span>
          <span className="h2e-muted">editor</span>
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
            {streaming ? `Streaming · ${kb} KB · ${stats.chunks} chunks` : stats.chunks ? `Parsed ${kb} KB · ${stats.chunks} chunks · ${(stats.ms / 1000).toFixed(1)}s` : 'Idle'}
            {streaming ? <button className="h2e-link" onClick={stopStream}>Stop</button> : null}
          </div>
        </div>

        <div className="h2e-bar-group">
          <div className="h2e-segmented is-icons" role="group" aria-label="Device width">
            {(['desktop', 'tablet', 'mobile'] as Device[]).map(d => (
              <button key={d} className={device === d ? 'is-on' : ''} onClick={() => setDevice(d)} title={d}>
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
          <button className="h2e-btn" disabled={streaming} onClick={() => exportHtml('download')}>Download</button>
          <button className="h2e-btn is-primary" disabled={streaming} onClick={() => exportHtml('dist')} title="Write web/dist/index.html (⌘S)">
            Export to dist
          </button>
        </div>
      </header>

      <div className="h2e-body">
        <StructurePanel
          outline={outline}
          streaming={streaming}
          selected={selected}
          hovered={hovered}
          onSelect={setSelected}
          onHover={setHovered}
          onApply={applyStructure}
        />

        <main className="h2e-center">
          <Canvas
            root={root}
            streaming={streaming}
            selected={selected}
            hovered={hovered}
            baseUrl={baseUrl}
            device={device}
            labelFor={labelFor}
            rendererRef={rendererRef}
            callbacks={canvasCallbacks}
            onRendered={readComputed}
          />
          <div className="h2e-canvas-foot">
            {editingId ? (
              <span><b>Editing text</b> · <kbd>↵</kbd> save · <kbd>⇧</kbd><kbd>↵</kbd> line break · <kbd>esc</kbd> cancel</span>
            ) : selected ? (
              <span>Double-click text to edit · <kbd>⌘</kbd><kbd>D</kbd> duplicate · <kbd>⌫</kbd> delete · <kbd>esc</kbd> parent</span>
            ) : (
              <span>{streaming ? 'Rendering while the HTML streams in…' : 'Click any element to inspect it.'}</span>
            )}
          </div>
        </main>

        <Inspector
          node={selectedNode}
          path={path}
          computed={computed}
          size={size}
          canEditText={canEditText && !streaming}
          page={pageInfo}
          onStyle={setStyle}
          onStyleText={setStyleText}
          onAttribute={setAttr}
          onSelect={setSelected}
          onAction={action}
        />
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
