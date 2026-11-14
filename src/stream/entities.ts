const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', bull: '•', middot: '·',
  times: '×', divide: '÷', minus: '−', plusmn: '±', deg: '°', micro: 'µ',
  para: '¶', sect: '§', euro: '€', pound: '£', yen: '¥', cent: '¢',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐',
  hearts: '♥', star: '☆', check: '✓', cross: '✗', infin: '∞', ne: '≠',
  le: '≤', ge: '≥', asymp: '≈', frac12: '½', frac14: '¼', frac34: '¾',
  sup2: '²', sup3: '³', iexcl: '¡', iquest: '¿', shy: '­', zwj: '‍',
  zwnj: '‌', ensp: ' ', emsp: ' ', thinsp: ' ', dagger: '†',
  Dagger: '‡', permil: '‰', prime: '′', Prime: '″', oline: '‾', loz: '◊',
}

// Entities browsers also accept without the trailing semicolon.
const LEGACY = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg'])

const ENTITY = /&(#[xX][0-9a-fA-F]{1,6};?|#[0-9]{1,7};?|[a-zA-Z][a-zA-Z0-9]{1,31};?)/g

function fromCodePoint(code: number) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return '�'
  }
  return String.fromCodePoint(code)
}

export function decodeEntities(input: string) {
  if (input.indexOf('&') === -1) return input
  return input.replace(ENTITY, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const digits = body.slice(hex ? 2 : 1).replace(/;$/, '')
      return fromCodePoint(parseInt(digits, hex ? 16 : 10))
    }
    const terminated = body.endsWith(';')
    const name = terminated ? body.slice(0, -1) : body
    if (terminated && name in NAMED) return NAMED[name]
    if (!terminated) {
      // `&copy2024` → `©2024`: match the longest legacy prefix.
      for (let len = name.length; len >= 2; len--) {
        const prefix = name.slice(0, len)
        if (LEGACY.has(prefix)) return NAMED[prefix] + name.slice(len)
      }
    }
    return match
  })
}

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
