/**
 * html2any/stream — parse HTML while it streams, read its structure, edit it, write it back.
 *
 * Everything works on one immutable tree (`HtmlRoot`). Nodes have stable `id`s, an `open`
 * flag while content may still arrive, and unchanged subtrees keep their identity across
 * updates and edits.
 */
import { createStreamParser, parseHTML, type StreamParser } from './parser'
import { applyOutline, inferSchema, toOutline, type PageSchema } from './schema'
import { documentParts, toDocument, toHTML } from './serialize'
import {
  createIdGenerator, duplicateNode, findPath, moveSibling, removeNode, setAttribute, textContent,
  updateNode,
} from './tree'
import type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot } from './types'

export type { HtmlElement, HtmlNode, HtmlRoot, HtmlText } from './types'
export type { SchemaKind, SchemaNode } from './schema'
export type Schema = PageSchema

export type ParseOptions = {
  /** The text is complete: close every open node. */
  done?: boolean
  /** Strip a ```html fence around LLM output. Default true. */
  fence?: boolean
}

type Chunk = string | Uint8Array
export type Source = AsyncIterable<Chunk> | ReadableStream<Chunk> | Response

type Entry = { text: string; parser: StreamParser; fence: boolean; done: boolean }
const CACHE_SIZE = 8
const cache: Entry[] = []

function parseText(text: string, done: boolean, fence: boolean): HtmlRoot {
  let entry: Entry | undefined
  for (const candidate of cache) {
    if (candidate.fence !== fence) continue
    if (candidate.text === text) {
      entry = candidate
      break
    }
    // Continue from the longest earlier text this one extends.
    if (!candidate.done && text.length > candidate.text.length && text.startsWith(candidate.text)) {
      if (!entry || candidate.text.length > entry.text.length) entry = candidate
    }
  }

  if (!entry) {
    entry = { text: '', parser: createStreamParser({ stripCodeFence: fence }), fence, done: false }
    cache.unshift(entry)
    if (cache.length > CACHE_SIZE) cache.pop()
  } else {
    cache.splice(cache.indexOf(entry), 1)
    cache.unshift(entry)
  }

  if (entry.text !== text) {
    entry.parser.write(text.slice(entry.text.length))
    entry.text = text
  }
  if (done && !entry.done) {
    entry.parser.end()
    entry.done = true
  }
  return entry.parser.snapshot()
}

async function* chunksOf(source: Source): AsyncGenerator<Chunk> {
  let stream: AsyncIterable<Chunk> | ReadableStream<Chunk> | null = source as AsyncIterable<Chunk>
  if (typeof Response !== 'undefined' && source instanceof Response) stream = source.body
  if (!stream) return
  if (Symbol.asyncIterator in stream) {
    yield* stream as AsyncIterable<Chunk>
    return
  }
  const reader = (stream as ReadableStream<Chunk>).getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

async function* parseSource(source: Source, fence: boolean): AsyncGenerator<HtmlRoot> {
  const parser = createStreamParser({ stripCodeFence: fence })
  const decoder = new TextDecoder()
  let last = parser.snapshot()
  for await (const chunk of chunksOf(source)) {
    const tree = parser.write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }))
    if (tree !== last) {
      last = tree
      yield tree
    }
  }
  const tail = decoder.decode()
  if (tail) parser.write(tail)
  yield parser.end()
}

/**
 * Parse HTML that may still be arriving.
 *
 * Pass the text received so far and get a tree that is always safe to render. Calls that
 * extend the previous text continue incrementally instead of starting over:
 *
 *   const tree = parse(message.content)
 *   const final = parse(message.content, { done: true })
 *
 * Or pass a stream and iterate the trees:
 *
 *   for await (const tree of parse(response)) render(tree)
 */
export function parse(text: string, options?: ParseOptions): HtmlRoot
export function parse(source: Source, options?: Omit<ParseOptions, 'done'>): AsyncGenerator<HtmlRoot>
export function parse(source: string | Source, options: ParseOptions = {}): HtmlRoot | AsyncGenerator<HtmlRoot> {
  const fence = options.fence !== false
  if (typeof source === 'string') return parseText(source, Boolean(options.done), fence)
  return parseSource(source, fence)
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

/** Apply an edited outline: structure, tags, classes, attributes, style and plain text. */
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
  const parts = documentParts(parseHTML(source, { createId: createIdGenerator(root), stripCodeFence: false }))
  const children = [...parts.headNodes, ...parts.bodyNodes]
  return updateNode<HtmlParent>(root, id, node => ({ ...node, children }) as HtmlElement)
}
