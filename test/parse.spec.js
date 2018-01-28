const parse = require('../src/parse')
const {html1, html2, xml1} = require('./contents')

const parser = (content) => parse(content)

it('parse correctly', () => {
  expect(parse(html1)).toMatchSnapshot()
})

it('parse correctly', () => {
  expect(parse(html2)).toMatchSnapshot()
})

it('parse xml correctly', () => {
  expect(parse(xml1)).toMatchSnapshot()
})
