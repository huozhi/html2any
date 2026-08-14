#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runs = Number(process.env.BENCHMARK_RUNS || 25)
const warmups = Number(process.env.BENCHMARK_WARMUPS || 3)
const temporary = mkdtempSync(path.join(tmpdir(), 'html2any-native-benchmark-'))
const executable = process.platform === 'win32' ? 'html2any.exe' : 'html2any'
const binary = path.join(temporary, executable)
const scriptc = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'scriptc.cmd' : 'scriptc')
const nodeCli = path.join(root, 'dist', 'bin', 'html2any.js')
const bunCli = path.join(root, 'src', 'bin', 'html2any.ts')
const largeFixture = path.join(root, 'benchmark', 'fixtures', 'raw', 'nextjs-installation.html')
const smallFixture = path.join(temporary, 'small.html')

function execute(command, args, capture = false) {
  const started = performance.now()
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'],
  })
  const elapsed = performance.now() - started
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr}`)
  }
  return { elapsed, stdout: result.stdout || '' }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function measure(command, args) {
  for (let index = 0; index < warmups; index++) {
    execute(command, args)
  }
  const samples = []
  for (let index = 0; index < runs; index++) {
    samples.push(execute(command, args).elapsed)
  }
  return {
    median_ms: Number(percentile(samples, 0.5).toFixed(2)),
    p95_ms: Number(percentile(samples, 0.95).toFixed(2)),
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

try {
  writeFileSync(smallFixture, '<html><head><title>Small</title></head><body><h1>Small</h1><p>Hello world.</p></body></html>')

  execute(process.execPath, ['run', 'build'])
  execute(scriptc, ['build', 'src/bin/html2any.ts', '-o', binary, '--no-keep-c'])

  const runtimes = [
    { name: 'Native', command: binary, prefix: [] },
    { name: 'Node', command: 'node', prefix: [nodeCli] },
    { name: 'Bun', command: process.execPath, prefix: [bunCli] },
  ]
  const scenarios = [
    { name: 'Small HTML', fixture: smallFixture },
    { name: '1.00 MB docs page', fixture: largeFixture },
  ]

  for (const scenario of scenarios) {
    const outputs = runtimes.map(runtime => execute(runtime.command, [...runtime.prefix, 'md', scenario.fixture], true).stdout)
    if (!outputs.every(output => output === outputs[0])) {
      throw new Error(`Output mismatch for ${scenario.name}`)
    }
  }

  const rows = []
  for (const scenario of scenarios) {
    for (const runtime of runtimes) {
      rows.push({
        scenario: scenario.name,
        runtime: runtime.name,
        ...measure(runtime.command, [...runtime.prefix, 'md', scenario.fixture]),
      })
    }
  }

  const binaryBytes = statSync(binary).size
  const fixtureBytes = statSync(largeFixture).size
  const nodeVersion = execute('node', ['--version'], true).stdout.trim()
  const bunVersion = execute(process.execPath, ['--version'], true).stdout.trim()
  const scriptcVersion = execute(scriptc, ['--version'], true).stdout.trim()
  process.stdout.write(`Platform: ${process.platform} ${process.arch}, ${cpus()[0]?.model || 'unknown CPU'}\n`)
  process.stdout.write(`Versions: Node ${nodeVersion}, Bun ${bunVersion}, scriptc ${scriptcVersion}\n`)
  process.stdout.write(`Large fixture: ${fixtureBytes} bytes\n`)
  process.stdout.write(`Binary size: ${formatBytes(binaryBytes)} (${binaryBytes} bytes)\n`)
  process.stdout.write(`Runs: ${runs} measured after ${warmups} warmups\n\n`)
  process.stdout.write('| Scenario | Runtime | Median | p95 |\n')
  process.stdout.write('| --- | --- | ---: | ---: |\n')
  for (const row of rows) {
    process.stdout.write(`| ${row.scenario} | ${row.runtime} | ${row.median_ms.toFixed(2)} ms | ${row.p95_ms.toFixed(2)} ms |\n`)
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
