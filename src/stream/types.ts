export type HtmlText = {
  type: 'text'
  id: string
  value: string
  /** true while the stream may still append to this text */
  open: boolean
}

export type HtmlElement = {
  type: 'element'
  id: string
  name: string
  attributes: Record<string, string>
  children: HtmlNode[]
  /** true until the closing tag (or an implied close) has been seen */
  open: boolean
}

export type HtmlRoot = {
  type: 'root'
  id: string
  children: HtmlNode[]
  open: boolean
  doctype?: string
}

export type HtmlNode = HtmlText | HtmlElement
export type HtmlParent = HtmlRoot | HtmlElement
