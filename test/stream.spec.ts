import { describe, expect, it } from 'bun:test'
import {
  apply, find, html, outline, parse, schema, setHTML, text, type HtmlElement, type HtmlNode, type HtmlRoot,
} from '../src/stream'
import { createStreamParser } from '../src/stream/parser'

const parseHTML = (source: string) => parse(source, { done: true })
const stream = () => createStreamParser()

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

/** The <body> element of a parsed tree. */
function body(root: HtmlRoot) {
  const htmlEl = root.children.find(n => n.type === 'element') as HtmlElement
  return htmlEl.children.find(n => n.type === 'element' && n.name === 'body') as HtmlElement
}

function strip(node: HtmlRoot | HtmlNode): unknown {
  if (node.type === 'text') return node.value
  if (node.type === 'comment') return `<!--${node.value}-->`
  const base: Record<string, unknown> = { children: node.children.map(strip) }
  if (node.type === 'element') {
    base.name = node.name
    base.attributes = node.attributes
  }
  return base
}

function allClosed(node: HtmlRoot | HtmlNode): boolean {
  if (node.open) return false
  return node.type !== 'element' && node.type !== 'root' ? true : node.children.every(allClosed)
}

function chunked(source: string, sizes: number[]) {
  const parser = stream()
  let i = 0
  let k = 0
  while (i < source.length) {
    const size = sizes[k++ % sizes.length]
    parser.write(source.slice(i, i + size))
    i += size
  }
  return parser.end()
}

describe('stream parser', () => {
  it('parses a full document and serializes it back', () => {
    const root = parseHTML(PAGE)
    expect(root.doctype).toBe('doctype html')
    const out = html(root)
    expect(out).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(out).toContain('<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>')
    expect(out).toContain('<path d="M0 0L10 10"/><linearGradient id="g"/>')
    expect(out).toContain('<svg viewBox="0 0 10 10">')
    expect(out).toContain('content: "</div>"')
    expect(out).toContain('document.write("</p>")')
    expect(out).toContain('<b>Hello</b> <i>world</i>')
    expect(out).toContain('href="/about?a=1&amp;b=2"')
    expect(out).toContain('Fresh leaves — every week.')
    expect(out).toContain('<!-- hero -->')
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
      const parser = stream()
      const root = parser.write(PAGE.slice(0, n))
      const content = text(root)
      // Text outside raw-text elements must never show a dangling `<tag` or `&ent`.
      const visible = html(root).replace(/<(script|style|title)[^>]*>[\s\S]*?(<\/\1>|$)/g, '')
      expect(visible).not.toMatch(/&lt;[a-z!/]/i)
      expect(content).not.toMatch(/&[a-z]+$/)
    }
  })

  it('holds back incomplete tags, comments and entities', () => {
    const parser = stream()
    let root = parser.write('<div><p>Hello</p><a hre')
    expect(html(root)).toBe('<div><p>Hello</p></div>')
    root = parser.write('f="/x">link</a><!-- thinking')
    expect(html(root)).toBe('<div><p>Hello</p><a href="/x">link</a></div>')
    root = parser.write(' --><p>a &am')
    expect(html(root)).toBe('<div><p>Hello</p><a href="/x">link</a><!-- thinking --><p>a </p></div>')
    root = parser.write('p; b')
    expect(text(root)).toBe('Hellolinka & b')
  })

  it('marks open nodes while streaming and closes them at the end', () => {
    const parser = stream()
    const root = parser.write('<section><p>typing')
    const section = body(root).children[0]
    expect(section.type === 'element' && section.open).toBe(true)
    const p = section.type === 'element' ? section.children[0] : null
    expect(p && p.open).toBe(true)
    expect(allClosed(parser.end())).toBe(true)
  })

  it('recovers from mismatched and implied end tags', () => {
    expect(html(parseHTML('<div><p>text</div><span>after</span>'))).toBe('<div><p>text</p></div><span>after</span>')
    expect(html(parseHTML('<p>one<p>two<div>three</div>'))).toBe('<p>one</p><p>two</p><div>three</div>')
    // Like browsers: the open <b> is reconstructed inside the <div>.
    expect(html(parseHTML('<p>a <b>bold<div>x</div>'))).toBe('<p>a <b>bold</b></p><div><b>x</b></div>')
    expect(html(parseHTML('<b>1<i>2</b>3</i>4'))).toBe('<b>1<i>2</i></b><i>3</i>4')
    expect(html(parseHTML('<!doctype html><table>x<tr><td>1</td></tr></table>'))).toBe('x<table><tr><td>1</td></tr></table>')
    expect(html(parseHTML('<a href=1>a<a href=2>b</a>'))).toBe('<a href="1">a</a><a href="2">b</a>')
    expect(html(parseHTML('<dl><dt>a<dd>b<dt>c</dl>'))).toBe('<dl><dt>a</dt><dd>b</dd><dt>c</dt></dl>')
    expect(html(parseHTML('<h2>Title<h3>Sub</h3>'))).toBe('<h2>Title</h2><h3>Sub</h3>')
    expect(html(parseHTML('</div>stray<br/>ok'))).toBe('stray<br>ok')
  })

  it('handles raw text closing tags split across chunks', () => {
    const root = chunked('<style>a<b{}</sty', [100])
    expect(html(root)).toBe('<style>a<b{}</sty</style>')
    const parser = stream()
    parser.write('<style>a<b{}</sty')
    parser.write('le><p>x</p>')
    expect(html(parser.end())).toBe('<style>a<b{}</style><p>x</p>')
  })

  it('strips markdown code fences around streamed HTML', () => {
    const parser = stream()
    parser.write('``')
    parser.write('`html\n<p>hi</p>\n`')
    parser.write('``')
    expect(html(parser.end())).toBe('<p>hi</p>\n')
  })

  it('treats a stray quote inside a tag like browsers do', () => {
    // The attribute value runs to the next quote; a tag still open at the end is dropped.
    expect(html(parseHTML('<div class="a>text</div>'))).toBe('')
    const recovered = parseHTML('<div class="a>text</div><p class="b">x</p>')
    expect((body(recovered).children[0] as HtmlElement).attributes.class).toBe('a>text</div><p class=')
    expect(text(recovered)).toBe('x')
  })

  it('keeps identity of finished subtrees between writes', () => {
    const parser = stream()
    const first = parser.write('<section><h1>Done</h1></section><section><p>Stre')
    const second = parser.write('aming</p>')
    expect(second).not.toBe(first)
    expect(body(second).children[0]).toBe(body(first).children[0])
    expect(body(second).children[1]).not.toBe(body(first).children[1])
    const third = parser.write('')
    expect(third).toBe(second)
  })

  it('keeps ids stable while streaming', () => {
    const parser = stream()
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
    const doc = html(parseHTML('<style>p{}</style><p>hi</p>'), { document: true, title: 'T' })
    expect(doc).toBe('<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>T</title>\n<style>p{}</style>\n</head>\n<body>\n<p>hi</p>\n</body>\n</html>\n')
  })

  it('round-trips a well formed document', () => {
    const doc = html(parseHTML(PAGE), { document: true })
    expect(html(parseHTML(doc), { document: true })).toBe(doc)
  })
})

