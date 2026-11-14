export type StyleEntry = [property: string, value: string]

/** Split an inline style into ordered declarations (aware of quotes and parentheses). */
export function parseStyle(style: string): StyleEntry[] {
  const entries: StyleEntry[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  const push = (part: string) => {
    const colon = part.indexOf(':')
    if (colon === -1) return
    const prop = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (prop) entries.push([prop, value])
  }
  for (let i = 0; i < style.length; i++) {
    const c = style[i]
    if (quote) {
      if (c === quote && style[i - 1] !== '\\') quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) {
      push(style.slice(start, i))
      start = i + 1
    }
  }
  push(style.slice(start))
  return entries
}

export function serializeStyle(entries: StyleEntry[]) {
  return entries.map(([prop, value]) => `${prop}: ${value}`).join('; ')
}

export function getStyleValue(style: string, prop: string) {
  const entries = parseStyle(style)
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i][0] === prop) return entries[i][1]
  return ''
}

/** Set (or remove, with an empty value) one declaration, keeping the order of the others. */
export function setStyleValue(style: string, prop: string, value: string) {
  const entries = parseStyle(style).filter(([p], i, all) => p !== prop || all.findLastIndex(([q]) => q === prop) === i)
  const index = entries.findIndex(([p]) => p === prop)
  const trimmed = value.trim()
  if (!trimmed) {
    if (index !== -1) entries.splice(index, 1)
  } else if (index !== -1) {
    entries[index] = [prop, trimmed]
  } else {
    entries.push([prop, trimmed])
  }
  return serializeStyle(entries)
}

export function styleToText(style: string) {
  const entries = parseStyle(style)
  return entries.length ? entries.map(([p, v]) => `${p}: ${v};`).join('\n') : ''
}

export function textToStyle(text: string) {
  return serializeStyle(parseStyle(text.replace(/\n/g, ' ')))
}

export function toHexColor(value: string): string | null {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map(c => c + c).join('').toLowerCase()
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v)
  if (rgb) {
    if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return null
    return '#' + [rgb[1], rgb[2], rgb[3]].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
  }
  return null
}

const NUMERIC = /^(-?\d*\.?\d+)([a-z%]*)$/i

/** Increment the number in a CSS value, keeping its unit: `16px` → `17px`. */
export function nudge(value: string, delta: number): string | null {
  const match = NUMERIC.exec(value.trim())
  if (!match) return null
  const decimals = (match[1].split('.')[1] || '').length
  const next = (parseFloat(match[1]) + delta).toFixed(Math.min(decimals, 2))
  const unit = match[2] || (value.trim() === '0' ? 'px' : '')
  return `${parseFloat(next)}${unit}`
}
