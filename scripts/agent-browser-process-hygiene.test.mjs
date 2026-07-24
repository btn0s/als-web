import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildAgentBrowserProcessReport,
  main,
  parseAgentBrowserProcessHygieneArgs,
  parseElapsedSeconds,
  parseProcessTable,
  planReverifiedTerminations,
  selectOrphanedAgentBrowserRoots,
} from './agent-browser-process-hygiene.mjs'

const PROCESS_TABLE = `
  101     1    02:01 agent-browser-d /opt/agent-browser/bin/agent-browser-darwin-arm64 --session test
  102     1    10:00 /Applications/Go /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  103   101    01:59 /Applications/Ch /cache/chrome --type=browser
  104   103    01:58 /Applications/Ch /cache/chrome --type=renderer
  105     2    10:00 agent-browser-d /opt/agent-browser/bin/agent-browser-darwin-arm64
  106     1    00:30 agent-browser-d /opt/agent-browser/bin/agent-browser-darwin-arm64
  107     1    10:00 node node /opt/agent-browser/bin/agent-browser.js
  108     1    10:00 agent-browser-h agent-browser-helper
  109     1  1-00:00 agent-browser agent-browser --session old
`

test('parses BSD elapsed time without relying on unsupported ps etimes', () => {
  assert.equal(parseElapsedSeconds('01:02'), 62)
  assert.equal(parseElapsedSeconds('03:04:05'), 11_045)
  assert.equal(parseElapsedSeconds('2-03:04:05'), 183_845)
  assert.equal(parseElapsedSeconds('03:60'), null)
  assert.equal(parseElapsedSeconds('unknown'), null)
})

test('selects only old PPID-1 agent-browser native roots', () => {
  const processes = parseProcessTable(PROCESS_TABLE)
  const selected = selectOrphanedAgentBrowserRoots(processes, 120)

  assert.deepEqual(selected.map(({ pid }) => pid), [101, 109])
  assert.equal(selected.some(({ pid }) => pid === 102), false)
  assert.equal(selected.some(({ pid }) => pid === 107), false)
  assert.equal(selected.some(({ pid }) => pid === 108), false)
})

test('reports Chrome descendants without selecting them as signal roots', () => {
  const report = buildAgentBrowserProcessReport(
    parseProcessTable(PROCESS_TABLE),
    120,
  )
  const candidate = report.find(({ root }) => root.pid === 101)

  assert.deepEqual(
    candidate.descendants.map(({ process, depth }) => ({
      pid: process.pid,
      depth,
    })),
    [
      { pid: 103, depth: 1 },
      { pid: 104, depth: 2 },
    ],
  )
  assert.equal(report.some(({ root }) => root.pid === 103), false)
  assert.equal(report.some(({ root }) => root.pid === 104), false)
})

test('re-verifies process identity before producing exact numeric targets', () => {
  const original = parseProcessTable(PROCESS_TABLE)
  const selected = selectOrphanedAgentBrowserRoots(original, 120)
  const current = original.map((processInfo) =>
    processInfo.pid === 101
      ? { ...processInfo, command: '/Applications/Google Chrome' }
      : { ...processInfo, elapsedSeconds: processInfo.elapsedSeconds + 1 })

  const plan = planReverifiedTerminations(selected, current, 120)

  assert.deepEqual(plan.verified.map(({ pid }) => pid), [109])
  assert.deepEqual(plan.skipped.map(({ pid }) => pid), [101])
})

test('defaults to list-only and requires a positive integer age', () => {
  assert.deepEqual(parseAgentBrowserProcessHygieneArgs([]), {
    help: false,
    json: false,
    terminate: false,
    minimumAgeSeconds: 120,
  })
  assert.equal(
    parseAgentBrowserProcessHygieneArgs(['--', '--terminate']).terminate,
    true,
  )
  assert.throws(
    () => parseAgentBrowserProcessHygieneArgs(['--min-age-seconds', '0']),
    /positive integer/,
  )
})

test('never signals in default mode and signals only re-verified roots explicitly', () => {
  const processes = parseProcessTable(PROCESS_TABLE)
  const signals = []
  const dependencies = {
    readProcesses: () => processes,
    signalProcess: (pid, signal) => signals.push({ pid, signal }),
    writeOutput: () => {},
    writeError: () => {},
  }

  assert.equal(main([], dependencies), 0)
  assert.deepEqual(signals, [])

  assert.equal(main(['--terminate'], dependencies), 0)
  assert.deepEqual(signals, [
    { pid: 101, signal: 'SIGTERM' },
    { pid: 109, signal: 'SIGTERM' },
  ])
})
