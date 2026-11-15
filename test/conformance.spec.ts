import { describe, expect, it } from 'bun:test'
import { isSupported, loadTests, runTest } from './conformance'

const tests = loadTests().filter(isSupported)

// Known differences, listed explicitly so any new failure shows up as a regression:
// - <selectedcontent> mirroring the selected <option> is DOM behaviour, not parsing.
// - Processing instructions (`<?target data?>`) are a new syntax this parser does not implement.
// - Text inside a <template> in <head> should not rule out a later <frameset>.
const KNOWN_FAILURES = new Set([
  'webkit02.dat#44', 'webkit02.dat#45', 'webkit02.dat#46', 'webkit02.dat#47',
  'tests1.dat#39', 'tests1.dat#43', 'tests1.dat#46', 'html5test-com.dat#11',
  'template.dat#44',
])

describe('html5lib tree construction (web-platform-tests)', () => {
  it('matches browsers on the supported tests', () => {
    const failures: string[] = []
    for (const test of tests) {
      const key = `${test.file}#${test.index}`
      if (runTest(test) !== test.document && !KNOWN_FAILURES.has(key)) failures.push(`${key} ${JSON.stringify(test.data)}`)
    }
    expect(failures).toEqual([])
  })

  it('produces the same tree for any chunking of the input', () => {
    const differences: string[] = []
    for (const size of [1, 3, 7]) {
      for (const test of tests) {
        if (runTest(test, size) !== runTest(test)) differences.push(`${size}: ${test.file}#${test.index}`)
      }
    }
    expect(differences).toEqual([])
  })
})
