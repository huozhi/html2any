import fs from 'fs'
import path from 'path'

export const readFile = (filepath) => fs.readFileSync(path.resolve(__dirname, filepath), 'utf8')

