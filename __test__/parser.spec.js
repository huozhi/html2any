const html1 = require('./mock/html1')
const tokenizer = require('../src/tokenizer')
const parser = require('../src/parser')

const logJSON = (x) => console.log(JSON.stringify(x, null, 2))

const ast = tokenizer(html1)

it('parse correctly', () => {
  expect(parser(ast)).toMatchSnapshot()
})
