import transform from './transform'
import parse from './parse'
import type { TransformRule } from './types'

function html2any<Result = unknown>(html: string, rule: TransformRule<Result>) {
  return transform(parse(html)[0], rule)
}

export { parse, transform }
export default html2any
