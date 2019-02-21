import utils from './utils'

// assuming that quato always following equation - `=""`
const ATTR_FIND = /((^\w|\s+)[a-zA-Z-:]+)(="[^"]+"|\s+|\s*$)?/

function extraAttrs(str) {
  let i = 0
  const attrs = {}
  while (i < str.length) {
    const suffix = str.slice(i)
    const match = ATTR_FIND.exec(suffix)
    if (!match || !match[1]) {
      break
    }
    const result = match[0]
    let key = match[1]
    let value = match[3]

    key = key.trim()
    value = value && value.trim()

    attrs[key] = (value && value[0] === '=') ? value.slice(2, -1) : true
    i += result.length
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
  } else if (tag.startsWith('</')) {
    return {
      type: 'end',
      name: tag.slice(2, -1),
    }
  } else {
    const match = tag.match(/<([\w+:?\w*]+)\s*([^>]*)/)
    const tagName = match[1]
    const tagBody = match[2]
    return {
      type: (utils.isSelfClose(tagName) || tagBody[tagBody.length - 1] === '/') ? 'self-close' : 'start',
      name: tagName,
      attributes: extraAttrs(tagBody),
    }
  }
}

function splitTokens(html) {
  let i = 0
  let j = 0
  const tokens = []
  while (i < html.length) {
    const curr = html[i]
    if (curr === '<') {
      if (j < i) {
        tokens.push(html.slice(j, i))
        j = i
      }
      let k = i
      while (html[k] !== '>') k++
      tokens.push(html.slice(i, k + 1))
      i = j = k + 1
      continue
    }
    i++
  }
  return tokens
}

function tokenize(html) {
  return splitTokens(html)
    .map(s => s.replace(/^\n|\n$/g, ''))
    .map(s => s.trim())
    .filter(Boolean)
    .map(makeToken)
}

export default tokenize
