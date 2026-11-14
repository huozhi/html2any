import { describe, expect, it } from 'bun:test'
import {
  applyOutline, createIdGenerator, createStreamParser, getNode, inferSchema, parseHTML,
  textContent, toDocument, toHTML, toOutline, type HtmlNode, type HtmlRoot,
} from '../src/stream'

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Tea &amp; Co</title>
  <style>.card > h3 { color: #333 } a[href^="x"]::after { content: "</div>" }</style>
</head>
<body class="page">
  <!-- hero -->
  <header class="top"><nav><a href="/">Home</a> <a href="/about?a=1&amp;b=2">About</a></nav></header>
  <section class="hero">
    <h1>Calm <em>tea</em>, delivered</h1>
    <p>Fresh leaves &mdash; every week. <b>Hello</b> <i>world</i></p>
    <a class="btn" href="#go">Start</a>
  </section>
  <section class="grid">
    <div class="card"><h3>One</h3><p>First</p></div>
    <div class="card"><h3>Two</h3><p>Second</p></div>
    <div class="card"><h3>Three</h3><p>Third</p></div>
  </section>
  <ul><li>a<li>b</ul>
  <table><tr><td>1<td>2<tr><td>3</table>
  <svg viewBox="0 0 10 10"><path d="M0 0L10 10"/><linearGradient id="g"/></svg>
  <img src="/a.png" alt="A">
  <script>if (a < b && c > d) { document.write("</p>") }</script>
</body>
</html>`

function strip(node: HtmlRoot | HtmlNode): unknown {
  if (node.type === 'text') return node.value
  const base: Record<string, unknown> = { children: node.children.map(strip) }
  if (node.type === 'element') {
    base.name = node.name
    base.attributes = node.attributes
  }
  return base
}

function allClosed(node: HtmlRoot | HtmlNode): boolean {
  if (node.open) return false
  return node.type === 'text' || node.children.every(allClosed)
}

function chunked(html: string, sizes: number[]) {
  const parser = createStreamParser()
  let i = 0
  let k = 0
  while (i < html.length) {
    const size = sizes[k++ % sizes.length]
    parser.write(html.slice(i, i + size))
    i += size
  }
  return parser.end()
}

describe('stream parser', () => {
  it('parses a full document and serializes it back', () => {
    const root = parseHTML(PAGE)
    expect(root.doctype).toBe('doctype html')
    const html = toHTML(root)
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(html).toContain('<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>')
    expect(html).toContain('<path d="M0 0L10 10"/><linearGradient id="g"/>')
    expect(html).toContain('<svg viewBox="0 0 10 10">')
    expect(html).toContain('content: "</div>"')
    expect(html).toContain('document.write("</p>")')
    expect(html).toContain('<b>Hello</b> <i>world</i>')
    expect(html).toContain('href="/about?a=1&amp;b=2"')
    expect(html).toContain('Fresh leaves — every week.')
    expect(html).not.toContain('hero -->')
    expect(allClosed(root)).toBe(true)
  })

  it('is stable for every chunking of the input', () => {
    const expected = strip(parseHTML(PAGE))
    for (const sizes of [[1], [2], [3, 7], [5, 1, 13], [64], [17, 2, 1, 40]]) {
      expect(strip(chunked(PAGE, sizes))).toEqual(expected)
    }
  })

  it('never throws and never leaks partial markup for any prefix', () => {
    for (let n = 0; n <= PAGE.length; n++) {
      const parser = createStreamParser()
      const root = parser.write(PAGE.slice(0, n))
      const text = textContent(root)
      // Text outside raw-text elements must never show a dangling `<tag` or `&ent`.
      const visible = toHTML(root).replace(/<(script|style|title)[^>]*>[\s\S]*?(<\/\1>|$)/g, '')
      expect(visible).not.toMatch(/&lt;[a-z!/]/i)
      expect(text).not.toMatch(/&[a-z]+$/)
    }
  })

  it('holds back incomplete tags, comments and entities', () => {
    const parser = createStreamParser()
    let root = parser.write('<div><p>Hello</p><a hre')
    expect(toHTML(root)).toBe('<div><p>Hello</p></div>')
    root = parser.write('f="/x">link</a><!-- thinking')
    expect(toHTML(root)).toBe('<div><p>Hello</p><a href="/x">link</a></div>')
    root = parser.write(' --><p>a &am')
    expect(toHTML(root)).toBe('<div><p>Hello</p><a href="/x">link</a><p>a </p></div>')
    root = parser.write('p; b')
    expect(textContent(root)).toBe('Hellolinka & b')
  })

  it('marks open nodes while streaming and closes them at the end', () => {
    const parser = createStreamParser()
    const root = parser.write('<section><p>typing')
    const section = root.children[0]
    expect(section.type === 'element' && section.open).toBe(true)
    const p = section.type === 'element' ? section.children[0] : null
    expect(p && p.open).toBe(true)
    expect(allClosed(parser.end())).toBe(true)
  })

  it('recovers from mismatched and implied end tags', () => {
    expect(toHTML(parseHTML('<div><p>text</div><span>after</span>'))).toBe('<div><p>text</p></div><span>after</span>')
    expect(toHTML(parseHTML('<p>one<p>two<div>three</div>'))).toBe('<p>one</p><p>two</p><div>three</div>')
    expect(toHTML(parseHTML('<p>a <b>bold<div>x</div>'))).toBe('<p>a <b>bold</b></p><div>x</div>')
    expect(toHTML(parseHTML('<dl><dt>a<dd>b<dt>c</dl>'))).toBe('<dl><dt>a</dt><dd>b</dd><dt>c</dt></dl>')
    expect(toHTML(parseHTML('<h2>Title<h3>Sub</h3>'))).toBe('<h2>Title</h2><h3>Sub</h3>')
    expect(toHTML(parseHTML('</div>stray<br/>ok'))).toBe('stray<br>ok')
  })

  it('handles raw text closing tags split across chunks', () => {
    const root = chunked('<style>a<b{}</sty', [100])
    expect(toHTML(root)).toBe('<style>a<b{}</sty</style>')
    const parser = createStreamParser()
    parser.write('<style>a<b{}</sty')
    parser.write('le><p>x</p>')
    expect(toHTML(parser.end())).toBe('<style>a<b{}</style><p>x</p>')
  })

  it('strips markdown code fences around streamed HTML', () => {
    const parser = createStreamParser()
    parser.write('``')
    parser.write('`html\n<p>hi</p>\n`')
    parser.write('``')
    expect(toHTML(parser.end())).toBe('<p>hi</p>\n')
  })

  it('recovers from a stray quote inside a tag at the end of the stream', () => {
    expect(toHTML(parseHTML('<div class="a>text</div>'))).toContain('text')
  })

  it('keeps identity of finished subtrees between writes', () => {
    const parser = createStreamParser()
    const first = parser.write('<section><h1>Done</h1></section><section><p>Stre')
    const second = parser.write('aming</p>')
    expect(second).not.toBe(first)
    expect(second.children[0]).toBe(first.children[0])
    expect(second.children[1]).not.toBe(first.children[1])
    const third = parser.write('')
    expect(third).toBe(second)
  })

  it('keeps ids stable while streaming', () => {
    const parser = createStreamParser()
    const a = parser.write('<main><p>one</p><p>t')
    const b = parser.write('wo</p></main>')
    const ids = (root: HtmlRoot) => {
      const out: string[] = []
      const visit = (n: HtmlNode) => {
        out.push(n.id)
        if (n.type === 'element') n.children.forEach(visit)
      }
      root.children.forEach(visit)
      return out
    }
    expect(ids(b).slice(0, ids(a).length)).toEqual(ids(a))
  })
})

describe('documents', () => {
  it('wraps fragments into a document', () => {
    const doc = toDocument(parseHTML('<style>p{}</style><p>hi</p>'), { title: 'T' })
    expect(doc).toBe('<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>T</title>\n<style>p{}</style>\n</head>\n<body>\n<p>hi</p>\n</body>\n</html>\n')
  })

  it('round-trips a well formed document', () => {
    const doc = toDocument(parseHTML(PAGE))
    expect(toDocument(parseHTML(doc))).toBe(doc)
  })
})

describe('schema and outline', () => {
  const root = parseHTML(PAGE)
  const schema = inferSchema(root)

  it('infers sections, kinds and collections', () => {
    expect(schema.title).toBe('Tea & Co')
    const tags = schema.children.map(n => n.tag)
    expect(tags).toEqual(['header', 'section', 'section', 'ul', 'table', 'svg', 'img'])
    const grid = schema.children[2]
    expect(grid.collection).toEqual({ count: 3, item: 'div.card' })
    const hero = schema.children[1]
    expect(hero.children.map(n => n.kind)).toEqual(['heading', 'text', 'button'])
    // inline content inside the paragraph is not part of the structure
    expect(hero.children[1].children).toEqual([])
  })

  it('renders an outline', () => {
    const outline = toOutline(schema, { header: false })
    expect(outline).toContain('section.hero #')
    expect(outline).toContain('  h1 #')
    expect(outline).toContain('"Calm tea, delivered"')
    expect(outline).toContain('[3 × div.card]')
  })

  it('applies an unchanged outline as a no-op', () => {
    const gen = createIdGenerator(root)
    const result = applyOutline(root, toOutline(schema), gen)
    expect(result.root).toBe(root)
    expect(result.errors).toEqual([])
  })

  it('reorders, deletes, renames, duplicates and inserts blocks', () => {
    const gen = createIdGenerator(root)
    const lines = toOutline(schema, { header: false }).trimEnd().split('\n')
    const find = (pattern: RegExp) => lines.findIndex(line => pattern.test(line.trim()))
    const hero = schema.children[1]
    const grid = schema.children[2]
    const [c1, c2, c3] = grid.children
    const edited = [
      `section.grid #${grid.id}`,
      `  div.card #${c3.id}`,
      `    h3 #${c3.children[0].id}`,
      `    p #${c3.children[1].id}`,
      `  article.card #${c1.id}`,
      `    h3 #${c1.children[0].id}`,
      `    p #${c1.children[1].id}`,
      `  div.card #${c1.id}`,
      `  p.note "Added by outline"`,
      `section #${hero.id}`,
      `  h1 #${hero.children[0].id}`,
      lines[find(/^ul /)],
    ].join('\n')
    const { root: next, errors } = applyOutline(root, edited, gen)
    expect(errors).toEqual([])
    const html = toHTML(next)
    // header removed, grid first, hero paragraph + button removed
    expect(html).not.toContain('<header')
    expect(html.indexOf('class="grid"')).toBeLessThan(html.indexOf('class="hero"'))
    expect(html).not.toContain('Fresh leaves')
    expect(html).toContain('<h1>Calm <em>tea</em>, delivered</h1>')
    // c3 before c1 (renamed to article), c1 duplicated, c2 removed, a new paragraph appended
    expect(html).not.toContain('Second')
    expect(html.indexOf('Third')).toBeLessThan(html.indexOf('<article class="card"><h3>One'))
    expect(html.match(/<h3>One<\/h3>/g)?.length).toBe(2)
    expect(html).toContain('<p class="note">Added by outline</p>')
    // the original node keeps its id, the copy gets a fresh one
    expect(getNode(next, c1.id)).toBeDefined()
    expect(getNode(next, c2.id)).toBeUndefined()
    // non-structural content (style, script, head) is untouched
    expect(html).toContain('document.write')
    expect(html).toContain('<title>Tea &amp; Co</title>')
  })

  it('reports unknown ids and unreadable lines', () => {
    const gen = createIdGenerator(root)
    const { errors } = applyOutline(root, 'div #nope\n???', gen)
    expect(errors.length).toBe(2)
  })
})

describe('streaming schema', () => {
  it('has no blocks while only the head has arrived', () => {
    const parser = createStreamParser()
    const root = parser.write('<!doctype html><html><head><title>T</title><style>p{}')
    expect(inferSchema(root).children).toEqual([])
    parser.write('</style></head><body><main><p>x')
    expect(inferSchema(parser.snapshot()).children.map(n => n.tag)).toEqual(['main'])
  })
})
