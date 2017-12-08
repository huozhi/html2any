const tokenize = require('./tokenize')
const parse = require('./parse')
const transform = require('./transform')

const html2any = (html, rule) => transform(parse(tokenize(html))[0], rule)

module.exports = html2any
module.exports.default = module.exports

module.exports.tokenize = tokenize
module.exports.parse = parse
module.exports.transform = transform
