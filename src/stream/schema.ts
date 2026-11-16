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
  classes: string[]
  /** Attributes worth showing (href, src, alt, ...); not class or style. */
  attributes: Record<string, string>
  style: string
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
/** Attributes shown in the outline. Others are kept but not listed. */
const SHOWN_ATTRIBUTES = ['id', 'href', 'src', 'alt', 'type', 'name', 'placeholder', 'value', 'target', 'action', 'method', 'for']
const SIMPLE_CLASS = /^[\w-]+$/
const MAX_LABEL = 48
/** Blocks nested deeper than this are shown (and kept) as one leaf. */
const MAX_DEPTH = 200

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

export function kindOf(node: HtmlElement): SchemaKind {
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
  else if (lower === 'table') label = ''
  else label = textContent(node)
  label = label.replace(/\s+/g, ' ').trim()
  return label.length > MAX_LABEL ? label.slice(0, MAX_LABEL - 1) + '…' : label
}

function classesOf(node: HtmlElement) {
  const value = (node.attributes.class || '').trim()
  return value ? value.split(/\s+/) : []
}

function shapeOf(node: HtmlElement): string {
  const kids = structuralChildren(node).map(child => child.name.toLowerCase()).join(',')
  return `${node.name.toLowerCase()}.${classesOf(node).sort().join('.')}[${kids}]`
}

function shownAttributes(node: HtmlElement) {
  const out: Record<string, string> = {}
  for (const name of SHOWN_ATTRIBUTES) if (name in node.attributes) out[name] = node.attributes[name]
  return out
}

