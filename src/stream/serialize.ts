import { escapeAttribute, escapeText } from './entities'
import { HEAD_ELEMENTS, RAW_TEXT_ELEMENTS, RCDATA_ELEMENTS, VOID_ELEMENTS } from './elements'
import type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot } from './types'

function serializeAttributes(attrs: Record<string, string>) {
  let out = ''
  for (const name in attrs) {
    const value = attrs[name]
    out += value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`
  }
  return out
}

function serializeNode(node: HtmlNode, foreign: boolean, raw: boolean): string {
  if (node.type === 'text') return raw ? node.value : escapeText(node.value)
  const lower = node.name.toLowerCase()
  const inForeign = (foreign || lower === 'svg' || lower === 'math') && lower !== 'foreignobject'
  const open = `<${node.name}${serializeAttributes(node.attributes)}`
  if (!inForeign && VOID_ELEMENTS.has(lower)) return `${open}>`
  if (inForeign && node.children.length === 0) return `${open}/>`
  const rawChildren = RAW_TEXT_ELEMENTS.has(lower) && !RCDATA_ELEMENTS.has(lower)
  let inner = ''
  for (const child of node.children) inner += serializeNode(child, inForeign, rawChildren)
  return `${open}>${inner}</${node.name}>`
}

/** Serialize nodes back to HTML. Whitespace and attribute order are preserved. */
export function toHTML(input: HtmlNode | HtmlParent | HtmlNode[]): string {
  if (Array.isArray(input)) return input.map(node => serializeNode(node, false, false)).join('')
  if (input.type === 'root') return toHTML(input.children)
  return serializeNode(input, false, false)
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

/** Split a parsed tree into head and body content, with or without explicit wrappers. */
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
      if (!head && node.type === 'element' && HEAD_ELEMENTS.has(node.name.toLowerCase())) {
        headNodes.push(node)
      } else {
        bodyNodes.push(node)
      }
    }
  }
  return { html, head, body, headNodes, bodyNodes }
}

/** Serialize a full, standalone HTML document. Fragments get a minimal document shell. */
export function toDocument(root: HtmlRoot, options: { title?: string } = {}): string {
  const doctype = `<!${root.doctype || 'DOCTYPE html'}>\n`
  if (findElement(root.children, 'html')) {
    return doctype + toHTML(root.children).trim() + '\n'
  }
  const { headNodes, bodyNodes } = documentParts(root)
  const hasTitle = headNodes.some(n => n.type === 'element' && n.name.toLowerCase() === 'title')
  const hasCharset = headNodes.some(n => n.type === 'element' && n.name.toLowerCase() === 'meta' && 'charset' in n.attributes)
  const head = [
    hasCharset ? '' : '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    hasTitle ? '' : `<title>${escapeText(options.title || 'Untitled')}</title>`,
    toHTML(headNodes).trim(),
  ].filter(Boolean)
  return `${doctype}<html>\n<head>\n${head.join('\n')}\n</head>\n<body>\n${toHTML(bodyNodes).trim()}\n</body>\n</html>\n`
}
