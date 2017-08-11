function transform (ast, rule) {
  function next (node) {
    if (node) {
      if (typeof node === 'string') {
        return rule(node)
      }
      if (Array.isArray(node)) {
        return node.map((n, index) => {
          if (typeof n !== 'string') {
            n.index = index // critical array element index
          }
          return rule(n, next(n.children))
        })
      } else {
        return rule(node, next(node.children))
      }
    }
    return null
  }
  return next(ast)
}

module.exports = transform
