#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { htmlToMarkdown } from '../src/context.js'

const root = path.resolve(import.meta.dir, '..')
const benchmarkDir = path.join(root, 'benchmark')
const defaultFixturesDir = path.join(benchmarkDir, 'fixtures', 'raw')
const defaultOutputsDir = path.join(benchmarkDir, 'outputs')

function parseArgs(argv) {
  const args = {
    fixturesDir: defaultFixturesDir,
    outputsDir: defaultOutputsDir,
    refresh: false,
    noFetch: false,
    page: '',
    help: false,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--fixtures') {
      args.fixturesDir = path.resolve(argv[++index])
    } else if (arg === '--out') {
      args.outputsDir = path.resolve(argv[++index])
    } else if (arg === '--page') {
      args.page = argv[++index] || ''
    } else if (arg === '--refresh') {
      args.refresh = true
    } else if (arg === '--no-fetch') {
      args.noFetch = true
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    }
  }

  return args
}

function usage() {
  return `Usage:
  bun benchmark/run.mjs [options]

Options:
  --refresh          Fetch pages even when cached fixtures exist
  --no-fetch         Only use existing benchmark/fixtures/raw/*.html files
  --page <id>        Run one page from benchmark/pages.json
  --fixtures <dir>   Read/write raw HTML fixtures in another directory
  --out <dir>        Write generated variants and reports in another directory
  --help             Show this help
`
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function exists(file) {
  try {
    await readFile(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function fetchHtml(url) {
  const started = performance.now()
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'html2any-benchmark/0.1',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  return {
    html: await response.text(),
    latency_ms: Math.round(performance.now() - started),
  }
}

function estimateTokens(text) {
  const tokens = String(text).match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)
  return tokens ? tokens.length : 0
}

function measure(text) {
  const value = String(text)
  return {
    bytes: Buffer.byteLength(value, 'utf8'),
    chars: value.length,
    estimated_tokens: estimateTokens(value),
  }
}

function compression(rawTokens, variantTokens) {
  if (!rawTokens) {
    return 0
  }
  return Number((1 - variantTokens / rawTokens).toFixed(4))
}

function csvEscape(value) {
  const text = String(value == null ? '' : value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] || {})
  return [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(',')),
  ].join('\n')
}

async function loadPage(page, args) {
  const fixtureFile = path.join(args.fixturesDir, `${page.id}.html`)
  if (!args.refresh && await exists(fixtureFile)) {
    return {
      html: await readFile(fixtureFile, 'utf8'),
      fixtureFile,
      fetched: false,
      fetch_latency_ms: 0,
    }
  }
  if (args.noFetch) {
    return null
  }

  const fetched = await fetchHtml(page.url)
  await mkdir(args.fixturesDir, { recursive: true })
  await writeFile(fixtureFile, fetched.html)
  return {
    html: fetched.html,
    fixtureFile,
    fetched: true,
    fetch_latency_ms: fetched.latency_ms,
  }
}

function buildVariants(page, html) {
  return {
    raw: {
      extension: 'raw.html',
      content: html,
    },
    md: {
      extension: 'md',
      content: htmlToMarkdown(html, { url: page.url }),
    },
  }
}

function taskRowsForPage(tasks, page, variants) {
  return tasks
    .filter(task => task.source === page.url)
    .flatMap(task => Object.entries(variants).map(([variant, data]) => {
      const prompt = `${task.prompt}\n\nContext:\n${data.content}`
      return {
        task_id: task.id,
        page_id: page.id,
        variant,
        prompt_estimated_tokens: estimateTokens(prompt),
        context_estimated_tokens: estimateTokens(data.content),
        checks: task.checks.length,
      }
    }))
}

function summarize(rows) {
  const byVariant = new Map()
  rows.forEach(row => {
    const group = byVariant.get(row.variant) || {
      variant: row.variant,
      pages: 0,
      total_estimated_tokens: 0,
      average_estimated_tokens: 0,
      average_compression_vs_raw: 0,
    }
    group.pages += 1
    group.total_estimated_tokens += row.estimated_tokens
    group.average_compression_vs_raw += row.compression_vs_raw
    byVariant.set(row.variant, group)
  })

  return Array.from(byVariant.values()).map(group => ({
    ...group,
    average_estimated_tokens: Math.round(group.total_estimated_tokens / group.pages),
    average_compression_vs_raw: Number((group.average_compression_vs_raw / group.pages).toFixed(4)),
  }))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }

  const pages = await readJson(path.join(benchmarkDir, 'pages.json'))
  const tasks = await readJson(path.join(benchmarkDir, 'tasks.json'))
  const selectedPages = args.page ? pages.filter(page => page.id === args.page) : pages
  if (!selectedPages.length) {
    throw new Error(`No benchmark page matched "${args.page}"`)
  }

  await mkdir(args.outputsDir, { recursive: true })

  const rows = []
  const taskRows = []
  const skipped = []

  for (const page of selectedPages) {
    const loaded = await loadPage(page, args)
    if (!loaded) {
      skipped.push(page.id)
      continue
    }

    const variants = buildVariants(page, loaded.html)
    const rawTokens = estimateTokens(variants.raw.content)

    for (const [variant, data] of Object.entries(variants)) {
      const outputFile = path.join(args.outputsDir, `${page.id}.${data.extension}`)
      await writeFile(outputFile, data.content)
      const stats = measure(data.content)
      rows.push({
        page_id: page.id,
        url: page.url,
        variant,
        output_file: path.relative(root, outputFile),
        bytes: stats.bytes,
        chars: stats.chars,
        estimated_tokens: stats.estimated_tokens,
        compression_vs_raw: compression(rawTokens, stats.estimated_tokens),
        fetched: loaded.fetched,
        fetch_latency_ms: loaded.fetch_latency_ms,
      })
    }

    taskRows.push(...taskRowsForPage(tasks, page, variants))
  }

  const report = {
    generated_at: new Date().toISOString(),
    note: 'estimated_tokens uses a deterministic regex tokenizer, not a model-specific tokenizer.',
    skipped,
    summary: summarize(rows),
    pages: rows,
    tasks: taskRows,
  }

  await writeFile(path.join(args.outputsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (rows.length) {
    await writeFile(path.join(args.outputsDir, 'pages.csv'), `${toCsv(rows)}\n`)
  }
  if (taskRows.length) {
    await writeFile(path.join(args.outputsDir, 'tasks.csv'), `${toCsv(taskRows)}\n`)
  }

  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`)
  if (skipped.length) {
    process.stdout.write(`Skipped without fixture: ${skipped.join(', ')}\n`)
  }
  process.stdout.write(`Wrote ${path.relative(root, args.outputsDir)}/report.json\n`)
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
