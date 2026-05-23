import type { ElementNode, Token } from './types'

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

function isSelfClose(tagName: string) {
  return voidElementTags.indexOf(tagName.toLowerCase()) > -1
}

function isPair(tagX: ElementNode | undefined, tagY: Token) {
  if (!tagX || tagY.type === 'string') {
    return false
  }
  return tagX.name === tagY.name && tagX.type === 'start' && tagY.type === 'end'
}

export default { isPair, isSelfClose }
