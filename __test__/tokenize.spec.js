const tokenize = require('../src/tokenize')
const html1 = require('./mock/html1')
const html2 = require('./mock/html2')

it('tokenize parse correctly', () => {
  expect(tokenize(html1)).toMatchSnapshot()
})

it('tokenize parse correctly', () => {
  expect(tokenize(html2)).toMatchSnapshot()
})
