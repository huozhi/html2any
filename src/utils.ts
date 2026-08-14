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

export function isSelfClose(tagName: string) {
  return voidElementTags.indexOf(tagName.toLowerCase()) > -1
}

export function isPair(tagX: ElementNode | undefined, tagY: Token) {
  if (!tagX || tagY.type === 'string') {
    return false
  }
  return tagX.type === 'start' && tagY.type === 'end' && tagX.name === tagY.name
}

export default { isPair, isSelfClose }
