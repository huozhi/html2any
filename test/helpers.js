import fs from 'fs'
import { resolve } from 'path'

const __dirname = resolve(process.cwd(), 'test')

export const readFile = (filepath) => fs.readFileSync(resolve(__dirname, filepath), 'utf8')

