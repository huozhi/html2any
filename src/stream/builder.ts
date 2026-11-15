/**
 * HTML tree construction, following the WHATWG parsing algorithm: insertion modes, the stack of
 * open elements, active formatting elements (adoption agency, reconstruction), foster parenting,
 * tables, select, template and foreign content (SVG, MathML).
 *
 * Not implemented: frameset documents, scripting (documents are parsed with scripting disabled),
 * quirks-mode differences, and fragment parsing with a context element.
 *
 * The builder works on a mutable tree and produces immutable snapshots. Mutations mark the
 * changed nodes and their ancestors dirty; a snapshot only rebuilds dirty nodes, so unchanged
 * subtrees keep their identity across snapshots.
 */
import type { Attr, TextState, TokenSink, Tokenizer } from './tokenizer'
import type { HtmlNode, HtmlRoot } from './types'

type Ns = 'html' | 'svg' | 'math'

type MBase = { id: string; parent: MParent | null; dirty: boolean; snap: unknown }
type MText = MBase & { kind: 'text'; value: string; open: boolean }
type MComment = MBase & { kind: 'comment'; value: string }
type MElement = MBase & {
  kind: 'element'
  name: string
  ns: Ns
  attrs: Record<string, string>
  children: MNode[]
  open: boolean
  implied: boolean
}
type MDocument = MBase & { kind: 'root'; children: MNode[]; open: boolean; doctype?: string }
type MNode = MText | MComment | MElement
type MParent = MElement | MDocument

type Mode =
  | 'initial' | 'beforeHtml' | 'beforeHead' | 'inHead' | 'inHeadNoscript' | 'afterHead' | 'inBody'
  | 'text' | 'inTable' | 'inTableText' | 'inCaption' | 'inColumnGroup' | 'inTableBody' | 'inRow'
  | 'inCell' | 'inSelect' | 'inSelectInTable' | 'inTemplate' | 'afterBody' | 'afterAfterBody'
  | 'inFrameset' | 'afterFrameset' | 'afterAfterFrameset'

type Token =
  | { type: 'start'; name: string; attrs: Attr[]; selfClosing: boolean }
  | { type: 'end'; name: string }
  | { type: 'chars'; data: string }
  | { type: 'comment'; data: string }
  | { type: 'doctype'; raw: string }
  | { type: 'eof' }

const MARKER = null
type FormattingEntry = MElement | typeof MARKER

const set = (...names: string[]) => new Set(names)

