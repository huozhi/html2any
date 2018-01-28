const React = require('react')
const renderer = require('react-test-renderer')
const parse = require('../src/parse')
const transform = require('../src/transform')
const {html1, html2} = require('./contents')

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
    case 'input': {
      if (attributes.readonly) {
        attributes.readOnly = attributes.readonly
        delete attributes.readonly
      }
      elem = {
        type: 'input',
        props: attributes,
      }
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
  const ast = parse(html1)[0]
  const result = transform(ast, rule)
  const output = renderer.create(result).toJSON()
  expect(output).toMatchSnapshot()
})

it('transform works well on html2 with customized rule', () => {
  const ast = parse(html2)[0]
  const result = transform(ast, rule)
  const output = renderer.create(result).toJSON()
  expect(output).toMatchSnapshot()
})
