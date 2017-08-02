const utils = require('./utils')

function getAttributes(str) {
  const paris = str.split(/(?=(^\w|\s+[a-z-]+="[^"]+")|(\s+\w+\s+))/)
    .filter(Boolean)
    .map(s => s.trim())
  return paris.reduce((r, pair) => {
    const [key, val] = pair.split('=')
    const value = val ? val.slice(1, -1) : true

    return Object.assign(
      {},
      r,
      {[key]: value},
    )
  }, {})
}

function getTokenFromTag(tag) {
  const isEndTag = tag.startsWith('</')
  if (isEndTag) {
    return {
      type: 'end',
      name: tag.slice(2, -1),
    }
  } else {
    const hasChildrenText = tag[tag.length - 1] !== '>'
    const closePos = hasChildrenText ? tag.indexOf('>') : tag.length - 1
    const tagSelf = tag.slice(0, closePos) // `<div class="3">123` to `<div class="3"`
    const children = hasChildrenText ? tag.slice(closePos + 1).trim() : null
    const match = tagSelf.match(/<(\w+)\s*([^/>]*)/)

    return {
      type: utils.isSelfClose(match[1]) ? 'self-close' : 'start',
      children,
      name: match[1],
      attribues: getAttributes(match[2]),
    }
  }
}

function makeToken(tag) {
  const isTag = tag.startsWith('<') && tag.endsWith('>')

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
    const match = tag.match(/<(\w+)\s*([^/>]*)/)
    return {
      type: utils.isSelfClose(match[1]) ? 'self-close' : 'start',
      name: match[1],
      attribues: getAttributes(match[2]),
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

function tokenizer(html) {
  // return html.split(/(?=<[^>]*>)/)
  return splitTokens(html)
    .map(s => s.replace(/^\n|\n$/g, ''))
    .map(s => s.trim())
    .filter(Boolean)
    .map(makeToken)
    // .map(getTokenFromTag)
}

module.exports = tokenizer
