import { decodeEntities, PARTIAL_REFERENCE } from './entities'

export type Attr = [name: string, value: string]

export interface TokenSink {
  startTag(name: string, attrs: Attr[], selfClosing: boolean): void
  endTag(name: string): void
  chars(data: string): void
  comment(data: string): void
  doctype(raw: string): void
  /** CDATA sections are only allowed in foreign content (SVG, MathML). */
  cdataAllowed(): boolean
}

export type TextState = 'data' | 'rcdata' | 'rawtext' | 'script' | 'plaintext'

const WS = /[\t\n\f\r ]/
const ALPHA = /[a-zA-Z]/

function isWs(c: string | undefined) {
  return c !== undefined && WS.test(c)
}

type ScannedTag = { end: number; name: string; attrs: Attr[]; selfClosing: boolean }

/**
 * Scan a tag starting at `s[i] === '<'` following the HTML tokenizer's tag and attribute states.
 * Returns null when the tag is not complete yet.
 */
function scanTag(s: string, i: number, isEnd: boolean): ScannedTag | null {
  const len = s.length
  let j = i + (isEnd ? 2 : 1)
  const nameStart = j
  while (j < len && !isWs(s[j]) && s[j] !== '/' && s[j] !== '>') j++
  if (j >= len) return null
  const name = s.slice(nameStart, j).toLowerCase().replace(/\0/g, '�')
  const attrs: Attr[] = []
  let selfClosing = false
  while (true) {
    while (j < len && isWs(s[j])) j++
    if (j >= len) return null
    const c = s[j]
    if (c === '>') return { end: j, name, attrs, selfClosing }
    if (c === '/') {
      j++
      if (j >= len) return null
      if (s[j] === '>') {
        selfClosing = true
        return { end: j, name, attrs, selfClosing }
      }
      continue
    }
    const attrStart = j
    j++ // the first character is part of the name, even `=`
    while (j < len && !isWs(s[j]) && s[j] !== '/' && s[j] !== '>' && s[j] !== '=') j++
    if (j >= len) return null
    const attrName = s.slice(attrStart, j).toLowerCase().replace(/\0/g, '�')
    while (j < len && isWs(s[j])) j++
    if (j >= len) return null
    let value = ''
    if (s[j] === '=') {
      j++
      while (j < len && isWs(s[j])) j++
      if (j >= len) return null
      const q = s[j]
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, j + 1)
        if (close === -1) return null
        value = s.slice(j + 1, close)
        j = close + 1
      } else if (q !== '>') {
        const start = j
        while (j < len && !isWs(s[j]) && s[j] !== '>') j++
        if (j >= len) return null
        value = s.slice(start, j)
      }
      value = decodeEntities(value.replace(/\0/g, '�'), true)
    }
    if (!attrs.some(([n]) => n === attrName)) attrs.push([attrName, value])
  }
}

const endTagPatterns = new Map<string, RegExp>()

function endTagPattern(tag: string) {
  let pattern = endTagPatterns.get(tag)
  if (!pattern) {
    pattern = new RegExp(`</${tag}(?=[\\t\\n\\f\\r />])`, 'gi')
    endTagPatterns.set(tag, pattern)
  }
  return pattern
}

/**
 * A resumable HTML tokenizer. `feed` consumes as much of the buffered input as can be tokenized
 * unambiguously and keeps the rest (half a tag, a partial character reference, ...) for later.
 */
export class Tokenizer {
  private buffer = ''
  private state: TextState = 'data'
  private rawTag = ''
  /** Script data escape state: 0 normal, 1 inside `<!--`, 2 inside `<!--<script>` (double escaped). */
  private scriptEscape = 0
  /** Consecutive `-` just before the current position, so `-->` can span chunks. */
  private scriptDashes = 0
  constructor(private sink: TokenSink) {}

  /** Switch to a raw text state after a start tag such as <script>, <style> or <textarea>. */
  setState(state: TextState, tag = '') {
    this.state = state
    this.rawTag = tag
    this.scriptEscape = 0
    this.scriptDashes = 0
  }

