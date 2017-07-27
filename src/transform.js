function transform(node, next) {
  if (node == null || (node && !Array.isArray(node) && !node.name)) {
    return node
  } else if (node && Array.isArray(node)) {
    return node.map((n, idx) => {
      const props = Object.assign({}, n.attribues, {key: idx})
      return next(n.name, props, transform(n.children, next))
    })
  } else {
    return next(node.name, node.attribues, transform(node.children, next))
  }
}

module.exports = transform
