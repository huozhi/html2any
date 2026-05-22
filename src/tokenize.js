import utils from './utils'

const RAW_TEXT_TAGS = ['script', 'style', 'textarea', 'title']

function extraAttrs(str) {
  let i = 0
  const attrs = {}

  while (i < str.length) {
    while (/\s/.test(str[i])) i++
    if (!str[i] || str[i] === '/') {
      break
    }

    const nameStart = i
    while (str[i] && !/[\s=/>]/.test(str[i])) i++
    const key = str.slice(nameStart, i)
    let value = true

    while (/\s/.test(str[i])) i++
    if (str[i] === '=') {
      i++
      while (/\s/.test(str[i])) i++

      const quote = str[i]
      if (quote === '"' || quote === "'") {
        i++
        const valueStart = i
        while (str[i] && str[i] !== quote) i++
        value = str.slice(valueStart, i)
        if (str[i] === quote) i++
      } else {
        const valueStart = i
        while (str[i] && !/[\s>]/.test(str[i])) i++
        value = str.slice(valueStart, i)
      }
    }

    if (key) {
      attrs[key] = value
    }
  }

  return attrs
}

function makeToken(tag) {
  const isTag = tag[0] === '<' && tag[tag.length - 1] === '>'

  if (!isTag) {
    return {
      type: 'string',
      value: tag,
    }
  } else if (/^<!--/.test(tag) || /^<!doctype/i.test(tag) || /^<\?/.test(tag)) {
    return null
  } else if (tag.startsWith('</')) {
    return {
      type: 'end',
      name: tag.slice(2, -1).trim().split(/\s+/)[0],
    }
  } else {
    const body = tag.slice(1, -1).trim()
    const match = body.match(/^([^\s/>]+)/)
    if (!match) {
      return null
    }
    const tagName = match[1]
    const tagBody = body.slice(tagName.length)
    return {
      type: (utils.isSelfClose(tagName) || tagBody[tagBody.length - 1] === '/') ? 'self-close' : 'start',
      name: tagName,
      attributes: extraAttrs(tagBody),
    }
  }
}

function findTagEnd(html, start) {
  let quote = null

  for (let i = start + 1; i < html.length; i++) {
    const curr = html[i]
    if (quote) {
      if (curr === quote) quote = null
    } else if (curr === '"' || curr === "'") {
      quote = curr
    } else if (curr === '>') {
      return i
    }
  }

  return -1
}

function getStartTagName(tag) {
  if (tag.startsWith('</') || tag.startsWith('<!') || tag.startsWith('<?')) {
    return null
  }

  const match = tag.slice(1, -1).trim().match(/^([^\s/>]+)/)
  return match && match[1]
}

function splitTokens(html) {
  let i = 0
  let j = 0
  const tokens = []
  while (i < html.length) {
    const curr = html[i]
    if (curr === '<') {
      if (html.startsWith('<!--', i)) {
        const k = html.indexOf('-->', i + 4)
        if (k === -1) break
        if (j < i) {
          tokens.push(html.slice(j, i))
        }
        tokens.push(html.slice(i, k + 3))
        i = j = k + 3
        continue
      }

      if (j < i) {
        tokens.push(html.slice(j, i))
        j = i
      }

      const k = findTagEnd(html, i)
      if (k === -1) {
        break
      }

      tokens.push(html.slice(i, k + 1))

      const tagName = getStartTagName(html.slice(i, k + 1))
      if (tagName && RAW_TEXT_TAGS.indexOf(tagName.toLowerCase()) > -1) {
        const closeTagStart = html.toLowerCase().indexOf(`</${tagName.toLowerCase()}`, k + 1)
        if (closeTagStart > -1) {
          const closeTagEnd = findTagEnd(html, closeTagStart)
          if (closeTagEnd > -1) {
            if (k + 1 < closeTagStart) {
              tokens.push(html.slice(k + 1, closeTagStart))
            }
            tokens.push(html.slice(closeTagStart, closeTagEnd + 1))
            i = j = closeTagEnd + 1
            continue
          }
        }
      }

      i = j = k + 1
      continue
    }
    i++
  }
  if (j < html.length) {
    tokens.push(html.slice(j))
  }
  return tokens
}

function tokenize(html) {
  return splitTokens(html)
    .map(s => s.replace(/^\n+$/g, ''))
    .map(s => s.trim())
    .filter(Boolean)
    .map(makeToken)
    .filter(Boolean)
}

export default tokenize