describe('schema and outline', () => {
  const root = parseHTML(PAGE)
  const page = schema(root)

  it('infers sections, kinds and collections', () => {
    expect(page.title).toBe('Tea & Co')
    const tags = page.children.map(n => n.tag)
    expect(tags).toEqual(['header', 'section', 'section', 'ul', 'table', 'svg', 'img'])
    const grid = page.children[2]
    expect(grid.collection).toEqual({ count: 3, item: 'div.card' })
    const hero = page.children[1]
    expect(hero.children.map(n => n.kind)).toEqual(['heading', 'text', 'button'])
    // inline content inside the paragraph is not part of the structure
    expect(hero.children[1].children).toEqual([])
  })

  it('renders an outline', () => {
    const file = outline(root, { header: false })
    expect(file).toContain('section.hero #')
    expect(file).toContain('  h1 #')
    expect(file).toContain('"Calm tea, delivered"')
    expect(file).toContain('[3 × div.card]')
  })

  it('applies an unchanged outline as a no-op', () => {
    const result = apply(root, outline(root))
    expect(result.root).toBe(root)
    expect(result.errors).toEqual([])
  })

  it('reorders, deletes, renames, duplicates and inserts blocks', () => {
    const lines = outline(root, { header: false }).trimEnd().split('\n')
    const lineOf = (pattern: RegExp) => lines.findIndex(line => pattern.test(line.trim()))
    const hero = page.children[1]
    const grid = page.children[2]
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
      `section.hero #${hero.id}`,
      `  h1 #${hero.children[0].id}`,
      lines[lineOf(/^ul /)],
    ].join('\n')
    const { root: next, errors } = apply(root, edited)
    expect(errors).toEqual([])
    const out = html(next)
    // header removed, grid first, hero paragraph + button removed
    expect(out).not.toContain('<header')
    expect(out.indexOf('class="grid"')).toBeLessThan(out.indexOf('class="hero"'))
    expect(out).not.toContain('Fresh leaves')
    expect(out).toContain('<h1>Calm <em>tea</em>, delivered</h1>')
    // c3 before c1 (renamed to article), c1 duplicated, c2 removed, a new paragraph appended
    expect(out).not.toContain('Second')
    expect(out.indexOf('Third')).toBeLessThan(out.indexOf('<article class="card"><h3>One'))
    expect(out.match(/<h3>One<\/h3>/g)?.length).toBe(2)
    expect(out).toContain('<p class="note">Added by outline</p>')
    // the original node keeps its id, the copy gets a fresh one
    expect(find(next, c1.id)).toBeDefined()
    expect(find(next, c2.id)).toBeUndefined()
    // non-structural content (style, script, head) is untouched
    expect(out).toContain('document.write')
    expect(out).toContain('<title>Tea &amp; Co</title>')
  })

  it('reports unknown ids and unreadable lines', () => {
    const { errors } = apply(root, 'div #nope\n???')
    expect(errors.length).toBe(2)
  })
})

