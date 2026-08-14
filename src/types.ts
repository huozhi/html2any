export type AttributeValue = string | boolean

export type Attributes = Record<string, AttributeValue | undefined>

export type TextNode = string

export type ElementNode = {
  name: string
  attributes: Attributes
  children?: AstNode[]
  index?: number
  type?: 'root' | 'start' | 'self-close'
}

export type AstNode = TextNode | ElementNode

export type Token =
  | {
    type: 'string'
    value: string
  }
  | {
    type: 'start' | 'self-close'
    name: string
    attributes: Attributes
  }
  | {
    type: 'end'
    name: string
  }

export type TransformRule<Result = unknown> = (
  node: AstNode,
  children: Result | Result[] | null | undefined,
  index?: number,
) => Result
