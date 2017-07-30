const tokenizer = require('../src/tokenizer')
const html1 = require('./mock/html1')

it('tokenizer parse correctly', () => {
  expect(tokenizer(html1)).toMatchSnapshot()
})