  feed(text: string, final: boolean) {
    this.buffer += text
    const s = this.buffer
    let i = 0
    while (i < s.length) {
      const next = this.state === 'data' ? this.data(s, i, final) : this.raw(s, i, final)
      if (next === i) break
      i = next
    }
    this.buffer = s.slice(i)
  }

  private text(data: string) {
    if (data) this.sink.chars(data)
  }

  /** Emit decoded text, holding back a partial character reference at the end of the input. */
  private textUpTo(s: string, i: number, end: number, final: boolean, decode: boolean) {
    let cut = end
    if (decode && !final && end === s.length) {
      const partial = PARTIAL_REFERENCE.exec(s.slice(i, end))
      if (partial) cut = i + partial.index
    }
    const raw = s.slice(i, cut)
    this.text(decode ? decodeEntities(raw) : raw)
    return cut
  }

  private raw(s: string, i: number, final: boolean): number {
    if (this.state === 'script') return this.script(s, i, final)
    if (this.state === 'plaintext') {
      this.text(s.slice(i).replace(/\0/g, '�'))
      return s.length
    }
    const decode = this.state === 'rcdata'
    const emit = (end: number) => {
      const raw = s.slice(i, end).replace(/\0/g, '�')
      this.text(decode ? decodeEntities(raw) : raw)
    }
    const pattern = endTagPattern(this.rawTag)
    pattern.lastIndex = i
    const match = pattern.exec(s)
    if (!match) {
      if (final) {
        emit(s.length)
        return s.length
      }
      // Hold back a tail that could still become the end tag or a character reference.
      let hold = s.length
      const lt = s.lastIndexOf('<')
      if (lt >= i && `</${this.rawTag}`.startsWith(s.slice(lt).toLowerCase())) hold = lt
      else if (lt >= i && s.slice(lt).toLowerCase() === `</${this.rawTag}`) hold = lt
      if (decode) {
        const partial = PARTIAL_REFERENCE.exec(s.slice(i, hold))
        if (partial) hold = i + partial.index
      }
      emit(hold)
      return hold
    }
    const tag = scanTag(s, match.index, true)
    if (!tag) {
      emit(match.index)
      if (!final) return match.index
      this.state = 'data'
      this.sink.endTag(this.rawTag)
      return s.length
    }
    emit(match.index)
    this.state = 'data'
    this.sink.endTag(this.rawTag)
    return tag.end + 1
  }

  /** Script data with the escaped and double-escaped states (`<!--<script>...</script>-->`). */
  private script(s: string, i: number, final: boolean): number {
    const len = s.length
    let k = i
    let state = this.scriptEscape
    let dashes = this.scriptDashes
    const emit = (end: number) => this.text(s.slice(i, end).replace(/\0/g, '\ufffd'))
    // Is `tag` followed by a character that ends a tag name? null when we need more input.
    const tagAt = (at: number, tag: string): boolean | null => {
      const chunk = s.slice(at, at + tag.length + 1)
      if (chunk.length <= tag.length) return final ? false : tag.startsWith(chunk.toLowerCase()) ? null : false
      return chunk.slice(0, tag.length).toLowerCase() === tag && /[\t\n\f\r />]/.test(chunk[tag.length])
    }
    while (k < len) {
      const c = s[k]
      if (c === '-') {
        dashes++
        k++
        continue
      }
      const wasDashes = dashes
      dashes = 0
      if (c === '>' && state > 0 && wasDashes >= 2) {
        state = 0
        k++
        continue
      }
      if (c !== '<') {
        k++
        continue
      }
      if (state === 0) {
        if (s.startsWith('<!--', k)) {
          state = 1
          k += 4
          dashes = 2
          continue
        }
        if (!final && len - k < 4 && '<!--'.startsWith(s.slice(k))) break
      }
      if (state === 1) {
        const open = tagAt(k + 1, 'script')
        if (open === null) break
        if (open) {
          state = 2
          k += 7
          continue
        }
      }
      const close = tagAt(k + 2, 'script')
      if (s[k + 1] === '/' && close === null) break
      if (k + 1 >= len && !final) break
      if (s[k + 1] === '/' && close) {
        if (state === 2) {
          state = 1
          k += 8
          continue
        }
        const tag = scanTag(s, k, true)
        if (!tag && !final) {
          emit(k)
          this.scriptEscape = state
          this.scriptDashes = 0
          return k
        }
        emit(k)
        this.state = 'data'
        this.scriptEscape = 0
        this.scriptDashes = 0
        this.sink.endTag('script')
        return tag ? tag.end + 1 : len
      }
      k++
    }
    emit(k)
    this.scriptEscape = state
    this.scriptDashes = dashes
    return k
  }

