#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { htmlToMarkdown } from './context.js'

const USAGE = `Usage:
  html2any md <file|url|->
  html2 md <file|url|->

Options:
  --url <url>   Set source URL metadata for stdin or local files
  --help        Show this help
`

function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift()
  let input = ''
  let url = ''

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--url') {
      url = args[++index] || ''
    } else if (arg === '--help' || arg === '-h') {
      return { help: true }
    } else if (!input) {
      input = arg
    }
  }

  return { command, input, url }
}

function isUrl(value) {
  return /^https?:\/\//i.test(value)
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readInput(input) {
  if (!input || input === '-') {
    return { html: await readStdin(), url: '' }
  }
  if (isUrl(input)) {
    const response = await fetch(input, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'html2any/0.1',
      },
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch ${input}: ${response.status} ${response.statusText}`)
    }
    return { html: await response.text(), url: input }
  }
  return { html: await readFile(input, 'utf8'), url: path.resolve(input) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.command || !args.input) {
    process.stdout.write(USAGE)
    process.exit(args.help ? 0 : 1)
  }

  const command = args.command.toLowerCase()
  if (!['md', 'markdown'].includes(command)) {
    process.stderr.write(`Unknown command: ${args.command}\n\n${USAGE}`)
    process.exit(1)
  }

  const input = await readInput(args.input)
  const options = { url: args.url || input.url }
  process.stdout.write(htmlToMarkdown(input.html, options))
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
