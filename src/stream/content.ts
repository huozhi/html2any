/**
 * Content model: split a page into a template (the tree) and its content (typed JSON fields).
 *
 *   const { schema, data } = content(tree)
 *   const next = fill(tree, { ...data, hero: { ...data.hero, title: 'New title' } })
 *
 * Extraction is deterministic and works on the block structure from `inferSchema`: plain-text
 * blocks become `text`, blocks with inline markup `richtext`, links `link`, images `image`,
 * repeated siblings (cards, tiers, list items) become lists, and single-field wrappers collapse.
 * `fill(tree, content(tree).data)` returns the same tree.
 */
import { parseHTML } from './parser'
import { getContentRoot, inferSchema, schemaNode, type SchemaNode } from './schema'
import { documentParts, toHTML } from './serialize'
import { cloneNode, createIdGenerator, findPath, removeNode, setAttribute, textContent, updateNode, walk, type IdGenerator } from './tree'
import type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot, HtmlText } from './types'

export type FieldType = 'text' | 'richtext' | 'link' | 'image'
export type ContentSchema = FieldType | ContentSchema[] | { [key: string]: ContentSchema }
export type LinkValue = { label: string; href: string }
export type ImageValue = { src: string; alt: string }
export type ContentValue = string | LinkValue | ImageValue | ContentValue[] | { [key: string]: ContentValue }
export type ContentData = { [key: string]: ContentValue }

type Binding =
  | { kind: 'text' | 'richtext'; id: string }
  | { kind: 'link'; id: string; rich: boolean }
  | { kind: 'image'; id: string }
  | { kind: 'object'; fields: Map<string, Binding> }
  | { kind: 'list'; items: { id: string; binding: Binding }[] }

type Extracted = { binding: Binding; name: string; meaningful: boolean }

// Class names that describe layout, not content.
const LAYOUT_CLASS = /^(wrap|wrapper|container|inner|outer|content|contents|row|col|cols|column|columns|grid|flex|stack|section|block|box|main|page|body|layout|clearfix|group|area|holder|panel|items|list)$/i
const UTILITY_CLASS = /[:/[\]]|^-?(p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|min|max|text|bg|flex|grid|gap|items|justify|rounded|shadow|border|font|leading|tracking|space|col|row|top|left|right|bottom|z|opacity|overflow|inset|order|self|place|content|object|aspect|ring|divide|transition|duration|ease|sm|md|lg|xl|hover|focus)-/
const SKIP = new Set(['svg', 'math', 'video', 'audio', 'iframe', 'canvas', 'input', 'textarea', 'select', 'object', 'embed', 'br', 'hr', 'script', 'style', 'template'])
// Landmark elements name their content even without an id or class.
const LANDMARKS = new Set(['header', 'footer', 'nav', 'aside', 'form'])
const ROLE_NAMES: Record<string, string> = {
  h1: 'title', h2: 'title', h3: 'title', h4: 'title', h5: 'title', h6: 'title', p: 'text', blockquote: 'quote',
  cite: 'cite', img: 'image', picture: 'image', ul: 'items', ol: 'items', dl: 'items', li: 'item', span: 'label',
  small: 'note', strong: 'label', b: 'label', em: 'label', label: 'label', header: 'header', footer: 'footer',
  nav: 'nav', section: 'section', article: 'article', aside: 'aside', main: 'main', form: 'form', button: 'button',
  pre: 'code', code: 'code', table: 'table', figure: 'figure', figcaption: 'caption', summary: 'question',
  details: 'item', time: 'time', address: 'address',
}

function camel(value: string) {
  const words = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  return words.map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1))).join('')
}

function meaningfulClass(classes: string[], parentClasses: string[]) {
  for (const cls of classes) {
    if (LAYOUT_CLASS.test(cls) || UTILITY_CLASS.test(cls)) continue
    // `tier-note` inside `.tier` is just `note`.
    let name = cls
    for (const parent of parentClasses) {
      if (name.startsWith(parent + '-') && name.length > parent.length + 1) name = name.slice(parent.length + 1)
    }
    if (/^(btn|button)(-|$)/.test(name)) continue
    const key = camel(name)
    if (key) return key
  }
  return ''
}

function nameOf(node: SchemaNode, parent: SchemaNode | null): { name: string; meaningful: boolean } {
  const id = node.attributes.id
  if (id && camel(id)) return { name: camel(id), meaningful: true }
  const cls = meaningfulClass(node.classes, parent?.classes ?? [])
  if (cls) return { name: cls, meaningful: true }
  const lower = node.tag.toLowerCase()
  if (LANDMARKS.has(lower)) return { name: lower, meaningful: true }
  if (node.kind === 'button') return { name: 'cta', meaningful: false }
  if (lower === 'a') return { name: 'link', meaningful: false }
  return { name: ROLE_NAMES[lower] ?? 'block', meaningful: false }
}

