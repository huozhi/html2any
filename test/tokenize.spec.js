import tokenize from '../src/tokenize'
import {html1, html2} from './contents'

it('tokenize parse correctly', () => {
  expect(tokenize(html1)).toMatchSnapshot()
})

it('tokenize parse correctly', () => {
  expect(tokenize(html2)).toMatchSnapshot()
})
