import { decodeEntities } from './entities'
import { CLOSES_P, HEADINGS, PHRASING_ELEMENTS, RAW_TEXT_ELEMENTS, RCDATA_ELEMENTS, VOID_ELEMENTS } from './elements'
import type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot } from './types'

export type StreamParserOptions = {
  /** Custom id factory. Defaults to `n1`, `n2`, ... */
  createId?: () => string
  /** Strip a leading ```html fence and a trailing ``` (common in LLM output). Default true. */
  stripCodeFence?: boolean
}

export type StreamParser = {
  /** Feed the next chunk. Never throws. Returns the current tree snapshot. */
  write(chunk: string): HtmlRoot
  /** Flush everything, close all open nodes and return the final tree. */
  end(): HtmlRoot
  /** The latest snapshot. */
  snapshot(): HtmlRoot
}

// A tag longer than this without a closing `>` is assumed to contain a stray quote.
const MAX_PENDING_TAG = 4096
const PARTIAL_ENTITY = /&[#a-zA-Z0-9]{0,32}$/
const TAG_NAME = /^[^\s/>]+/

function findTagEnd(s: string, start: number, quoteAware: boolean) {
  let quote: string | null = null
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (quoteAware && (c === '"' || c === "'") && /[=\s]/.test(s[i - 1] || '')) {
      quote = c
    } else if (c === '>') {
      return i
    }
  }
  return -1
}

function parseAttributes(source: string, lowercase: boolean) {
  const attrs: Record<string, string> = {}
  let i = 0
  while (i < source.length) {
    while (i < source.length && /[\s/]/.test(source[i])) i++
    if (i >= source.length) break
    const nameStart = i
    while (i < source.length && !/[\s=/>]/.test(source[i])) i++
    let name = source.slice(nameStart, i)
    if (!name) {
      i++
      continue
    }
    if (lowercase) name = name.toLowerCase()
    let value = ''
    while (i < source.length && /\s/.test(source[i])) i++
    if (source[i] === '=') {
      i++
      while (i < source.length && /\s/.test(source[i])) i++
      const quote = source[i]
      if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, i + 1)
        value = source.slice(i + 1, end === -1 ? source.length : end)
        i = end === -1 ? source.length : end + 1
      } else {
        const start = i
        while (i < source.length && !/[\s>]/.test(source[i])) i++
        value = source.slice(start, i)
      }
    }
    if (!(name in attrs)) attrs[name] = decodeEntities(value)
  }
  return attrs
}

