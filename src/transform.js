function transform(ast, rule) {
  function next(node, index) {
    if (node) {
      if (typeof node === 'string') {
        return rule(node, undefined, index)
      }
      if (Array.isArray(node)) {
        return node.map((n, index) => {
          if (typeof n !== 'string') {
            n.index = index // critical array element index
          }
          return rule(n, next(n.children), index)
        })
      } else {
        return rule(node, next(node.children), index)
      }
    }
    return null
  }
  return next(ast)
}

export default transform
