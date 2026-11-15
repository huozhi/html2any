import type { HtmlElement, HtmlNode, HtmlParent, HtmlRoot, HtmlText } from './types'

export type IdGenerator = () => string

/** An id generator that continues after the largest `n<number>` id in the tree. */
export function createIdGenerator(root: HtmlRoot, prefix = 'n'): IdGenerator {
  let max = 0
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  walk(root, node => {
    const match = pattern.exec(node.id)
    if (match) max = Math.max(max, Number(match[1]))
  })
  return () => `${prefix}${++max}`
}

/** Visit descendants in document order; return false from `visit` to skip a subtree. Iterative. */
export function walk(node: HtmlParent | HtmlNode, visit: (node: HtmlNode, parent: HtmlParent) => void | false) {
  if (node.type !== 'element' && node.type !== 'root') return
  const stack: [HtmlNode, HtmlParent][] = []
  for (let k = node.children.length - 1; k >= 0; k--) stack.push([node.children[k], node])
  while (stack.length) {
    const [child, parent] = stack.pop()!
    if (visit(child, parent) === false || child.type !== 'element') continue
    for (let k = child.children.length - 1; k >= 0; k--) stack.push([child.children[k], child])
  }
}

type PathEntry = { node: HtmlParent | HtmlNode; index: number }

/** Path from the root to the node with `id`, each entry carrying its index in the parent. */
export function findPath(root: HtmlRoot, id: string): PathEntry[] | null {
  if (root.id === id) return [{ node: root, index: -1 }]
  // Depth-first search with an explicit stack of [parent, next child index].
  const path: PathEntry[] = [{ node: root, index: -1 }]
  const cursor: number[] = [0]
  while (path.length) {
    const parent = path[path.length - 1].node as HtmlParent
    const i = cursor[cursor.length - 1]
    if (i >= parent.children.length) {
      path.pop()
      cursor.pop()
      continue
    }
    cursor[cursor.length - 1] = i + 1
    const child = parent.children[i]
    if (child.id === id) {
      path.push({ node: child, index: i })
      return path
    }
    if (child.type === 'element' && child.children.length) {
      path.push({ node: child, index: i })
      cursor.push(0)
    }
  }
  return null
}

export function getNode(root: HtmlRoot, id: string): HtmlParent | HtmlNode | undefined {
  const path = findPath(root, id)
  return path ? path[path.length - 1].node : undefined
}

export function getParent(root: HtmlRoot, id: string): HtmlParent | undefined {
  const path = findPath(root, id)
  return path && path.length > 1 ? (path[path.length - 2].node as HtmlParent) : undefined
}

function rebuild(path: PathEntry[], replacement: HtmlParent | HtmlNode | null): HtmlRoot {
  let current = replacement
  for (let k = path.length - 1; k > 0; k--) {
    const parent = path[k - 1].node as HtmlParent
    const children = parent.children.slice()
    if (current) children[path[k].index] = current as HtmlNode
    else children.splice(path[k].index, 1)
    current = { ...parent, children } as HtmlParent
  }
  return current as HtmlRoot
}

/** Immutably replace the node with `id`. Untouched subtrees keep their identity. */
export function updateNode<T extends HtmlParent | HtmlNode>(root: HtmlRoot, id: string, update: (node: T) => T): HtmlRoot {
  const path = findPath(root, id)
  if (!path) return root
  const node = path[path.length - 1].node as T
  const next = update(node)
  if (next === node) return root
  if (path.length === 1) return next as unknown as HtmlRoot
  return rebuild(path, next)
}

export function removeNode(root: HtmlRoot, id: string): HtmlRoot {
  const path = findPath(root, id)
  if (!path || path.length === 1) return root
  return rebuild(path, null)
}

export function insertNode(root: HtmlRoot, parentId: string, index: number, node: HtmlNode): HtmlRoot {
  return updateNode<HtmlParent>(root, parentId, parent => {
    const children = parent.children.slice()
    children.splice(Math.max(0, Math.min(index, children.length)), 0, node)
    return { ...parent, children }
  })
}

export function setAttribute(root: HtmlRoot, id: string, name: string, value: string | null): HtmlRoot {
  return updateNode<HtmlElement>(root, id, node => {
    if (node.type !== 'element') return node
    if (value === null && !(name in node.attributes)) return node
    if (value !== null && node.attributes[name] === value) return node
    const attributes = { ...node.attributes }
    if (value === null) delete attributes[name]
    else attributes[name] = value
    return { ...node, attributes }
  })
}

export function cloneNode<T extends HtmlNode>(node: T, createId: IdGenerator): T {
  if (node.type !== 'element') return { ...node, id: createId() }
  return {
    ...node,
    id: createId(),
    attributes: { ...node.attributes },
    children: node.children.map(child => cloneNode(child, createId)),
  }
}

/** Insert a deep copy right after the node. Returns the new tree and the copy's id. */
export function duplicateNode(root: HtmlRoot, id: string, createId: IdGenerator): { root: HtmlRoot; id: string | null } {
  const path = findPath(root, id)
  if (!path || path.length < 2) return { root, id: null }
  const entry = path[path.length - 1]
  const parent = path[path.length - 2].node as HtmlParent
  const copy = cloneNode(entry.node as HtmlNode, createId)
  return { root: insertNode(root, parent.id, entry.index + 1, copy), id: copy.id }
}

/** Move a node among its element siblings (skipping whitespace text). */
export function moveSibling(root: HtmlRoot, id: string, direction: -1 | 1): HtmlRoot {
  const path = findPath(root, id)
  if (!path || path.length < 2) return root
  const parent = path[path.length - 2].node as HtmlParent
  const from = path[path.length - 1].index
  let to = from + direction
  while (to >= 0 && to < parent.children.length && parent.children[to].type === 'text' && !/\S/.test((parent.children[to] as HtmlText).value)) {
    to += direction
  }
  if (to < 0 || to >= parent.children.length) return root
  return updateNode<HtmlParent>(root, parent.id, p => {
    const children = p.children.slice()
    const [node] = children.splice(from, 1)
    children.splice(to, 0, node)
    return { ...p, children }
  })
}

/** Text content, without scripts, styles and comments. Iterative. */
export function textContent(node: HtmlNode | HtmlParent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'comment') return ''
  let out = ''
  walk(node, child => {
    if (child.type === 'text') out += child.value
    else if (child.type === 'element') {
      const lower = child.name.toLowerCase()
      if (lower === 'script' || lower === 'style' || lower === 'template') return false
    }
  })
  return out
}
