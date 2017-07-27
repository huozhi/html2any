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

function tokenizer(html) {
  return html.split(/(?=<\/?\w+\s*[^>]*>)/)
    .map(s => s.replace(/\n/g, ''))
    .map(s => s.trim())
    .filter(Boolean)
    .map(getTokenFromTag)
}

module.exports = tokenizer
