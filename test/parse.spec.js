import parse from '../src/parse'
import {html1, html2, xml1} from './contents'

it('parse correctly', () => {
  expect(parse(html1)).toMatchSnapshot()
})

it('parse correctly', () => {
  expect(parse(html2)).toMatchSnapshot()
})

it('parse xml correctly', () => {
  expect(parse(xml1)).toMatchSnapshot()
})