const SPECIAL = set(
  'address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote', 'body',
  'br', 'button', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dir', 'div', 'dl', 'dt',
  'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input', 'keygen', 'li',
  'link', 'listing', 'main', 'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes', 'noscript',
  'object', 'ol', 'p', 'param', 'plaintext', 'pre', 'script', 'search', 'section', 'select', 'source',
  'style', 'summary', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'title',
  'tr', 'track', 'ul', 'wbr', 'xmp',
)
const SPECIAL_MATH = set('mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml')
const SPECIAL_SVG = set('foreignObject', 'desc', 'title')
const FORMATTING = set('a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u')
const IMPLIED_END = set('dd', 'dt', 'li', 'optgroup', 'option', 'p', 'rb', 'rp', 'rt', 'rtc')
const IMPLIED_END_THOROUGH = set(...IMPLIED_END, 'caption', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr')
const HEADINGS = set('h1', 'h2', 'h3', 'h4', 'h5', 'h6')
const CLOSES_P = set(
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p',
  'search', 'section', 'summary', 'ul',
)
const BLOCK_END = set(
  'address', 'article', 'aside', 'blockquote', 'button', 'center', 'details', 'dialog', 'dir', 'div',
  'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'listing', 'main', 'menu',
  'nav', 'ol', 'pre', 'search', 'section', 'summary', 'ul',
)
const TABLE_FOSTER = set('table', 'tbody', 'tfoot', 'thead', 'tr')
const TABLE_SECTIONS = set('tbody', 'tfoot', 'thead')
const CELL_OR_TABLE_START = set('caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr')
const HEAD_START = set('base', 'basefont', 'bgsound', 'link', 'meta', 'noframes', 'script', 'style', 'template', 'title')
const FOREIGN_BREAKOUT = set(
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1',
  'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol',
  'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
)

const SVG_TAGS: Record<string, string> = {}
for (const name of [
  'altGlyph', 'altGlyphDef', 'altGlyphItem', 'animateColor', 'animateMotion', 'animateTransform',
  'clipPath', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA',
  'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode',
  'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile',
  'feTurbulence', 'foreignObject', 'glyphRef', 'linearGradient', 'radialGradient', 'textPath',
]) SVG_TAGS[name.toLowerCase()] = name

const SVG_ATTRS: Record<string, string> = {}
for (const name of [
  'attributeName', 'attributeType', 'baseFrequency', 'baseProfile', 'calcMode', 'clipPathUnits',
  'diffuseConstant', 'edgeMode', 'filterUnits', 'glyphRef', 'gradientTransform', 'gradientUnits',
  'kernelMatrix', 'kernelUnitLength', 'keyPoints', 'keySplines', 'keyTimes', 'lengthAdjust',
  'limitingConeAngle', 'markerHeight', 'markerUnits', 'markerWidth', 'maskContentUnits', 'maskUnits',
  'numOctaves', 'pathLength', 'patternContentUnits', 'patternTransform', 'patternUnits', 'pointsAtX',
  'pointsAtY', 'pointsAtZ', 'preserveAlpha', 'preserveAspectRatio', 'primitiveUnits', 'refX', 'refY',
  'repeatCount', 'repeatDur', 'requiredExtensions', 'requiredFeatures', 'specularConstant',
  'specularExponent', 'spreadMethod', 'startOffset', 'stdDeviation', 'stitchTiles', 'surfaceScale',
  'systemLanguage', 'tableValues', 'targetX', 'targetY', 'textLength', 'viewBox', 'viewTarget',
  'xChannelSelector', 'yChannelSelector', 'zoomAndPan',
]) SVG_ATTRS[name.toLowerCase()] = name

const WS_ONLY = /^[\t\n\f\r ]*$/
const LEADING_WS = /^[\t\n\f\r ]+/

export class TreeBuilder implements TokenSink {
  tokenizer!: Tokenizer
  private doc: MDocument
  private stack: MElement[] = []
  private onStack = new Set<MElement>()
  private lingering = new Set<MElement>()
  private bodyStarted = false
  private openCounts = new Map<string, number>()
  private afe: FormattingEntry[] = []
  private mode: Mode = 'initial'
  private originalMode: Mode = 'inBody'
  private templateModes: Mode[] = []
  private head: MElement | null = null
  private form: MElement | null = null
  private fosterParenting = false
  private framesetOk = true
  private quirks = false
  private skipNewline = false
  private pendingTableText: string[] = []
  private snapshotCache: HtmlRoot | null = null

  constructor(private createId: () => string) {
    this.doc = { kind: 'root', id: 'root', parent: null, dirty: true, snap: null, children: [], open: true }
  }

  // ---------------------------------------------------------------------------------------------
  // Token sink

  startTag(name: string, attrs: Attr[], selfClosing: boolean) {
    this.skipNewline = false
    this.dispatch({ type: 'start', name, attrs, selfClosing })
  }

  endTag(name: string) {
    this.skipNewline = false
    this.dispatch({ type: 'end', name })
  }

  chars(data: string) {
    if (this.skipNewline) {
      this.skipNewline = false
      if (data[0] === '\n') data = data.slice(1)
      if (!data) return
    }
    this.dispatch({ type: 'chars', data })
  }

  comment(data: string) {
    this.skipNewline = false
    this.dispatch({ type: 'comment', data })
  }

  doctype(raw: string) {
    this.dispatch({ type: 'doctype', raw })
  }

  cdataAllowed() {
    const node = this.current()
    return Boolean(node && node.ns !== 'html')
  }

  eof() {
    this.dispatch({ type: 'eof' })
    this.sealHead()
    while (this.stack.length) this.pop()
    this.doc.open = false
    this.touch(this.doc)
  }

  /** The tree as immutable nodes. Unchanged subtrees keep their identity between calls. */
  snapshot(): HtmlRoot {
    if (!this.doc.dirty && this.snapshotCache) return this.snapshotCache
    // Rebuild dirty nodes bottom-up without recursion (documents can be very deep).
    const order: (MNode | MDocument)[] = []
    const pending: (MNode | MDocument)[] = [this.doc]
    while (pending.length) {
      const node = pending.pop()!
      if (!node.dirty && node.snap) continue
      order.push(node)
      if (node.kind === 'element' || node.kind === 'root') {
        for (const child of node.children) if (child.dirty || !child.snap) pending.push(child)
      }
    }
    for (let k = order.length - 1; k >= 0; k--) {
      const node = order[k]
      node.dirty = false
      if (node.kind === 'text') {
        node.snap = { type: 'text', id: node.id, value: node.value, open: node.open }
      } else if (node.kind === 'comment') {
        node.snap = { type: 'comment', id: node.id, value: node.value, open: false }
      } else if (node.kind === 'element') {
        const el: Record<string, unknown> = {
          type: 'element',
          id: node.id,
          name: node.name,
          attributes: { ...node.attrs },
          children: node.children.map(child => child.snap),
          open: node.open,
        }
        if (node.implied) el.implied = true
        if (node.ns !== 'html') el.namespace = node.ns
        node.snap = el
      } else {
        const root: Record<string, unknown> = {
          type: 'root',
          id: node.id,
          children: node.children.map(child => child.snap),
          open: node.open,
        }
        if (node.doctype !== undefined) root.doctype = node.doctype
        node.snap = root
      }
    }
    this.snapshotCache = this.doc.snap as HtmlRoot
    return this.snapshotCache
  }

  /** Strip a trailing ``` left in the body by fenced LLM output. */
  stripTrailingFence() {
    let node: MParent | undefined = this.stack.find(el => el.name === 'body') ?? this.findBody()
    while (node) {
      const last: MNode | undefined = node.children[node.children.length - 1]
      if (!last) return
      if (last.kind === 'text') {
        if (/```\s*$/.test(last.value)) {
          last.value = last.value.replace(/```\s*$/, '')
          this.touch(last)
          if (!last.value) this.detach(last)
        }
        return
      }
      if (last.kind !== 'element') return
      node = last
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Mutable tree helpers

  private findBody(): MElement | undefined {
    const html = this.doc.children.find((n): n is MElement => n.kind === 'element' && n.name === 'html')
    return html?.children.find((n): n is MElement => n.kind === 'element' && n.name === 'body')
  }

  private touch(node: MNode | MDocument | null) {
    let current: MNode | MDocument | null = node
    while (current && !current.dirty) {
      current.dirty = true
      current = current.parent
    }
  }

  private detach(node: MNode) {
    const parent = node.parent
    if (!parent) return
    const index = parent.children.indexOf(node)
    if (index !== -1) parent.children.splice(index, 1)
    node.parent = null
    this.touch(parent)
  }

  private insertNode(parent: MParent, node: MNode, before: MNode | null = null) {
    if (node.parent) this.detach(node)
    const index = before ? parent.children.indexOf(before) : -1
    if (index === -1) parent.children.push(node)
    else parent.children.splice(index, 0, node)
    node.parent = parent
    node.dirty = true
    this.touch(parent)
  }

  private createElement(name: string, attrs: Attr[] | Record<string, string>, ns: Ns = 'html'): MElement {
    const record: Record<string, string> = {}
    if (Array.isArray(attrs)) {
      for (const [key, value] of attrs) {
        const adjusted = ns === 'svg' ? SVG_ATTRS[key] ?? key : ns === 'math' && key === 'definitionurl' ? 'definitionURL' : key
        if (!(adjusted in record)) record[adjusted] = value
      }
    } else {
      Object.assign(record, attrs)
    }
    return {
      kind: 'element', id: this.createId(), parent: null, dirty: true, snap: null,
      name: ns === 'svg' ? SVG_TAGS[name] ?? name : name, ns, attrs: record, children: [], open: true, implied: false,
    }
  }

  private current(): MElement | undefined {
    return this.stack[this.stack.length - 1]
  }

  private is(el: MElement | undefined, ...names: string[]) {
    return Boolean(el && el.ns === 'html' && names.includes(el.name))
  }

  /**
   * Text stays open until its parent element leaves the stack: until then, ignored tags or
   * foster parenting may still append to it.
   */
  private closeTexts(el: MElement) {
    for (const child of el.children) {
      if (child.kind === 'text' && child.open) {
        child.open = false
        this.touch(child)
      }
    }
  }

  // Every change to the stack of open elements goes through these helpers, which keep a count
  // of open HTML elements by name. Scope checks for names that are not open return at once, so
  // deeply nested documents do not make parsing quadratic.
  private track(el: MElement, delta: 1 | -1) {
    if (delta > 0) this.onStack.add(el)
    else this.onStack.delete(el)
    if (el.ns !== 'html') return
    this.openCounts.set(el.name, (this.openCounts.get(el.name) ?? 0) + delta)
  }

  private isOpen(name: string) {
    return (this.openCounts.get(name) ?? 0) > 0
  }

  private stackRemoveAt(index: number) {
    const [el] = this.stack.splice(index, 1)
    if (el) this.track(el, -1)
    return el
  }

  private stackInsertAt(index: number, el: MElement) {
    this.stack.splice(index, 0, el)
    this.track(el, 1)
  }

  /** Mark an element (and its direct text) closed: nothing will be added to it any more. */
  private close(el: MElement) {
    // Until <body> starts, head content can still be inserted after </head>.
    if (el === this.head && this.mode !== 'inBody' && !this.bodyStarted) return
    el.open = false
    this.closeTexts(el)
    this.touch(el)
  }

  private sealHead() {
    this.bodyStarted = true
    if (this.head && this.head.open && !this.onStack.has(this.head)) this.close(this.head)
  }

  private hasOpenDescendant(el: MElement) {
    for (const open of this.onStack) {
      for (let node: MParent | null = open.parent; node; node = node.parent) {
        if (node === el) return true
      }
    }
    return false
  }

  /**
   * An element removed from the middle of the stack (</form>, the adoption agency) may still
   * have open descendants; it stays open until they close.
   */
  private closeOrLinger(el: MElement) {
    if (this.hasOpenDescendant(el)) this.lingering.add(el)
    else this.close(el)
  }

  private settleLingering() {
    if (!this.lingering.size) return
    for (const el of [...this.lingering]) {
      if (!this.hasOpenDescendant(el)) {
        this.lingering.delete(el)
        this.close(el)
      }
    }
  }

  private pop() {
    const el = this.stack.pop()
    if (el) {
      this.track(el, -1)
      this.close(el)
      this.settleLingering()
    }
    return el
  }

  private push(el: MElement) {
    this.stack.push(el)
    this.track(el, 1)
  }

  private removeFromStack(el: MElement) {
    const index = this.stack.lastIndexOf(el)
    if (index === -1) return
    this.stackRemoveAt(index)
    this.closeOrLinger(el)
  }

  /** The appropriate place for inserting a node, with foster parenting. */
  private place(target: MParent = this.current() ?? this.doc): { parent: MParent; before: MNode | null } {
    if (this.fosterParenting && target.kind === 'element' && target.ns === 'html' && TABLE_FOSTER.has(target.name)) {
      let tableIndex = -1
      let templateIndex = -1
      for (let k = this.stack.length - 1; k >= 0; k--) {
        const el = this.stack[k]
        if (el.ns !== 'html') continue
        if (el.name === 'table' && tableIndex === -1) tableIndex = k
        if (el.name === 'template' && templateIndex === -1) templateIndex = k
      }
      if (templateIndex > tableIndex) return { parent: this.stack[templateIndex], before: null }
      if (tableIndex === -1) return { parent: this.stack[0], before: null }
      const table = this.stack[tableIndex]
      if (table.parent) return { parent: table.parent, before: table }
      return { parent: this.stack[tableIndex - 1], before: null }
    }
    return { parent: target, before: null }
  }

  private insertElement(name: string, attrs: Attr[] | Record<string, string>, ns: Ns = 'html', implied = false) {
    const el = this.createElement(name, attrs, ns)
    el.implied = implied
    const { parent, before } = this.place()
    this.insertNode(parent, el, before)
    this.push(el)
    return el
  }

  private insertVoid(name: string, attrs: Attr[]) {
    this.insertElement(name, attrs)
    this.pop()
  }

  private insertText(data: string) {
    const { parent, before } = this.place()
    if (parent.kind === 'root') return
    const index = before ? parent.children.indexOf(before) : parent.children.length
    const previous = parent.children[index - 1]
    if (previous && previous.kind === 'text') {
      previous.value += data
      this.touch(previous)
      return
    }
    const text: MText = { kind: 'text', id: this.createId(), parent: null, dirty: true, snap: null, value: data, open: true }
    this.insertNode(parent, text, before)
  }

  private insertComment(data: string, parent?: MParent) {
    const node: MComment = { kind: 'comment', id: this.createId(), parent: null, dirty: true, snap: null, value: data }
    if (parent) this.insertNode(parent, node)
    else {
      const place = this.place()
      this.insertNode(place.parent, node, place.before)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Scopes and implied end tags

  private isScopeBoundary(el: MElement, extra?: Set<string>) {
    if (el.ns === 'html') {
      return el.name === 'applet' || el.name === 'caption' || el.name === 'html' || el.name === 'table' ||
        el.name === 'td' || el.name === 'th' || el.name === 'marquee' || el.name === 'object' ||
        el.name === 'template' || el.name === 'select' || Boolean(extra?.has(el.name))
    }
    if (el.ns === 'math') return SPECIAL_MATH.has(el.name)
    return SPECIAL_SVG.has(el.name)
  }

  private inScope(names: string | Set<string>, kind: 'default' | 'list' | 'button' | 'table' | 'select' = 'default') {
    if (typeof names === 'string' ? !this.isOpen(names) : ![...names].some(name => this.isOpen(name))) return false
    const match = (el: MElement) => el.ns === 'html' && (typeof names === 'string' ? el.name === names : names.has(el.name))
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const el = this.stack[k]
      if (match(el)) return true
      if (kind === 'table') {
        if (el.ns === 'html' && (el.name === 'html' || el.name === 'table' || el.name === 'template')) return false
      } else if (kind === 'select') {
        if (!(el.ns === 'html' && (el.name === 'optgroup' || el.name === 'option'))) return false
      } else if (this.isScopeBoundary(el, kind === 'list' ? set('ol', 'ul') : kind === 'button' ? set('button') : undefined)) {
        return false
      }
    }
    return false
  }

  private elementInScope(target: MElement) {
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const el = this.stack[k]
      if (el === target) return true
      if (this.isScopeBoundary(el)) return false
    }
    return false
  }

  private generateImpliedEndTags(except?: string, thorough = false) {
    const names = thorough ? IMPLIED_END_THOROUGH : IMPLIED_END
    while (true) {
      const el = this.current()
      if (!el || el.ns !== 'html' || !names.has(el.name) || el.name === except) return
      this.pop()
    }
  }

  private popUntil(names: string | Set<string>) {
    while (this.stack.length) {
      const el = this.pop()!
      if (el.ns === 'html' && (typeof names === 'string' ? el.name === names : names.has(el.name))) return
    }
  }

  private closeP() {
    this.generateImpliedEndTags('p')
    this.popUntil('p')
  }

  private closePInButtonScope() {
    if (this.inScope('p', 'button')) this.closeP()
  }

  private clearStackTo(names: Set<string>) {
    while (this.stack.length) {
      const el = this.current()!
      if (el.ns === 'html' && (names.has(el.name) || el.name === 'html' || el.name === 'template')) return
      this.pop()
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Active formatting elements

  private pushFormatting(el: MElement) {
    let same = 0
    let earliest = -1
    for (let k = this.afe.length - 1; k >= 0; k--) {
      const entry = this.afe[k]
      if (entry === MARKER) break
      if (entry.name === el.name && entry.ns === el.ns && sameAttributes(entry.attrs, el.attrs)) {
        same++
        earliest = k
      }
    }
    if (same >= 3) this.afe.splice(earliest, 1)
    this.afe.push(el)
  }

  private clearFormattingToMarker() {
    while (this.afe.length) {
      if (this.afe.pop() === MARKER) return
    }
  }

  private reconstructFormatting() {
    if (!this.afe.length) return
    let index = this.afe.length - 1
    let entry = this.afe[index]
    if (entry === MARKER || this.onStack.has(entry)) return
    while (index > 0) {
      const previous = this.afe[index - 1]
      if (previous === MARKER || this.onStack.has(previous)) break
      index--
    }
    for (; index < this.afe.length; index++) {
      entry = this.afe[index] as MElement
      const el = this.insertElement(entry.name, { ...entry.attrs }, entry.ns)
      this.afe[index] = el
    }
  }

  /** The adoption agency algorithm, run for end tags of formatting elements. */
  private adoptionAgency(subject: string): boolean {
    const current = this.current()
    if (current && current.ns === 'html' && current.name === subject && !this.afe.includes(current)) {
      this.pop()
      return true
    }
    for (let outer = 0; outer < 8; outer++) {
      let formattingIndex = -1
      for (let k = this.afe.length - 1; k >= 0; k--) {
        const entry = this.afe[k]
        if (entry === MARKER) break
        if (entry.name === subject && entry.ns === 'html') {
          formattingIndex = k
          break
        }
      }
      if (formattingIndex === -1) return false
      const formatting = this.afe[formattingIndex] as MElement
      const stackIndex = this.stack.indexOf(formatting)
      if (stackIndex === -1) {
        this.afe.splice(formattingIndex, 1)
        return true
      }
      if (!this.elementInScope(formatting)) return true

      let furthestBlock: MElement | null = null
      let furthestIndex = -1
      for (let k = stackIndex + 1; k < this.stack.length; k++) {
        if (isSpecial(this.stack[k])) {
          furthestBlock = this.stack[k]
          furthestIndex = k
          break
        }
      }
      if (!furthestBlock) {
        while (this.stack.length > stackIndex) this.pop()
        this.afe.splice(this.afe.indexOf(formatting), 1)
        return true
      }

      const commonAncestor = this.stack[stackIndex - 1]
      let bookmark = this.afe.indexOf(formatting)
      let node: MElement = furthestBlock
      let lastNode: MElement = furthestBlock
      let nodeIndex = furthestIndex
      for (let inner = 1; ; inner++) {
        nodeIndex--
        node = this.stack[nodeIndex]
        if (node === formatting) break
        let afeIndex = this.afe.indexOf(node)
        if (inner > 3 && afeIndex !== -1) {
          this.afe.splice(afeIndex, 1)
          if (afeIndex < bookmark) bookmark--
          afeIndex = -1
        }
        if (afeIndex === -1) {
          this.stackRemoveAt(nodeIndex)
          this.closeOrLinger(node)
          continue
        }
        const replacement = this.createElement(node.name, { ...node.attrs }, node.ns)
        this.afe[afeIndex] = replacement
        this.stackRemoveAt(nodeIndex)
        this.stackInsertAt(nodeIndex, replacement)
        this.closeOrLinger(node)
        node = replacement
        if (lastNode === furthestBlock) bookmark = afeIndex + 1
        this.insertNode(node, lastNode)
        lastNode = node
      }

      const target = this.place(commonAncestor)
      this.insertNode(target.parent, lastNode, target.before)

      const clone = this.createElement(formatting.name, { ...formatting.attrs }, formatting.ns)
      for (const child of [...furthestBlock.children]) this.insertNode(clone, child)
      this.insertNode(furthestBlock, clone)

      const oldAfe = this.afe.indexOf(formatting)
      this.afe.splice(bookmark, 0, clone)
      this.afe.splice(oldAfe < bookmark ? oldAfe : oldAfe + 1, 1)

      this.removeFromStack(formatting)
      this.stackInsertAt(this.stack.indexOf(furthestBlock) + 1, clone)
    }
    return true
  }

  // ---------------------------------------------------------------------------------------------
  // Dispatch

  private dispatch(token: Token) {
    const node = this.current()
    if (!node || node.ns === 'html' || token.type === 'eof') return this.process(this.mode, token)
    const start = token.type === 'start'
    if (isMathTextIntegrationPoint(node) && ((start && token.name !== 'mglyph' && token.name !== 'malignmark') || token.type === 'chars')) {
      return this.process(this.mode, token)
    }
    if (node.ns === 'math' && node.name === 'annotation-xml' && start && token.name === 'svg') {
      return this.process(this.mode, token)
    }
    if (isHtmlIntegrationPoint(node) && (start || token.type === 'chars')) return this.process(this.mode, token)
    this.foreign(token)
  }

  private foreign(token: Token) {
    switch (token.type) {
      case 'chars':
        this.insertText(token.data.replace(/\0/g, '�'))
        if (/[^\t\n\f\r \0]/.test(token.data)) this.framesetOk = false
        return
      case 'comment':
        this.insertComment(token.data)
        return
      case 'doctype':
        return
      case 'start': {
        const breakout = FOREIGN_BREAKOUT.has(token.name) ||
          (token.name === 'font' && token.attrs.some(([n]) => n === 'color' || n === 'face' || n === 'size'))
        if (breakout) {
          while (this.stack.length) {
            const el = this.current()!
            if (el.ns === 'html' || isMathTextIntegrationPoint(el) || isHtmlIntegrationPoint(el)) break
            this.pop()
          }
          return this.process(this.mode, token)
        }
        const ns = this.current()!.ns
        this.insertElement(token.name, token.attrs, ns)
        if (token.selfClosing) this.pop()
        return
      }
      case 'end': {
        if (token.name === 'br' || token.name === 'p') {
          while (this.stack.length) {
            const el = this.current()!
            if (el.ns === 'html' || isMathTextIntegrationPoint(el) || isHtmlIntegrationPoint(el)) break
            this.pop()
          }
          return this.process(this.mode, token)
        }
        for (let k = this.stack.length - 1; k > 0; k--) {
          const el = this.stack[k]
          if (el.name.toLowerCase() === token.name) {
            while (this.stack.length > k) this.pop()
            return
          }
          if (this.stack[k - 1].ns === 'html') return this.process(this.mode, token)
        }
        return
      }
    }
  }

  private process(mode: Mode, token: Token): void {
    switch (mode) {
      case 'initial': return this.initial(token)
      case 'beforeHtml': return this.beforeHtml(token)
      case 'beforeHead': return this.beforeHead(token)
      case 'inHead': return this.inHead(token)
      case 'inHeadNoscript': return this.inHeadNoscript(token)
      case 'afterHead': return this.afterHead(token)
      case 'inBody': return this.inBody(token)
      case 'text': return this.text(token)
      case 'inTable': return this.inTable(token)
      case 'inTableText': return this.inTableText(token)
      case 'inCaption': return this.inCaption(token)
      case 'inColumnGroup': return this.inColumnGroup(token)
      case 'inTableBody': return this.inTableBody(token)
      case 'inRow': return this.inRow(token)
      case 'inCell': return this.inCell(token)
      case 'inSelect': return this.inSelect(token)
      case 'inSelectInTable': return this.inSelectInTable(token)
      case 'inTemplate': return this.inTemplate(token)
      case 'afterBody': return this.afterBody(token)
      case 'afterAfterBody': return this.afterAfterBody(token)
      case 'inFrameset': return this.inFrameset(token)
      case 'afterFrameset': return this.afterFrameset(token)
      case 'afterAfterFrameset': return this.afterAfterFrameset(token)
    }
  }

  /** Split leading whitespace off a chars token; process it, then continue with the rest. */
  private splitWhitespace(token: Token, whitespace: (data: string) => void): Token | null {
    if (token.type !== 'chars') return token
    const lead = LEADING_WS.exec(token.data)?.[0] ?? ''
    if (lead) whitespace(lead)
    const rest = token.data.slice(lead.length)
    return rest ? { type: 'chars', data: rest } : null
  }

  private rawText(token: Extract<Token, { type: 'start' }>, state: TextState) {
    this.insertElement(token.name, token.attrs)
    this.tokenizer.setState(state, token.name)
    this.originalMode = this.mode
    this.mode = 'text'
  }

  private initial(token: Token): void {
    if (token.type === 'chars') {
      const rest = this.splitWhitespace(token, () => {})
      if (!rest) return
      token = rest
    }
    if (token.type === 'comment') return this.insertComment(token.data, this.doc)
    if (token.type === 'doctype') {
      this.doc.doctype = token.raw
      this.quirks = isQuirksDoctype(token.raw)
      this.touch(this.doc)
      this.mode = 'beforeHtml'
      return
    }
    // No doctype: the document is in quirks mode.
    this.quirks = true
    this.mode = 'beforeHtml'
    this.process('beforeHtml', token)
  }

  private beforeHtml(token: Token): void {
    if (token.type === 'chars') {
      const rest = this.splitWhitespace(token, () => {})
      if (!rest) return
      token = rest
    }
    if (token.type === 'doctype') return
    if (token.type === 'comment') return this.insertComment(token.data, this.doc)
    if (token.type === 'start' && token.name === 'html') {
      this.insertElement('html', token.attrs)
      this.mode = 'beforeHead'
      return
    }
    if (token.type === 'end' && !['head', 'body', 'html', 'br'].includes(token.name)) return
    this.insertElement('html', [], 'html', true)
    this.mode = 'beforeHead'
    this.process('beforeHead', token)
  }

  private beforeHead(token: Token): void {
    if (token.type === 'chars') {
      const rest = this.splitWhitespace(token, () => {})
      if (!rest) return
      token = rest
    }
    if (token.type === 'comment') return this.insertComment(token.data)
    if (token.type === 'doctype') return
    if (token.type === 'start' && token.name === 'html') return this.inBody(token)
    if (token.type === 'start' && token.name === 'head') {
      this.head = this.insertElement('head', token.attrs)
      this.mode = 'inHead'
      return
    }
    if (token.type === 'end' && !['head', 'body', 'html', 'br'].includes(token.name)) return
    this.head = this.insertElement('head', [], 'html', true)
    this.mode = 'inHead'
    this.process('inHead', token)
  }

  private inHead(token: Token): void {
    if (token.type === 'chars') {
      const rest = this.splitWhitespace(token, ws => this.insertText(ws))
      if (!rest) return
      token = rest
    }
    if (token.type === 'comment') return this.insertComment(token.data)
    if (token.type === 'doctype') return
    if (token.type === 'start') {
      const name = token.name
      if (name === 'html') return this.inBody(token)
      if (name === 'base' || name === 'basefont' || name === 'bgsound' || name === 'link' || name === 'meta') {
        return this.insertVoid(name, token.attrs)
      }
      if (name === 'title') return this.rawText(token, 'rcdata')
      if (name === 'noscript') {
        this.insertElement(name, token.attrs)
        this.mode = 'inHeadNoscript'
        return
      }
      if (name === 'noframes' || name === 'style') return this.rawText(token, 'rawtext')
      if (name === 'script') return this.rawText(token, 'script')
      if (name === 'template') {
        this.insertElement(name, token.attrs)
        this.afe.push(MARKER)
        // A template in the body rules out a frameset; one in the head does not.
        if (this.mode === 'inBody') this.framesetOk = false
        this.mode = 'inTemplate'
        this.templateModes.push('inTemplate')
        return
      }
      if (name === 'head') return
    }
    if (token.type === 'end') {
      if (token.name === 'head') {
        this.pop()
        this.mode = 'afterHead'
        return
      }
      if (token.name === 'template') {
        if (!this.isOpen('template')) return
        this.generateImpliedEndTags(undefined, true)
        this.popUntil('template')
        this.clearFormattingToMarker()
        this.templateModes.pop()
        this.resetMode()
        return
      }
      if (!['body', 'html', 'br'].includes(token.name)) return
    }
    this.pop()
    this.mode = 'afterHead'
    this.process('afterHead', token)
  }

  private inHeadNoscript(token: Token): void {
    if (token.type === 'doctype') return
    if (token.type === 'start' && token.name === 'html') return this.inBody(token)
    if (token.type === 'end' && token.name === 'noscript') {
      this.pop()
      this.mode = 'inHead'
      return
    }
    if (token.type === 'chars') {
      const rest = this.splitWhitespace(token, ws => this.insertText(ws))
      if (!rest) return
      token = rest
    }
    if (token.type === 'comment') return this.inHead(token)
    if (token.type === 'start' && ['basefont', 'bgsound', 'link', 'meta', 'noframes', 'style'].includes(token.name)) {
      return this.inHead(token)
    }
    if (token.type === 'start' && (token.name === 'head' || token.name === 'noscript')) return
    if (token.type === 'end' && token.name !== 'br') return
    this.pop()
    this.mode = 'inHead'
    this.process('inHead', token)
  }

  private afterHead(token: Token): void {
    if (token.type === 'chars') {
      const rest = this.splitWhitespace(token, ws => this.insertText(ws))
      if (!rest) return
      token = rest
    }
    if (token.type === 'comment') return this.insertComment(token.data)
    if (token.type === 'doctype') return
    if (token.type === 'start') {
      if (token.name === 'html') return this.inBody(token)
      if (token.name === 'body') {
        this.sealHead()
        this.insertElement('body', token.attrs)
        this.framesetOk = false
        this.mode = 'inBody'
        return
      }
      if (token.name === 'frameset') {
        this.sealHead()
        this.insertElement('frameset', token.attrs)
        this.mode = 'inFrameset'
        return
      }
      if (HEAD_START.has(token.name) && this.head) {
        this.push(this.head)
        this.inHead(token)
        const index = this.stack.indexOf(this.head)
        if (index !== -1) this.stackRemoveAt(index)
        return
      }
      if (token.name === 'head') return
    }
    if (token.type === 'end') {
      if (token.name === 'template') return this.inHead(token)
      if (!['body', 'html', 'br'].includes(token.name)) return
    }
    this.sealHead()
    this.insertElement('body', [], 'html', true)
    this.mode = 'inBody'
    this.process('inBody', token)
  }

  private inBody(token: Token): void {
    switch (token.type) {
      case 'chars': {
        const data = token.data.replace(/\0/g, '')
        if (!data) return
        this.reconstructFormatting()
        this.insertText(data)
        if (!WS_ONLY.test(data)) this.framesetOk = false
        return
      }
      case 'comment':
        return this.insertComment(token.data)
      case 'doctype':
        return
      case 'eof':
        if (this.templateModes.length) return this.inTemplate(token)
        return
      case 'start':
        return this.inBodyStart(token)
      case 'end':
        return this.inBodyEnd(token)
    }
  }

  private inBodyStart(token: Extract<Token, { type: 'start' }>): void {
    const name = token.name
    if (name === 'html') {
      if (this.isOpen('template')) return
      this.mergeAttributes(this.stack[0], token.attrs)
      return
    }
    if (HEAD_START.has(name)) return this.inHead(token)
    if (name === 'body') {
      const body = this.stack[1]
      if (!body || !this.is(body, 'body') || this.isOpen('template')) return
      this.framesetOk = false
      this.mergeAttributes(body, token.attrs)
      return
    }
    if (name === 'frameset') {
      const body = this.stack[1]
      if (!body || !this.is(body, 'body') || !this.framesetOk) return
      this.detach(body)
      while (this.stack.length > 1) this.pop()
      this.insertElement('frameset', token.attrs)
      this.mode = 'inFrameset'
      return
    }
    if (CLOSES_P.has(name)) {
      this.closePInButtonScope()
      this.insertElement(name, token.attrs)
      return
    }
    if (HEADINGS.has(name)) {
      this.closePInButtonScope()
      if (HEADINGS.has(this.current()?.name ?? '') && this.current()?.ns === 'html') this.pop()
      this.insertElement(name, token.attrs)
      return
    }
    if (name === 'pre' || name === 'listing') {
      this.closePInButtonScope()
      this.insertElement(name, token.attrs)
      this.skipNewline = true
      this.framesetOk = false
      return
    }
    if (name === 'form') {
      const inTemplate = this.isOpen('template')
      if (this.form && !inTemplate) return
      this.closePInButtonScope()
      const el = this.insertElement(name, token.attrs)
      if (!inTemplate) this.form = el
      return
    }
    if (name === 'li' || name === 'dd' || name === 'dt') {
      this.framesetOk = false
      const matches = name === 'li' ? ['li'] : ['dd', 'dt']
      for (let k = this.stack.length - 1; k >= 0; k--) {
        const el = this.stack[k]
        if (el.ns === 'html' && matches.includes(el.name)) {
          this.generateImpliedEndTags(el.name)
          this.popUntil(el.name)
          break
        }
        if (isSpecial(el) && !(el.ns === 'html' && ['address', 'div', 'p'].includes(el.name))) break
      }
      this.closePInButtonScope()
      this.insertElement(name, token.attrs)
      return
    }
    if (name === 'plaintext') {
      this.closePInButtonScope()
      this.insertElement(name, token.attrs)
      this.tokenizer.setState('plaintext')
      return
    }
    if (name === 'button') {
      if (this.inScope('button')) {
        this.generateImpliedEndTags()
        this.popUntil('button')
      }
      this.reconstructFormatting()
      this.insertElement(name, token.attrs)
      this.framesetOk = false
      return
    }
    if (name === 'a') {
      for (let k = this.afe.length - 1; k >= 0; k--) {
        const entry = this.afe[k]
        if (entry === MARKER) break
        if (entry.name === 'a') {
          this.adoptionAgency('a')
          const afeIndex = this.afe.indexOf(entry)
          if (afeIndex !== -1) this.afe.splice(afeIndex, 1)
          this.removeFromStack(entry)
          break
        }
      }
      this.reconstructFormatting()
      this.pushFormatting(this.insertElement(name, token.attrs))
      return
    }
    if (name === 'nobr') {
      this.reconstructFormatting()
      if (this.inScope('nobr')) {
        if (!this.adoptionAgency('nobr')) this.anyOtherEndTag('nobr')
        this.reconstructFormatting()
      }
      this.pushFormatting(this.insertElement(name, token.attrs))
      return
    }
    if (FORMATTING.has(name)) {
      this.reconstructFormatting()
      this.pushFormatting(this.insertElement(name, token.attrs))
      return
    }
    if (name === 'applet' || name === 'marquee' || name === 'object') {
      this.reconstructFormatting()
      this.insertElement(name, token.attrs)
      this.afe.push(MARKER)
      this.framesetOk = false
      return
    }
    if (name === 'table') {
      if (!this.quirks) this.closePInButtonScope()
      this.insertElement(name, token.attrs)
      this.framesetOk = false
      this.mode = 'inTable'
      return
    }
    if (name === 'input' || name === 'textarea') {
      // A form control closes an open <select>.
      if (this.inScope('select')) this.popUntil('select')
    }
    if (name === 'area' || name === 'br' || name === 'embed' || name === 'img' || name === 'keygen' || name === 'wbr' || name === 'input') {
      this.reconstructFormatting()
      this.insertVoid(name, token.attrs)
      const hidden = name === 'input' && token.attrs.some(([n, v]) => n === 'type' && v.toLowerCase() === 'hidden')
      if (!hidden) this.framesetOk = false
      return
    }
    if (name === 'param' || name === 'source' || name === 'track') return this.insertVoid(name, token.attrs)
    if (name === 'hr') {
      this.closePInButtonScope()
      if (this.inScope('select')) this.generateImpliedEndTags()
      this.insertVoid(name, token.attrs)
      this.framesetOk = false
      return
    }
    if (name === 'image') return this.inBodyStart({ ...token, name: 'img' })
    if (name === 'textarea') {
      this.insertElement(name, token.attrs)
      this.skipNewline = true
      this.framesetOk = false
      this.tokenizer.setState('rcdata', name)
      this.originalMode = this.mode
      this.mode = 'text'
      return
    }
    if (name === 'xmp') {
      this.closePInButtonScope()
      this.reconstructFormatting()
      this.framesetOk = false
      return this.rawText(token, 'rawtext')
    }
    if (name === 'iframe') {
      this.framesetOk = false
      return this.rawText(token, 'rawtext')
    }
    if (name === 'noembed') return this.rawText(token, 'rawtext')
    // Customizable <select>: its content is parsed with the in-body rules.
    if (name === 'select') {
      if (this.inScope('select')) {
        this.popUntil('select')
        return
      }
      this.reconstructFormatting()
      this.insertElement(name, token.attrs)
      this.framesetOk = false
      return
    }
    if (name === 'option') {
      if (this.inScope('select')) this.generateImpliedEndTags('optgroup')
      else if (this.is(this.current(), 'option')) this.pop()
      this.reconstructFormatting()
      this.insertElement(name, token.attrs)
      return
    }
    if (name === 'optgroup') {
      if (this.inScope('select')) this.generateImpliedEndTags()
      else if (this.is(this.current(), 'option')) this.pop()
      this.reconstructFormatting()
      this.insertElement(name, token.attrs)
      return
    }
    if (name === 'rb' || name === 'rtc') {
      if (this.inScope('ruby')) this.generateImpliedEndTags()
      this.insertElement(name, token.attrs)
      return
    }
    if (name === 'rp' || name === 'rt') {
      if (this.inScope('ruby')) this.generateImpliedEndTags('rtc')
      this.insertElement(name, token.attrs)
      return
    }
    if (name === 'math' || name === 'svg') {
      this.reconstructFormatting()
      this.insertElement(name, token.attrs, name)
      if (token.selfClosing) this.pop()
      return
    }
    if (CELL_OR_TABLE_START.has(name) || name === 'frame' || name === 'head') return
    this.reconstructFormatting()
    this.insertElement(name, token.attrs)
  }

  private inBodyEnd(token: Extract<Token, { type: 'end' }>): void {
    const name = token.name
    if (name === 'template') return this.inHead(token)
    if (name === 'body' || name === 'html') {
      if (!this.inScope('body')) return
      this.mode = 'afterBody'
      if (name === 'html') this.process('afterBody', token)
      return
    }
    if (BLOCK_END.has(name)) {
      if (!this.inScope(name)) return
      this.generateImpliedEndTags()
      this.popUntil(name)
      return
    }
    if (name === 'form') {
      if (this.isOpen('template')) {
        if (!this.inScope('form')) return
        this.generateImpliedEndTags()
        this.popUntil('form')
        return
      }
      const node = this.form
      this.form = null
      if (!node || !this.elementInScope(node)) return
      this.generateImpliedEndTags()
      this.removeFromStack(node)
      return
    }
    if (name === 'p') {
      if (!this.inScope('p', 'button')) {
        this.insertElement('p', [])
      }
      this.closeP()
      return
    }
    if (name === 'li') {
      if (!this.inScope('li', 'list')) return
      this.generateImpliedEndTags('li')
      this.popUntil('li')
      return
    }
    if (name === 'dd' || name === 'dt') {
      if (!this.inScope(name)) return
      this.generateImpliedEndTags(name)
      this.popUntil(name)
      return
    }
    if (HEADINGS.has(name)) {
      if (!this.inScope(HEADINGS)) return
      this.generateImpliedEndTags()
      this.popUntil(HEADINGS)
      return
    }
    if (FORMATTING.has(name)) {
      if (!this.adoptionAgency(name)) this.anyOtherEndTag(name)
      return
    }
    if (name === 'applet' || name === 'marquee' || name === 'object') {
      if (!this.inScope(name)) return
      this.generateImpliedEndTags()
      this.popUntil(name)
      this.clearFormattingToMarker()
      return
    }
    if (name === 'br') return this.inBodyStart({ type: 'start', name: 'br', attrs: [], selfClosing: false })
    if (name === 'select') {
      if (this.inScope('select')) this.popUntil('select')
      return
    }
    this.anyOtherEndTag(name)
  }

  private anyOtherEndTag(name: string) {
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const el = this.stack[k]
      if (el.ns === 'html' && el.name === name) {
        this.generateImpliedEndTags(name)
        while (this.stack.length > k) this.pop()
        return
      }
      if (isSpecial(el)) return
    }
  }

  private mergeAttributes(el: MElement | undefined, attrs: Attr[]) {
    if (!el) return
    let changed = false
    for (const [key, value] of attrs) {
      if (!(key in el.attrs)) {
        el.attrs[key] = value
        changed = true
      }
    }
    if (changed) {
      el.implied = false
      this.touch(el)
    }
  }

  private text(token: Token): void {
    if (token.type === 'chars') return this.insertText(token.data)
    if (token.type === 'eof') {
      this.pop()
      this.mode = this.originalMode
      return this.process(this.mode, token)
    }
    if (token.type === 'end') {
      this.pop()
      this.mode = this.originalMode
    }
  }

  private inTable(token: Token): void {
    const current = this.current()
    if (token.type === 'chars' && current && current.ns === 'html' && ['table', 'tbody', 'template', 'tfoot', 'thead', 'tr'].includes(current.name)) {
      this.pendingTableText = []
      this.originalMode = this.mode
      this.mode = 'inTableText'
      return this.inTableText(token)
    }
    if (token.type === 'comment') return this.insertComment(token.data)
    if (token.type === 'doctype') return
    if (token.type === 'start') {
      const name = token.name
      if (name === 'caption') {
        this.clearStackTo(set('table'))
        this.afe.push(MARKER)
        this.insertElement(name, token.attrs)
        this.mode = 'inCaption'
        return
      }
      if (name === 'colgroup') {
        this.clearStackTo(set('table'))
        this.insertElement(name, token.attrs)
        this.mode = 'inColumnGroup'
        return
      }
      if (name === 'col') {
        this.clearStackTo(set('table'))
        this.insertElement('colgroup', [], 'html', true)
        this.mode = 'inColumnGroup'
        return this.inColumnGroup(token)
      }
      if (TABLE_SECTIONS.has(name)) {
        this.clearStackTo(set('table'))
        this.insertElement(name, token.attrs)
        this.mode = 'inTableBody'
        return
      }
      if (name === 'td' || name === 'th' || name === 'tr') {
        this.clearStackTo(set('table'))
        this.insertElement('tbody', [], 'html', true)
        this.mode = 'inTableBody'
        return this.inTableBody(token)
      }
      if (name === 'table') {
        if (!this.inScope('table', 'table')) return
        this.popUntil('table')
        this.resetMode()
        return this.process(this.mode, token)
      }
      if (name === 'style' || name === 'script' || name === 'template') return this.inHead(token)
      if (name === 'input' && token.attrs.some(([n, v]) => n === 'type' && v.toLowerCase() === 'hidden')) {
        this.insertVoid(name, token.attrs)
        return
      }
      if (name === 'form') {
        const inTemplate = this.isOpen('template')
        if (this.form && !inTemplate) return
        const form = this.insertElement(name, token.attrs)
        if (!inTemplate) this.form = form
        this.pop()
        return
      }
    }
    if (token.type === 'end') {
      const name = token.name
      if (name === 'table') {
        if (!this.inScope('table', 'table')) return
        this.popUntil('table')
        this.resetMode()
        return
      }
      if (['body', 'caption', 'col', 'colgroup', 'html', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'].includes(name)) return
      if (name === 'template') return this.inHead(token)
    }
    if (token.type === 'eof') return this.inBody(token)
    this.fosterParenting = true
    this.inBody(token)
    this.fosterParenting = false
  }

  private inTableText(token: Token): void {
    if (token.type === 'chars') {
      const data = token.data.replace(/\0/g, '')
      if (data) this.pendingTableText.push(data)
      return
    }
    const text = this.pendingTableText.join('')
    this.pendingTableText = []
    if (text) {
      if (!WS_ONLY.test(text)) {
        this.fosterParenting = true
        this.reconstructFormatting()
        this.insertText(text)
        this.fosterParenting = false
      } else {
        this.insertText(text)
      }
    }
    this.mode = this.originalMode
    this.process(this.mode, token)
  }

  private closeCaption() {
    this.generateImpliedEndTags()
    this.popUntil('caption')
    this.clearFormattingToMarker()
    this.mode = 'inTable'
  }

  private inCaption(token: Token): void {
    if (token.type === 'end' && token.name === 'caption') {
      if (!this.inScope('caption', 'table')) return
      return this.closeCaption()
    }
    if ((token.type === 'start' && CELL_OR_TABLE_START.has(token.name)) || (token.type === 'end' && token.name === 'table')) {
      if (!this.inScope('caption', 'table')) return
      this.closeCaption()
      return this.inTable(token)
    }
    if (token.type === 'end' && ['body', 'col', 'colgroup', 'html', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr'].includes(token.name)) return
    this.inBody(token)
  }

  private inColumnGroup(token: Token): void {
    if (token.type === 'chars') {
      const rest = this.splitWhitespace(token, ws => this.insertText(ws))
      if (!rest) return
      token = rest
    }
    if (token.type === 'comment') return this.insertComment(token.data)
    if (token.type === 'doctype') return
    if (token.type === 'start' && token.name === 'html') return this.inBody(token)
    if (token.type === 'start' && token.name === 'col') return this.insertVoid('col', token.attrs)
    if (token.type === 'end' && token.name === 'colgroup') {
      if (!this.is(this.current(), 'colgroup')) return
      this.pop()
      this.mode = 'inTable'
      return
    }
    if (token.type === 'end' && token.name === 'col') return
    if ((token.type === 'start' || token.type === 'end') && token.name === 'template') return this.inHead(token)
    if (token.type === 'eof') return this.inBody(token)
    if (!this.is(this.current(), 'colgroup')) return
    this.pop()
    this.mode = 'inTable'
    this.inTable(token)
  }

  private inTableBody(token: Token): void {
    if (token.type === 'start' && token.name === 'tr') {
      this.clearStackTo(TABLE_SECTIONS)
      this.insertElement('tr', token.attrs)
      this.mode = 'inRow'
      return
    }
    if (token.type === 'start' && (token.name === 'th' || token.name === 'td')) {
      this.clearStackTo(TABLE_SECTIONS)
      this.insertElement('tr', [], 'html', true)
      this.mode = 'inRow'
      return this.inRow(token)
    }
    if (token.type === 'end' && TABLE_SECTIONS.has(token.name)) {
      if (!this.inScope(token.name, 'table')) return
      this.clearStackTo(TABLE_SECTIONS)
      this.pop()
      this.mode = 'inTable'
      return
    }
    if ((token.type === 'start' && ['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead'].includes(token.name)) || (token.type === 'end' && token.name === 'table')) {
      if (!this.inScope(TABLE_SECTIONS, 'table')) return
      this.clearStackTo(TABLE_SECTIONS)
      this.pop()
      this.mode = 'inTable'
      return this.inTable(token)
    }
    if (token.type === 'end' && ['body', 'caption', 'col', 'colgroup', 'html', 'td', 'th', 'tr'].includes(token.name)) return
    this.inTable(token)
  }

  private inRow(token: Token): void {
    if (token.type === 'start' && (token.name === 'th' || token.name === 'td')) {
      this.clearStackTo(set('tr'))
      this.insertElement(token.name, token.attrs)
      this.mode = 'inCell'
      this.afe.push(MARKER)
      return
    }
    if (token.type === 'end' && token.name === 'tr') {
      if (!this.inScope('tr', 'table')) return
      this.clearStackTo(set('tr'))
      this.pop()
      this.mode = 'inTableBody'
      return
    }
    if ((token.type === 'start' && ['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead', 'tr'].includes(token.name)) || (token.type === 'end' && token.name === 'table')) {
      if (!this.inScope('tr', 'table')) return
      this.clearStackTo(set('tr'))
      this.pop()
      this.mode = 'inTableBody'
      return this.inTableBody(token)
    }
    if (token.type === 'end' && TABLE_SECTIONS.has(token.name)) {
      if (!this.inScope(token.name, 'table') || !this.inScope('tr', 'table')) return
      this.clearStackTo(set('tr'))
      this.pop()
      this.mode = 'inTableBody'
      return this.inTableBody(token)
    }
    if (token.type === 'end' && ['body', 'caption', 'col', 'colgroup', 'html', 'td', 'th'].includes(token.name)) return
    this.inTable(token)
  }

  private closeCell() {
    this.generateImpliedEndTags()
    this.popUntil(set('td', 'th'))
    this.clearFormattingToMarker()
    this.mode = 'inRow'
  }

  private inCell(token: Token): void {
    if (token.type === 'end' && (token.name === 'td' || token.name === 'th')) {
      if (!this.inScope(token.name, 'table')) return
      this.generateImpliedEndTags()
      this.popUntil(token.name)
      this.clearFormattingToMarker()
      this.mode = 'inRow'
      return
    }
    if (token.type === 'start' && CELL_OR_TABLE_START.has(token.name)) {
      if (!this.inScope(set('td', 'th'), 'table')) return
      this.closeCell()
      return this.inRow(token)
    }
    if (token.type === 'end' && ['body', 'caption', 'col', 'colgroup', 'html'].includes(token.name)) return
    if (token.type === 'end' && ['table', 'tbody', 'tfoot', 'thead', 'tr'].includes(token.name)) {
      if (!this.inScope(token.name, 'table')) return
      this.closeCell()
      return this.inRow(token)
    }
    this.inBody(token)
  }

  private inSelect(token: Token): void {
    switch (token.type) {
      case 'chars': {
        const data = token.data.replace(/\0/g, '')
        if (data) this.insertText(data)
        return
      }
      case 'comment':
        return this.insertComment(token.data)
      case 'doctype':
        return
      case 'eof':
        return this.inBody(token)
      case 'start': {
        const name = token.name
        if (name === 'html') return this.inBody(token)
        if (name === 'option') {
          if (this.is(this.current(), 'option')) this.pop()
          this.insertElement(name, token.attrs)
          return
        }
        if (name === 'optgroup') {
          if (this.is(this.current(), 'option')) this.pop()
          if (this.is(this.current(), 'optgroup')) this.pop()
          this.insertElement(name, token.attrs)
          return
        }
        if (name === 'hr') {
          if (this.is(this.current(), 'option')) this.pop()
          if (this.is(this.current(), 'optgroup')) this.pop()
          this.insertVoid(name, token.attrs)
          return
        }
        if (name === 'select') {
          if (!this.inScope('select', 'select')) return
          this.popUntil('select')
          this.resetMode()
          return
        }
        if (name === 'input' || name === 'keygen' || name === 'textarea') {
          if (!this.inScope('select', 'select')) return
          this.popUntil('select')
          this.resetMode()
          return this.process(this.mode, token)
        }
        if (name === 'script' || name === 'template') return this.inHead(token)
        return
      }
      case 'end': {
        const name = token.name
        if (name === 'optgroup') {
          const previous = this.stack[this.stack.length - 2]
          if (this.is(this.current(), 'option') && this.is(previous, 'optgroup')) this.pop()
          if (this.is(this.current(), 'optgroup')) this.pop()
          return
        }
        if (name === 'option') {
          if (this.is(this.current(), 'option')) this.pop()
          return
        }
        if (name === 'select') {
          if (!this.inScope('select', 'select')) return
          this.popUntil('select')
          this.resetMode()
          return
        }
        if (name === 'template') return this.inHead(token)
        return
      }
    }
  }

  private inSelectInTable(token: Token): void {
    const tableish = ['caption', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'td', 'th']
    if (token.type === 'start' && tableish.includes(token.name)) {
      this.popUntil('select')
      this.resetMode()
      return this.process(this.mode, token)
    }
    if (token.type === 'end' && tableish.includes(token.name)) {
      if (!this.inScope(token.name, 'table')) return
      this.popUntil('select')
      this.resetMode()
      return this.process(this.mode, token)
    }
    this.inSelect(token)
  }

  private inTemplate(token: Token): void {
    if (token.type === 'chars' || token.type === 'comment' || token.type === 'doctype') return this.inBody(token)
    if (token.type === 'start') {
      const name = token.name
      if (HEAD_START.has(name)) return this.inHead(token)
      const next: Mode =
        ['caption', 'colgroup', 'tbody', 'tfoot', 'thead'].includes(name) ? 'inTable' :
        name === 'col' ? 'inColumnGroup' :
        name === 'tr' ? 'inTableBody' :
        name === 'td' || name === 'th' ? 'inRow' : 'inBody'
      this.templateModes[this.templateModes.length - 1] = next
      this.mode = next
      return this.process(next, token)
    }
    if (token.type === 'end') {
      if (token.name === 'template') return this.inHead(token)
      return
    }
    // eof
    if (!this.isOpen('template')) return
    this.popUntil('template')
    this.clearFormattingToMarker()
    this.templateModes.pop()
    this.resetMode()
    this.process(this.mode, token)
  }

  private afterBody(token: Token): void {
    if (token.type === 'chars' && WS_ONLY.test(token.data)) return this.inBody(token)
    if (token.type === 'comment') return this.insertComment(token.data, this.stack[0])
    if (token.type === 'doctype') return
    if (token.type === 'start' && token.name === 'html') return this.inBody(token)
    if (token.type === 'end' && token.name === 'html') {
      this.mode = 'afterAfterBody'
      return
    }
    if (token.type === 'eof') return
    this.mode = 'inBody'
    this.inBody(token)
  }

  private afterAfterBody(token: Token): void {
    if (token.type === 'comment') return this.insertComment(token.data, this.doc)
    if (token.type === 'doctype' || (token.type === 'chars' && WS_ONLY.test(token.data)) || (token.type === 'start' && token.name === 'html')) {
      return this.inBody(token)
    }
    if (token.type === 'eof') return
    this.mode = 'inBody'
    this.inBody(token)
  }

  private inFrameset(token: Token): void {
    if (token.type === 'chars') {
      const ws = token.data.replace(/[^\t\n\f\r ]/g, '')
      if (ws) this.insertText(ws)
      return
    }
    if (token.type === 'comment') return this.insertComment(token.data)
    if (token.type === 'start') {
      if (token.name === 'html') return this.inBody(token)
      if (token.name === 'frameset') return void this.insertElement('frameset', token.attrs)
      if (token.name === 'frame') return this.insertVoid('frame', token.attrs)
      if (token.name === 'noframes') return this.inHead(token)
      return
    }
    if (token.type === 'end' && token.name === 'frameset') {
      if (this.stack.length <= 1) return
      this.pop()
      if (!this.is(this.current(), 'frameset')) this.mode = 'afterFrameset'
    }
  }

  private afterFrameset(token: Token): void {
    if (token.type === 'chars') {
      const ws = token.data.replace(/[^\t\n\f\r ]/g, '')
      if (ws) this.insertText(ws)
      return
    }
    if (token.type === 'comment') return this.insertComment(token.data)
    if (token.type === 'start' && token.name === 'html') return this.inBody(token)
    if (token.type === 'start' && token.name === 'noframes') return this.inHead(token)
    if (token.type === 'end' && token.name === 'html') this.mode = 'afterAfterFrameset'
  }

  private afterAfterFrameset(token: Token): void {
    if (token.type === 'comment') return this.insertComment(token.data, this.doc)
    if (token.type === 'doctype' || (token.type === 'start' && token.name === 'html')) return this.inBody(token)
    if (token.type === 'chars') {
      const ws = token.data.replace(/[^\t\n\f\r ]/g, '')
      if (ws) this.inBody({ type: 'chars', data: ws })
      return
    }
    if (token.type === 'start' && token.name === 'noframes') return this.inHead(token)
  }

  private resetMode() {
    for (let k = this.stack.length - 1; k >= 0; k--) {
      const node = this.stack[k]
      const last = k === 0
      const name = node.ns === 'html' ? node.name : ''
      if ((name === 'td' || name === 'th') && !last) return void (this.mode = 'inCell')
      if (name === 'tr') return void (this.mode = 'inRow')
      if (TABLE_SECTIONS.has(name)) return void (this.mode = 'inTableBody')
      if (name === 'caption') return void (this.mode = 'inCaption')
      if (name === 'colgroup') return void (this.mode = 'inColumnGroup')
      if (name === 'table') return void (this.mode = 'inTable')
      if (name === 'template') return void (this.mode = this.templateModes[this.templateModes.length - 1] ?? 'inBody')
      if (name === 'head' && !last) return void (this.mode = 'inHead')
      if (name === 'body') return void (this.mode = 'inBody')
      if (name === 'frameset') return void (this.mode = 'inFrameset')
      if (name === 'html') return void (this.mode = this.head ? 'afterHead' : 'beforeHead')
      if (last) return void (this.mode = 'inBody')
    }
    this.mode = 'inBody'
  }
}

function sameAttributes(a: Record<string, string>, b: Record<string, string>) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => a[key] === b[key])
}

function isSpecial(el: MElement) {
  if (el.ns === 'html') return SPECIAL.has(el.name)
  if (el.ns === 'math') return SPECIAL_MATH.has(el.name)
  return SPECIAL_SVG.has(el.name)
}

function isMathTextIntegrationPoint(el: MElement) {
  return el.ns === 'math' && (el.name === 'mi' || el.name === 'mo' || el.name === 'mn' || el.name === 'ms' || el.name === 'mtext')
}

function isHtmlIntegrationPoint(el: MElement) {
  if (el.ns === 'svg') return el.name === 'foreignObject' || el.name === 'desc' || el.name === 'title'
  if (el.ns === 'math' && el.name === 'annotation-xml') {
    const encoding = (el.attrs.encoding || '').toLowerCase()
    return encoding === 'text/html' || encoding === 'application/xhtml+xml'
  }
  return false
}

const QUIRKS_PUBLIC_PREFIXES = [
  '+//silmaril//dtd html pro v0r11 19970101//', '-//as//dtd html 3.0 aswedit + extensions//',
  '-//advasoft ltd//dtd html 3.0 aswedit + extensions//', '-//ietf//dtd html 2.0', '-//ietf//dtd html 2.1e//',
  '-//ietf//dtd html 3.0//', '-//ietf//dtd html 3.2', '-//ietf//dtd html 3//', '-//ietf//dtd html level',
  '-//ietf//dtd html strict', '-//ietf//dtd html//', '-//metrius//dtd metrius presentational//',
  '-//microsoft//dtd internet explorer', '-//netscape comm. corp.//dtd html//',
  '-//netscape comm. corp.//dtd strict html//', "-//o'reilly and associates//dtd html",
  '-//softquad software//dtd hotmetal pro', '-//softquad//dtd hotmetal pro',
  '-//spyglass//dtd html 2.0 extended//', '-//sq//dtd html 2.0 hotmetal + extensions//',
  '-//sun microsystems corp.//dtd hotjava html//', '-//sun microsystems corp.//dtd hotjava strict html//',
  '-//w3c//dtd html 3 1995-03-24//', '-//w3c//dtd html 3.2', '-//w3c//dtd html 4.0 frameset//',
  '-//w3c//dtd html 4.0 transitional//', '-//w3c//dtd html experimental', '-//w3c//dtd w3 html//',
  '-//w3o//dtd w3 html 3.0//', '-//webtechs//dtd mozilla html',
]

/** Quirks mode from the doctype (HTML spec, "the initial insertion mode"). */
function isQuirksDoctype(raw: string) {
  const match = /^doctype\s*([^\s>]*)\s*([\s\S]*)$/i.exec(raw.trim())
  if (!match || match[1].toLowerCase() !== 'html') return true
  const ids = /^(public|system)\s*(?:"([^"]*)"|'([^']*)')?\s*(?:"([^"]*)"|'([^']*)')?/i.exec(match[2])
  if (!ids) return false
  const isPublic = ids[1].toLowerCase() === 'public'
  const first = ids[2] ?? ids[3]
  const second = ids[4] ?? ids[5]
  const publicId = isPublic ? (first ?? '').toLowerCase() : ''
  const systemId = isPublic ? second : first
  if (isPublic && first === undefined) return true
  if (publicId === '-//w3o//dtd w3 html strict 3.0//en//' || publicId === '-/w3c/dtd html 4.0 transitional/en' || publicId === 'html') return true
  if (systemId?.toLowerCase() === 'http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd') return true
  if (QUIRKS_PUBLIC_PREFIXES.some(prefix => publicId.startsWith(prefix))) return true
  if (systemId === undefined && (publicId.startsWith('-//w3c//dtd html 4.01 frameset//') || publicId.startsWith('-//w3c//dtd html 4.01 transitional//'))) return true
  return false
}
