import { documentParts } from '../../../src/stream/serialize'
import type { HtmlElement, HtmlNode, HtmlRoot } from '../../../src/stream'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MATH_NS = 'http://www.w3.org/1998/Math/MathML'

function namespaceOf(el: Element): 'html' | 'svg' | 'math' {
  return el.namespaceURI === SVG_NS ? 'svg' : el.namespaceURI === MATH_NS ? 'math' : 'html'
}
// Never rendered on the canvas (kept in the document and in the export).
const INERT = new Set(['script', 'noscript', 'object', 'embed', 'base', 'applet'])
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data'])
const RAW = new Set(['style', 'textarea', 'title', 'xmp'])
const PHRASING = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins',
  'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup',
  'time', 'tt', 'u', 'var', 'br', 'wbr', 'img', 'svg',
])

export const EDITOR_FRAME_CSS = `
[data-h2a-hover]:not([data-h2a-sel]) { outline: 1px dashed rgba(0, 79, 214, .55) !important; outline-offset: -1px !important; }
[data-h2a-sel] { outline: 2px solid #004fd6 !important; outline-offset: -2px !important; }
[data-h2a-editing] { outline: 2px solid #004fd6 !important; outline-offset: 3px !important; cursor: text !important; caret-color: #004fd6; box-shadow: 0 0 0 6px rgba(0, 79, 214, .12) !important; }
[data-h2a-stream]::after { content: ""; display: inline-block; width: .45em; height: 1em; margin-left: 2px; vertical-align: -0.14em; border-radius: 1px; background: #004fd6; animation: h2a-blink 1s steps(2, start) infinite; }
@keyframes h2a-blink { to { visibility: hidden; } }
html { cursor: default; }
`

export const FRAME_SKELETON = `<!doctype html><html><head><meta charset="utf-8"><style data-h2a-editor>${EDITOR_FRAME_CSS}</style></head><body></body></html>`

export type RendererCallbacks = {
  /** Managed element ids from the clicked element up to <body>; `clicks` is the click count. */
  onSelect(chain: string[], clicks: number): void
  onHover(chain: string[]): void
  onCommitText(id: string, html: string): void
  onEditingChange(id: string | null): void
  onKeyDown(event: KeyboardEvent): void
  onViewportChange(): void
}

type Namespace = 'html' | 'svg' | 'math'

function isSafeAttribute(name: string, value: string) {
  if (/^on/i.test(name)) return false
  if (URL_ATTRS.has(name.toLowerCase()) && /^\s*(javascript|vbscript):/i.test(value)) return false
  if (name === 'http-equiv') return false
  return true
}

export class CanvasRenderer {
  private doc: Document
  private callbacks: RendererCallbacks
  private domById = new Map<string, Node>()
  private lastById = new Map<string, HtmlNode>()
  private idByDom = new WeakMap<Node, string>()
  private astById = new Map<string, HtmlElement>()
  private bodyId: string | null = null
  private bodyAttrs: Record<string, string> = {}
  private baseEl: HTMLBaseElement | null = null
  private editing: { id: string; el: HTMLElement; original: string } | null = null
  private selected: string | null = null
  private hovered: string | null = null
  private streamEl: Element | null = null
  private readOnly = false
  private disposers: (() => void)[] = []

  constructor(doc: Document, callbacks: RendererCallbacks) {
    this.doc = doc
    this.callbacks = callbacks
    this.listen()
  }

