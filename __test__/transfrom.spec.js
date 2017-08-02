const html1 = require('./mock/html1')
const html2 = require('./mock/html2')
const tokenizer = require('../src/tokenizer')
const parser = require('../src/parser')
const transform = require('../src/transform')
const React = require('react')
const ReactDOMServer = require('react-dom/server')

function rule (node, children) {
  if (typeof node === 'string') {
    return node
  }
  const {name, attribues} = node
  if (attribues && attribues.hasOwnProperty('style')) {
    delete attribues.style
  }
  if (attribues && attribues.hasOwnProperty('class')) {
    attribues.className = attribues.class
    delete attribues.class
  }
  let elem
  switch (name) {
    case 'p': {
      elem = {
        tag: 'h1',
        props: attribues
      }
      break
    }
    case 'b': {
      elem = {
        tag: 'h2',
        props: attribues
      }
      break
    }
    case 'div': {
      elem = {
        tag: 'div',
        props: attribues
      }
      break
    }
    default: {
      elem = {
        tag: name,
        props: attribues,
      }
    }
  }

  if (!elem || !elem.tag) {
    return null
  }

  // add react index prop
  if (typeof node.index === 'number') {
    Object.assign(elem.props, {key: node.index})
  }
  return React.createElement(elem.tag, elem.props, children)
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
