import transform from './transform'
import parse from './parse'

function html2any(html, rule) {
  return transform(parse(html)[0], rule)
}

export { parse, transform }
export default html2any
