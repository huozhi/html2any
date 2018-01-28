const {readFile} = require('./helpers')

const html1 = readFile('./mock/html1.html')
const html2 = readFile('./mock/html2.html')
const xml1 = readFile('./mock/mpd-1.xml')

module.exports = {html1, html2, xml1}
