import tokenize from './tokenize'
import utils from './utils'

function isEmpty(stack) {
  return stack.length === 0
}

function getTop(stack) {
  return stack[stack.length - 1]
}

function appendChild(node, child) {
  if (!node.children) {
    node.children = []
  }
  node.children.push(filterProps(child))
}

function filterProps(node) {
  if (typeof node === 'string') {
    return node
  }
  return ['name', 'children', 'attributes'].reduce(
    (r, c) => Object.assign({}, r, {[c]: node[c]}),
    {},
  )
}

function parse(src) {
  const tokens = tokenize(src)
  const stack = []
  const tree = {
    type: 'root',
    children: [],
  }

  stack.push(tree)
  while (!isEmpty(stack) && !isEmpty(tokens)) {
    const curr = tokens.shift()
    const top = getTop(stack)

    if (curr.type === 'string') {
      appendChild(top, curr.value)
    } else if (utils.isPair(top, curr)) {
      const node = stack.pop()
      if (!isEmpty(stack)) {
        appendChild(getTop(stack), node)
      }
    } else if (curr.type === 'self-close') {
      appendChild(top, curr)
    } else if (curr.type === 'start') {
      stack.push(curr)
    }
  }
  return tree.children
}

export default parse
