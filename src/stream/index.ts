/**
 * html2any/stream — parse HTML as it streams, read its structure, edit it, write it back.
 *
 * Everything works on one immutable tree (`HtmlRoot`). Nodes have stable `id`s, an `open`
 * flag while content may still arrive, and unchanged subtrees keep their identity across
 * writes and edits.
 */
import { createStreamParser, parseHTML } from './parser'
import { applyOutline, inferSchema, toOutline, type PageSchema } from './schema'
import { toDocument, toHTML } from './serialize'
import {
  createIdGenerator, duplicateNode, findPath, moveSibling, removeNode, setAttribute, textContent,
  updateNode,
} from './tree'
import type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot } from './types'

export type { HtmlElement, HtmlNode, HtmlRoot, HtmlText } from './types'
export type { SchemaKind, SchemaNode } from './schema'
export type Schema = PageSchema

export type Stream = {
  /** Feed a chunk. Never throws; returns a tree that is safe to render. */
  write(chunk: string): HtmlRoot
  /** Feed the last chunk (optional), close every open node and return the final tree. */
  end(chunk?: string): HtmlRoot
  /** The latest tree. */
  readonly tree: HtmlRoot
}

/**
 * Incremental, fault-tolerant parser.
 *
 *   const s = stream()
 *   for await (const chunk of response) render(s.write(chunk))
 *   const tree = s.end()
 *
 * One-shot: `stream().end(html)`.
 * `fence` (default true) strips a ```html fence around LLM output.
 */
export function stream(options: { fence?: boolean } = {}): Stream {
  const parser = createStreamParser({ stripCodeFence: options.fence !== false })
  return {
    write: chunk => parser.write(chunk),
    end: chunk => {
      if (chunk) parser.write(chunk)
      return parser.end()
    },
    get tree() {
      return parser.snapshot()
    },
  }
}

/** Serialize back to HTML. With `{ document: true }`, a full standalone document. */
export function html(node: HtmlRoot | HtmlNode | HtmlNode[], options: { document?: boolean; title?: string } = {}) {
  if (options.document && !Array.isArray(node) && node.type === 'root') return toDocument(node, options)
  return toHTML(node)
}

/** Text content, without scripts and styles. */
export function text(node: HtmlRoot | HtmlNode) {
  return textContent(node)
}

/** The page's block structure: sections, headings, text, lists, media, repeated collections. */
export function schema(root: HtmlRoot): Schema {
  return inferSchema(root)
}

/** The block structure as an editable text file. Edit it and pass it to `apply`. */
export function outline(root: HtmlRoot, options: { header?: boolean } = {}) {
  return toOutline(inferSchema(root), options)
}

/** Apply an edited outline: move, nest, remove, duplicate, rename or insert blocks. */
export function apply(root: HtmlRoot, outlineText: string) {
  return applyOutline(root, outlineText, createIdGenerator(root))
}

/** The node with `id`. */
export function find(root: HtmlRoot, id: string): HtmlNode | undefined {
  const entries = findPath(root, id)
  const node = entries?.[entries.length - 1].node
  return node && node.type !== 'root' ? node : undefined
}

/** Ancestors of `id` followed by the node itself (the root is not included). */
export function path(root: HtmlRoot, id: string): HtmlNode[] {
  const entries = findPath(root, id)
  return entries ? entries.slice(1).map(entry => entry.node as HtmlNode) : []
}

/** Replace the node with `id` by `fn(node)`. */
export function update<T extends HtmlNode>(root: HtmlRoot, id: string, fn: (node: T) => T): HtmlRoot {
  return updateNode<T>(root, id, fn)
}

export function remove(root: HtmlRoot, id: string): HtmlRoot {
  return removeNode(root, id)
}

/** Move a node before (-1) or after (1) its previous / next sibling. */
export function move(root: HtmlRoot, id: string, by: -1 | 1): HtmlRoot {
  return moveSibling(root, id, by)
}

/** Insert a copy right after the node. Returns the new tree and the copy's id. */
export function duplicate(root: HtmlRoot, id: string): { root: HtmlRoot; id?: string } {
  const result = duplicateNode(root, id, createIdGenerator(root))
  return { root: result.root, id: result.id ?? undefined }
}

/** Set an attribute; `null` removes it. */
export function setAttr(root: HtmlRoot, id: string, name: string, value: string | null): HtmlRoot {
  return setAttribute(root, id, name, value)
}

/** Replace an element's children with parsed HTML (like `innerHTML =`). */
export function setHTML(root: HtmlRoot, id: string, source: string): HtmlRoot {
  const children = parseHTML(source, { createId: createIdGenerator(root), stripCodeFence: false }).children
  return updateNode<HtmlParent>(root, id, node => ({ ...node, children }) as HtmlElement)
}
