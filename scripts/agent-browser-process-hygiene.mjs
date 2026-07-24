#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_MINIMUM_AGE_SECONDS = 120

const AGENT_BROWSER_EXECUTABLE_PATTERN =
  /^(?:agent-browser(?:\.exe)?|agent-browser-darwin-(?:arm64|x64)|agent-browser-linux(?:-musl)?-(?:arm64|x64)|agent-browser-win32-x64\.exe)$/

const USAGE = `usage: pnpm process-hygiene:agent-browser -- [options]

Lists old agent-browser daemon roots and their descendants. It never signals
anything unless --terminate is supplied.

options:
  --terminate                 SIGTERM re-verified matching daemon roots only
  --min-age-seconds <seconds> Minimum age for a root (default: 120)
  --json                      Emit machine-readable JSON
  --help                      Show this help
`

export function parseElapsedSeconds(value) {
  const match = /^(?:(\d+)-)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (match === null) {
    return null
  }

  const days = Number(match[1] ?? 0)
  const hasHours = match[4] !== undefined
  const hours = hasHours ? Number(match[2]) : 0
  const minutes = Number(hasHours ? match[3] : match[2])
  const seconds = Number(hasHours ? match[4] : match[3])

  if (
    !Number.isSafeInteger(days)
    || !Number.isSafeInteger(hours)
    || minutes > 59
    || seconds > 59
  ) {
    return null
  }

  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds
}

export function parseProcessTable(output) {
  const processes = []

  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line)
    if (match === null) {
      continue
    }

    const pid = Number(match[1])
    const parentPid = Number(match[2])
    const elapsedSeconds = parseElapsedSeconds(match[3])
    if (
      !Number.isSafeInteger(pid)
      || pid <= 0
      || !Number.isSafeInteger(parentPid)
      || parentPid < 0
      || elapsedSeconds === null
    ) {
      continue
    }

    processes.push({
      pid,
      parentPid,
      elapsedSeconds,
      executable: match[4],
      command: match[5] ?? '',
    })
  }

  return processes
}

function firstCommandToken(command) {
  const token = command.trimStart().split(/\s+/, 1)[0] ?? ''
  return token.replace(/^["']|["']$/g, '')
}

export function isAgentBrowserExecutable(processInfo) {
  const executableNames = new Set([
    basename(processInfo.executable),
    basename(firstCommandToken(processInfo.command)),
  ])

  for (const executableName of executableNames) {
    if (AGENT_BROWSER_EXECUTABLE_PATTERN.test(executableName)) {
      return true
    }
  }

  return false
}

export function selectOrphanedAgentBrowserRoots(
  processes,
  minimumAgeSeconds = DEFAULT_MINIMUM_AGE_SECONDS,
) {
  return processes
    .filter((processInfo) =>
      processInfo.parentPid === 1
      && processInfo.elapsedSeconds >= minimumAgeSeconds
      && isAgentBrowserExecutable(processInfo))
    .sort((left, right) => left.pid - right.pid)
}

export function collectProcessDescendants(processes, rootPid) {
  const childrenByParent = new Map()
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.parentPid) ?? []
    children.push(processInfo)
    childrenByParent.set(processInfo.parentPid, children)
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.pid - right.pid)
  }

  const descendants = []
  const visited = new Set([rootPid])
  const queue = (childrenByParent.get(rootPid) ?? [])
    .map((processInfo) => ({ process: processInfo, depth: 1 }))

  for (let index = 0; index < queue.length; index += 1) {
    const descendant = queue[index]
    if (visited.has(descendant.process.pid)) {
      continue
    }

    visited.add(descendant.process.pid)
    descendants.push(descendant)

    for (const child of childrenByParent.get(descendant.process.pid) ?? []) {
      queue.push({ process: child, depth: descendant.depth + 1 })
    }
  }

  return descendants
}

export function buildAgentBrowserProcessReport(
  processes,
  minimumAgeSeconds = DEFAULT_MINIMUM_AGE_SECONDS,
) {
  return selectOrphanedAgentBrowserRoots(processes, minimumAgeSeconds)
    .map((root) => ({
      root,
      descendants: collectProcessDescendants(processes, root.pid),
    }))
}

function hasSameProcessIdentity(expected, current) {
  return expected.pid === current.pid
    && expected.executable === current.executable
    && expected.command === current.command
}

export function planReverifiedTerminations(
  originallySelectedRoots,
  currentProcesses,
  minimumAgeSeconds = DEFAULT_MINIMUM_AGE_SECONDS,
) {
  const currentRootsByPid = new Map(
    selectOrphanedAgentBrowserRoots(currentProcesses, minimumAgeSeconds)
      .map((processInfo) => [processInfo.pid, processInfo]),
  )
  const verified = []
  const skipped = []

  for (const original of originallySelectedRoots) {
    const current = currentRootsByPid.get(original.pid)
    if (current !== undefined && hasSameProcessIdentity(original, current)) {
      verified.push(current)
    } else {
      skipped.push(original)
    }
  }

  return { verified, skipped }
}

