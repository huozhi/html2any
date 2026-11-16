import { describe, expect, it } from 'bun:test'
import { html, parse } from '../src/stream'
import { createStreamParser } from '../src/stream/parser'
import type { HtmlNode, HtmlRoot } from '../src/stream/types'

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const TAGS = ['div', 'p', 'span', 'b', 'i', 'a', 'table', 'tr', 'td', 'tbody', 'li', 'ul', 'select', 'option',
  'svg', 'path', 'math', 'mi', 'template', 'form', 'button', 'h1', 'h2', 'pre', 'textarea', 'script', 'style',
  'title', 'nobr', 'font', 'caption', 'col', 'frameset', 'body', 'head', 'html', 'br', 'img', 'input', 'foreignObject']
const BITS = ['text', ' ', '\n', '&amp;', '&am', '&#x41;', '&notin', '<!--c-->', '<!-- x', '<!doctype html>',
  '<?pi?>', '</>', '<', '>', '"', "'", '\0', '\r\n', ']]>', '<![CDATA[x]]>', '-->', '</sCrIpt>', '<!--<script>']

// A script containing `<!--<script>` cannot round-trip in any HTML serializer (browsers included):
// on reparse it enters the "double escaped" state and swallows the next </script>.
const ROUND_TRIP_BITS = BITS.filter(bit => bit !== '<!--<script>' && bit !== '<!-- x')
// Nested forms (a <form> inside <select> inside <form>) are a DOM the parser itself can build but
// no markup can reproduce: a second <form> start tag is ignored while one is open.
const ROUND_TRIP_TAGS = TAGS.filter(tag => tag !== 'form')

/** Random HTML soup: unbalanced tags, odd attributes, entities, comments and raw text. */
function soup(random: () => number, length: number, bits = BITS, tags = TAGS) {
  let out = ''
  for (let k = 0; k < length; k++) {
    const r = random()
    const tag = tags[Math.floor(random() * tags.length)]
    if (r < 0.35) {
      const attrs = random() < 0.4 ? ` a${k}="${random() < 0.5 ? 'v' : 'x>y'}" b c='d'` : ''
      out += `<${random() < 0.2 ? tag.toUpperCase() : tag}${attrs}${random() < 0.1 ? '/' : ''}>`
    } else if (r < 0.6) {
      out += `</${tag}>`
    } else {
      out += bits[Math.floor(random() * bits.length)]
    }
  }
  return out
}

/** Random well-formed markup that serializes back to itself. */
function document(random: () => number, depth = 0): string {
  const blocks = ['section', 'div', 'p', 'ul', 'h2']
  let out = ''
  const count = 1 + Math.floor(random() * 3)
  for (let k = 0; k < count; k++) {
    const tag = blocks[Math.floor(random() * blocks.length)]
    const inner = tag === 'ul'
      ? '<li>item &amp; more</li><li><b>bold</b> text</li>'
      : tag === 'p' || tag === 'h2' ? `Text ${k} <a href="/x?a=1&amp;b=2">link</a>` : depth < 3 ? document(random, depth + 1) : 'leaf'
    out += `<${tag} class="c${k}">${inner}</${tag}>\n`
  }
  return out
}

function parseInChunks(source: string, random: () => number) {
  const parser = createStreamParser({ stripCodeFence: false })
  const snapshots: HtmlRoot[] = []
  let i = 0
  while (i < source.length) {
    const size = 1 + Math.floor(random() * 12)
    snapshots.push(parser.write(source.slice(i, i + size)))
    i += size
  }
  return { final: parser.end(), snapshots }
}

function closedNodes(root: HtmlRoot) {
  const out = new Map<string, HtmlNode>()
  const stack: HtmlNode[] = [...root.children]
  while (stack.length) {
    const node = stack.pop()!
    if (!node.open) out.set(node.id, node)
    if (node.type === 'element') stack.push(...node.children)
  }
  return out
}

function byId(root: HtmlRoot) {
  const out = new Map<string, HtmlNode>()
  const stack: HtmlNode[] = [...root.children]
  while (stack.length) {
    const node = stack.pop()!
    out.set(node.id, node)
    if (node.type === 'element') stack.push(...node.children)
  }
  return out
}

describe('fuzz', () => {
  it('never throws and does not depend on chunking', () => {
    const random = rng(42)
    for (let round = 0; round < 400; round++) {
      const source = soup(random, 40)
      const whole = html(parse(source, { done: true, fence: false }))
      const { final } = parseInChunks(source, random)
      expect(html(final)).toBe(whole)
    }
  })

  it('never changes a node after it is closed', () => {
    const random = rng(7)
    for (let round = 0; round < 200; round++) {
      const source = soup(random, 40)
      const { final, snapshots } = parseInChunks(source, random)
      const last = byId(final)
      for (const snapshot of snapshots) {
        for (const [id, node] of closedNodes(snapshot)) {
          const later = last.get(id)
          // A closed node may be moved (adoption agency), but its content never changes.
          if (later) expect(html(later)).toBe(html(node))
        }
      }
    }
  })

  it('serializes well-formed documents back to the same markup', () => {
    const random = rng(3)
    for (let round = 0; round < 200; round++) {
      const source = document(random)
      expect(html(parse(source, { done: true }))).toBe(source)
    }
  })

  it('is stable after one serialize / parse round trip', () => {
    const random = rng(11)
    for (let round = 0; round < 2000; round++) {
      const once = html(parse(soup(random, 30, ROUND_TRIP_BITS, ROUND_TRIP_TAGS), { done: true, fence: false }), { document: true })
      const twice = html(parse(once, { done: true, fence: false }), { document: true })
      const thrice = html(parse(twice, { done: true, fence: false }), { document: true })
      expect(thrice).toBe(twice)
    }
  })

  it('stays linear on pathological nesting', () => {
    for (const source of ['<div>'.repeat(50000), '<b>'.repeat(20000), '<table>'.repeat(5000), '<a>'.repeat(5000), '<p><span>'.repeat(20000)]) {
      const started = performance.now()
      const root = parse(source + 'x', { done: true })
      html(root)
      expect(performance.now() - started).toBeLessThan(3000)
    }
  })
})
