import parse from './parse'
import transform from './transform'

const html2any = (html, rule) => transform(parse(html)[0], rule)

export default html2any
export {parse, transform}
