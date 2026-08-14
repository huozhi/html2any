import { parse } from './parse'
import type { AstNode, ElementNode } from './types'

type TextOptions = {
  preserveLines?: boolean
}

type PageContext = {
  title: string
  description: string
  url: string
}

type LinkContext = {
  label: string
  href: string
}

type ActionContext = LinkContext & {
  role: string
  selector: string
}

type CodeExample = {
  language: string
  code: string
  section: string
}

type SectionContext = {
  heading: string
  level: number
  summary: string
  content: string[]
  code_examples: CodeExample[]
  links: LinkContext[]
}

type FormField = {
  name: string
  label: string
  type: string
  required: boolean
}

type FormContext = {
  fields: FormField[]
  submit: Pick<ActionContext, 'label' | 'role'> | null
}

type ExtractedContext = {
  page: PageContext
  sections: SectionContext[]
  actions: ActionContext[]
  forms: FormContext[]
  navigation: LinkContext[]
  code_examples: CodeExample[]
}

type ExtractOptions = {
  url?: string
}

const DROP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'svg',
  'canvas',
])

const NAV_TAGS = new Set(['nav'])
const CHROME_TAGS = new Set(['header', 'footer', 'aside'])
const BLOCK_TAGS = new Set([
  'article',
  'blockquote',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'li',
  'main',
  'p',
  'section',
  'summary',
])
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const LIST_TAGS = new Set(['ul', 'ol'])

function tagName(node: AstNode | undefined | null) {
  if (!node || typeof node === 'string') {
    return ''
  }
  return typeof node === 'string' ? '' : String(node.name || '').toLowerCase()
}

function attrs(node: AstNode | undefined | null) {
  return node && typeof node !== 'string' ? node.attributes : {}
}

function decodeEntity(entity: string) {
  const named: Record<string, string | undefined> = {
    amp: '&',
    apos: "'",
    copy: '(c)',
    hellip: '...',
    gt: '>',
    lt: '<',
    mdash: '--',
    nbsp: ' ',
    ndash: '-',
    reg: '(r)',
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    trade: '(tm)',
    quot: '"',
  }
  if (entity[0] === '#') {
    const code = entity[1] && entity[1].toLowerCase() === 'x'
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
      return `&${entity};`
    }
    if (code <= 0xffff) {
      return String.fromCharCode(code)
    }
    const offset = code - 0x10000
    return String.fromCharCode(0xd800 + Math.floor(offset / 0x400), 0xdc00 + (offset % 0x400))
  }
  const namedValue = named[entity]
  return namedValue !== undefined ? namedValue : `&${entity};`
}

