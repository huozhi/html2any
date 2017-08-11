const html1 = require('./mock/html1')
const html2 = require('./mock/html2')
const tokenizer = require('../src/tokenizer')
const parser = require('../src/parser')

const logJSON = x => console.log(JSON.stringify(x, null, 2))

it('parse correctly', () => {
  const tks = tokenizer(html1)
  expect(parser(tks)).toMatchSnapshot()
})

it('parse correctly', () => {
  const tks = tokenizer(html2)
  expect(parser(tks)).toMatchSnapshot()
})
