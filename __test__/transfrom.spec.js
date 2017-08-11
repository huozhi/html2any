const html1 = require('./mock/html1')
const html2 = require('./mock/html2')
const tokenizer = require('../src/tokenizer')
const parser = require('../src/parser')
const transform = require('../src/transform')
const React = require('react')
const ReactDOMServer = require('react-dom/server')

function rule(node, children) {
  if (typeof node === 'string') {
    return node
  }
  const {name, attributes} = node
  if (attributes && attributes.hasOwnProperty('style')) {
    delete attributes.style
  }
  if (attributes && attributes.hasOwnProperty('class')) {
    attributes.className = attributes.class
    delete attributes.class
  }
  let elem
  switch (name) {
    case 'p': {
      elem = {
        type: 'h1',
        props: attributes,
      }
      break
    }
    case 'b': {
      elem = {
        type: 'h2',
        props: attributes,
      }
      break
    }
    case 'div': {
      elem = {
        type: 'div',
        props: attributes,
      }
      break
    }
    default: {
      elem = {
        type: name,
        props: attributes,
      }
    }
  }

  if (!elem || !elem.type) {
    return null
  }

  // add react index prop
  if (typeof node.index === 'number') {
    Object.assign(elem.props, {key: node.index})
  }
  return React.createElement(elem.type, elem.props, children)
}

it('transform works well on html1 with customized rule', () => {
  const ast = parser(tokenizer(html1))[0]
  const output = transform(ast, rule)
  expect(ReactDOMServer.renderToStaticMarkup(output)).toMatchSnapshot()
})

it('transform works well on html2 with customized rule', () => {
  const ast = parser(tokenizer(html2))[0]
  const output = transform(ast, rule)
  expect(ReactDOMServer.renderToStaticMarkup(output)).toMatchSnapshot()
})
