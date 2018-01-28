const tokenize = require('../src/tokenize')
const parse = require('../src/parse')
const {html1, html2, xml1} = require('./contents')

const parser = (content) => parse(tokenize(content))

it('parse correctly', () => {
  const tks = tokenize(html1)
  expect(parse(tks)).toMatchSnapshot()
})

it('parse correctly', () => {
  const tks = tokenize(html2)
  expect(parse(tks)).toMatchSnapshot()
})

it('parse xml correctly', () => {
  // const content = readFile('/mock/mpd-1.xml')
  const tks = tokenize(xml1)
  expect(parse(tks)).toMatchSnapshot()
})
