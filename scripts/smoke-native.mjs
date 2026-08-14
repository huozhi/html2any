#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const binary = process.argv[2]
if (!binary) {
  process.stderr.write('Usage: node scripts/smoke-native.mjs <binary>\n')
  process.exit(1)
}

const html = '<html><head><title>Native</title></head><body><h1>Native</h1><p>Hello &amp; goodbye.</p></body></html>'
const expected = '# Native\n\nHello & goodbye.\n'
const result = spawnSync(binary, ['md', '-', '--url', ''], {
  input: html,
  encoding: 'utf8',
})

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status || 1)
}
const output = result.stdout.replace(/\r\n/g, '\n')
if (output !== expected) {
  process.stderr.write(`Unexpected native output:\n${result.stdout}`)
  process.exit(1)
}

process.stdout.write('Native CLI smoke test passed.\n')
