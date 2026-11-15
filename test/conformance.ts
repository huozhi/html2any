/**
 * html5lib tree-construction test runner (test data from web-platform-tests, see test/html5lib).
 * Prints our tree in the same format as the `#document` sections and compares the strings.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStreamParser } from '../src/stream/parser'
import type { HtmlNode, HtmlRoot } from '../src/stream/types'

export type TreeTest = {
  file: string
  index: number
  data: string
  document: string
  fragment?: string
  scripting?: 'on' | 'off'
}

const DIR = join(import.meta.dir, 'html5lib')

export function loadTests(): TreeTest[] {
  const tests: TreeTest[] = []
  for (const file of readdirSync(DIR).filter(f => f.endsWith('.dat')).sort()) {
    const text = readFileSync(join(DIR, file), 'utf8')
    const chunks = text.split(/^#data\n/m).slice(1)
    chunks.forEach((chunk, index) => {
      const sections: Record<string, string[]> = {}
      let current = 'data'
      sections.data = []
      for (const line of chunk.split('\n')) {
        const heading = /^#(errors|new-errors|document-fragment|script-off|script-on|document|description)$/.exec(line)
        if (heading) {
          current = heading[1]
          sections[current] = []
          continue
        }
        sections[current].push(line)
      }
      tests.push({
        file,
        index,
        data: sections.data.join('\n'),
        document: (sections.document || []).join('\n').replace(/\n+$/, ''),
        fragment: sections['document-fragment']?.join('\n').trim(),
        scripting: 'script-on' in sections ? 'on' : 'script-off' in sections ? 'off' : undefined,
      })
    })
  }
  return tests
}

function formatDoctype(raw: string) {
  const body = raw.replace(/^doctype/i, '')
  const match = /^\s*([^\s>]*)\s*(.*)$/s.exec(body)!
  const name = match[1].toLowerCase()
  const rest = match[2]
  const ids = /^(public|system)\s*(?:"([^"]*)"|'([^']*)')?\s*(?:"([^"]*)"|'([^']*)')?/i.exec(rest)
  if (!ids || (ids[2] ?? ids[3] ?? ids[4] ?? ids[5]) === undefined) return `<!DOCTYPE ${name}>`
  const isPublic = ids[1].toLowerCase() === 'public'
  const first = ids[2] ?? ids[3] ?? ''
  const second = ids[4] ?? ids[5] ?? ''
  const publicId = isPublic ? first : ''
  const systemId = isPublic ? second : first
  return `<!DOCTYPE ${name} "${publicId}" "${systemId}">`
}

// Attributes the parser puts in a namespace on foreign elements ("adjust foreign attributes").
const FOREIGN_ATTRS = new Set([
  'xlink:actuate', 'xlink:arcrole', 'xlink:href', 'xlink:role', 'xlink:show', 'xlink:title', 'xlink:type',
  'xml:lang', 'xml:space', 'xmlns:xlink',
])

function attributeName(name: string, foreign: boolean) {
  if (!foreign) return name
  if (name === 'xmlns') return 'xmlns xmlns'
  return FOREIGN_ATTRS.has(name) ? name.replace(':', ' ') : name
}

export function formatTree(root: HtmlRoot): string {
  const lines: string[] = []
  if (root.doctype !== undefined) lines.push(`| ${formatDoctype(root.doctype)}`)
  const stack: [HtmlNode, number][] = []
  for (let k = root.children.length - 1; k >= 0; k--) stack.push([root.children[k], 0])
  while (stack.length) {
    const [node, depth] = stack.pop()!
    const indent = '| ' + '  '.repeat(depth)
    if (node.type === 'text') {
      lines.push(`${indent}"${node.value}"`)
      continue
    }
    if (node.type === 'comment') {
      lines.push(`${indent}<!-- ${node.value} -->`)
      continue
    }
    const prefix = node.namespace ? `${node.namespace} ` : ''
    lines.push(`${indent}<${prefix}${node.name}>`)
    const attrs = Object.entries(node.attributes)
      .map(([name, value]) => [attributeName(name, Boolean(node.namespace)), value] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [name, value] of attrs) lines.push(`${indent}  ${name}="${value}"`)
    let childDepth = depth + 1
    if (node.name === 'template' && !node.namespace) {
      lines.push(`${indent}  content`)
      childDepth++
    }
    for (let k = node.children.length - 1; k >= 0; k--) stack.push([node.children[k], childDepth])
  }
  return lines.join('\n')
}

export function runTest(test: TreeTest, chunkSize?: number): string {
  const parser = createStreamParser({ stripCodeFence: false })
  if (chunkSize) {
    for (let i = 0; i < test.data.length; i += chunkSize) parser.write(test.data.slice(i, i + chunkSize))
  } else {
    parser.write(test.data)
  }
  return formatTree(parser.end())
}

/** Tests we run: full documents, parsed with scripting disabled. */
export function isSupported(test: TreeTest) {
  // Processing instructions are a new spec feature this parser does not implement yet.
  return !test.fragment && test.scripting !== 'on' && test.file !== 'processing-instructions.dat'
}