export function schemaNode(node: HtmlElement, depth = 0): SchemaNode {
  const kids = depth < MAX_DEPTH ? structuralChildren(node) : []
  const result: SchemaNode = {
    id: node.id,
    tag: node.name,
    kind: kindOf(node),
    classes: classesOf(node),
    attributes: shownAttributes(node),
    style: (node.attributes.style || '').trim(),
    label: labelOf(node),
    open: node.open,
    children: kids.map(kid => schemaNode(kid, depth + 1)),
  }
  if (kids.length >= 2) {
    const counts = new Map<string, number>()
    for (const kid of kids) {
      const shape = shapeOf(kid)
      counts.set(shape, (counts.get(shape) || 0) + 1)
    }
    let best = 0
    for (const count of counts.values()) best = Math.max(best, count)
    if (best >= 2 && best * 2 >= kids.length && result.kind !== 'text') {
      const sample = kids.find(kid => counts.get(shapeOf(kid)) === best)!
      const cls = classesOf(sample)[0]
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
    children: structuralChildren(content).map(node => schemaNode(node)),
  }
}

export const OUTLINE_HEADER = [
  '// structure.outline — generated by html2any',
  '// tag.class #id attr="value" { style } "text"',
  '// Move lines to reorder, indent to nest, delete to remove, copy to duplicate.',
  '// Edit the tag, classes, attributes, { style } or "text" in place. A line without',
  '// #id inserts a new element.',
]

/** A text view of the schema that can be edited and applied back with `applyOutline`. */
export function toOutline(schema: PageSchema, options: { header?: boolean } = {}): string {
  const lines: string[] = options.header === false ? [] : [...OUTLINE_HEADER, '']
  function visit(node: SchemaNode, depth: number) {
    const simple = node.classes.every(c => SIMPLE_CLASS.test(c))
    let line = '  '.repeat(depth) + node.tag
    if (simple) line += node.classes.map(c => `.${c}`).join('')
    line += ` #${node.id}`
    if (!simple) line += ` class=${JSON.stringify(node.classes.join(' '))}`
    for (const [name, value] of Object.entries(node.attributes)) line += ` ${name}=${JSON.stringify(value)}`
    if (node.style) line += ` { ${node.style} }`
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
  attributes: Record<string, string>
  style?: string
  text?: string
  children: OutlineItem[]
}

const HEAD = /^([a-zA-Z][\w:-]*)((?:\.[\w-]+)*)(?:\s+#([\w-]+))?(.*)$/

function readQuoted(source: string, start: number): { value: string; end: number } {
  let i = start + 1
  while (i < source.length && source[i] !== '"') i += source[i] === '\\' ? 2 : 1
  const raw = source.slice(start, Math.min(i + 1, source.length))
  try {
    return { value: JSON.parse(raw.endsWith('"') ? raw : raw + '"'), end: i + 1 }
  } catch {
    return { value: raw.slice(1, raw.endsWith('"') ? -1 : undefined), end: i + 1 }
  }
}

/** Parse the part of a line after `tag.class #id`: attributes, { style }, "text", [annotation]. */
function parseRest(rest: string) {
  const attributes: Record<string, string> = {}
  let style: string | undefined
  let text: string | undefined
  let i = 0
  while (i < rest.length) {
    const c = rest[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === '{') {
      const end = rest.indexOf('}', i)
      style = rest.slice(i + 1, end === -1 ? rest.length : end).trim()
      i = end === -1 ? rest.length : end + 1
    } else if (c === '[') {
      const end = rest.indexOf(']', i)
      i = end === -1 ? rest.length : end + 1
    } else if (c === '"') {
      const quoted = readQuoted(rest, i)
      text = quoted.value
      i = quoted.end
    } else {
      const match = /^[^\s="{[]+/.exec(rest.slice(i))
      if (!match) {
        i++
        continue
      }
      const name = match[0]
      i += name.length
      if (rest[i] === '=') {
        i++
        if (rest[i] === '"') {
          const quoted = readQuoted(rest, i)
          attributes[name] = quoted.value
          i = quoted.end
        } else {
          const value = /^[^\s{[]*/.exec(rest.slice(i))![0]
          attributes[name] = value
          i += value.length
        }
      } else {
        attributes[name] = ''
      }
    }
  }
  return { attributes, style, text }
}

export function parseOutline(text: string): { items: OutlineItem[]; errors: string[] } {
  const items: OutlineItem[] = []
  const errors: string[] = []
  const stack: { indent: number; item: OutlineItem | null }[] = [{ indent: -1, item: null }]
  text.split('\n').forEach((raw, index) => {
    const expanded = raw.replace(/\t/g, '  ')
    const content = expanded.trim()
    if (!content || content.startsWith('//')) return
    const indent = expanded.length - expanded.trimStart().length
    const match = HEAD.exec(content)
    if (!match) {
      errors.push(`line ${index + 1}: cannot read "${content}"`)
      return
    }
    const rest = parseRest(match[4])
    const item: OutlineItem = {
      line: index + 1,
      tag: match[1],
      classes: match[2] ? match[2].slice(1).split('.') : [],
      id: match[3],
      attributes: rest.attributes,
      style: rest.style,
      text: rest.text,
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

function normalizeClass(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).join(' ')
}

/** Apply the tag, classes, attributes, style and text written on a line to an element. */
function applyLine(base: HtmlElement, item: OutlineItem, createId: IdGenerator): HtmlElement {
  let node = base
  const attrs = { ...node.attributes }
  let changed = false
  const set = (name: string, value: string | null) => {
    if (value === null) {
      if (name in attrs) {
        delete attrs[name]
        changed = true
      }
    } else if (attrs[name] !== value) {
      attrs[name] = value
      changed = true
    }
  }

  const wantClass = normalizeClass('class' in item.attributes ? item.attributes.class : item.classes.join(' '))
  if (wantClass !== normalizeClass(attrs.class || '')) set('class', wantClass || null)

  for (const [name, value] of Object.entries(item.attributes)) {
    if (name !== 'class' && name !== 'style') set(name, value)
  }
  for (const name of SHOWN_ATTRIBUTES) {
    if (!(name in item.attributes)) set(name, null)
  }

  const wantStyle = (item.style ?? item.attributes.style ?? '').trim()
  if (wantStyle !== (attrs.style || '').trim()) set('style', wantStyle || null)

  if (changed) node = { ...node, attributes: attrs }
  if (item.tag !== node.name && item.tag.toLowerCase() !== node.name.toLowerCase()) node = { ...node, name: item.tag }

  // "text" edits plain-text elements; truncated labels are display only.
  if (item.text !== undefined && !item.text.endsWith('…') && node.children.every(child => child.type === 'text')) {
    if (item.text !== labelOf(node) && !LEAVES.has(node.name.toLowerCase())) {
      node = { ...node, children: item.text ? [{ type: 'text', id: createId(), value: item.text, open: false }] : [] }
    }
  }
  return node
}

/**
 * Apply an edited outline to the tree. Inline content (text, links inside paragraphs, scripts,
 * styles...) always stays attached to its block; only structural blocks are moved, removed,
 * renamed, duplicated or created, and their attributes, style and plain text updated.
 */
export function applyOutline(root: HtmlRoot, outline: string, createId: IdGenerator): { root: HtmlRoot; errors: string[] } {
  const { items, errors } = parseOutline(outline)
  const content = getContentRoot(root)
  const index = new Map<string, HtmlElement>()
  const depthOf = new Map<string, number>()
  const pending: [HtmlParent, number][] = [[content, -1]]
  while (pending.length) {
    const [parent, depth] = pending.pop()!
    if (depth >= MAX_DEPTH) continue
    for (const child of structuralChildren(parent)) {
      index.set(child.id, child)
      depthOf.set(child.id, depth + 1)
      pending.push([child, depth + 1])
    }
  }

  const used = new Set<string>()

  function fillSlots(base: HtmlParent, blocks: HtmlElement[]): HtmlNode[] {
    const out: HtmlNode[] = []
    let k = 0
    for (const child of base.children) {
      if (isStructural(child, base)) {
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
      if (item.children.length === 0) return applyLine(base, item, createId)
    } else {
      base = { type: 'element', id: createId(), name: item.tag, attributes: {}, children: [], open: false }
    }
    base = applyLine(base, item, createId)
    // Leaves and blocks below the depth limit keep their content untouched.
    if (LEAVES.has(base.name.toLowerCase()) || (existing && (depthOf.get(existing.id) ?? 0) >= MAX_DEPTH)) return base
    const blocks = item.children.map(build)
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
