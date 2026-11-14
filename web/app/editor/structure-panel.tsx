'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

const LINE_HEIGHT = 20
const PADDING_TOP = 10
const ID_IN_LINE = /^\s*[a-zA-Z][\w:-]*(?:\.[\w-]+)*\s+#([\w-]+)/

type StructurePanelProps = {
  outline: string
  streaming: boolean
  selected: string | null
  hovered: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onApply: (text: string) => string[]
  onClose: () => void
}

function lineIds(text: string) {
  return text.split('\n').map(line => ID_IN_LINE.exec(line)?.[1] ?? null)
}

export function StructurePanel({ outline, streaming, selected, hovered, onSelect, onHover, onApply, onClose }: StructurePanelProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  const text = draft ?? outline
  const ids = useMemo(() => lineIds(text), [text])
  const lines = useMemo(() => text.split('\n'), [text])
  const dirty = draft !== null && draft !== outline

  useEffect(() => {
    if (streaming) {
      setDraft(null)
      setErrors([])
    }
  }, [streaming])

  // Keep the selected line in view when the selection comes from the canvas.
  useEffect(() => {
    const area = areaRef.current
    if (!area || !selected || focused.current) return
    const index = ids.indexOf(selected)
    if (index === -1) return
    const top = PADDING_TOP + index * LINE_HEIGHT
    if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - LINE_HEIGHT * 2) {
      area.scrollTop = Math.max(0, top - area.clientHeight / 2)
      syncScroll()
    }
  }, [selected, ids])

  // Follow the stream while new lines arrive.
  useEffect(() => {
    const area = areaRef.current
    if (!area || !streaming) return
    area.scrollTop = area.scrollHeight
    syncScroll()
  }, [streaming, outline])

  function syncScroll() {
    const area = areaRef.current
    const backdrop = backdropRef.current
    if (area && backdrop) backdrop.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`
  }

  function lineAt(clientY: number) {
    const area = areaRef.current
    if (!area) return -1
    const y = clientY - area.getBoundingClientRect().top + area.scrollTop - PADDING_TOP
    return Math.floor(y / LINE_HEIGHT)
  }

  function selectCaretLine() {
    const area = areaRef.current
    if (!area) return
    const index = area.value.slice(0, area.selectionStart).split('\n').length - 1
    const id = ids[index]
    if (id && id !== selected) onSelect(id)
  }

  function apply() {
    if (!dirty) return
    const result = onApply(draft as string)
    setErrors(result)
    setDraft(null)
  }

  function revert() {
    setDraft(null)
    setErrors([])
  }

  function indentSelection(area: HTMLTextAreaElement, outdent: boolean) {
    const value = area.value
    const start = value.lastIndexOf('\n', area.selectionStart - 1) + 1
    const endIndex = value.indexOf('\n', Math.max(area.selectionEnd - 1, area.selectionStart))
    const end = endIndex === -1 ? value.length : endIndex
    const block = value.slice(start, end)
    const changed = block
      .split('\n')
      .map(line => (outdent ? line.replace(/^ {1,2}/, '') : '  ' + line))
      .join('\n')
    const next = value.slice(0, start) + changed + value.slice(end)
    const caret = area.selectionStart
    const collapsed = caret === area.selectionEnd
    const delta = changed.length - block.length
    setDraft(next)
    requestAnimationFrame(() => {
      if (collapsed) {
        const position = Math.max(start, caret + delta)
        area.setSelectionRange(position, position)
      } else {
        area.setSelectionRange(start, end + delta)
      }
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key === 'Enter') {
      event.preventDefault()
      apply()
    } else if (event.key === 'Escape' && dirty) {
      event.preventDefault()
      revert()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      indentSelection(event.currentTarget, event.shiftKey)
    }
  }

  function onMouseMove(event: MouseEvent<HTMLTextAreaElement>) {
    const id = ids[lineAt(event.clientY)] ?? null
    if (id !== hovered) onHover(id)
  }

  return (
    <aside className="h2e-panel h2e-left">
      <div className="h2e-panel-head">
        <div className="h2e-file">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M9.5 1.5V5H13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
          structure.outline
          {streaming ? <span className="h2e-pill is-live">live</span> : dirty ? <span className="h2e-pill is-dirty">edited</span> : null}
        </div>
        <div className="h2e-head-actions">
          <button className="h2e-btn is-small" disabled={!dirty} onClick={revert}>Revert</button>
          <button className="h2e-btn is-small is-primary" disabled={!dirty} onClick={apply} title="Apply (⌘↵)">Apply</button>
          <button className="h2e-icon is-tiny" title="Close structure (⌘\)" aria-label="Close structure" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      </div>
      <div className="h2e-code">
        <div className="h2e-code-backdrop" ref={backdropRef} aria-hidden="true">
          {lines.map((line, index) => {
            const id = ids[index]
            const isComment = line.trimStart().startsWith('//')
            const cls = [
              'h2e-code-line',
              id && id === selected ? 'is-selected' : '',
              id && id === hovered && id !== selected ? 'is-hovered' : '',
              isComment ? 'is-comment' : '',
            ].join(' ')
            return (
              <div className={cls} key={index}>
                {isComment ? line : <OutlineLine line={line} />}
                {'​'}
              </div>
            )
          })}
        </div>
        <textarea
          ref={areaRef}
          className="h2e-code-input"
          value={text}
          readOnly={streaming}
          spellCheck={false}
          wrap="off"
          autoCapitalize="off"
          autoComplete="off"
          onChange={e => setDraft(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          onSelect={selectCaretLine}
          onFocus={() => (focused.current = true)}
          onBlur={() => (focused.current = false)}
          onMouseMove={onMouseMove}
          onMouseLeave={() => onHover(null)}
        />
      </div>
      {errors.length ? (
        <div className="h2e-errors">
          {errors.slice(0, 4).map((error, i) => <div key={i}>{error}</div>)}
          {errors.length > 4 ? <div>…and {errors.length - 4} more</div> : null}
        </div>
      ) : (
        <div className="h2e-hint">Edit structure, <code>{'{ style }'}</code>, attributes or <code>"text"</code>, then <kbd>⌘</kbd><kbd>↵</kbd>.</div>
      )}
    </aside>
  )
}

const HEAD = /^(\s*)([a-zA-Z][\w:-]*)((?:\.[\w-]+)*)(\s+#[\w-]+)?(.*)$/
const REST = /(\{[^}]*\}?)|(\[[^\]]*\]?)|([^\s="{[]+)(=)("(?:[^"\\]|\\.)*"?|[^\s{[]*)|("(?:[^"\\]|\\.)*"?)|(\s+)|(.)/g

function OutlineLine({ line }: { line: string }) {
  const match = HEAD.exec(line)
  if (!match) return <>{line}</>
  const [, indent, tag, classes, id, rest] = match
  const parts: React.ReactNode[] = []
  let m: RegExpExecArray | null
  let k = 0
  REST.lastIndex = 0
  while ((m = REST.exec(rest))) {
    if (m[1]) parts.push(<span className="tok-style" key={k++}>{m[1]}</span>)
    else if (m[2]) parts.push(<span className="tok-collection" key={k++}>{m[2]}</span>)
    else if (m[3]) parts.push(<span className="tok-attr" key={k++}>{m[3]}</span>, m[4], <span className="tok-string" key={k++}>{m[5]}</span>)
    else if (m[6]) parts.push(<span className="tok-label" key={k++}>{m[6]}</span>)
    else parts.push(m[7] ?? m[8])
  }
  return (
    <>
      {Array.from({ length: Math.floor(indent.length / 2) }, (_, i) => <span className="tok-guide" key={`g${i}`}>{'  '}</span>)}
      {indent.length % 2 ? ' ' : ''}
      <span className="tok-tag">{tag}</span>
      {classes ? <span className="tok-class">{classes}</span> : null}
      {id ? <span className="tok-id">{id}</span> : null}
      {parts}
    </>
  )
}
