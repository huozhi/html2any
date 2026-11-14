import { HEADINGS, PHRASING_ELEMENTS } from './elements'
import { documentParts } from './serialize'
import { cloneNode, textContent, updateNode, type IdGenerator } from './tree'
import type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot } from './types'

export type SchemaKind =
  | 'section' | 'container' | 'heading' | 'text' | 'list' | 'item' | 'link' | 'button'
  | 'image' | 'media' | 'form' | 'field' | 'code' | 'table' | 'quote' | 'details'

export type SchemaNode = {
  id: string
  tag: string
  kind: SchemaKind
  className?: string
  label: string
  /** Set when most children share one shape (cards, pricing tiers, list items...). */
  collection?: { count: number; item: string }
  open: boolean
  children: SchemaNode[]
}

export type PageSchema = {
  title: string
  contentRoot: string
  children: SchemaNode[]
}

const HIDDEN = new Set(['html', 'body', 'script', 'style', 'link', 'meta', 'title', 'base', 'head', 'template', 'noscript', 'br', 'wbr'])
// Shown as a single line; their insides are not part of the page structure.
const LEAVES = new Set(['svg', 'math', 'img', 'picture', 'video', 'audio', 'iframe', 'canvas', 'input', 'textarea', 'select', 'pre', 'table', 'object', 'embed'])
const SECTIONS = new Set(['section', 'header', 'footer', 'nav', 'main', 'article', 'aside'])
const TEXTS = new Set(['p', 'span', 'small', 'strong', 'em', 'b', 'i', 'label', 'figcaption', 'dt', 'dd', 'summary', 'cite', 'time'])

function hasDirectText(node: HtmlParent) {
  return node.children.some(child => child.type === 'text' && /\S/.test(child.value))
}

/** Whether an element child is a block in the page structure (vs. inline text content). */
export function isStructural(node: HtmlNode, parent: HtmlParent): node is HtmlElement {
  if (node.type !== 'element') return false
  const lower = node.name.toLowerCase()
  if (HIDDEN.has(lower)) return false
  if (parent.type === 'element' && LEAVES.has(parent.name.toLowerCase())) return false
  if (PHRASING_ELEMENTS.has(lower) && hasDirectText(parent)) return false
  return true
}

export function structuralChildren(parent: HtmlParent): HtmlElement[] {
  if (parent.type === 'element' && LEAVES.has(parent.name.toLowerCase())) return []
  return parent.children.filter((child): child is HtmlElement => isStructural(child, parent))
}

export function getContentRoot(root: HtmlRoot): HtmlParent {
  const parts = documentParts(root)
  // While <head> is still streaming there is no <body> yet: the page has no blocks so far.
  return parts.body ?? parts.html ?? root
}

function kindOf(node: HtmlElement): SchemaKind {
  const lower = node.name.toLowerCase()
  if (HEADINGS.has(lower)) return 'heading'
  if (SECTIONS.has(lower)) return 'section'
  if (lower === 'ul' || lower === 'ol' || lower === 'dl' || lower === 'menu') return 'list'
  if (lower === 'li') return 'item'
  if (lower === 'button' || (lower === 'a' && /\b(btn|button|cta)\b/i.test(node.attributes.class || ''))) return 'button'
  if (lower === 'a') return 'link'
  if (lower === 'img' || lower === 'picture' || lower === 'svg') return 'image'
  if (lower === 'video' || lower === 'audio' || lower === 'iframe' || lower === 'canvas') return 'media'
  if (lower === 'form') return 'form'
  if (lower === 'input' || lower === 'textarea' || lower === 'select') return 'field'
  if (lower === 'pre' || lower === 'code') return 'code'
  if (lower === 'table') return 'table'
  if (lower === 'blockquote') return 'quote'
  if (lower === 'details') return 'details'
  if (TEXTS.has(lower) || hasDirectText(node)) return 'text'
  return 'container'
}

