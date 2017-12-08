const html1 = require('./mock/html1')
const html2 = require('./mock/html2')
const tokenize = require('../src/tokenize')
const parse = require('../src/parse')

const logJSON = x => console.log(JSON.stringify(x, null, 2))

it('parse correctly', () => {
  const tks = tokenize(html1)
  expect(parse(tks)).toMatchSnapshot()
})

it('parse correctly', () => {
  const tks = tokenize(html2)
  expect(parse(tks)).toMatchSnapshot()
})