/** Plain text only when every child is a text node; anything else (inline tags, comments) is rich. */
function hasInlineElements(el: HtmlElement) {
  return el.children.some(child => child.type !== 'text')
}

function plural(name: string) {
  return name.endsWith('s') ? name : name + 's'
}

function unique(fields: Map<string, unknown>, name: string) {
  if (!fields.has(name)) return name
  let k = 2
  while (fields.has(name + k)) k++
  return name + k
}

class Extractor {
  constructor(private elements: Map<string, HtmlElement>) {}

  leaf(node: SchemaNode, el: HtmlElement): Binding | null {
    const lower = el.name.toLowerCase()
    if (SKIP.has(lower) || el.namespace) return null
    if (lower === 'img') return el.attributes.src !== undefined ? { kind: 'image', id: el.id } : null
    if (lower === 'picture') {
      let img: HtmlElement | undefined
      walk(el, child => {
        if (!img && child.type === 'element' && child.name === 'img') img = child
      })
      return img ? { kind: 'image', id: img.id } : null
    }
    if (!/\S/.test(textContent(el))) return null
    if (lower === 'a') return { kind: 'link', id: el.id, rich: hasInlineElements(el) }
    return { kind: hasInlineElements(el) ? 'richtext' : 'text', id: el.id }
  }

  extract(node: SchemaNode, parent: SchemaNode | null): Extracted | null {
    const el = this.elements.get(node.id)
    if (!el) return null
    const naming = nameOf(node, parent)

    if (node.children.length === 0) {
      const binding = this.leaf(node, el)
      return binding ? { binding, ...naming } : null
    }

    // Repeated children become a list; anything else next to them stays a named field.
    const collection = node.collection
    const isItem = (child: SchemaNode) => {
      // Page sections are distinct content even when they look alike.
      if (!collection || child.kind === 'section') return false
      const cls = child.classes[0]
      return collection.item === child.tag + (cls ? `.${cls}` : '')
    }
    const items: { id: string; binding: Binding }[] = []
    const fields = new Map<string, Binding>()
    const meaningfulFields = new Set<string>()
    let listName = ''
    for (const child of node.children) {
      const extracted = this.extract(child, node)
      if (!extracted) continue
      if (isItem(child)) {
        items.push({ id: child.id, binding: extracted.binding })
        if (!listName) listName = extracted.meaningful ? plural(extracted.name) : 'items'
        continue
      }
      // A wrapper without a name of its own (main, .wrap) contributes its fields directly.
      if (extracted.binding.kind === 'object' && !extracted.meaningful) {
        for (const [key, value] of extracted.binding.fields) fields.set(unique(fields, key), value)
        continue
      }
      const key = unique(fields, extracted.name)
      fields.set(key, extracted.binding)
      if (extracted.meaningful) meaningfulFields.add(key)
    }

    // Several links (or images) side by side are a list even if their classes differ.
    if (!items.length && fields.size >= 2) {
      const bindings = [...fields.values()]
      const kind = bindings[0].kind
      if ((kind === 'link' || kind === 'image') && bindings.every(b => b.kind === kind) && meaningfulFields.size === 0) {
        for (const binding of bindings) items.push({ id: (binding as { id: string }).id, binding })
        fields.clear()
        listName = kind === 'link' ? 'links' : 'images'
      }
    }

    if (items.length) {
      const list: Binding = { kind: 'list', items }
      if (!fields.size) {
        return naming.meaningful ? { binding: list, ...naming } : { binding: list, name: listName, meaningful: listName !== 'items' }
      }
      fields.set(unique(fields, listName), list)
    }
    if (!fields.size) {
      const binding = this.leaf(node, el)
      return binding ? { binding, ...naming } : null
    }
    // A single field collapses into its parent: `div.wrap > div.cta` is just `cta`.
    if (fields.size === 1) {
      const [[key, binding]] = [...fields]
      if (naming.meaningful) return { binding, ...naming }
      return { binding, name: key, meaningful: meaningfulFields.has(key) }
    }
    return { binding: { kind: 'object', fields }, ...naming }
  }
}

function elementsById(root: HtmlRoot | HtmlElement) {
  const elements = new Map<string, HtmlElement>()
  if (root.type === 'element') elements.set(root.id, root)
  walk(root, node => {
    if (node.type === 'element') elements.set(node.id, node)
  })
  return elements
}

