import { TreeBuilder } from './builder'
import { Tokenizer } from './tokenizer'
import type { HtmlNode, HtmlRoot } from './types'

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

/**
 * Incremental HTML parser: a resumable tokenizer feeding a WHATWG tree builder. Every prefix of
 * the input produces a valid tree, and the final tree does not depend on how the input was split.
 */
export function createStreamParser(options: StreamParserOptions = {}): StreamParser {
  let counter = 0
  const createId = options.createId ?? (() => `n${++counter}`)
  const builder = new TreeBuilder(createId)
  const tokenizer = new Tokenizer(builder)
  builder.tokenizer = tokenizer
  let fence: 'detect' | 'done' = options.stripCodeFence === false ? 'done' : 'detect'
  let pending = ''
  let ended = false
  let broken = false

  function feed(chunk: string, final: boolean) {
    let text = pending + chunk
    pending = ''
    // A CR at the end may be the first half of CRLF.
    if (!final && text.endsWith('\r')) {
      pending = '\r'
      text = text.slice(0, -1)
    }
    text = text.replace(/\r\n?/g, '\n')

    if (fence === 'detect') {
      const lead = /^\s*/.exec(text)![0].length
      const head = text.slice(lead)
      if (!final && head.length < 3 && '```'.startsWith(head)) {
        pending = text + pending
        return
      }
      if (head.startsWith('```')) {
        const newline = text.indexOf('\n', lead)
        if (newline === -1 && !final) {
          pending = text + pending
          return
        }
        text = newline === -1 ? '' : text.slice(newline + 1)
      }
      fence = 'done'
    }

    if (broken) return
    try {
      tokenizer.feed(text, final)
    } catch (error) {
      // The parser must never break the stream: keep the tree built so far.
      broken = true
      if (typeof console !== 'undefined') console.error('[html2any] parser error', error)
    }
  }

  return {
    write(chunk: string) {
      if (!ended && chunk) feed(chunk, false)
      return builder.snapshot()
    },
    end() {
      if (ended) return builder.snapshot()
      ended = true
      feed('', true)
      try {
        if (options.stripCodeFence !== false) builder.stripTrailingFence()
        builder.eof()
      } catch (error) {
        if (typeof console !== 'undefined') console.error('[html2any] parser error', error)
      }
      return builder.snapshot()
    },
    snapshot() {
      return builder.snapshot()
    },
  }
}

/** One-shot parse with the same rules as the stream parser. */
export function parseHTML(html: string, options?: StreamParserOptions): HtmlRoot {
  const parser = createStreamParser(options)
  parser.write(html)
  return parser.end()
}

export function isWhitespaceText(node: HtmlNode) {
  return node.type === 'text' && !/\S/.test(node.value)
}