  private data(s: string, i: number, final: boolean): number {
    const lt = s.indexOf('<', i)
    if (lt === -1) return this.textUpTo(s, i, s.length, final, true)
    if (lt > i) {
      this.text(decodeEntities(s.slice(i, lt)))
      return lt
    }
    const len = s.length
    const c = s[i + 1]
    if (c === undefined) {
      if (!final) return i
      this.text('<')
      return len
    }

    if (c === '!') {
      const head = s.slice(i, i + 9)
      if (head.startsWith('<!--')) return this.commentAt(s, i, final)
      if (!final && head.length < 4 && '<!--'.startsWith(head)) return i
      if (/^<!doctype/i.test(head)) {
        const end = s.indexOf('>', i)
        if (end === -1) {
          if (!final) return i
          this.sink.doctype(s.slice(i + 2))
          return len
        }
        this.sink.doctype(s.slice(i + 2, end))
        return end + 1
      }
      if (!final && head.length < 9 && '<!doctype'.startsWith(head.toLowerCase())) return i
      if (this.sink.cdataAllowed()) {
        if (head === '<![CDATA[') {
          const end = s.indexOf(']]>', i + 9)
          if (end === -1) {
            if (!final) return i
            this.text(s.slice(i + 9))
            return len
          }
          this.text(s.slice(i + 9, end))
          return end + 3
        }
        if (!final && head.length < 9 && '<![CDATA['.startsWith(head)) return i
      }
      return this.bogusComment(s, i, i + 2, final)
    }

    if (c === '/') {
      const d = s[i + 2]
      if (d === undefined) {
        if (!final) return i
        this.text('</')
        return len
      }
      if (ALPHA.test(d)) {
        const tag = scanTag(s, i, true)
        if (!tag) return final ? len : i
        this.sink.endTag(tag.name)
        return tag.end + 1
      }
      if (d === '>') return i + 3
      return this.bogusComment(s, i, i + 2, final)
    }

    if (c === '?') return this.bogusComment(s, i, i + 1, final)

    if (ALPHA.test(c)) {
      const tag = scanTag(s, i, false)
      // EOF inside a tag drops the tag, like browsers do.
      if (!tag) return final ? len : i
      this.sink.startTag(tag.name, tag.attrs, tag.selfClosing)
      return tag.end + 1
    }

    this.text('<')
    return i + 1
  }

  private commentAt(s: string, i: number, final: boolean): number {
    const start = i + 4
    if (s[start] === '>') {
      this.sink.comment('')
      return start + 1
    }
    if (s.startsWith('->', start)) {
      this.sink.comment('')
      return start + 2
    }
    let end = -1
    let close = 0
    let from = start
    while (true) {
      const dash = s.indexOf('--', from)
      if (dash === -1) break
      if (s[dash + 2] === '>') {
        end = dash
        close = 3
        break
      }
      if (s[dash + 2] === '!' && s[dash + 3] === '>') {
        end = dash
        close = 4
        break
      }
      from = dash + 1
    }
    if (end === -1) {
      if (!final) return i
      // EOF inside the comment: the trailing dashes belong to the comment's end.
      this.sink.comment(s.slice(start).replace(/--!?$|-$/, '').replace(/\0/g, '�'))
      return s.length
    }
    this.sink.comment(s.slice(start, end).replace(/\0/g, '�'))
    return end + close
  }

  private bogusComment(s: string, i: number, start: number, final: boolean): number {
    const end = s.indexOf('>', start)
    if (end === -1) {
      if (!final) return i
      this.sink.comment(s.slice(start).replace(/\0/g, '�'))
      return s.length
    }
    this.sink.comment(s.slice(start, end).replace(/\0/g, '�'))
    return end + 1
  }
}
