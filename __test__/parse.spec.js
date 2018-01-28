const fs = require('fs')
const html1 = require('./mock/html1')
const html2 = require('./mock/html2')
const tokenize = require('../src/tokenize')
const parse = require('../src/parse')

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
  const content = fs.readFileSync(__dirname + '/mock/mpd-1.xml', 'utf8')
  const tks = tokenize(content)
  expect(parse(tks)).toMatchSnapshot()
})
