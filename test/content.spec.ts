import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { content, fill, html, parse, type ContentData } from '../src/stream'
import { SAMPLE_PAGE } from '../web/app/editor/sample-page'

const tree = parse(SAMPLE_PAGE, { done: true })
const page = content(tree)
const data = page.data as any

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

/** Lines of `after` that are not in `before`. */
function changedLines(before: string, after: string) {
  const old = new Set(before.split('\n'))
  return after.split('\n').filter(line => !old.has(line))
}

describe('content model', () => {
  it('extracts sections, fields and lists', () => {
    expect(Object.keys(page.schema)).toEqual(['nav', 'hero', 'features', 'quote', 'pricing', 'faq', 'cta', 'footer'])
    expect(page.schema.features).toEqual({
      sectionTitle: 'text',
      sectionLead: 'text',
      cards: [{ icon: 'text', title: 'text', text: 'text' }],
    })
    expect(page.schema.pricing).toEqual({
      sectionTitle: 'text',
      sectionLead: 'text',
      tiers: [{ title: 'text', price: 'richtext', note: 'text', items: ['text'], cta: 'link' }],
    })
    expect(data.hero.title).toBe('A quiet place for your thoughts.')
    expect(data.hero.actions).toEqual([
      { label: 'Start writing →', href: '#pricing' },
      { label: 'See how it works', href: '#features' },
    ])
    expect(data.pricing.tiers.map((tier: any) => tier.title)).toEqual(['Free', 'Personal', 'Family'])
    expect(data.pricing.tiers[1].price).toBe('$4 <small>/ month</small>')
    expect(data.pricing.tiers[0].items).toEqual(['Unlimited notes', 'Search', 'One device'])
  })

  it('fills unchanged content back as the same tree', () => {
    expect(fill(tree, page.data)).toBe(tree)
  })

  it('changes only the edited field', () => {
    const next = clone(page.data) as any
    next.hero.title = 'Notes that stay out of your way.'
    const filled = fill(tree, next)
    const before = html(tree, { document: true })
    const after = html(filled, { document: true })
    expect(changedLines(before, after)).toEqual(['      <h1>Notes that stay out of your way.</h1>'])
    expect(content(filled).data.features).toEqual(page.data.features)
  })

  it('edits links, rich text and list items', () => {
    const next = clone(page.data) as any
    next.hero.actions[1] = { label: 'Read the docs', href: '/docs' }
    next.pricing.tiers[1].price = '$5 <small>/ month</small>'
    next.pricing.tiers[0].items = ['Unlimited notes', 'Search']
    const out = html(fill(tree, next))
    expect(out).toContain('<a class="btn btn-ghost" href="/docs">Read the docs</a>')
    expect(out).toContain('<div class="price">$5 <small>/ month</small></div>')
    expect(out).toContain('<ul><li>Unlimited notes</li><li>Search</li></ul>')
  })

  it('adds list items by copying the last one', () => {
    const next = clone(page.data) as any
    next.pricing.tiers.push({ title: 'Team', price: '$20 <small>/ month</small>', note: 'For small teams.', items: ['Everything in Family', 'Admin tools'], cta: { label: 'Talk to us', href: '/team' } })
    const filled = fill(tree, next)
    const tiers = (content(filled).data as any).pricing.tiers
    expect(tiers.length).toBe(4)
    expect(tiers[3]).toEqual(next.pricing.tiers[3])
    const out = html(filled)
    expect(out).toContain('<div class="tier">\n            <h3>Team</h3>')
    // The copy keeps the template's markup and the whitespace between items.
    expect(out.match(/<div class="tier">/g)?.length).toBe(3)
  })

  it('removes list items from the end', () => {
    const next = clone(page.data) as any
    next.faq.faq = next.faq.faq.slice(0, 1)
    const out = html(fill(tree, next))
    expect(out.match(/<details/g)?.length).toBe(1)
    expect(out).not.toContain('Does it work offline?')
  })

  it('reads images and ignores decoration', () => {
    const root = parse('<section id="team"><img src="/a.png" alt="Ada"><span class="dot"></span><h2>Team</h2><svg><path d="M0"/></svg></section>', { done: true })
    expect(content(root).data).toEqual({ team: { image: { src: '/a.png', alt: 'Ada' }, title: 'Team' } })
    const out = html(fill(root, { team: { image: { src: '/b.png', alt: 'Grace' }, title: 'Team' } }))
    expect(out).toContain('<img src="/b.png" alt="Grace">')
  })

  it('names fields from ids and meaningful classes, not utility classes', () => {
    const root = parse('<div class="mx-auto max-w-5xl px-4"><h2 class="text-3xl font-bold">Plans</h2><ul class="grid gap-4"><li class="plan">A</li><li class="plan">B</li></ul></div>', { done: true })
    expect(content(root).data).toEqual({ title: 'Plans', plans: ['A', 'B'] })
  })

  it('round-trips real pages and random markup', () => {
    const dir = join(import.meta.dir, '..', 'benchmark', 'fixtures', 'raw')
    for (const file of readdirSync(dir)) {
      const root = parse(readFileSync(join(dir, file), 'utf8'), { done: true })
      const extracted = content(root)
      expect(fill(root, extracted.data)).toBe(root)
      expect(content(fill(root, clone(extracted.data))).data).toEqual(extracted.data)
    }
    let seed = 5
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    const parts = ['<div class="card">', '</div>', '<p>', 'text', '<a href="#">', 'link', '</a>', '<ul>', '<li>', 'item', '</ul>', '<h2>', 'Title', '<b>', 'bold', '<img src="x.png">', '<section id="s">', '</section>']
    for (let round = 0; round < 200; round++) {
      let source = ''
      for (let k = 0; k < 30; k++) source += parts[Math.floor(random() * parts.length)]
      const root = parse(source, { done: true })
      expect(fill(root, content(root).data as ContentData)).toBe(root)
    }
  })
})
