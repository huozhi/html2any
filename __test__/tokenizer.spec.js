const tokenizer = require('../src/tokenizer')
const html1 = require('./mock/html1')
const html2 = require('./mock/html2')

it('tokenizer parse correctly', () => {
  expect(tokenizer(html1)).toMatchSnapshot()
})

it('tokenizer parse correctly', () => {
  expect(tokenizer(html2)).toMatchSnapshot()
})
