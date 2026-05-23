#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { htmlToMarkdown } from '../src/context.ts'

const root = path.resolve(import.meta.dir, '..')
const defaultOutputsDir = path.join(root, 'benchmark', 'outputs', 'compare')
const FETCH_TIMEOUT_MS = 10000

function usage() {
  return `Usage:
  bun benchmark/compare-url.mjs <url...> [options]

Options:
  --out <dir>        Write Markdown outputs and report to another directory
  --no-files         Print report only
  --help            Show this help

Examples:
  bun benchmark/compare-url.mjs https://vercel.com/docs/vercel-sandbox/sdk-reference
  bun benchmark/compare-url.mjs https://a.test https://b.test --out /tmp/html2any-compare
`
}

function parseArgs(argv) {
  const args = {
    urls: [],
    outputsDir: defaultOutputsDir,
    writeFiles: true,
    help: false,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--out') {
      args.outputsDir = path.resolve(argv[++index])
    } else if (arg === '--no-files') {
      args.writeFiles = false
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else {
      args.urls.push(arg)
    }
  }

  return args
}

function slugUrl(url) {
  const parsed = new URL(url)
  const pathname = parsed.pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-')
  return [parsed.hostname, pathname].filter(Boolean).join('-').toLowerCase()
}

function estimateTokens(text) {
  const tokens = String(text).match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)
  return tokens ? tokens.length : 0
}

function compression(raw, compressed) {
  return raw ? Number((1 - compressed / raw).toFixed(4)) : 0
}

async function fetchHtml(url) {
  const started = performance.now()
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'html2any-compare/0.1',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  return {
    html: await response.text(),
    status: response.status,
    finalUrl: response.url || url,
    latencyMs: Math.round(performance.now() - started),
  }
}

function rowFor(url, fetched, markdown, outputFile) {
  const rawChars = fetched.html.length
  const mdChars = markdown.length
  const rawTokens = estimateTokens(fetched.html)
  const mdTokens = estimateTokens(markdown)
  return {
    url,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    latencyMs: fetched.latencyMs,
    rawChars,
    mdChars,
    savedChars: rawChars - mdChars,
    savedPercent: Number((compression(rawChars, mdChars) * 100).toFixed(2)),
    mdPercentOfRaw: rawChars ? Number(((mdChars / rawChars) * 100).toFixed(2)) : 0,
    rawEstimatedTokens: rawTokens,
    mdEstimatedTokens: mdTokens,
    savedEstimatedTokens: rawTokens - mdTokens,
    tokenSavedPercent: Number((compression(rawTokens, mdTokens) * 100).toFixed(2)),
    outputFile,
  }
}

function printTable(rows) {
  const tableRows = rows.map(row => ({
    url: row.url,
    rawChars: row.rawChars,
    mdChars: row.mdChars,
    savedPercent: `${row.savedPercent}%`,
    rawEstimatedTokens: row.rawEstimatedTokens,
    mdEstimatedTokens: row.mdEstimatedTokens,
    tokenSavedPercent: `${row.tokenSavedPercent}%`,
  }))
  console.table(tableRows)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.urls.length === 0) {
    process.stdout.write(usage())
    process.exit(args.help ? 0 : 1)
  }

  if (args.writeFiles) {
    await mkdir(args.outputsDir, { recursive: true })
  }

  const rows = []
  for (const url of args.urls) {
    const fetched = await fetchHtml(url)
    const markdown = htmlToMarkdown(fetched.html, { url: fetched.finalUrl })
    let outputFile = ''

    if (args.writeFiles) {
      outputFile = path.join(args.outputsDir, `${slugUrl(fetched.finalUrl)}.md`)
      await writeFile(outputFile, markdown)
    }

    rows.push(rowFor(url, fetched, markdown, outputFile ? path.relative(root, outputFile) : ''))
  }

  const totals = rows.reduce((sum, row) => ({
    rawChars: sum.rawChars + row.rawChars,
    mdChars: sum.mdChars + row.mdChars,
    rawEstimatedTokens: sum.rawEstimatedTokens + row.rawEstimatedTokens,
    mdEstimatedTokens: sum.mdEstimatedTokens + row.mdEstimatedTokens,
  }), {
    rawChars: 0,
    mdChars: 0,
    rawEstimatedTokens: 0,
    mdEstimatedTokens: 0,
  })

  const report = {
    generatedAt: new Date().toISOString(),
    note: 'estimated token counts use a deterministic regex tokenizer, not a model-specific tokenizer.',
    rows,
    totals: {
      ...totals,
      savedChars: totals.rawChars - totals.mdChars,
      savedPercent: Number((compression(totals.rawChars, totals.mdChars) * 100).toFixed(2)),
      savedEstimatedTokens: totals.rawEstimatedTokens - totals.mdEstimatedTokens,
      tokenSavedPercent: Number((compression(totals.rawEstimatedTokens, totals.mdEstimatedTokens) * 100).toFixed(2)),
    },
  }

  printTable(rows)
  process.stdout.write(`${JSON.stringify(report.totals, null, 2)}\n`)

  if (args.writeFiles) {
    const reportFile = path.join(args.outputsDir, 'report.json')
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`Wrote ${path.relative(root, reportFile)}\n`)
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
