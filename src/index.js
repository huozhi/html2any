import parse from './parse.js'
export { default as transform } from './transform.js'

const html2any = (html, rule) => transform(parse(html)[0], rule)

export default html2any
export { parse, transform }
