import { expect, it } from 'bun:test'
import parse from '../src/parse'

import { html1, html2, xml1 } from './fixtures'

it('parse correctly', () => {
  expect(parse(html1)).toMatchSnapshot()
})

it('parse correctly', () => {
  expect(parse(html2)).toMatchSnapshot()
})

it('parse xml correctly', () => {
  expect(parse(xml1)).toMatchSnapshot()
})

it('parses modern html attributes, custom elements, and raw text tags', () => {
  expect(parse(`
    <!doctype html>
    <MY-CARD data-id='42' empty="" disabled value=hello>
      <IMG src="a>b.jpg">
      <script>if (a < b && c > d) alert("</div>")</script>
    </MY-CARD>
  `)).toEqual([
    {
      name: 'MY-CARD',
      attributes: {
        'data-id': '42',
        empty: '',
        disabled: true,
        value: 'hello',
      },
      children: [
        {
          name: 'IMG',
          attributes: {
            src: 'a>b.jpg',
          },
          children: undefined,
        },
        {
          name: 'script',
          attributes: {},
          children: [
            'if (a < b && c > d) alert("</div>")',
          ],
        },
      ],
    },
  ])
})
