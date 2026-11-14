'use client'

import { useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { HtmlElement } from '../../../src/stream'
import { getStyleValue, nudge, styleToText, toHexColor } from './style-utils'

export type ComputedStyles = Record<string, string>

export const COMPUTED_PROPS = [
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align', 'font-family',
  'text-transform', 'display', 'flex-direction', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'width', 'max-width', 'height', 'min-height', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'background-color', 'border-radius', 'border-top-width', 'border-top-style', 'border-top-color',
  'box-shadow', 'opacity',
]

type InspectorProps = {
  node: HtmlElement | null
  path: HtmlElement[]
  computed: ComputedStyles
  size: { width: number; height: number } | null
  canEditText: boolean
  page: { title: string; nodes: number; bytes: number; blocks: number; collections: number }
  onStyle: (prop: string, value: string) => void
  onStyleText: (text: string) => void
  onAttribute: (name: string, value: string | null) => void
  onSelect: (id: string) => void
  onAction: (action: 'edit' | 'parent' | 'duplicate' | 'delete' | 'up' | 'down') => void
}

export function Inspector(props: InspectorProps) {
  const { node, computed, size, onStyle, onAction, page } = props

  if (!node) {
    return (
      <aside className="h2e-panel h2e-right">
        <div className="h2e-panel-head"><div className="h2e-file">Inspector</div></div>
        <div className="h2e-scroll">
          <Section title="Page">
            <div className="h2e-page-title">{page.title || 'Untitled page'}</div>
            <div className="h2e-stats">
              <Stat label="nodes" value={page.nodes} />
              <Stat label="blocks" value={page.blocks} />
              <Stat label="collections" value={page.collections} />
              <Stat label="KB" value={(page.bytes / 1024).toFixed(1)} />
            </div>
          </Section>
          <Section title="Shortcuts">
            <ul className="h2e-keys">
              <li><span>Select</span><span>click</span></li>
              <li><span>Edit text</span><span>double-click · <kbd>↵</kbd></span></li>
              <li><span>Line break while editing</span><span><kbd>⇧</kbd><kbd>↵</kbd></span></li>
              <li><span>Parent</span><span><kbd>esc</kbd></span></li>
              <li><span>Move up / down</span><span><kbd>⌥</kbd><kbd>↑</kbd> <kbd>⌥</kbd><kbd>↓</kbd></span></li>
              <li><span>Duplicate</span><span><kbd>⌘</kbd><kbd>D</kbd></span></li>
              <li><span>Delete</span><span><kbd>⌫</kbd></span></li>
              <li><span>Undo / redo</span><span><kbd>⌘</kbd><kbd>Z</kbd> · <kbd>⇧</kbd><kbd>⌘</kbd><kbd>Z</kbd></span></li>
              <li><span>Nudge a value</span><span><kbd>↑</kbd> <kbd>↓</kbd> · <kbd>⇧</kbd> ×10</span></li>
            </ul>
          </Section>
        </div>
      </aside>
    )
  }

  const style = node.attributes.style || ''
  const value = (prop: string) => getStyleValue(style, prop)
  const display = value('display') || computed.display || ''
  const isFlex = /flex/.test(display)
  const isGrid = /grid/.test(display)
  const field = (prop: string, label: string, extra?: Partial<StyleFieldProps>) => (
    <StyleField key={prop} prop={prop} label={label} value={value(prop)} placeholder={computed[prop] || ''} onChange={onStyle} {...extra} />
  )

  return (
    <aside className="h2e-panel h2e-right">
      <div className="h2e-panel-head">
        <div className="h2e-file">
          <span className="h2e-tag">&lt;{node.name}&gt;</span>
          <span className="h2e-muted">#{node.id}</span>
        </div>
        <div className="h2e-head-actions">
          <IconButton title="Select parent (esc)" onClick={() => onAction('parent')}>
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </IconButton>
          <IconButton title="Move up (⌥↑)" onClick={() => onAction('up')}>
            <path d="M4 10l4-4 4 4" />
          </IconButton>
          <IconButton title="Move down (⌥↓)" onClick={() => onAction('down')}>
            <path d="M4 6l4 4 4-4" />
          </IconButton>
          <IconButton title="Duplicate (⌘D)" onClick={() => onAction('duplicate')}>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </IconButton>
          <IconButton title="Delete (⌫)" danger onClick={() => onAction('delete')}>
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
          </IconButton>
        </div>
      </div>

      <div className="h2e-scroll">
        <div className="h2e-crumbs">
          {props.path.map((el, i) => (
            <button key={el.id} className={el.id === node.id ? 'is-current' : ''} onClick={() => props.onSelect(el.id)}>
              {i > 0 ? <span className="h2e-crumb-sep">›</span> : null}
              {el.name}
              {el.attributes.class ? <span className="h2e-muted">.{el.attributes.class.trim().split(/\s+/)[0]}</span> : null}
            </button>
          ))}
        </div>

        {props.canEditText ? (
          <button className="h2e-edit-text" onClick={() => onAction('edit')}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13h2.5L13 5.5 10.5 3 3 10.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
            Edit text on canvas
            <span className="h2e-muted">double-click</span>
          </button>
        ) : null}

        <Section title="Typography">
          <div className="h2e-grid2">
            {field('font-size', 'Size')}
            <SelectField prop="font-weight" label="Weight" value={value('font-weight')} placeholder={computed['font-weight']} onChange={onStyle}
              options={['100', '200', '300', '400', '500', '600', '700', '800', '900']} />
            {field('line-height', 'Line height')}
            {field('letter-spacing', 'Letter sp.')}
          </div>
          <ColorField prop="color" label="Color" value={value('color')} placeholder={computed.color} onChange={onStyle} />
          <Segmented prop="text-align" label="Align" value={value('text-align')} placeholder={computed['text-align']} onChange={onStyle}
            options={[['left', 'L'], ['center', 'C'], ['right', 'R'], ['justify', 'J']]} />
          {field('font-family', 'Font', { wide: true })}
        </Section>

        <Section title="Layout">
          <SelectField prop="display" label="Display" value={value('display')} placeholder={computed.display} onChange={onStyle}
            options={['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none']} wide />
          {isFlex ? (
            <div className="h2e-grid2">
              <SelectField prop="flex-direction" label="Direction" value={value('flex-direction')} placeholder={computed['flex-direction']} onChange={onStyle}
                options={['row', 'column', 'row-reverse', 'column-reverse']} />
              {field('gap', 'Gap')}
              <SelectField prop="justify-content" label="Justify" value={value('justify-content')} placeholder={computed['justify-content']} onChange={onStyle}
                options={['flex-start', 'center', 'flex-end', 'space-between', 'space-around']} />
              <SelectField prop="align-items" label="Align" value={value('align-items')} placeholder={computed['align-items']} onChange={onStyle}
                options={['stretch', 'flex-start', 'center', 'flex-end', 'baseline']} />
            </div>
          ) : null}
          {isGrid ? (
            <div className="h2e-grid2">
              {field('grid-template-columns', 'Columns', { wide: true })}
              {field('gap', 'Gap')}
            </div>
          ) : null}
          <div className="h2e-grid2">
            {field('width', 'Width')}
            {field('max-width', 'Max width')}
            {field('height', 'Height')}
            {field('min-height', 'Min height')}
          </div>
        </Section>

        <Section title="Spacing">
          <BoxModel value={value} computed={computed} size={size} onChange={onStyle} />
        </Section>

        <Section title="Fill & border">
          <ColorField prop="background-color" label="Background" value={value('background-color')} placeholder={computed['background-color']} onChange={onStyle} />
          <div className="h2e-grid2">
            {field('border-radius', 'Radius')}
            {field('opacity', 'Opacity', { step: 0.05 })}
          </div>
          {field('border', 'Border', { wide: true, placeholder: borderSummary(computed) })}
          {field('box-shadow', 'Shadow', { wide: true })}
        </Section>

        <Section title="Inline CSS">
          <RawStyle key={node.id} style={style} onCommit={props.onStyleText} />
        </Section>

        <Section title="Attributes">
          <Attributes key={node.id} node={node} onChange={props.onAttribute} />
        </Section>
      </div>
    </aside>
  )
}

function borderSummary(computed: ComputedStyles) {
  const width = computed['border-top-width']
  if (!width || width === '0px' || computed['border-top-style'] === 'none') return 'none'
  return `${width} ${computed['border-top-style']} ${computed['border-top-color']}`
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="h2e-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="h2e-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function IconButton({ title, onClick, children, danger }: { title: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button className={`h2e-icon${danger ? ' is-danger' : ''}`} title={title} aria-label={title} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

type StyleFieldProps = {
  prop: string
  label: string
  value: string
  placeholder: string
  onChange: (prop: string, value: string) => void
  wide?: boolean
  step?: number
}

function nudgeKey(event: KeyboardEvent<HTMLInputElement>, current: string, step: number, apply: (v: string) => void) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)
  const next = nudge(current, delta)
  if (next === null) return
  event.preventDefault()
  apply(next)
}

function StyleField({ prop, label, value, placeholder, onChange, wide, step = 1 }: StyleFieldProps) {
  return (
    <label className={`h2e-field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={e => onChange(prop, e.target.value)}
        onKeyDown={e => nudgeKey(e, value || placeholder, step, v => onChange(prop, v))}
      />
    </label>
  )
}

function SelectField({ prop, label, value, placeholder, options, onChange, wide }: StyleFieldProps & { options: string[] }) {
  const all = value && !options.includes(value) ? [value, ...options] : options
  return (
    <label className={`h2e-field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      <select value={value} onChange={e => onChange(prop, e.target.value)} className={value ? '' : 'is-placeholder'}>
        <option value="">{placeholder ? `${placeholder}` : '—'}</option>
        {all.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

function ColorField({ prop, label, value, placeholder, onChange }: StyleFieldProps) {
  const hex = toHexColor(value) || toHexColor(placeholder || '') || '#000000'
  const transparent = !value && !toHexColor(placeholder || '')
  return (
    <label className="h2e-field is-wide">
      <span>{label}</span>
      <div className="h2e-color">
        <span className={`h2e-swatch${transparent ? ' is-empty' : ''}`} style={{ background: value || placeholder }}>
          <input type="color" value={hex} onChange={e => onChange(prop, e.target.value)} aria-label={`${label} color`} />
        </span>
        <input value={value} placeholder={placeholder} spellCheck={false} onChange={e => onChange(prop, e.target.value)} />
      </div>
    </label>
  )
}

function Segmented({ prop, label, value, placeholder, options, onChange }: StyleFieldProps & { options: [string, string][] }) {
  const current = value || ''
  const fallback = placeholder === 'start' ? 'left' : placeholder === 'end' ? 'right' : placeholder
  return (
    <div className="h2e-field is-wide">
      <span>{label}</span>
      <div className="h2e-segmented">
        {options.map(([option, short]) => (
          <button
            key={option}
            title={option}
            className={current === option ? 'is-on' : !current && fallback === option ? 'is-implied' : ''}
            onClick={() => onChange(prop, current === option ? '' : option)}
          >
            <AlignIcon kind={short} />
          </button>
        ))}
      </div>
    </div>
  )
}

function AlignIcon({ kind }: { kind: string }) {
  const rows: [number, number][] =
    kind === 'L' ? [[2, 12], [2, 9], [2, 11]] :
    kind === 'C' ? [[2, 12], [3.5, 9], [2.5, 11]] :
    kind === 'R' ? [[2, 12], [5, 9], [3, 11]] :
    [[2, 12], [2, 12], [2, 12]]
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {rows.map(([x, w], i) => <rect key={i} x={x} y={3.5 + i * 3.5} width={w} height="1.6" rx=".8" fill="currentColor" />)}
    </svg>
  )
}

function BoxModel({ value, computed, size, onChange }: {
  value: (prop: string) => string
  computed: ComputedStyles
  size: { width: number; height: number } | null
  onChange: (prop: string, value: string) => void
}) {
  const side = (kind: 'margin' | 'padding', dir: 'top' | 'right' | 'bottom' | 'left') => {
    const prop = `${kind}-${dir}`
    const current = value(prop)
    const placeholder = (computed[prop] || '').replace(/px$/, '')
    return (
      <input
        className={`h2e-box-input is-${dir}`}
        value={current}
        placeholder={placeholder === '0' ? '0' : placeholder}
        spellCheck={false}
        title={prop}
        onChange={e => onChange(prop, /^-?\d*\.?\d+$/.test(e.target.value) ? `${e.target.value}px` : e.target.value)}
        onKeyDown={e => nudgeKey(e, current || computed[prop] || '0px', 1, v => onChange(prop, v))}
      />
    )
  }
  return (
    <div className="h2e-box">
      <span className="h2e-box-label">margin</span>
      {side('margin', 'top')}{side('margin', 'right')}{side('margin', 'bottom')}{side('margin', 'left')}
      <div className="h2e-box-inner">
        <span className="h2e-box-label">padding</span>
        {side('padding', 'top')}{side('padding', 'right')}{side('padding', 'bottom')}{side('padding', 'left')}
        <div className="h2e-box-core">{size ? `${Math.round(size.width)} × ${Math.round(size.height)}` : '—'}</div>
      </div>
    </div>
  )
}

function RawStyle({ style, onCommit }: { style: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(styleToText(style))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(styleToText(style))
  }, [style, focused])
  return (
    <textarea
      className="h2e-raw"
      value={text}
      placeholder={'color: tomato;\nborder: 1px solid;'}
      spellCheck={false}
      rows={Math.max(3, text.split('\n').length + 1)}
      onFocus={() => setFocused(true)}
      onChange={e => setText(e.target.value)}
      onBlur={() => {
        setFocused(false)
        onCommit(text)
      }}
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          onCommit(text)
        }
      }}
    />
  )
}

function Attributes({ node, onChange }: { node: HtmlElement; onChange: (name: string, value: string | null) => void }) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const entries = Object.entries(node.attributes).filter(([key]) => key !== 'style')
  const add = () => {
    const key = name.trim()
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(key)) return
    onChange(key, value)
    setName('')
    setValue('')
  }
  return (
    <div className="h2e-attrs">
      {entries.map(([key, val]) => (
        <div className="h2e-attr" key={key}>
          <span title={key}>{key}</span>
          <input value={val} spellCheck={false} onChange={e => onChange(key, e.target.value)} />
          <button className="h2e-icon is-tiny" title={`Remove ${key}`} aria-label={`Remove ${key}`} onClick={() => onChange(key, null)}>×</button>
        </div>
      ))}
      <div className="h2e-attr is-new">
        <input value={name} placeholder="name" spellCheck={false} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <input value={value} placeholder="value" spellCheck={false} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="h2e-icon is-tiny" title="Add attribute" aria-label="Add attribute" onClick={add}>+</button>
      </div>
    </div>
  )
}