function decodeHtml(value: string | boolean | undefined | null) {
  const input = value === undefined || value === null || value === false ? '' : String(value)
  let output = ''
  let cursor = 0
  while (cursor < input.length) {
    const ampersand = input.indexOf('&', cursor)
    if (ampersand === -1) {
      output += input.slice(cursor)
      break
    }
    output += input.slice(cursor, ampersand)
    const semicolon = input.indexOf(';', ampersand + 1)
    if (semicolon === -1) {
      output += input.slice(ampersand)
      break
    }
    const entity = input.slice(ampersand + 1, semicolon)
    if (/^([a-zA-Z][a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+)$/.test(entity)) {
      output += decodeEntity(entity)
      cursor = semicolon + 1
    } else {
      output += '&'
      cursor = ampersand + 1
    }
  }
  return output
}

function compactText(value: string | boolean | undefined | null) {
  return decodeHtml(value)
    .replace(/\s+/g, ' ')
    .trim()
}

function compactLines(value: string | undefined | null) {
  return decodeHtml(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

function compactInline(value: string) {
  return compactText(value).replace(/\s+([.,;:!?])/g, '$1')
}

function isHidden(node: AstNode | undefined | null) {
  const nodeAttrs = attrs(node)
  const style = String(nodeAttrs.style || '').toLowerCase()
  return nodeAttrs.hidden === true ||
    String(nodeAttrs['aria-hidden']).toLowerCase() === 'true' ||
    /display\s*:\s*none/.test(style) ||
    /visibility\s*:\s*hidden/.test(style)
}

function shouldDrop(node: AstNode | undefined | null) {
  return DROP_TAGS.has(tagName(node)) || isHidden(node)
}

function childrenOf(node: AstNode | undefined | null): AstNode[] {
  return node && typeof node !== 'string' && Array.isArray(node.children) ? node.children : []
}

function textOf(node: AstNode | undefined | null, options: TextOptions = {}): string {
  if (typeof node === 'string') {
    return options.preserveLines ? compactLines(node) : compactText(node)
  }
  if (!node || shouldDrop(node)) {
    return ''
  }

  const name = tagName(node)
  if (name === 'br') {
    return '\n'
  }
  if (name === 'img') {
    return compactText(attrs(node).alt || attrs(node).title || '')
  }

  const joined = childrenOf(node).map(child => textOf(child, options)).filter(Boolean).join(options.preserveLines ? '\n' : ' ')
  return options.preserveLines ? compactLines(joined) : compactText(joined)
}

function inlineText(node: AstNode | undefined | null, links: LinkContext[]): string {
  if (typeof node === 'string') {
    return compactText(node)
  }
  if (!node || shouldDrop(node)) {
    return ''
  }

  const name = tagName(node)
  const nodeAttrs = attrs(node)
  if (name === 'br') {
    return '\n'
  }
  if (name === 'code') {
    const code = textOf(node)
    return code ? `\`${code.replace(/`/g, '\\`')}\`` : ''
  }
  if (name === 'a') {
    const label = textOf(node) || compactText(nodeAttrs.href || '')
    const href = compactText(nodeAttrs.href || '')
    if (label && href) {
      links.push({ label, href })
      return `[${escapeMarkdown(label)}](${href})`
    }
    return label
  }
  if (name === 'img') {
    return compactText(nodeAttrs.alt || nodeAttrs.title || '')
  }

  return compactInline(childrenOf(node).map(child => inlineText(child, links)).filter(Boolean).join(' '))
}

function escapeMarkdown(value: string) {
  return String(value).replace(/([\[\]])/g, '\\$1')
}

function pushUnique<T>(list: T[], item: T | null | undefined, key: (item: T) => string) {
  if (!item || !key(item)) {
    return
  }
  if (!list.some(existing => key(existing) === key(item))) {
    list.push(item)
  }
}

function extractMeta(roots: AstNode[], sourceUrl: string) {
  const page: PageContext = {
    title: '',
    description: '',
    url: sourceUrl || '',
  }

  function visit(node: AstNode) {
    if (!node || typeof node === 'string') {
      return
    }
    const name = tagName(node)
    const nodeAttrs = attrs(node)
    if (name === 'title' && !page.title) {
      page.title = textOf(node)
    } else if (name === 'meta') {
      const metaName = String(nodeAttrs.name || nodeAttrs.property || '').toLowerCase()
      if ((metaName === 'description' || metaName === 'og:description') && !page.description) {
        page.description = compactText(nodeAttrs.content || '')
      } else if (metaName === 'og:title' && !page.title) {
        page.title = compactText(nodeAttrs.content || '')
      } else if (metaName === 'og:url' && !page.url) {
        page.url = compactText(nodeAttrs.content || '')
      }
    } else if (name === 'link' && String(nodeAttrs.rel || '').toLowerCase() === 'canonical' && !page.url) {
      page.url = compactText(nodeAttrs.href || '')
    }

    childrenOf(node).forEach(visit)
  }

  roots.forEach(visit)
  return page
}

function extractRows(node: AstNode) {
  const rows: string[][] = []
  function visit(rowNode: AstNode) {
    if (!rowNode || typeof rowNode === 'string' || shouldDrop(rowNode)) {
      return
    }
    if (tagName(rowNode) === 'tr') {
      const cells = childrenOf(rowNode)
        .filter(child => ['td', 'th'].includes(tagName(child)))
        .map(cell => textOf(cell))
        .filter(Boolean)
      if (cells.length) {
        rows.push(cells)
      }
      return
    }
    childrenOf(rowNode).forEach(visit)
  }
  visit(node)
  return rows
}

function tableToMarkdown(rows: string[][]) {
  if (!rows.length) {
    return ''
  }
  const width = Math.max(...rows.map(row => row.length))
  const normalized = rows.map(row => Array.from({ length: width }, (_, index) => compactText(row[index] || '')))
  const header = normalized[0]
  const separator = header.map(() => '---')
  return [header, separator, ...normalized.slice(1)]
    .map(row => `| ${row.map(cell => cell.replace(/\|/g, '\\|')).join(' | ')} |`)
    .join('\n')
}

function listToMarkdown(node: AstNode, depth = 0): string {
  const ordered = tagName(node) === 'ol'
  return childrenOf(node)
    .filter(child => tagName(child) === 'li')
    .map((child, index) => {
      const links: LinkContext[] = []
      const direct = childrenOf(child)
        .filter(grandchild => !LIST_TAGS.has(tagName(grandchild)))
        .map(grandchild => inlineText(grandchild, links))
        .filter(Boolean)
        .join(' ')
      const nested = childrenOf(child)
        .filter(grandchild => LIST_TAGS.has(tagName(grandchild)))
        .map(grandchild => listToMarkdown(grandchild, depth + 1))
        .filter(Boolean)
        .join('\n')
      const marker = ordered ? `${index + 1}.` : '-'
      const line = `${'  '.repeat(depth)}${marker} ${compactText(direct || textOf(child))}`
      return nested ? `${line}\n${nested}` : line
    })
    .filter(Boolean)
    .join('\n')
}

function fieldFromInput(node: AstNode) {
  const name = tagName(node)
  const nodeAttrs = attrs(node)
  if (!['input', 'select', 'textarea'].includes(name)) {
    return null
  }
  if (['hidden', 'submit', 'button', 'reset'].includes(String(nodeAttrs.type || '').toLowerCase())) {
    return null
  }
  return {
    name: compactText(nodeAttrs.name || nodeAttrs.id || ''),
    label: compactText(nodeAttrs['aria-label'] || nodeAttrs.placeholder || ''),
    type: compactText(nodeAttrs.type || name),
    required: nodeAttrs.required === true,
  }
}

function extractForm(node: AstNode) {
  const fields: FormField[] = []
  const submit: Pick<ActionContext, 'label' | 'role'>[] = []

  function visit(child: AstNode) {
    if (!child || typeof child === 'string' || shouldDrop(child)) {
      return
    }
    const name = tagName(child)
    const nodeAttrs = attrs(child)
    const field = fieldFromInput(child)
    if (field) {
      fields.push(field)
    }
    if (name === 'button' || (name === 'input' && ['submit', 'button'].includes(String(nodeAttrs.type || '').toLowerCase()))) {
      submit.push({
        label: compactText(textOf(child) || nodeAttrs.value || nodeAttrs['aria-label'] || 'submit'),
        role: 'submit',
      })
    }
    childrenOf(child).forEach(visit)
  }

  visit(node)
  return {
    fields,
    submit: submit[0] !== undefined ? submit[0] : null,
  }
}

function createSection(heading = '', level = 1): SectionContext {
  return {
    heading,
    level,
    summary: '',
    content: [],
    code_examples: [],
    links: [],
  }
}

function extractContext(html: string, options: ExtractOptions = {}): ExtractedContext {
  const roots = parse(html)
  const page = extractMeta(roots, options.url || '')
  const sections: SectionContext[] = []
  const actions: ActionContext[] = []
  const forms: FormContext[] = []
  const navigation: LinkContext[] = []
  const codeExamples: CodeExample[] = []
  let current = createSection('', 1)

  function commitSection() {
    if (current.content.length || current.code_examples.length || current.links.length) {
      current.summary = current.content.find(Boolean) || ''
      sections.push(current)
    }
  }

  function addContent(value: string) {
    const text = compactLines(value)
    if (text && !current.content.includes(text)) {
      current.content.push(text)
    }
  }

  function addCode(code: string, language: string) {
    const cleanCode = compactLines(code)
    if (!cleanCode) {
      return
    }
    const item = {
      language: language || '',
      code: cleanCode,
      section: current.heading,
    }
    current.code_examples.push(item)
    codeExamples.push(item)
  }

  function visit(node: AstNode, inChrome: boolean) {
    if (!node || typeof node === 'string' || shouldDrop(node)) {
      return
    }

    const name = tagName(node)
    const nodeAttrs = attrs(node)
    const chrome = inChrome || CHROME_TAGS.has(name)

    if (NAV_TAGS.has(name)) {
      collectNavigation(node, navigation)
      return
    }
    if (chrome) {
      collectNavigation(node, navigation)
      collectActions(node, actions)
      return
    }
    if (HEADING_TAGS.has(name)) {
      const heading = textOf(node)
      if (heading) {
        commitSection()
        current = createSection(heading, Number(name.slice(1)))
      }
      return
    }
    if (name === 'pre') {
      let codeNode: AstNode | null = null
      for (const child of childrenOf(node)) {
        if (tagName(child) === 'code') {
          codeNode = child
          break
        }
      }
      const targetNode = codeNode !== null ? codeNode : node
      const languageClass = compactText(attrs(targetNode).class || attrs(targetNode).className || attrs(node).class || '')
      addCode(textOf(targetNode, { preserveLines: true }), languageClass.replace(/^language-/, ''))
      return
    }
    if (name === 'table') {
      const table = tableToMarkdown(extractRows(node))
      if (table) {
        addContent(table)
      }
      return
    }
    if (LIST_TAGS.has(name)) {
      addContent(listToMarkdown(node))
      return
    }
    if (name === 'form') {
      forms.push(extractForm(node))
      childrenOf(node).forEach(child => visit(child, chrome))
      return
    }
    if (name === 'a' || name === 'button') {
      collectAction(node, actions)
    }
    if (name === 'p' || name === 'blockquote' || name === 'summary' || name === 'figcaption') {
      const links: LinkContext[] = []
      const text = inlineText(node, links)
      links.forEach(link => pushUnique(current.links, link, item => `${item.label}\n${item.href}`))
      addContent(text)
      return
    }
    if (name === 'code' && !childrenOf(node).some(child => typeof child !== 'string')) {
      addContent(`\`${textOf(node)}\``)
      return
    }
    if (BLOCK_TAGS.has(name)) {
      const blockChildren = childrenOf(node)
      const hasStructuredChild = blockChildren.some(child => {
        const childName = tagName(child)
        return HEADING_TAGS.has(childName) || LIST_TAGS.has(childName) || ['p', 'pre', 'table', 'form'].includes(childName)
      })
      if (!hasStructuredChild && textOf(node)) {
        const links: LinkContext[] = []
        const text = inlineText(node, links)
        links.forEach(link => pushUnique(current.links, link, item => `${item.label}\n${item.href}`))
        addContent(text)
        return
      }
    }

    childrenOf(node).forEach(child => visit(child, chrome))
  }

  roots.forEach(root => visit(root, false))
  commitSection()

  return {
    page,
    sections: sections.filter(section => section.content.length > 0 || section.code_examples.length > 0 || section.heading !== 'Page'),
    actions,
    forms: forms.filter(form => form.fields.length > 0 || form.submit !== null),
    navigation,
    code_examples: codeExamples,
  }
}

function collectNavigation(node: AstNode, navigation: LinkContext[]) {
  if (!node || typeof node === 'string' || shouldDrop(node)) {
    return
  }
  if (tagName(node) === 'a') {
    const label = textOf(node)
    const href = compactText(attrs(node).href || '')
    if (label && href) {
      pushUnique(navigation, { label, href }, item => `${item.label}\n${item.href}`)
    }
  }
  childrenOf(node).forEach(child => collectNavigation(child, navigation))
}

function collectAction(node: AstNode, actions: ActionContext[]) {
  const name = tagName(node)
  const nodeAttrs = attrs(node)
  const label = compactText(textOf(node) || nodeAttrs.value || nodeAttrs['aria-label'] || nodeAttrs.title || '')
  const href = compactText(nodeAttrs.href || '')
  const role = compactText(nodeAttrs.role || (name === 'button' ? 'button' : href ? 'link' : ''))
  if (label && (href || role)) {
    pushUnique(actions, {
      label,
      role,
      href,
      selector: selectorFor(node as ElementNode),
    }, item => `${item.label}\n${item.href}\n${item.role}`)
  }
}

function collectActions(node: AstNode, actions: ActionContext[]) {
  if (!node || typeof node === 'string' || shouldDrop(node)) {
    return
  }
  if (['a', 'button'].includes(tagName(node))) {
    collectAction(node, actions)
  }
  childrenOf(node).forEach(child => collectActions(child, actions))
}

function selectorFor(node: ElementNode) {
  const nodeAttrs = attrs(node)
  if (nodeAttrs.id) {
    return `#${nodeAttrs.id}`
  }
  if (nodeAttrs.name) {
    return `${tagName(node)}[name="${nodeAttrs.name}"]`
  }
  if (nodeAttrs.href) {
    return `${tagName(node)}[href="${nodeAttrs.href}"]`
  }
  return tagName(node)
}

function renderMarkdown(context: ExtractedContext) {
  const lines: string[] = []
  if (context.page.title) {
    lines.push(`# ${context.page.title}`)
  }
  if (context.page.description) {
    lines.push(context.page.description)
  }
  if (context.page.url) {
    lines.push(`Source: ${context.page.url}`)
  }

  context.sections.forEach(section => {
    if (section.heading && section.heading !== context.page.title) {
      lines.push('', `${'#'.repeat(Math.min(Math.max(section.level, 2), 6))} ${section.heading}`)
    }
    section.content.forEach(item => {
      lines.push('', item)
    })
    section.code_examples.forEach(example => {
      lines.push('', `\`\`\`${example.language || ''}`, example.code, '```')
    })
  })

  return `${lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n').trim()}\n`
}

function htmlToMarkdown(html: string, options: ExtractOptions = {}) {
  return renderMarkdown(extractContext(html, options))
}

export { extractContext, htmlToMarkdown, renderMarkdown }
