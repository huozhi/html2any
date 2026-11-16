import { LEGACY, PACKED } from './entities-data'

let table: Map<string, string> | null = null
let legacy: Set<string> | null = null

function named() {
  if (!table) {
    table = new Map()
    for (const entry of PACKED.split(',')) {
      const eq = entry.indexOf('=')
      const chars = entry.slice(eq + 1).split('.').map(code => String.fromCodePoint(parseInt(code, 36)))
      table.set(entry.slice(0, eq), chars.join(''))
    }
    legacy = new Set(LEGACY.split(','))
  }
  return table
}

// Numeric references in the C1 range map to windows-1252 (HTML spec, "numeric character reference end state").
const C1: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
}

function fromCodePoint(code: number) {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
  return String.fromCodePoint(C1[code] ?? code)
}

const DIGIT = /[0-9]/
const HEX = /[0-9a-fA-F]/
const ALNUM = /[a-zA-Z0-9]/

/**
 * Decode character references the way browsers do: numeric references, the longest matching
 * named reference, and legacy references without `;` (which are left alone inside attribute
 * values when followed by `=` or an alphanumeric character).
 */
export function decodeEntities(input: string, attribute = false): string {
  if (input.indexOf('&') === -1) return input
  const names = named()
  let out = ''
  let last = 0
  let i = input.indexOf('&')
  while (i !== -1) {
    let next = i + 1
    if (input[i + 1] === '#') {
      let j = i + 2
      const hex = input[j] === 'x' || input[j] === 'X'
      if (hex) j++
      const start = j
      const digit = hex ? HEX : DIGIT
      while (j < input.length && digit.test(input[j])) j++
      if (j > start) {
        const code = parseInt(input.slice(start, Math.min(j, start + 12)), hex ? 16 : 10)
        if (input[j] === ';') j++
        out += input.slice(last, i) + fromCodePoint(j - start > 12 ? 0x110000 : code)
        last = next = j
      }
    } else {
      let j = i + 1
      while (j < input.length && j - i <= 32 && ALNUM.test(input[j])) j++
      const name = input.slice(i + 1, j)
      if (name && input[j] === ';' && names.has(name)) {
        out += input.slice(last, i) + names.get(name)
        last = next = j + 1
      } else if (name) {
        for (let len = Math.min(name.length, 6); len >= 2; len--) {
          const prefix = name.slice(0, len)
          if (!legacy!.has(prefix)) continue
          const after = input[i + 1 + len] || ''
          if (attribute && (after === '=' || ALNUM.test(after))) break
          out += input.slice(last, i) + names.get(prefix)
          last = next = i + 1 + len
          break
        }
      }
    }
    i = input.indexOf('&', next)
  }
  return out + input.slice(last)
}

/** A trailing `&...` that may still become a character reference once more input arrives. */
export const PARTIAL_REFERENCE = /&(?:#[xX]?[0-9a-fA-F]{0,12}|[a-zA-Z0-9]{0,32})$/

export function escapeText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '&nbsp;')
}

export function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/ /g, '&nbsp;')
}
