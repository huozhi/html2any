import parse from './parse'

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

function tagName(node) {
  return typeof node === 'string' ? '' : String(node.name || '').toLowerCase()
}

function attrs(node) {
  return node && typeof node !== 'string' ? node.attributes || {} : {}
}

function decodeEntity(entity) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  if (entity[0] === '#') {
    const code = entity[1] && entity[1].toLowerCase() === 'x'
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`
  }
  return Object.prototype.hasOwnProperty.call(named, entity) ? named[entity] : `&${entity};`
}

function decodeHtml(value) {
  return String(value || '').replace(/&([a-zA-Z][a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);/g, (_, entity) => decodeEntity(entity))
}

function compactText(value) {
  return decodeHtml(value)
    .replace(/\s+/g, ' ')
    .trim()
}

function compactLines(value) {
  return decodeHtml(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

function compactInline(value) {
  return compactText(value).replace(/\s+([.,;:!?])/g, '$1')
}

function isHidden(node) {
  const nodeAttrs = attrs(node)
  const style = String(nodeAttrs.style || '').toLowerCase()
  return nodeAttrs.hidden === true ||
    String(nodeAttrs['aria-hidden']).toLowerCase() === 'true' ||
    /display\s*:\s*none/.test(style) ||
    /visibility\s*:\s*hidden/.test(style)
}

function shouldDrop(node) {
  return DROP_TAGS.has(tagName(node)) || isHidden(node)
}

function childrenOf(node) {
  return node && typeof node !== 'string' && Array.isArray(node.children) ? node.children : []
}

function textOf(node, options = {}) {
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

function inlineText(node, links) {
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

function escapeMarkdown(value) {
  return String(value).replace(/([\[\]])/g, '\\$1')
}

function pushUnique(list, item, key) {
  if (!item || !key(item)) {
    return
  }
  if (!list.some(existing => key(existing) === key(item))) {
    list.push(item)
  }
}

function extractMeta(roots, sourceUrl) {
  const page = {
    title: '',
    description: '',
    url: sourceUrl || '',
  }

  function visit(node) {
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

function extractRows(node) {
  const rows = []
  function visit(rowNode) {
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

function tableToMarkdown(rows) {
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

function listToMarkdown(node, depth = 0) {
  const ordered = tagName(node) === 'ol'
  return childrenOf(node)
    .filter(child => tagName(child) === 'li')
    .map((child, index) => {
      const links = []
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

function fieldFromInput(node) {
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

function extractForm(node) {
  const fields = []
  const submit = []

  function visit(child) {
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
    submit: submit[0] || null,
  }
}

function createSection(heading = '', level = 1) {
  return {
    heading,
    level,
    summary: '',
    content: [],
    code_examples: [],
    links: [],
  }
}

function extractContext(html, options = {}) {
  const roots = parse(html)
  const page = extractMeta(roots, options.url || '')
  const sections = []
  const actions = []
  const forms = []
  const navigation = []
  const codeExamples = []
  let current = createSection('', 1)

  function commitSection() {
    if (current.content.length || current.code_examples.length || current.links.length) {
      current.summary = current.content.find(Boolean) || ''
      sections.push(current)
    }
  }

  function addContent(value) {
    const text = compactLines(value)
    if (text && !current.content.includes(text)) {
      current.content.push(text)
    }
  }

  function addCode(code, language = '') {
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

  function visit(node, inChrome = false) {
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
      const codeNode = childrenOf(node).find(child => tagName(child) === 'code')
      const languageClass = compactText(attrs(codeNode).class || attrs(codeNode).className || attrs(node).class || '')
      addCode(textOf(codeNode || node, { preserveLines: true }), languageClass.replace(/^language-/, ''))
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
      const links = []
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
        const links = []
        const text = inlineText(node, links)
        links.forEach(link => pushUnique(current.links, link, item => `${item.label}\n${item.href}`))
        addContent(text)
        return
      }
    }

    childrenOf(node).forEach(child => visit(child, chrome))
  }

  roots.forEach(root => visit(root))
  commitSection()

  return {
    page,
    sections: sections.filter(section => section.content.length || section.code_examples.length || section.heading !== 'Page'),
    actions,
    forms: forms.filter(form => form.fields.length || form.submit),
    navigation,
    code_examples: codeExamples,
  }
}

function collectNavigation(node, navigation) {
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

function collectAction(node, actions) {
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
      selector: selectorFor(node),
    }, item => `${item.label}\n${item.href}\n${item.role}`)
  }
}

function collectActions(node, actions) {
  if (!node || typeof node === 'string' || shouldDrop(node)) {
    return
  }
  if (['a', 'button'].includes(tagName(node))) {
    collectAction(node, actions)
  }
  childrenOf(node).forEach(child => collectActions(child, actions))
}

function selectorFor(node) {
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

function renderMarkdown(context) {
  const lines = []
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

function htmlToMarkdown(html, options = {}) {
  return renderMarkdown(extractContext(html, options))
}

export { extractContext, htmlToMarkdown, renderMarkdown }