export function createStreamParser(options: StreamParserOptions = {}): StreamParser {
  let counter = 0
  const createId = options.createId ?? (() => `n${++counter}`)
  let fence: 'detect' | 'done' = options.stripCodeFence === false ? 'done' : 'detect'

  let root: HtmlRoot = { type: 'root', id: 'root', children: [], open: true }
  const stack: HtmlParent[] = [root]
  // Nodes copied during the current write. They may be mutated in place; everything else is
  // frozen so untouched subtrees keep their identity between snapshots.
  let drafts = new WeakSet<object>()
  let buffer = ''
  let rawTag: string | null = null
  let ended = false

  function draftPath(): HtmlParent {
    for (let k = 0; k < stack.length; k++) {
      const node = stack[k]
      if (drafts.has(node)) continue
      const copy = { ...node, children: node.children.slice() } as HtmlParent
      drafts.add(copy)
      stack[k] = copy
      if (k === 0) {
        root = copy as HtmlRoot
      } else {
        // An open element is always the last child of its parent.
        const parent = stack[k - 1]
        parent.children[parent.children.length - 1] = copy as HtmlElement
      }
    }
    return stack[stack.length - 1]
  }

  function closeTrailingText(parent: HtmlParent) {
    const last = parent.children[parent.children.length - 1]
    if (last && last.type === 'text' && last.open) {
      parent.children[parent.children.length - 1] = { ...last, open: false }
    }
  }

  function appendRawText(value: string) {
    if (!value) return
    const parent = draftPath()
    const last = parent.children[parent.children.length - 1]
    if (last && last.type === 'text' && last.open) {
      parent.children[parent.children.length - 1] = { ...last, value: last.value + value }
    } else {
      parent.children.push({ type: 'text', id: createId(), value, open: true })
    }
  }

  function lowerName(node: HtmlParent) {
    return node.type === 'root' ? '#root' : node.name.toLowerCase()
  }

  function inForeignContent() {
    for (let k = stack.length - 1; k > 0; k--) {
      const name = lowerName(stack[k])
      if (name === 'svg' || name === 'math') return true
      if (name === 'foreignobject') return false
    }
    return false
  }

  function popTo(index: number) {
    draftPath()
    while (stack.length > index) {
      const node = stack.pop() as HtmlElement
      closeTrailingText(node)
      node.open = false
    }
  }

  /** Close the nearest open element in `names`, unless a `stop` element is found first. */
  function closeIfOpen(names: string[], stop: (name: string) => boolean) {
    for (let k = stack.length - 1; k > 0; k--) {
      const name = lowerName(stack[k])
      if (names.includes(name)) {
        popTo(k)
        return
      }
      if (stop(name)) return
    }
  }

  const stopAt = (...names: string[]) => (name: string) =>
    names.includes(name) || name === 'body' || name === 'html' || name === 'template'

  function applyImpliedEndTags(name: string) {
    if (CLOSES_P.has(name)) closeIfOpen(['p'], n => !PHRASING_ELEMENTS.has(n))
    if (HEADINGS.has(name) && HEADINGS.has(lowerName(stack[stack.length - 1]))) popTo(stack.length - 1)
    switch (name) {
      case 'li':
        closeIfOpen(['li'], stopAt('ul', 'ol', 'menu'))
        break
      case 'dt':
      case 'dd':
        closeIfOpen(['dt', 'dd'], stopAt('dl'))
        break
      case 'tr':
        closeIfOpen(['tr'], stopAt('table', 'thead', 'tbody', 'tfoot'))
        break
      case 'td':
      case 'th':
        closeIfOpen(['td', 'th'], stopAt('tr', 'table'))
        break
      case 'thead':
      case 'tbody':
      case 'tfoot':
        closeIfOpen(['thead', 'tbody', 'tfoot'], stopAt('table'))
        break
      case 'option':
        closeIfOpen(['option'], stopAt('select', 'datalist', 'optgroup'))
        break
      case 'optgroup':
        closeIfOpen(['option'], stopAt('select', 'optgroup'))
        closeIfOpen(['optgroup'], stopAt('select'))
        break
    }
  }

  function startTag(rawName: string, attrSource: string, selfClosing: boolean) {
    const foreign = inForeignContent()
    const lower = rawName.toLowerCase()
    const name = foreign ? rawName : lower
    if (!foreign) applyImpliedEndTags(lower)
    const parent = draftPath()
    closeTrailingText(parent)
    const isVoid = !foreign && VOID_ELEMENTS.has(lower)
    const closed = selfClosing || isVoid
    const element: HtmlElement = {
      type: 'element',
      id: createId(),
      name,
      attributes: parseAttributes(attrSource, !foreign && lower !== 'svg' && lower !== 'math'),
      children: [],
      open: !closed,
    }
    drafts.add(element)
    parent.children.push(element)
    if (!closed) {
      stack.push(element)
      if (!foreign && RAW_TEXT_ELEMENTS.has(lower)) rawTag = lower
    }
  }

  function endTag(rawName: string) {
    const lower = rawName.toLowerCase()
    for (let k = stack.length - 1; k > 0; k--) {
      if (lowerName(stack[k]) === lower) {
        popTo(k)
        return
      }
    }
    // Unmatched end tag: ignore it.
  }

  function appendRaw(text: string) {
    appendRawText(text)
  }

  function appendDecoded(text: string) {
    appendRawText(decodeEntities(text))
  }

  function emitData(text: string, final: boolean) {
    let cut = text.length
    if (!final) {
      const partial = PARTIAL_ENTITY.exec(text)
      if (partial) cut = partial.index
    }
    appendRawText(decodeEntities(text.slice(0, cut)))
    return cut
  }

  function consumeRawText(s: string, i: number, final: boolean): number {
    const tag = rawTag as string
    const rcdata = RCDATA_ELEMENTS.has(tag)
    const appendText = rcdata ? appendDecoded : appendRaw
    const lower = s.toLowerCase()
    const needle = '</' + tag
    let from = i
    while (true) {
      const j = lower.indexOf(needle, from)
      if (j === -1) {
        if (final) {
          appendText(s.slice(i))
          return s.length
        }
        // Hold back a tail that could be the start of the closing tag.
        const lt = s.lastIndexOf('<')
        let holdFrom = lt >= i && needle.startsWith(lower.slice(lt)) ? lt : s.length
        const partial = rcdata ? PARTIAL_ENTITY.exec(s.slice(i, holdFrom)) : null
        if (partial) holdFrom = i + partial.index
        appendText(s.slice(i, holdFrom))
        return holdFrom
      }
      const after = s[j + needle.length]
      if (after === undefined && !final) {
        appendText(s.slice(i, j))
        return j
      }
      if (after === undefined || /[\s/>]/.test(after)) {
        const end = findTagEnd(s, j, false)
        appendText(s.slice(i, j))
        if (end === -1) {
          if (!final) return j
          rawTag = null
          endTag(tag)
          return s.length
        }
        rawTag = null
        endTag(tag)
        return end + 1
      }
      from = j + 1
    }
  }

  function consume(final: boolean) {
    const s = buffer
    let i = 0

    if (fence === 'detect') {
      const lead = /^\s*/.exec(s)![0].length
      const head = s.slice(lead)
      if (!final && head.length < 3 && '```'.startsWith(head)) return
      if (head.startsWith('```')) {
        const newline = s.indexOf('\n', lead)
        if (newline === -1 && !final) return
        i = newline === -1 ? s.length : newline + 1
      }
      fence = 'done'
    }

    while (i < s.length) {
      if (rawTag) {
        const next = consumeRawText(s, i, final)
        if (next === i && !final) break
        i = next
        continue
      }

      const lt = s.indexOf('<', i)
      if (lt === -1) {
        i += emitData(s.slice(i), final)
        break
      }
      if (lt > i) {
        emitData(s.slice(i, lt), true)
        i = lt
      }

      const next = s[i + 1]
      if (next === undefined) {
        if (final) appendRawText('<')
        else break
        i = s.length
        break
      }

      if (next === '!') {
        if (s.startsWith('<!--', i)) {
          const end = s.indexOf('-->', i + 4)
          if (end === -1) {
            if (final) i = s.length
            break
          }
          i = end + 3
          continue
        }
        if (!final && '<!--'.startsWith(s.slice(i, i + 4)) && s.length - i < 4) break
        if (s.startsWith('<![CDATA[', i)) {
          const end = s.indexOf(']]>', i)
          if (end === -1) {
            if (!final) break
            appendRawText(s.slice(i + 9))
            i = s.length
            break
          }
          appendRawText(s.slice(i + 9, end))
          i = end + 3
          continue
        }
        const end = s.indexOf('>', i)
        if (end === -1) {
          if (final) i = s.length
          break
        }
        const body = s.slice(i + 2, end).trim()
        if (/^doctype/i.test(body)) {
          draftPath()
          root.doctype = body
        }
        i = end + 1
        continue
      }

      if (next === '?') {
        const end = s.indexOf('>', i)
        if (end === -1) {
          if (final) i = s.length
          break
        }
        i = end + 1
        continue
      }

      if (next === '/') {
        if (s.length === i + 2 && !final) break
        const end = findTagEnd(s, i, false)
        if (end === -1) {
          if (final) i = s.length
          break
        }
        const name = TAG_NAME.exec(s.slice(i + 2, end).trim())
        if (name) endTag(name[0])
        i = end + 1
        continue
      }

      if (/[a-zA-Z]/.test(next)) {
        let end = findTagEnd(s, i, true)
        if (end === -1 && (final || s.length - i > MAX_PENDING_TAG)) end = findTagEnd(s, i, false)
        if (end === -1) {
          // Incomplete tag: keep it out of the tree until it completes; drop it at the end.
          if (final) i = s.length
          break
        }
        const body = s.slice(i + 1, end)
        const name = TAG_NAME.exec(body)![0]
        const selfClosing = /\/\s*$/.test(body)
        startTag(name, body.slice(name.length).replace(/\/\s*$/, ''), selfClosing)
        i = end + 1
        continue
      }

      // A literal `<` that does not start markup.
      appendRawText('<')
      i += 1
    }

    buffer = s.slice(i)
  }

  function stripTrailingFence() {
    if (options.stripCodeFence === false) return
    const last = root.children[root.children.length - 1]
    if (last && last.type === 'text' && /```\s*$/.test(last.value)) {
      const value = last.value.replace(/```\s*$/, '')
      root.children[root.children.length - 1] = { ...last, value }
      if (!value) root.children.pop()
    }
  }

  return {
    write(chunk: string) {
      if (ended || !chunk) return root
      drafts = new WeakSet()
      buffer += chunk
      try {
        consume(false)
      } catch {
        // The parser must never break the stream. Drop the pending buffer if something
        // truly unexpected happens; the tree built so far stays valid.
        buffer = ''
      }
      return root
    },
    end() {
      if (ended) return root
      drafts = new WeakSet()
      try {
        consume(true)
      } catch {
        buffer = ''
      }
      popTo(1)
      draftPath()
      closeTrailingText(root)
      stripTrailingFence()
      root.open = false
      ended = true
      return root
    },
    snapshot() {
      return root
    },
  }
}

/** One-shot parse with the same recovery rules as the stream parser. */
export function parseHTML(html: string, options?: StreamParserOptions): HtmlRoot {
  const parser = createStreamParser(options)
  parser.write(html)
  return parser.end()
}

export function isWhitespaceText(node: HtmlNode) {
  return node.type === 'text' && !/\S/.test(node.value)
}