export function parseAgentBrowserProcessHygieneArgs(argv) {
  const options = {
    help: false,
    json: false,
    terminate: false,
    minimumAgeSeconds: DEFAULT_MINIMUM_AGE_SECONDS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--') {
      continue
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--json') {
      options.json = true
    } else if (argument === '--terminate') {
      options.terminate = true
    } else if (argument === '--min-age-seconds') {
      index += 1
      options.minimumAgeSeconds = Number(argv[index])
    } else if (argument.startsWith('--min-age-seconds=')) {
      options.minimumAgeSeconds = Number(argument.slice(
        '--min-age-seconds='.length,
      ))
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (
    !Number.isSafeInteger(options.minimumAgeSeconds)
    || options.minimumAgeSeconds < 1
  ) {
    throw new Error('--min-age-seconds must be a positive integer.')
  }

  return options
}

export function readProcessTable() {
  const output = execFileSync(
    '/bin/ps',
    ['-ww', '-axo', 'pid=,ppid=,etime=,comm=,args='],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  return parseProcessTable(output)
}

function processSummary(processInfo) {
  return {
    pid: processInfo.pid,
    parentPid: processInfo.parentPid,
    elapsedSeconds: processInfo.elapsedSeconds,
    executable: processInfo.executable,
    command: processInfo.command,
  }
}

export function formatAgentBrowserProcessReport(report) {
  const lines = [
    `mode: ${report.mode}`,
    `minimum age: ${report.minimumAgeSeconds}s`,
    `matching daemon roots: ${report.roots.length}`,
  ]

  for (const candidate of report.roots) {
    const root = candidate.root
    lines.push(
      '',
      `root pid=${root.pid} ppid=${root.parentPid} age=${root.elapsedSeconds}s`,
      `  executable: ${root.executable}`,
      `  descendants: ${candidate.descendants.length}`,
    )

    for (const descendant of candidate.descendants) {
      lines.push(
        `${'  '.repeat(descendant.depth + 1)}`
        + `pid=${descendant.process.pid} ppid=${descendant.process.parentPid} `
        + `age=${descendant.process.elapsedSeconds}s `
        + `executable=${descendant.process.executable}`,
      )
    }
  }

  if (report.mode === 'list-only') {
    lines.push('', 'No signals sent. Re-run with --terminate to send SIGTERM to these roots.')
  } else {
    lines.push(
      '',
      `SIGTERM sent: ${report.termination.signaled.length}`,
      `skipped after re-verification: ${report.termination.skipped.length}`,
      `signal failures: ${report.termination.failed.length}`,
    )
    for (const failure of report.termination.failed) {
      lines.push(`  pid=${failure.pid}: ${failure.error}`)
    }
  }

  return `${lines.join('\n')}\n`
}

export function main(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  const readProcesses = dependencies.readProcesses ?? readProcessTable
  const signalProcess = dependencies.signalProcess
    ?? ((pid, signal) => process.kill(pid, signal))
  const writeOutput = dependencies.writeOutput
    ?? ((value) => process.stdout.write(value))
  const writeError = dependencies.writeError
    ?? ((value) => process.stderr.write(value))

  let options
  try {
    options = parseAgentBrowserProcessHygieneArgs(argv)
  } catch (error) {
    writeError(`agent-browser-process-hygiene: ${error.message}\n\n${USAGE}`)
    return 2
  }

  if (options.help) {
    writeOutput(USAGE)
    return 0
  }

  let processes
  try {
    processes = readProcesses()
  } catch (error) {
    writeError(`agent-browser-process-hygiene: process discovery failed: ${error.message}\n`)
    return 1
  }

  const roots = buildAgentBrowserProcessReport(
    processes,
    options.minimumAgeSeconds,
  )
  const report = {
    mode: options.terminate ? 'terminate' : 'list-only',
    minimumAgeSeconds: options.minimumAgeSeconds,
    roots: roots.map(({ root, descendants }) => ({
      root: processSummary(root),
      descendants: descendants.map(({ process: processInfo, depth }) => ({
        depth,
        process: processSummary(processInfo),
      })),
    })),
  }

  if (options.terminate) {
    const selectedRoots = roots.map(({ root }) => root)
    let currentProcesses
    try {
      currentProcesses = readProcesses()
    } catch (error) {
      writeError(`agent-browser-process-hygiene: re-verification failed: ${error.message}\n`)
      return 1
    }

    const plan = planReverifiedTerminations(
      selectedRoots,
      currentProcesses,
      options.minimumAgeSeconds,
    )
    const termination = {
      signaled: [],
      skipped: plan.skipped.map(processSummary),
      failed: [],
    }

    for (const processInfo of plan.verified) {
      try {
        signalProcess(processInfo.pid, 'SIGTERM')
        termination.signaled.push(processSummary(processInfo))
      } catch (error) {
        termination.failed.push({
          pid: processInfo.pid,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    report.termination = termination
  }

  writeOutput(
    options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatAgentBrowserProcessReport(report),
  )

  return report.termination?.failed.length > 0 ? 1 : 0
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  process.exitCode = main()
}
