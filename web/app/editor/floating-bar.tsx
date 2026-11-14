'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { HtmlElement, SchemaKind } from '../../../src/stream'
import type { ComputedStyles } from './inspector'
import { getStyleValue, toHexColor } from './style-utils'

export type BarAction = 'edit' | 'parent' | 'duplicate' | 'delete' | 'up' | 'down'

type FloatingBarProps = {
  node: HtmlElement
  kind: SchemaKind
  /** One of several siblings with the same shape (cards, tiers, list items). */
  collectionItem: boolean
  canEditText: boolean
  computed: ComputedStyles
  /** Ancestors, outermost first. */
  ancestors: HtmlElement[]
  propsOpen: boolean
  onStyle: (prop: string, value: string) => void
  onAttr: (name: string, value: string | null) => void
  onAction: (action: BarAction) => void
  onSelect: (id: string) => void
  onToggleProps: () => void
}

type Field = 'href' | 'src' | 'alt' | null

const TEXT_KINDS = new Set<SchemaKind>(['heading', 'text', 'button', 'link', 'item', 'quote', 'details'])
const BOX_KINDS = new Set<SchemaKind>(['section', 'container', 'list', 'form', 'item', 'button', 'quote', 'details'])
const ALIGNS = ['left', 'center', 'right'] as const

function px(value: string | undefined) {
  const n = parseFloat(value || '')
  return Number.isFinite(n) ? n : 0
}

function label(el: HtmlElement) {
  const cls = (el.attributes.class || '').trim().split(/\s+/)[0]
  return { tag: el.name, cls: cls || '' }
}

export function FloatingBar(props: FloatingBarProps) {
  const { node, kind, computed, onStyle, onAttr, onAction } = props
  const [field, setField] = useState<Field>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const style = node.attributes.style || ''
  const value = (prop: string) => getStyleValue(style, prop) || computed[prop] || ''
  const lower = node.name.toLowerCase()
  const isText = TEXT_KINDS.has(kind) || props.canEditText
  const isBox = BOX_KINDS.has(kind) || lower === 'body'
  const display = value('display')
  const isFlex = /flex/.test(display)
  const isGrid = /grid/.test(display)

  useEffect(() => {
    setField(null)
    setMenu(false)
  }, [node.id])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const { tag, cls } = label(node)
  const fontSize = Math.round(px(value('font-size')))
  const bold = px(value('font-weight')) >= 600
  const align = (value('text-align') || 'left').replace('start', 'left').replace('end', 'right')
  const padding = Math.round(px(value('padding-top')))
  const gap = Math.round(px(value('row-gap') || value('gap')))

  return (
    <div className="h2e-bar-float" onMouseDown={e => e.stopPropagation()}>
      <div className="h2e-bar-row">
        <div className="h2e-bar-menu" ref={menuRef}>
          <button className="h2e-chip" onClick={() => setMenu(open => !open)} title="Select a parent">
            <span className="h2e-chip-tag">{tag}</span>
            {cls ? <span className="h2e-chip-class">.{cls}</span> : null}
            <Icon d="M4 6l4 4 4-4" size={12} />
          </button>
          {menu ? (
            <div className="h2e-menu" role="menu">
              {[...props.ancestors].reverse().map(el => {
                const l = label(el)
                return (
                  <button key={el.id} role="menuitem" onClick={() => { setMenu(false); props.onSelect(el.id) }}>
                    <span className="h2e-chip-tag">{l.tag}</span>
                    {l.cls ? <span className="h2e-chip-class">.{l.cls}</span> : null}
                  </button>
                )
              })}
              {props.ancestors.length === 0 ? <div className="h2e-menu-empty">No parent</div> : null}
            </div>
          ) : null}
        </div>

        {isText ? (
          <Group>
            {props.canEditText ? <Btn title="Edit text (double-click)" onClick={() => onAction('edit')}><Icon d="M3 13h2.5L13 5.5 10.5 3 3 10.5z" /></Btn> : null}
            <Stepper title="Font size" value={fontSize} step={fontSize >= 32 ? 4 : 2} min={8} onChange={n => onStyle('font-size', `${n}px`)}>
              <span className="h2e-glyph">Aa</span>
            </Stepper>
            <Btn title="Bold" active={bold} onClick={() => onStyle('font-weight', bold ? '400' : '700')}>
              <span className="h2e-glyph is-bold">B</span>
            </Btn>
            <Swatch title="Text color" value={value('color')} onChange={v => onStyle('color', v)} kind="text" />
            <Btn title={`Align ${align}`} onClick={() => onStyle('text-align', ALIGNS[(ALIGNS.indexOf(align as typeof ALIGNS[number]) + 1) % ALIGNS.length])}>
              <AlignIcon align={align} />
            </Btn>
          </Group>
        ) : null}

        {lower === 'a' ? (
          <Group>
            <Btn title="Link" active={field === 'href'} onClick={() => setField(field === 'href' ? null : 'href')}>
              <Icon d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />
            </Btn>
          </Group>
        ) : null}

        {lower === 'img' ? (
          <Group>
            <Btn title="Image source" active={field === 'src'} onClick={() => setField(field === 'src' ? null : 'src')} wide>Replace</Btn>
            <Btn title="Alt text" active={field === 'alt'} onClick={() => setField(field === 'alt' ? null : 'alt')} wide>Alt</Btn>
            <Stepper title="Corner radius" value={Math.round(px(value('border-top-left-radius') || value('border-radius')))} step={2} min={0} onChange={n => onStyle('border-radius', `${n}px`)}>
              <Icon d="M3 13V8a5 5 0 0 1 5-5h5" />
            </Stepper>
          </Group>
        ) : null}

        {isBox ? (
          <Group>
            <Swatch title="Background" value={value('background-color')} onChange={v => onStyle('background-color', v)} kind="fill" />
            <Stepper title="Padding" value={padding} step={4} min={0} onChange={n => onStyle('padding', `${n}px`)}>
              <Icon d="M2.5 2.5h11v11h-11zM5.5 5.5h5v5h-5z" />
            </Stepper>
            {isFlex || isGrid ? (
              <Stepper title="Gap" value={gap} step={4} min={0} onChange={n => onStyle('gap', `${n}px`)}>
                <Icon d="M3 3v10M13 3v10M6.5 8h3" />
              </Stepper>
            ) : null}
            {isFlex ? (
              <Btn title="Direction" onClick={() => onStyle('flex-direction', value('flex-direction') === 'column' ? 'row' : 'column')}>
                <Icon d={value('flex-direction') === 'column' ? 'M8 3v10M5 10l3 3 3-3' : 'M3 8h10M10 5l3 3-3 3'} />
              </Btn>
            ) : null}
          </Group>
        ) : null}

        <Group>
          {props.collectionItem ? (
            <>
              <Btn title="Add another (⌘D)" onClick={() => onAction('duplicate')} wide accent>
                <Icon d="M8 3.5v9M3.5 8h9" /> Add
              </Btn>
              <Btn title="Move earlier (⌥↑)" onClick={() => onAction('up')}><Icon d="M10 4 6 8l4 4" /></Btn>
              <Btn title="Move later (⌥↓)" onClick={() => onAction('down')}><Icon d="M6 4l4 4-4 4" /></Btn>
            </>
          ) : (
            <>
              <Btn title="Duplicate (⌘D)" onClick={() => onAction('duplicate')}>
                <Icon d="M5.5 5.5h8v8h-8zM10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
              </Btn>
              <Btn title="Move up (⌥↑)" onClick={() => onAction('up')}><Icon d="M4 10l4-4 4 4" /></Btn>
              <Btn title="Move down (⌥↓)" onClick={() => onAction('down')}><Icon d="M4 6l4 4 4-4" /></Btn>
            </>
          )}
          <Btn title="Delete (⌫)" danger onClick={() => onAction('delete')}>
            <Icon d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
          </Btn>
        </Group>

        <Btn title="All properties (⌘I)" active={props.propsOpen} onClick={props.onToggleProps}>
          <Icon d="M3 4.5h10M3 8h10M3 11.5h10M10 3v3M5.5 6.5v3M11 10v3" />
        </Btn>
      </div>

      {field ? (
        <div className="h2e-bar-field">
          <span>{field}</span>
          <input
            autoFocus
            value={node.attributes[field] || ''}
            placeholder={field === 'href' ? 'https://… or #section' : field === 'src' ? 'https://…/image.png' : 'Describe the image'}
            spellCheck={false}
            onChange={e => onAttr(field, e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === 'Escape') setField(null)
            }}
          />
          <button className="h2e-bar-close" title="Done" onClick={() => setField(null)}>Done</button>
        </div>
      ) : null}
    </div>
  )
}

