import { expect, it } from 'bun:test'
import tokenize from '../src/tokenize'
import { html1, html2 } from './fixtures'

it('tokenize parse correctly', () => {
  expect(tokenize(html1)).toMatchSnapshot()
})

it('tokenize parse correctly', () => {
  expect(tokenize(html2)).toMatchSnapshot()
})

it('tokenizes modern html attributes and custom elements', () => {
  expect(tokenize(`<my-card data-id='42' empty="" disabled value=hello data-json='{"x":">"}'></my-card>`)).toEqual([
    {
      type: 'start',
      name: 'my-card',
      attributes: {
        'data-id': '42',
        empty: '',
        disabled: true,
        value: 'hello',
        'data-json': '{"x":">"}',
      },
    },
    {
      type: 'end',
      name: 'my-card',
    },
  ])
})

it('ignores comments and doctype tokens', () => {
  expect(tokenize(`<!doctype html><div><!-- hidden --><span>ok</span></div>`)).toEqual([
    {
      type: 'start',
      name: 'div',
      attributes: {},
    },
    {
      type: 'start',
      name: 'span',
      attributes: {},
    },
    {
      type: 'string',
      value: 'ok',
    },
    {
      type: 'end',
      name: 'span',
    },
    {
      type: 'end',
      name: 'div',
    },
  ])
})

it('keeps raw text contents intact for script and style tags', () => {
  expect(tokenize(`<script>if (a < b && c > d) alert("</div>")</script>`)).toEqual([
    {
      type: 'start',
      name: 'script',
      attributes: {},
    },
    {
      type: 'string',
      value: 'if (a < b && c > d) alert("</div>")',
    },
    {
      type: 'end',
      name: 'script',
    },
  ])
})

it.each(['script', 'style', 'textarea', 'title'])('keeps markup inside %s as a single text token', (name) => {
  for (const value of ['<p>', '<b>raw</b>', '<!-- raw -->', '</div>', '<script>nested</script>']) {
    // A matching end tag still terminates the enclosing raw-text element.
    if (name === 'script' && value.includes('</script>')) continue
    expect(tokenize(`<${name}>  ${value}  </${name}>`)).toEqual([
      { type: 'start', name, attributes: {} },
      { type: 'string', value },
      { type: 'end', name },
    ])
  }
})

it.each(['script', 'style', 'textarea', 'title'])('keeps unclosed %s contents as text', (name) => {
  expect(tokenize(`<${name}><b>raw</b>`)).toEqual([
    { type: 'start', name, attributes: {} },
    { type: 'string', value: '<b>raw</b>' },
  ])
})

it('requires a complete raw-text closing tag name and matches it case-insensitively', () => {
  expect(tokenize('<SCRIPT><b>raw</b></script-extra><i>more</i></sCrIpT >')).toEqual([
    { type: 'start', name: 'SCRIPT', attributes: {} },
    { type: 'string', value: '<b>raw</b></script-extra><i>more</i>' },
    { type: 'end', name: 'sCrIpT' },
  ])
})
