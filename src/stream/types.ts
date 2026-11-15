export type HtmlText = {
  type: 'text'
  id: string
  value: string
  /** true while the stream may still append to this text */
  open: boolean
}

export type HtmlComment = {
  type: 'comment'
  id: string
  value: string
  open: false
}

export type HtmlElement = {
  type: 'element'
  id: string
  name: string
  attributes: Record<string, string>
  children: HtmlNode[]
  /** true until the element is closed (by its end tag or by the parser's recovery rules) */
  open: boolean
  /** Created by the parser without a tag in the source (html, head, body, tbody, ...). */
  implied?: true
  /** Set for SVG and MathML elements. */
  namespace?: 'svg' | 'math'
}

export type HtmlRoot = {
  type: 'root'
  id: string
  children: HtmlNode[]
  open: boolean
  doctype?: string
}

export type HtmlNode = HtmlText | HtmlComment | HtmlElement
export type HtmlParent = HtmlRoot | HtmlElement
