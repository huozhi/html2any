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