function labelOf(node: HtmlElement): string {
  const lower = node.name.toLowerCase()
  const attrs = node.attributes
  let label = ''
  if (lower === 'img') label = attrs.alt || (attrs.src || '').split(/[?#]/)[0].split('/').pop() || ''
  else if (lower === 'input' || lower === 'textarea' || lower === 'select') label = attrs.placeholder || attrs.name || attrs.type || ''
  else if (lower === 'svg') label = attrs['aria-label'] || ''
  else if (lower === 'table') {
    const rows = textContent(node).trim() ? node.children : []
    label = rows.length ? 'table' : ''
  } else label = textContent(node)
  label = label.replace(/\s+/g, ' ').trim()
  return label.length > 48 ? label.slice(0, 47) + '…' : label
}

function firstClass(node: HtmlElement) {
  const value = (node.attributes.class || '').trim()
  return value ? value.split(/\s+/)[0] : undefined
}

function shapeOf(node: HtmlElement, parent: HtmlParent): string {
  const kids = structuralChildren(node).map(child => child.name.toLowerCase()).join(',')
  return `${node.name.toLowerCase()}.${(node.attributes.class || '').trim().split(/\s+/).sort().join('.')}[${kids}]`
}

function schemaNode(node: HtmlElement, parent: HtmlParent): SchemaNode {
  const kids = structuralChildren(node)
  const result: SchemaNode = {
    id: node.id,
    tag: node.name,
    kind: kindOf(node),
    className: firstClass(node),
    label: labelOf(node),
    open: node.open,
    children: kids.map(child => schemaNode(child, node)),
  }
  if (kids.length >= 2) {
    const counts = new Map<string, number>()
    for (const kid of kids) {
      const shape = shapeOf(kid, node)
      counts.set(shape, (counts.get(shape) || 0) + 1)
    }
    let best = 0
    for (const count of counts.values()) best = Math.max(best, count)
    if (best >= 2 && best * 2 >= kids.length && kindOf(node) !== 'text') {
      const sample = kids.find(kid => counts.get(shapeOf(kid, node)) === best)!
      const cls = firstClass(sample)
      result.collection = { count: best, item: sample.name + (cls ? `.${cls}` : '') }
    }
  }
  return result
}

/** Infer the page structure: sections, blocks, repeated collections and editable leaves. */
export function inferSchema(root: HtmlRoot): PageSchema {
  const parts = documentParts(root)
  const content = getContentRoot(root)
  const title = parts.headNodes.find(n => n.type === 'element' && n.name.toLowerCase() === 'title')
  return {
    title: title ? textContent(title).trim() : '',
    contentRoot: content.id,
    children: structuralChildren(content).map(child => schemaNode(child, content)),
  }
}

export const OUTLINE_HEADER = [
  '// structure.outline — generated by html2any',
  '// Move lines to reorder, indent to nest, delete a line to remove it,',
  '// duplicate a line (with its children) to copy, change the tag to rename,',
  '// or add `tag.class "text"` (without #id) to insert a new element.',
]

/** A text view of the schema that can be edited and applied back with `applyOutline`. */
export function toOutline(schema: PageSchema, options: { header?: boolean } = {}): string {
  const lines: string[] = options.header === false ? [] : [...OUTLINE_HEADER, '']
  function visit(node: SchemaNode, depth: number) {
    const selector = node.tag + (node.className ? `.${node.className}` : '')
    let line = `${'  '.repeat(depth)}${selector} #${node.id}`
    if (node.collection) line += `  [${node.collection.count} × ${node.collection.item}]`
    else if (node.label && node.children.length === 0) line += `  ${JSON.stringify(node.label)}`
    lines.push(line)
    for (const child of node.children) visit(child, depth + 1)
  }
  for (const node of schema.children) visit(node, 0)
  return lines.join('\n') + '\n'
}

type OutlineItem = {
  line: number
  tag: string
  classes: string[]
  id?: string
  text?: string
  children: OutlineItem[]
}

const LINE = /^([a-zA-Z][\w:-]*)((?:\.[\w-]+)*)(?:\s+#([\w-]+))?(.*)$/

export function parseOutline(text: string): { items: OutlineItem[]; errors: string[] } {
  const items: OutlineItem[] = []
  const errors: string[] = []
  const stack: { indent: number; item: OutlineItem | null }[] = [{ indent: -1, item: null }]
  text.split('\n').forEach((raw, index) => {
    const expanded = raw.replace(/\t/g, '  ')
    const content = expanded.trim()
    if (!content || content.startsWith('//')) return
    const indent = expanded.length - expanded.trimStart().length
    const match = LINE.exec(content)
    if (!match) {
      errors.push(`line ${index + 1}: cannot read "${content}"`)
      return
    }
    let text: string | undefined
    const quoted = /"(?:[^"\\]|\\.)*"/.exec(match[4])
    if (quoted) {
      try {
        text = JSON.parse(quoted[0])
      } catch {
        text = quoted[0].slice(1, -1)
      }
    }
    const item: OutlineItem = {
      line: index + 1,
      tag: match[1],
      classes: match[2] ? match[2].slice(1).split('.') : [],
      id: match[3],
      text,
      children: [],
    }
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1].item
    if (parent) parent.children.push(item)
    else items.push(item)
    stack.push({ indent, item })
  })
  return { items, errors }
}

