const utils = require('./utils')

const ATTRIBUTES_REGEX = /(?=(^\w|\s+[a-z-]+="[^"]+")|(\s+\w+\s+))/

function getAttributes(str) {
  const paris = str.split(ATTRIBUTES_REGEX).filter(Boolean).map(s => s.trim())
  return paris.reduce((r, pair) => {
    const [key, val] = pair.split('=')
    const value = val ? val.slice(1, -1) : true

    return Object.assign({}, r, {[key]: value})
  }, {})
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
    const match = tag.match(/<(\w+)\s*([^>]*)/)
    return {
      type: utils.isSelfClose(match[1]) ? 'self-close' : 'start',
      name: match[1],
      attributes: getAttributes(match[2].slice(0, -1)),
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
  return splitTokens(html)
    .map(s => s.replace(/^\n|\n$/g, ''))
    .map(s => s.trim())
    .filter(Boolean)
    .map(makeToken)
}

module.exports = tokenizer