describe('streaming schema', () => {
  it('has no blocks while only the head has arrived', () => {
    const parser = stream()
    const root = parser.write('<!doctype html><html><head><title>T</title><style>p{}')
    expect(schema(root).children).toEqual([])
    parser.write('</style></head><body><main><p>x')
    expect(schema(parser.snapshot()).children.map(n => n.tag)).toEqual(['main'])
  })
})

describe('edits', () => {
  it('replaces children with parsed HTML using fresh ids', () => {
    const root = parseHTML('<main><p id="a">old</p></main>')
    const p = (body(root).children[0] as HtmlElement).children[0]
    const next = setHTML(root, p.id, 'new <b>bold</b>')
    expect(html(next)).toBe('<main><p id="a">new <b>bold</b></p></main>')
    const ids = new Set<string>()
    const visit = (n: HtmlNode) => {
      expect(ids.has(n.id)).toBe(false)
      ids.add(n.id)
      if (n.type === 'element') n.children.forEach(visit)
    }
    next.children.forEach(visit)
  })
})

describe('parse', () => {
  it('continues incrementally when the text grows', () => {
    const a = parse('<main><section><h1>Done</h1></section><p>Stre')
    const b = parse('<main><section><h1>Done</h1></section><p>Streaming</p>')
    expect((b.children[0] as any).children[0]).toBe((a.children[0] as any).children[0])
    expect(parse('<main><section><h1>Done</h1></section><p>Streaming</p>')).toBe(b)
    const final = parse('<main><section><h1>Done</h1></section><p>Streaming</p>', { done: true })
    expect(final.open).toBe(false)
    expect(html(final)).toBe('<main><section><h1>Done</h1></section><p>Streaming</p></main>')
  })

  it('starts over when the text is not an extension', () => {
    parse('<p>first version')
    expect(html(parse('<p>second', { done: true }))).toBe('<p>second</p>')
  })

  it('iterates trees from an async source', async () => {
    async function* chunks() {
      yield '```html\n<ul><li>a'
      yield new TextEncoder().encode('<li>b</ul>\n```')
    }
    const trees: HtmlRoot[] = []
    for await (const tree of parse(chunks())) trees.push(tree)
    expect(trees.length).toBeGreaterThan(1)
    expect(trees[trees.length - 1].open).toBe(false)
    expect(html(trees[trees.length - 1])).toBe('<ul><li>a</li><li>b</li></ul>\n')
  })

  it('reads a Response body', async () => {
    const response = new Response('<p>hi <b>there</b></p>')
    let last: HtmlRoot | undefined
    for await (const tree of parse(response)) last = tree
    expect(html(last!)).toBe('<p>hi <b>there</b></p>')
  })
})

describe('outline properties', () => {
  const root = parseHTML('<main><h1 class="title" style="color: red">Hi</h1><a href="/x" class="btn btn-lg">Go</a><div class="md:flex w-1/2">x</div></main>')

  it('shows classes, attributes, style and text', () => {
    const file = outline(root, { header: false })
    expect(file).toContain('h1.title #')
    expect(file).toContain('{ color: red }  "Hi"')
    expect(file).toContain('a.btn.btn-lg #')
    expect(file).toContain('href="/x"')
    expect(file).toContain('class="md:flex w-1/2"')
    expect(apply(root, file).root).toBe(root)
  })

  it('applies edited style, attributes, classes and text', () => {
    const file = outline(root, { header: false })
      .replace('{ color: red }  "Hi"', '{ color: blue; font-size: 40px }  "Hello"')
      .replace('a.btn.btn-lg', 'a.btn')
      .replace('href="/x"', 'href="/y" target="_blank"')
      .replace('class="md:flex w-1/2"', 'class="grid"')
    const { root: next, errors } = apply(root, file)
    expect(errors).toEqual([])
    expect(html(next)).toBe('<main><h1 class="title" style="color: blue; font-size: 40px">Hello</h1><a href="/y" class="btn" target="_blank">Go</a><div class="grid">x</div></main>')
  })

  it('removes a style and an attribute when they are deleted from the line', () => {
    const file = outline(root, { header: false }).replace(' { color: red }', '').replace(' href="/x"', '')
    expect(html(apply(root, file).root)).toBe('<main><h1 class="title">Hi</h1><a class="btn btn-lg">Go</a><div class="md:flex w-1/2">x</div></main>')
  })

  it('creates new elements with properties', () => {
    const file = outline(root, { header: false }) + 'p.note data-x="1" { margin: 0 } "New"\n'
    expect(html(apply(root, file).root)).toContain('<p class="note" data-x="1" style="margin: 0">New</p>')
  })
})
