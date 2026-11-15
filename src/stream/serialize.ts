import { escapeAttribute, escapeText } from './entities'
import { HEAD_ELEMENTS, VOID_ELEMENTS } from './elements'
import { updateNode } from './tree'
import type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot, HtmlText } from './types'

/** Elements whose text children are serialized without escaping. */
const RAW_SERIALIZE = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'])

function serializeAttributes(attrs: Record<string, string>) {
  let out = ''
  for (const name in attrs) {
    const value = attrs[name]
    out += value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`
  }
  return out
}

/**
 * Parsed trees carry the element's namespace. Elements created by hand (outline edits) have none
 * and are written as HTML, which browsers parse back into the right namespace anyway.
 */
function isForeign(node: HtmlElement) {
  if (node.namespace) return true
  const lower = node.name.toLowerCase()
  return lower === 'svg' || lower === 'math'
}

type Frame = { node: HtmlNode; foreign: boolean; raw: boolean } | string

/**
 * Serialize nodes back to HTML. Whitespace and attribute order are preserved; tags the parser
 * implied (html, head, body, tbody, ...) are omitted, so fragments serialize as fragments.
 * Iterative, so very deep trees cannot overflow the stack.
 */
export function toHTML(input: HtmlNode | HtmlParent | HtmlNode[]): string {
  const nodes = Array.isArray(input) ? input : input.type === 'root' ? input.children : [input]
  const out: string[] = []
  const stack: Frame[] = []
  for (let k = nodes.length - 1; k >= 0; k--) stack.push({ node: nodes[k], foreign: false, raw: false })
  while (stack.length) {
    const frame = stack.pop()!
    if (typeof frame === 'string') {
      out.push(frame)
      continue
    }
    const { node } = frame
    if (node.type === 'text') {
      out.push(frame.raw ? node.value : escapeText(node.value))
      continue
    }
    if (node.type === 'comment') {
      out.push(`<!--${node.value}-->`)
      continue
    }
    const lower = node.name.toLowerCase()
    const foreign = isForeign(node)
    const childForeign = foreign && lower !== 'foreignobject'
    const raw = !foreign && RAW_SERIALIZE.has(lower)
    const omitTags = node.implied && Object.keys(node.attributes).length === 0
    if (!omitTags) {
      const open = `<${node.name}${serializeAttributes(node.attributes)}`
      if (!foreign && VOID_ELEMENTS.has(lower)) {
        out.push(`${open}>`)
        continue
      }
      if (foreign && node.children.length === 0) {
        out.push(`${open}/>`)
        continue
      }
      // The parser drops a newline right after these start tags; keep it on a round trip.
      const first = node.children[0]
      const lead = !foreign && (lower === 'pre' || lower === 'textarea' || lower === 'listing') && first?.type === 'text' && first.value[0] === '\n'
      out.push(`${open}>${lead ? '\n' : ''}`)
      stack.push(`</${node.name}>`)
    }
    for (let k = node.children.length - 1; k >= 0; k--) {
      stack.push({ node: node.children[k], foreign: childForeign, raw })
    }
  }
  return out.join('')
}

export function findElement(nodes: HtmlNode[], name: string): HtmlElement | undefined {
  for (const node of nodes) {
    if (node.type === 'element' && node.name.toLowerCase() === name) return node
  }
  return undefined
}

export type DocumentParts = {
  html?: HtmlElement
  head?: HtmlElement
  body?: HtmlElement
  /** Nodes that render inside <head> */
  headNodes: HtmlNode[]
  /** Nodes that render inside <body> */
  bodyNodes: HtmlNode[]
}

/** Split a parsed tree into head and body content. */
export function documentParts(root: HtmlRoot): DocumentParts {
  const html = findElement(root.children, 'html')
  const top = html ? html.children : root.children
  const head = findElement(top, 'head')
  const body = findElement(top, 'body')
  const headNodes: HtmlNode[] = head ? head.children.slice() : []
  const bodyNodes: HtmlNode[] = []
  if (body) {
    bodyNodes.push(...body.children)
  } else {
    for (const node of top) {
      if (node === head) continue
      if (!head && node.type === 'element' && HEAD_ELEMENTS.has(node.name.toLowerCase())) headNodes.push(node)
      else bodyNodes.push(node)
    }
  }
  return { html, head, body, headNodes, bodyNodes }
}

/** Serialize a full, standalone HTML document. Fragments get a minimal document shell. */
export function toDocument(root: HtmlRoot, options: { title?: string } = {}): string {
  const doctype = `<!${root.doctype || 'DOCTYPE html'}>\n`
  const parts = documentParts(root)
  if (parts.html && !parts.html.implied) {
    // Whitespace after </body> or </html> is parsed back into <body>: keep exactly one newline
    // there so serializing and parsing again is stable.
    let tree = root
    const last = parts.body?.children[parts.body.children.length - 1]
    if (parts.body && last?.type === 'text' && /\s$/.test(last.value)) {
      // An implied <body> gets the newline back from after </html>; an explicit one keeps one.
      const value = last.value.replace(/\s+$/, parts.body.implied ? '' : '\n')
      if (value !== last.value) tree = updateNode<HtmlText>(root, last.id, node => ({ ...node, value }))
    }
    // Frameset documents: whitespace after </html> lands on <html> itself.
    const trailing = parts.html.children[parts.html.children.length - 1]
    if (!parts.body && trailing?.type === 'text' && !/\S/.test(trailing.value)) {
      tree = updateNode<HtmlText>(tree, trailing.id, node => ({ ...node, value: '' }))
    }
    return doctype + toHTML(tree.children.filter(n => n.type !== 'text')).trim() + '\n'
  }
  const { headNodes, bodyNodes } = parts
  const hasTitle = headNodes.some(n => n.type === 'element' && n.name.toLowerCase() === 'title')
  const hasCharset = headNodes.some(n => n.type === 'element' && n.name.toLowerCase() === 'meta' && 'charset' in n.attributes)
  const head = [
    hasCharset ? '' : '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    hasTitle ? '' : `<title>${escapeText(options.title || 'Untitled')}</title>`,
    toHTML(headNodes).trim(),
  ].filter(Boolean)
  const htmlAttrs = parts.html ? serializeAttributes(parts.html.attributes) : ''
  const bodyAttrs = parts.body ? serializeAttributes(parts.body.attributes) : ''
  return `${doctype}<html${htmlAttrs}>\n<head>\n${head.join('\n')}\n</head>\n<body${bodyAttrs}>\n${toHTML(bodyNodes).trim()}\n</body>\n</html>\n`
}
