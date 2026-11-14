export { createStreamParser, parseHTML } from './parser'
export type { StreamParser, StreamParserOptions } from './parser'
export { toHTML, toDocument, documentParts } from './serialize'
export type { DocumentParts } from './serialize'
export {
  createIdGenerator, findPath, getNode, getParent, updateNode, removeNode, insertNode,
  setAttribute, cloneNode, duplicateNode, moveSibling, textContent, walk,
} from './tree'
export type { IdGenerator } from './tree'
export {
  inferSchema, toOutline, parseOutline, applyOutline, getContentRoot, isStructural, structuralChildren,
} from './schema'
export type { PageSchema, SchemaNode, SchemaKind } from './schema'
export { decodeEntities, escapeText, escapeAttribute } from './entities'
export type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot, HtmlText } from './types'