function Group({ children }: { children: ReactNode }) {
  return <div className="h2e-bar-group-float">{children}</div>
}

function Btn({ title, onClick, children, active, danger, wide, accent }: {
  title: string
  onClick: () => void
  children: ReactNode
  active?: boolean
  danger?: boolean
  wide?: boolean
  accent?: boolean
}) {
  const cls = ['h2e-fb', active && 'is-active', danger && 'is-danger', wide && 'is-wide', accent && 'is-accent'].filter(Boolean).join(' ')
  return (
    <button className={cls} title={title} aria-label={title} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  )
}

function Stepper({ title, value, step, min, onChange, children }: {
  title: string
  value: number
  step: number
  min: number
  onChange: (n: number) => void
  children: ReactNode
}) {
  return (
    <div className="h2e-stepper" title={title}>
      <span className="h2e-stepper-icon" aria-hidden="true">{children}</span>
      <button aria-label={`Decrease ${title.toLowerCase()}`} onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <span className="h2e-stepper-value">{value}</span>
      <button aria-label={`Increase ${title.toLowerCase()}`} onClick={() => onChange(value + step)}>+</button>
    </div>
  )
}

function Swatch({ title, value, onChange, kind }: { title: string; value: string; onChange: (v: string) => void; kind: 'text' | 'fill' }) {
  const hex = toHexColor(value)
  return (
    <label className={`h2e-fb h2e-fb-swatch is-${kind}`} title={title}>
      {kind === 'text' ? (
        <span className="h2e-glyph" style={{ borderBottom: `3px solid ${value || '#000'}` }}>A</span>
      ) : (
        <span className={`h2e-dot-swatch${hex ? '' : ' is-empty'}`} style={hex ? { background: value } : undefined} />
      )}
      <input type="color" value={hex || '#ffffff'} onChange={e => onChange(e.target.value)} aria-label={title} />
    </label>
  )
}

function AlignIcon({ align }: { align: string }) {
  const rows: [number, number][] =
    align === 'center' ? [[2, 12], [3.5, 9], [2.5, 11]] :
    align === 'right' ? [[2, 12], [5, 9], [3, 11]] :
    align === 'justify' ? [[2, 12], [2, 12], [2, 12]] :
    [[2, 12], [2, 9], [2, 11]]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {rows.map(([x, w], i) => <rect key={i} x={x} y={3.5 + i * 3.5} width={w} height="1.6" rx=".8" fill="currentColor" />)}
    </svg>
  )
}

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
