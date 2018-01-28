const fs = require('fs')
const path = require('path')

const readFile = (filepath) => fs.readFileSync(path.resolve(__dirname, filepath), 'utf8')

exports.readFile = readFile
