const voidElementTags = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]

function isSelfClose(tagName) {
  return voidElementTags.indexOf(tagName) > -1
}

function isPair(tagX, tagY) {
  return tagX.name === tagY.name && tagX.type === 'start' && tagY.type === 'end'
}

export default {isPair, isSelfClose}