/**
 * Apply an edited outline to the tree. Inline content (text, links inside paragraphs, scripts,
 * styles...) always stays attached to its block; only structural blocks are moved, removed,
 * renamed, duplicated or created.
 */
export function applyOutline(root: HtmlRoot, outline: string, createId: IdGenerator): { root: HtmlRoot; errors: string[] } {
  const { items, errors } = parseOutline(outline)
  const content = getContentRoot(root)
  const index = new Map<string, HtmlElement>()
  ;(function collect(parent: HtmlParent) {
    for (const child of structuralChildren(parent)) {
      index.set(child.id, child)
      collect(child)
    }
  })(content)

  const used = new Set<string>()

  function fillSlots(base: HtmlParent, blocks: HtmlElement[]): HtmlNode[] {
    const out: HtmlNode[] = []
    let k = 0
    for (const child of base.children) {
      if (isStructural(child, base) && !(base.type === 'element' && LEAVES.has(base.name.toLowerCase()))) {
        if (k < blocks.length) out.push(blocks[k++])
      } else {
        out.push(child)
      }
    }
    while (k < blocks.length) out.push(blocks[k++])
    return out
  }

  function build(item: OutlineItem): HtmlElement {
    const existing = item.id ? index.get(item.id) : undefined
    if (item.id && !existing) errors.push(`line ${item.line}: #${item.id} is not in the page, created a new <${item.tag}>`)
    let base: HtmlElement
    if (existing && !used.has(existing.id)) {
      used.add(existing.id)
      base = existing
    } else if (existing) {
      base = cloneNode(existing, createId)
      // A copied line without child lines keeps the whole copied subtree.
      if (item.children.length === 0) return item.tag === existing.name ? base : { ...base, name: item.tag }
    } else {
      base = {
        type: 'element',
        id: createId(),
        name: item.tag,
        attributes: item.classes.length ? { class: item.classes.join(' ') } : {},
        children: item.text ? [{ type: 'text', id: createId(), value: item.text, open: false }] : [],
        open: false,
      }
    }
    if (item.tag !== base.name && item.tag.toLowerCase() !== base.name.toLowerCase()) base = { ...base, name: item.tag }
    const blocks = item.children.map(build)
    if (LEAVES.has(base.name.toLowerCase())) return base
    const children = fillSlots(base, blocks)
    const same = children.length === base.children.length && children.every((c, i) => c === base.children[i])
    return same ? base : { ...base, children }
  }

  const blocks = items.map(build)
  const nextChildren = fillSlots(content, blocks)
  const same = nextChildren.length === content.children.length && nextChildren.every((c, i) => c === content.children[i])
  if (same) return { root, errors }
  return {
    root: updateNode<HtmlParent>(root, content.id, node => ({ ...node, children: nextChildren }) as HtmlParent),
    errors,
  }
}
