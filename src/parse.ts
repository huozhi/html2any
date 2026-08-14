import { tokenize } from './tokenize'
import { isPair } from './utils'
import type { AstNode, ElementNode, Token } from './types'

function isEmpty<T>(stack: T[]) {
  return stack.length === 0
}

function getTop<T>(stack: T[]) {
  return stack[stack.length - 1]
}

function appendChild(node: ElementNode, child: AstNode) {
  if (!node.children) {
    node.children = []
  }
  node.children.push(filterProps(child))
}

function filterProps(node: AstNode): AstNode {
  if (typeof node === 'string') {
    return node
  }
  return {
    name: node.name,
    children: node.children,
    attributes: node.attributes,
  }
}

export function parse(src: string): AstNode[] {
  const tokens = tokenize(src)
  const stack: ElementNode[] = []
  const tree: ElementNode = {
    type: 'root',
    children: [],
    name: 'root',
    attributes: {},
  }

  stack.push(tree)
  while (!isEmpty(stack) && !isEmpty(tokens)) {
    const curr = tokens[0] as Token
    tokens.splice(0, 1)
    const top = getTop(stack)

    if (curr.type === 'string') {
      appendChild(top, curr.value)
    } else if (isPair(top, curr)) {
      const node = stack.pop() as ElementNode
      if (!isEmpty(stack)) {
        appendChild(getTop(stack), node)
      }
    } else if (curr.type === 'self-close') {
      appendChild(top, curr)
    } else if (curr.type === 'start') {
      stack.push(curr as ElementNode)
    }
  }

  while (stack.length > 1) {
    const node = stack.pop() as ElementNode
    appendChild(getTop(stack), node)
  }

  return tree.children || []
}

export default parse
