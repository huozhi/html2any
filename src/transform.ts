import type { AstNode, ElementNode, TransformRule } from './types'

function transform<Result = unknown>(ast: AstNode, rule: TransformRule<Result>) {
  function next(node: AstNode | AstNode[] | undefined, index?: number): Result | Result[] | null {
    if (node) {
      if (typeof node === 'string') {
        return rule(node, undefined, index)
      }
      if (Array.isArray(node)) {
        return node.map((n, index) => {
          if (typeof n !== 'string') {
            n.index = index // critical array element index
          }
          return rule(n, next(typeof n === 'string' ? undefined : n.children), index)
        })
      } else {
        return rule(node, next((node as ElementNode).children), index)
      }
    }
    return null
  }
  return next(ast)
}

export default transform
