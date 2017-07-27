const html1 = require('./mock/html1')
const tokenizer = require('../src/tokenizer')
const parser = require('../src/parser')
const transform = require('../src/transform')
const React = require('react')
const ReactDOMServer = require('react-dom/server')

const ast = parser(tokenizer(html1))
const output = transform(ast, React.createElement)

console.log(ReactDOMServer.renderToStaticMarkup(output[0]))
