const parse = require('./parse')
const transform = require('./transform')

const html2any = (html, rule) => transform(parse(html)[0], rule)

module.exports = html2any
module.exports.default = module.exports

module.exports.parse = parse
module.exports.transform = transform