function bind(root: HtmlRoot): Binding {
  const page = inferSchema(root)
  const extractor = new Extractor(elementsById(root))
  const contentRoot = getContentRoot(root)
  const pseudo: SchemaNode = {
    id: contentRoot.id, tag: contentRoot.type === 'root' ? 'root' : contentRoot.name, kind: 'container', classes: [],
    attributes: {}, style: '', label: '', open: false, children: page.children,
  }
  const fields = new Map<string, Binding>()
  for (const child of page.children) {
    const extracted = extractor.extract(child, pseudo)
    if (!extracted) continue
    if (extracted.binding.kind === 'object' && !extracted.meaningful) {
      for (const [key, value] of extracted.binding.fields) fields.set(unique(fields, key), value)
    } else {
      fields.set(unique(fields, extracted.name), extracted.binding)
    }
  }
  return { kind: 'object', fields }
}

function element(root: HtmlRoot, id: string) {
  const path = findPath(root, id)
  const node = path?.[path.length - 1].node
  return node && node.type === 'element' ? node : undefined
}

type Lookup = (id: string) => HtmlElement | undefined

function read(lookup: Lookup, binding: Binding): { schema: ContentSchema; value: ContentValue } {
  switch (binding.kind) {
    case 'text': {
      const el = lookup(binding.id)!
      return { schema: 'text', value: textContent(el) }
    }
    case 'richtext':
      return { schema: 'richtext', value: toHTML(lookup(binding.id)!.children) }
    case 'link': {
      const el = lookup(binding.id)!
      return { schema: 'link', value: { label: binding.rich ? toHTML(el.children) : textContent(el), href: el.attributes.href ?? '' } }
    }
    case 'image': {
      const el = lookup(binding.id)!
      return { schema: 'image', value: { src: el.attributes.src ?? '', alt: el.attributes.alt ?? '' } }
    }
    case 'object': {
      const schema: { [key: string]: ContentSchema } = {}
      const value: { [key: string]: ContentValue } = {}
      for (const [key, field] of binding.fields) {
        const result = read(lookup, field)
        schema[key] = result.schema
        value[key] = result.value
      }
      return { schema, value }
    }
    case 'list': {
      const values: ContentValue[] = []
      let itemSchema: ContentSchema = 'text'
      binding.items.forEach((item, index) => {
        const result = read(lookup, item.binding)
        values.push(result.value)
        itemSchema = index === 0 ? result.schema : mergeSchema(itemSchema, result.schema)
      })
      return { schema: [itemSchema], value: values }
    }
  }
}

function mergeSchema(a: ContentSchema, b: ContentSchema): ContentSchema {
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    return { ...b, ...a }
  }
  if (a === 'text' && b === 'richtext') return 'richtext'
  return a
}

/** Extract the content model of a page: field types and the current content as JSON. */
export function extractContent(root: HtmlRoot): { schema: { [key: string]: ContentSchema }; data: ContentData } {
  const elements = elementsById(root)
  const result = read(id => elements.get(id), bind(root))
  return { schema: result.schema as { [key: string]: ContentSchema }, data: result.value as ContentData }
}

function setText(root: HtmlRoot, id: string, value: string, createId: IdGenerator): HtmlRoot {
  return updateNode<HtmlElement>(root, id, node => {
    if (node.children.every(child => child.type === 'text') && textContent(node) === value) return node
    const children: HtmlNode[] = value ? [{ type: 'text', id: createId(), value, open: false } as HtmlText] : []
    return { ...node, children }
  })
}

function setInner(root: HtmlRoot, id: string, value: string, createId: IdGenerator): HtmlRoot {
  return updateNode<HtmlElement>(root, id, node => {
    if (toHTML(node.children) === value) return node
    const parts = documentParts(parseHTML(value, { createId, stripCodeFence: false }))
    return { ...node, children: [...parts.headNodes, ...parts.bodyNodes] }
  })
}

