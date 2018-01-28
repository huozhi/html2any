const {readFile} = require('./helpers')

const html1 = readFile('./fixtures/html1.html')
const html2 = readFile('./fixtures/html2.html')
const xml1 = readFile('./fixtures/mpd-1.xml')

module.exports = {html1, html2, xml1}