  dispose() {
    this.disposers.forEach(fn => fn())
    this.disposers = []
  }

  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly
    if (readOnly && this.editing) this.finishEditing(true)
  }

  setBaseUrl(url: string) {
    if (!url) {
      this.baseEl?.remove()
      this.baseEl = null
      return
    }
    if (!this.baseEl) {
      this.baseEl = this.doc.createElement('base')
      this.baseEl.setAttribute('data-h2a-editor', '')
      this.doc.head.prepend(this.baseEl)
    }
    this.baseEl.href = url
  }

  render(root: HtmlRoot, streaming: boolean) {
    const parts = documentParts(root)
    this.syncChildren(this.doc.head, parts.headNodes, 'html')
    if (parts.body) {
      this.bodyId = parts.body.id
      this.idByDom.set(this.doc.body, parts.body.id)
      this.astById.set(parts.body.id, parts.body)
      this.syncAttributes(this.doc.body, this.bodyAttrs, parts.body.attributes, false)
      this.bodyAttrs = parts.body.attributes
    } else {
      this.bodyId = null
      this.syncAttributes(this.doc.body, this.bodyAttrs, {}, false)
      this.bodyAttrs = {}
    }
    if (parts.html) {
      this.syncAttributes(this.doc.documentElement, {}, parts.html.attributes, false)
    }
    this.syncChildren(this.doc.body, parts.bodyNodes, 'html')
    this.markStreaming(streaming ? parts.bodyNodes : null)
    this.applyHighlight()
    this.callbacks.onViewportChange()
  }

  setSelected(id: string | null) {
    this.selected = id
    this.applyHighlight()
  }

  setHovered(id: string | null) {
    this.hovered = id
    this.applyHighlight()
  }

  getElement(id: string): Element | null {
    if (id === this.bodyId) return this.doc.body
    const node = this.domById.get(id)
    return node && node.nodeType === 1 && (node as Element).isConnected ? (node as Element) : null
  }

  scrollIntoView(id: string) {
    const el = this.getElement(id)
    if (!el || el === this.doc.body) return
    const rect = el.getBoundingClientRect()
    const view = this.doc.defaultView
    if (!view) return
    if (rect.bottom < 0 || rect.top > view.innerHeight) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  startEditing(id: string) {
    if (this.readOnly) return
    const el = this.getElement(id) as HTMLElement | null
    if (!el || el === this.doc.body) return
    if (this.editing) this.finishEditing(false)
    this.editing = { id, el, original: el.innerHTML }
    el.setAttribute('contenteditable', 'true')
    el.setAttribute('data-h2a-editing', '')
    el.setAttribute('spellcheck', 'false')
    el.focus({ preventScroll: true })
    this.callbacks.onEditingChange(id)
  }

  get editingId() {
    return this.editing?.id ?? null
  }

  finishEditing(cancel: boolean) {
    const editing = this.editing
    if (!editing) return
    this.editing = null
    const { el, id, original } = editing
    el.removeAttribute('contenteditable')
    el.removeAttribute('data-h2a-editing')
    el.removeAttribute('spellcheck')
    if (cancel) {
      el.innerHTML = original
      // Re-link the restored DOM on the next render.
      this.lastById.delete(id)
    } else {
      let html = el.innerHTML
      // Browsers leave a trailing <br> in emptied contenteditable elements.
      html = html.replace(/<br>$/, '')
      if (html !== original) {
        this.lastById.delete(id)
        this.callbacks.onCommitText(id, html)
      }
    }
    this.callbacks.onEditingChange(null)
  }

  private listen() {
    const doc = this.doc
    const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void, capture = true) => {
      doc.addEventListener(type, fn as EventListener, capture)
      this.disposers.push(() => doc.removeEventListener(type, fn as EventListener, capture))
    }

    on('click', e => {
      const target = e.target as Node
      if (this.editing && this.editing.el.contains(target)) return
      e.preventDefault()
      if (this.editing) this.finishEditing(false)
      this.callbacks.onSelect(this.chainOf(target), e.detail || 1)
    })

    on('dblclick', e => {
      if (this.readOnly) return
      const id = this.findEditableId(e.target as Node)
      if (!id) return
      e.preventDefault()
      this.callbacks.onSelect([id], 2)
      this.startEditing(id)
    })

    on('mouseover', e => {
      this.callbacks.onHover(this.chainOf(e.target as Node))
    })

    doc.documentElement.addEventListener('mouseleave', () => this.callbacks.onHover([]))

    on('submit', e => e.preventDefault())

    on('keydown', e => {
      if (this.editing) {
        if (e.key === 'Escape') {
          e.preventDefault()
          this.finishEditing(true)
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          this.finishEditing(false)
        } else if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault()
          doc.execCommand('insertLineBreak')
        }
        return
      }
      this.callbacks.onKeyDown(e)
    })

    on('paste', e => {
      if (!this.editing) return
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain') || ''
      doc.execCommand('insertText', false, text)
    })

    on('focusout', e => {
      if (this.editing && e.target === this.editing.el) this.finishEditing(false)
    })

    const view = doc.defaultView
    if (view) {
      const onViewport = () => this.callbacks.onViewportChange()
      view.addEventListener('scroll', onViewport, { passive: true })
      view.addEventListener('resize', onViewport)
      this.disposers.push(() => {
        view.removeEventListener('scroll', onViewport)
        view.removeEventListener('resize', onViewport)
      })
    }
  }

  private chainOf(node: Node | null): string[] {
    const chain: string[] = []
    let current: Node | null = node
    while (current) {
      const id = this.idByDom.get(current)
      if (id && current.nodeType === 1) chain.push(id)
      current = current.parentNode
    }
    return chain
  }

  private findManagedId(node: Node | null): string | null {
    let current: Node | null = node
    while (current) {
      const id = this.idByDom.get(current)
      if (id && current.nodeType === 1) return id
      current = current.parentNode
    }
    return null
  }

  /** The outermost element of a run of text content around the target, e.g. <p> for a <b> inside it. */
  private findEditableId(target: Node | null): string | null {
    let id = this.findManagedId(target)
    if (!id || id === this.bodyId) return null
    let el = this.getElement(id)
    while (el && el.parentElement && el.parentElement !== this.doc.body) {
      const parentId = this.idByDom.get(el.parentElement)
      const parentAst = parentId ? this.astById.get(parentId) : undefined
      if (!parentAst || !hasDirectText(parentAst)) break
      id = parentId as string
      el = el.parentElement
    }
    const ast = this.astById.get(id)
    if (!ast) return null
    const lower = ast.name.toLowerCase()
    if (RAW.has(lower) || lower === 'svg' || lower === 'img' || lower === 'input' || lower === 'select') return null
    if (!hasDirectText(ast) && !onlyInline(ast)) return null
    return id
  }

  private applyHighlight() {
    const doc = this.doc
    doc.querySelectorAll('[data-h2a-sel]').forEach(el => el.removeAttribute('data-h2a-sel'))
    doc.querySelectorAll('[data-h2a-hover]').forEach(el => el.removeAttribute('data-h2a-hover'))
    if (this.selected) this.getElement(this.selected)?.setAttribute('data-h2a-sel', '')
    if (this.hovered && this.hovered !== this.selected) this.getElement(this.hovered)?.setAttribute('data-h2a-hover', '')
  }

  private markStreaming(bodyNodes: HtmlNode[] | null) {
    this.streamEl?.removeAttribute('data-h2a-stream')
    this.streamEl = null
    if (!bodyNodes) return
    // Follow the open path to the element that is currently receiving text.
    let nodes = bodyNodes
    let target: HtmlElement | null = null
    while (true) {
      const last = [...nodes].reverse().find(n => n.type === 'element' || /\S/.test(n.value))
      if (!last || last.type !== 'element' || !last.open) break
      target = last
      nodes = last.children
    }
    if (!target || RAW.has(target.name.toLowerCase())) return
    const el = this.getElement(target.id)
    if (!el) return
    el.setAttribute('data-h2a-stream', '')
    this.streamEl = el
  }

  private syncChildren(parent: Node, nodes: HtmlNode[], ns: Namespace) {
    const desired: Node[] = []
    for (const node of nodes) desired.push(this.renderNode(node, ns))
    let ref = parent.firstChild
    for (const dom of desired) {
      while (ref && isEditorOwned(ref)) ref = ref.nextSibling
      if (ref === dom) {
        ref = ref.nextSibling
        continue
      }
      parent.insertBefore(dom, ref)
    }
    while (ref) {
      const next = ref.nextSibling
      if (!isEditorOwned(ref)) parent.removeChild(ref)
      ref = next
    }
  }

  private renderNode(node: HtmlNode, ns: Namespace): Node {
    const prev = this.lastById.get(node.id)
    let dom = this.domById.get(node.id)
    if (node.type === 'element') this.indexAst(node)

    // Structural sharing: an unchanged, still attached subtree needs no work at all.
    if (dom && prev === node && dom.isConnected && this.editing?.id !== node.id) return dom

    if (node.type === 'text') {
      if (dom && dom.nodeType === 3) {
        if ((dom as Text).data !== node.value) (dom as Text).data = node.value
      } else {
        dom = this.doc.createTextNode(node.value)
      }
      this.remember(node, dom)
      return dom
    }

    if (node.type === 'comment') {
      if (dom && dom.nodeType === 8) {
        if ((dom as Comment).data !== node.value) (dom as Comment).data = node.value
      } else {
        dom = this.doc.createComment(node.value)
      }
      this.lastById.set(node.id, node)
      this.domById.set(node.id, dom)
      return dom
    }

    const lower = node.name.toLowerCase()
    if (INERT.has(lower) || (lower === 'meta' && 'http-equiv' in node.attributes)) {
      if (!dom || dom.nodeType !== 8) dom = this.doc.createComment(lower)
      this.remember(node, dom)
      return dom
    }

    // Parsed nodes carry their namespace; hand-made ones (outline edits) inherit SVG from the parent.
    const nextNs: Namespace = node.namespace === 'svg' || (!node.namespace && (lower === 'svg' || (ns === 'svg' && lower !== 'foreignobject'))) ? 'svg'
      : node.namespace === 'math' ? 'math' : 'html'
    let el = dom as Element | undefined
    let prevAttrs = prev && prev.type === 'element' ? prev.attributes : {}
    if (!el || el.nodeType !== 1 || el.nodeName.toLowerCase() !== lower || namespaceOf(el) !== nextNs) {
      el = nextNs === 'svg' ? this.doc.createElementNS(SVG_NS, node.name)
        : nextNs === 'math' ? this.doc.createElementNS(MATH_NS, node.name)
        : this.doc.createElement(node.name)
      prevAttrs = {}
    }
    this.syncAttributes(el, prevAttrs, node.attributes, prevAttrs === node.attributes && el === dom)
    this.remember(node, el)

    if (this.editing?.id === node.id) return el
    if (RAW.has(lower)) {
      const text = node.children.map(child => (child.type === 'text' ? child.value : '')).join('')
      if (el.textContent !== text) el.textContent = text
      for (const child of node.children) this.lastById.set(child.id, child)
    } else {
      const childNs: Namespace = nextNs === 'svg' && lower !== 'foreignobject' ? 'svg' : nextNs === 'math' ? 'math' : 'html'
      this.syncChildren(el, node.children, childNs)
    }
    return el
  }

  private indexAst(node: HtmlElement) {
    this.astById.set(node.id, node)
  }

  private remember(node: HtmlNode, dom: Node) {
    this.lastById.set(node.id, node)
    if (node.type === 'element' || dom.nodeType === 3) {
      this.domById.set(node.id, dom)
      this.idByDom.set(dom, node.id)
    }
  }

  private syncAttributes(el: Element, prev: Record<string, string>, next: Record<string, string>, unchanged: boolean) {
    if (unchanged) return
    for (const name in prev) {
      if (!(name in next)) {
        try {
          el.removeAttribute(name)
        } catch {}
      }
    }
    for (const name in next) {
      const value = next[name]
      if (prev[name] === value && el.hasAttribute(name)) continue
      if (!isSafeAttribute(name, value)) continue
      try {
        el.setAttribute(name, value)
      } catch {
        // Invalid attribute names from frameworks (`@click`, `:class`) are kept in the tree only.
      }
    }
  }
}

function isEditorOwned(node: Node) {
  return node.nodeType === 1 && (node as Element).hasAttribute('data-h2a-editor')
}

function hasDirectText(node: HtmlElement) {
  return node.children.some(child => child.type === 'text' && /\S/.test(child.value))
}

function onlyInline(node: HtmlElement): boolean {
  return node.children.every(child => {
    if (child.type !== 'element') return true
    const lower = child.name.toLowerCase()
    return PHRASING.has(lower) && onlyInline(child)
  })
}