/** Set an attribute unless it already has that value; a missing attribute reads as ''. */
function setField(root: HtmlRoot, id: string, name: string, value: string): HtmlRoot {
  const el = element(root, id)
  if (!el || (el.attributes[name] ?? '') === value) return root
  return setAttribute(root, id, name, value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Remove a list item together with the whitespace that separated it from its predecessor. */
function removeItem(root: HtmlRoot, id: string): HtmlRoot {
  const path = findPath(root, id)
  if (!path || path.length < 2) return root
  const parent = path[path.length - 2].node as HtmlParent
  const index = path[path.length - 1].index
  const previous = parent.children[index - 1]
  let next = removeNode(root, id)
  if (previous?.type === 'text' && !/\S/.test(previous.value) && index > 1) next = removeNode(next, previous.id)
  return next
}

/** Insert copies of the last item after it, keeping the whitespace pattern between items. */
function appendItems(root: HtmlRoot, lastId: string, count: number, createId: IdGenerator): { root: HtmlRoot; ids: string[] } {
  const path = findPath(root, lastId)
  if (!path || path.length < 2) return { root, ids: [] }
  const parent = path[path.length - 2].node as HtmlParent
  const index = path[path.length - 1].index
  const last = parent.children[index] as HtmlElement
  const gap = parent.children[index - 1]
  const separator = gap?.type === 'text' && !/\S/.test(gap.value) ? gap.value : ''
  const added: HtmlNode[] = []
  const ids: string[] = []
  for (let k = 0; k < count; k++) {
    if (separator) added.push({ type: 'text', id: createId(), value: separator, open: false })
    const copy = cloneNode(last, createId)
    added.push(copy)
    ids.push(copy.id)
  }
  const next = updateNode<HtmlParent>(root, parent.id, node => {
    const children = node.children.slice()
    children.splice(index + 1, 0, ...added)
    return { ...node, children } as HtmlParent
  })
  return { root: next, ids }
}

/** Bindings for a freshly cloned list item, built the same way as for the original. */
function bindItem(root: HtmlRoot, id: string): Binding | null {
  const el = element(root, id)
  if (!el) return null
  const extractor = new Extractor(elementsById(el))
  return extractor.extract(schemaNode(el), null)?.binding ?? null
}

/** Whether a field already holds `value` (checked on the original nodes, before any path copy). */
function unchanged(original: Lookup, binding: Binding, value: unknown): boolean {
  if (binding.kind === 'object' || binding.kind === 'list') return false
  const el = original(binding.id)
  if (!el) return false
  switch (binding.kind) {
    case 'text':
      return typeof value === 'string' && el.children.every(c => c.type === 'text') && textContent(el) === value
    case 'richtext':
      return typeof value === 'string' && toHTML(el.children) === value
    case 'image':
      if (!isRecord(value)) return true
      return (value.src === undefined || (el.attributes.src ?? '') === value.src) &&
        (value.alt === undefined || (el.attributes.alt ?? '') === value.alt)
    case 'link': {
      if (!isRecord(value)) return true
      const plain = el.children.every(c => c.type === 'text')
      const label = binding.rich ? toHTML(el.children) : textContent(el)
      return (value.label === undefined || (label === value.label && (binding.rich || plain))) &&
        (value.href === undefined || (el.attributes.href ?? '') === value.href)
    }
  }
}

function write(root: HtmlRoot, binding: Binding, value: unknown, createId: IdGenerator, original: Lookup): HtmlRoot {
  if (unchanged(original, binding, value)) return root
  switch (binding.kind) {
    case 'text':
      return typeof value === 'string' ? setText(root, binding.id, value, createId) : root
    case 'richtext':
      return typeof value === 'string' ? setInner(root, binding.id, value, createId) : root
    case 'link': {
      if (!isRecord(value)) return root
      let next = root
      if (typeof value.label === 'string') {
        next = binding.rich ? setInner(next, binding.id, value.label, createId) : setText(next, binding.id, value.label, createId)
      }
      if (typeof value.href === 'string') next = setField(next, binding.id, 'href', value.href)
      return next
    }
    case 'image': {
      if (!isRecord(value)) return root
      let next = root
      if (typeof value.src === 'string') next = setField(next, binding.id, 'src', value.src)
      if (typeof value.alt === 'string') next = setField(next, binding.id, 'alt', value.alt)
      return next
    }
    case 'object': {
      if (!isRecord(value)) return root
      let next = root
      for (const [key, field] of binding.fields) {
        if (key in value) next = write(next, field, value[key], createId, original)
      }
      return next
    }
    case 'list': {
      if (!Array.isArray(value)) return root
      let next = root
      const items = binding.items.slice()
      // Fewer items: drop the extra ones from the end.
      while (items.length > value.length) next = removeItem(next, items.pop()!.id)
      // More items: copy the last one as a template, then fill the copies.
      if (value.length > items.length && items.length) {
        const added = appendItems(next, items[items.length - 1].id, value.length - items.length, createId)
        next = added.root
        for (const id of added.ids) {
          const itemBinding = bindItem(next, id)
          if (itemBinding) items.push({ id, binding: itemBinding })
        }
      }
      items.forEach((item, index) => {
        if (index < value.length) next = write(next, item.binding, value[index], createId, original)
      })
      return next
    }
  }
}

/** Write content back into the page. Unchanged fields leave their subtrees untouched. */
export function fillContent(root: HtmlRoot, data: ContentData): HtmlRoot {
  const elements = elementsById(root)
  return write(root, bind(root), data, createIdGenerator(root), id => elements.get(id))
}
