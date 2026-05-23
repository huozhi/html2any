import { expect, it } from 'bun:test'
import React from 'react'
import parse from '../src/parse'
import transform from '../src/transform'
import type { AstNode } from '../src/types'
import { html1, html2 } from './fixtures'

type RuleResult = React.ReactElement | string | null

function rule(node: AstNode, children: unknown): RuleResult {
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
  let elem: { type: string, props: Record<string, unknown> } | undefined
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
  return React.createElement(elem.type, elem.props, children as React.ReactNode)
}

function renderElement(node: unknown): unknown {
  if (node == null || typeof node === 'string') {
    return node
  }
  if (Array.isArray(node)) {
    return node.map(renderElement)
  }
  if (!React.isValidElement(node)) {
    return node
  }

  const {children, ...props} = node.props as Record<string, unknown> & { children?: unknown }
  return {
    type: node.type,
    props,
    children: children == null ? null : renderElement(children),
  }
}

it('transform works well on html1 with customized rule', () => {
  const ast = parse(html1)[0] as AstNode
  const result = transform(ast, rule)
  expect(renderElement(result)).toMatchSnapshot()
})

it('transform works well on html2 with customized rule', () => {
  const ast = parse(html2)[0] as AstNode
  const result = transform(ast, rule)
  expect(renderElement(result)).toMatchSnapshot()
})
