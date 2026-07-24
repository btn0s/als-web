#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const DEFAULT_SAMPLE_COUNT = 120
const MIN_SAMPLE_COUNT = 3
const MAX_SAMPLE_COUNT = 1000
const MAX_REQUESTED_BONES = 64
const AXES = ['x', 'y', 'z']

const USAGE = `Usage:
  node scripts/extract-als/inspect-clip-motion.mjs <file.glb> <clip-name> [options]

Options:
  --bones a,b    Report motion for the named bones.
  --pair a,b     Report Pearson X/Y/Z correlation for two bones.
                 Pair bones are included in the bone report automatically.
  --samples N    Number of samples across the closed interval [0, duration].
                 Default: ${DEFAULT_SAMPLE_COUNT}; range: ${MIN_SAMPLE_COUNT}-${MAX_SAMPLE_COUNT}.
  --json         Emit machine-readable JSON.
  --help         Show this help.
`

class UsageError extends Error {}

function splitBoneNames(rawValue, optionName) {
  if (rawValue === undefined) {
    throw new UsageError(`${optionName} requires a comma-separated value`)
  }

  const names = rawValue.split(',').map((name) => name.trim())
  if (names.length === 0 || names.some((name) => name.length === 0)) {
    throw new UsageError(`${optionName} contains an empty bone name`)
  }
  return names
}

export function parseInspectClipMotionArgs(argv) {
  const positional = []
  let bones = []
  let pair = null
  let samples = DEFAULT_SAMPLE_COUNT
  let json = false
  let help = false

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--help') {
      help = true
    } else if (argument === '--json') {
      json = true
    } else if (argument === '--bones') {
      bones = splitBoneNames(argv[++index], '--bones')
    } else if (argument === '--pair') {
      const names = splitBoneNames(argv[++index], '--pair')
      if (names.length !== 2) {
        throw new UsageError('--pair requires exactly two comma-separated bone names')
      }
      if (names[0] === names[1]) {
        throw new UsageError('--pair requires two different bone names')
      }
      pair = names
    } else if (argument === '--samples') {
      const rawValue = argv[++index]
      if (rawValue === undefined || !/^\d+$/.test(rawValue)) {
        throw new UsageError('--samples requires an integer')
      }
      samples = Number(rawValue)
      if (samples < MIN_SAMPLE_COUNT || samples > MAX_SAMPLE_COUNT) {
        throw new UsageError(
          `--samples must be between ${MIN_SAMPLE_COUNT} and ${MAX_SAMPLE_COUNT}`,
        )
      }
    } else if (argument.startsWith('--')) {
      throw new UsageError(`unknown option: ${argument}`)
    } else {
      positional.push(argument)
    }
  }

  if (help) {
    return { help, json, bones, pair, samples }
  }
  if (positional.length !== 2) {
    throw new UsageError('expected <file.glb> and <clip-name>')
  }

  const requestedBones = [...new Set([...bones, ...(pair ?? [])])]
  if (requestedBones.length > MAX_REQUESTED_BONES) {
    throw new UsageError(
      `at most ${MAX_REQUESTED_BONES} unique bones may be requested`,
    )
  }

  return {
    help,
    json,
    filePath: positional[0],
    clipName: positional[1],
    bones: requestedBones,
    pair,
    samples,
  }
}

function arrayBufferFromNodeBuffer(buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  )
}

async function loadGltf(filePath) {
  let bytes
  try {
    bytes = await readFile(filePath)
  } catch (error) {
    throw new Error(
      `unable to read GLB "${filePath}": ${error instanceof Error ? error.message : error}`,
    )
  }

  try {
    return await new Promise((resolveGltf, rejectGltf) => {
      new GLTFLoader().parse(
        arrayBufferFromNodeBuffer(bytes),
        '',
        resolveGltf,
        rejectGltf,
      )
    })
  } catch (error) {
    throw new Error(
      `unable to parse GLB "${filePath}": ${error instanceof Error ? error.message : error}`,
    )
  }
}

function collectBones(scene) {
  const bonesByName = new Map()
  scene.traverse((object) => {
    if (!object.isBone) return
    const matches = bonesByName.get(object.name) ?? []
    matches.push(object)
    bonesByName.set(object.name, matches)
  })
  return bonesByName
}

function boundedNames(names) {
  const sorted = [...names].sort()
  const displayed = sorted.slice(0, 20)
  const remainder = sorted.length - displayed.length
  return `${displayed.join(', ')}${remainder > 0 ? `, … (+${remainder})` : ''}`
}

function requireUniqueNamedItem(items, name, kind, availableNames) {
  const matches = items.filter((item) => item.name === name)
  if (matches.length === 0) {
    throw new Error(
      `missing ${kind} "${name}". Available ${kind}s: ${boundedNames(availableNames)}`,
    )
  }
  if (matches.length > 1) {
    throw new Error(`ambiguous ${kind} "${name}": found ${matches.length} matches`)
  }
  return matches[0]
}

function requireUniqueBone(bonesByName, name) {
  const matches = bonesByName.get(name) ?? []
  if (matches.length === 0) {
    throw new Error(
      `missing bone "${name}". Available bones: ${boundedNames(bonesByName.keys())}`,
    )
  }
  if (matches.length > 1) {
    throw new Error(`ambiguous bone "${name}": found ${matches.length} matches`)
  }
  return matches[0]
}

function createAxisSeries() {
  return { x: [], y: [], z: [] }
}

function range(series) {
  let minimum = Infinity
  let maximum = -Infinity
  for (const value of series) {
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  return {
    min: minimum,
    max: maximum,
    amplitude: maximum - minimum,
  }
}

function maximumQuaternionSeparationDegrees(quaternions) {
  let maximumAngle = 0
  for (let first = 0; first < quaternions.length; first++) {
    for (let second = first + 1; second < quaternions.length; second++) {
      maximumAngle = Math.max(
        maximumAngle,
        quaternions[first].angleTo(quaternions[second]),
      )
    }
  }
  return THREE.MathUtils.radToDeg(maximumAngle)
}

function pearsonCorrelation(first, second) {
  let firstMean = 0
  let secondMean = 0
  for (let index = 0; index < first.length; index++) {
    firstMean += first[index]
    secondMean += second[index]
  }
  firstMean /= first.length
  secondMean /= second.length

  let covariance = 0
  let firstVariance = 0
  let secondVariance = 0
  for (let index = 0; index < first.length; index++) {
    const firstDelta = first[index] - firstMean
    const secondDelta = second[index] - secondMean
    covariance += firstDelta * secondDelta
    firstVariance += firstDelta * firstDelta
    secondVariance += secondDelta * secondDelta
  }

  const denominator = Math.sqrt(firstVariance * secondVariance)
  return denominator <= Number.EPSILON ? null : covariance / denominator
}

function countBoneTracks(clip, boneName) {
  let count = 0
  for (const track of clip.tracks) {
    try {
      if (THREE.PropertyBinding.parseTrackName(track.name).nodeName === boneName) {
        count++
      }
    } catch {
      // GLTFLoader already accepted the clip. An exotic track name should not prevent motion
      // sampling; it simply cannot contribute to this per-bone diagnostic count.
    }
  }
  return count
}

function roundNumber(value) {
  return Number(value.toFixed(9))
}

function roundAxisValues(values) {
  return Object.fromEntries(
    AXES.map((axis) => [
      axis,
      Object.fromEntries(
        Object.entries(values[axis]).map(([key, value]) => [key, roundNumber(value)]),
      ),
    ]),
  )
}

function roundCorrelation(value) {
  return value === null ? null : roundNumber(value)
}

/**
 * Samples an authored clip without mutating or writing the source GLB.
 *
 * "Local rotation amplitude" is the largest quaternion angular separation among the requested
 * samples. Relative world positions retain the glTF world axes and subtract the root position.
 */
export async function inspectClipMotion({
  filePath,
  clipName,
  bones = [],
  pair = null,
  samples = DEFAULT_SAMPLE_COUNT,
}) {
  if (
    !Number.isInteger(samples)
    || samples < MIN_SAMPLE_COUNT
    || samples > MAX_SAMPLE_COUNT
  ) {
    throw new Error(
      `samples must be an integer between ${MIN_SAMPLE_COUNT} and ${MAX_SAMPLE_COUNT}`,
    )
  }

  const requestedBoneNames = [...new Set([...bones, ...(pair ?? [])])]
  if (requestedBoneNames.length > MAX_REQUESTED_BONES) {
    throw new Error(
      `at most ${MAX_REQUESTED_BONES} unique bones may be requested`,
    )
  }
  if (pair && (pair.length !== 2 || pair[0] === pair[1])) {
    throw new Error('pair must contain two different bone names')
  }

  const absoluteFilePath = resolve(filePath)
  const gltf = await loadGltf(absoluteFilePath)
  const clips = gltf.animations ?? []
  const clip = requireUniqueNamedItem(
    clips,
    clipName,
    'clip',
    clips.map((candidate) => candidate.name),
  )
  if (!(clip.duration > 0)) {
    throw new Error(`clip "${clipName}" has non-positive duration ${clip.duration}`)
  }

  const bonesByName = collectBones(gltf.scene)
  const root = requireUniqueBone(bonesByName, 'root')
  const requestedBones = new Map(
    requestedBoneNames.map((name) => [name, requireUniqueBone(bonesByName, name)]),
  )
  const sampleData = new Map(
    requestedBoneNames.map((name) => [
      name,
      {
        localRotations: [],
        relativeWorldPositions: createAxisSeries(),
      },
    ]),
  )

  const mixer = new THREE.AnimationMixer(gltf.scene)
  const action = mixer.clipAction(clip)
  action.setLoop(THREE.LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()

  const rootPosition = new THREE.Vector3()
  const bonePosition = new THREE.Vector3()
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    const time = clip.duration * sampleIndex / (samples - 1)
    mixer.setTime(time)
    gltf.scene.updateMatrixWorld(true)
    root.getWorldPosition(rootPosition)

    for (const [name, bone] of requestedBones) {
      const data = sampleData.get(name)
      data.localRotations.push(bone.quaternion.clone())
      bone.getWorldPosition(bonePosition)
      bonePosition.sub(rootPosition)
      data.relativeWorldPositions.x.push(bonePosition.x)
      data.relativeWorldPositions.y.push(bonePosition.y)
      data.relativeWorldPositions.z.push(bonePosition.z)
    }
  }

  const boneReports = {}
  for (const name of requestedBoneNames) {
    const data = sampleData.get(name)
    const firstRotation = data.localRotations[0]
    const lastRotation = data.localRotations.at(-1)
    const firstPosition = new THREE.Vector3(
      data.relativeWorldPositions.x[0],
      data.relativeWorldPositions.y[0],
      data.relativeWorldPositions.z[0],
    )
    const lastPosition = new THREE.Vector3(
      data.relativeWorldPositions.x.at(-1),
      data.relativeWorldPositions.y.at(-1),
      data.relativeWorldPositions.z.at(-1),
    )
    const closureDelta = lastPosition.sub(firstPosition)

    boneReports[name] = {
      trackCount: countBoneTracks(clip, name),
      localRotationAmplitudeDegrees: roundNumber(
        maximumQuaternionSeparationDegrees(data.localRotations),
      ),
      worldPositionRelativeToRootMeters: roundAxisValues({
        x: range(data.relativeWorldPositions.x),
        y: range(data.relativeWorldPositions.y),
        z: range(data.relativeWorldPositions.z),
      }),
      loopClosure: {
        localRotationErrorDegrees: roundNumber(
          THREE.MathUtils.radToDeg(firstRotation.angleTo(lastRotation)),
        ),
        relativeWorldPositionDeltaMeters: {
          x: roundNumber(closureDelta.x),
          y: roundNumber(closureDelta.y),
          z: roundNumber(closureDelta.z),
        },
        relativeWorldPositionErrorMeters: roundNumber(closureDelta.length()),
      },
    }
  }

  let pairReport = null
  if (pair) {
    const firstData = sampleData.get(pair[0]).relativeWorldPositions
    const secondData = sampleData.get(pair[1]).relativeWorldPositions
    pairReport = {
      bones: pair,
      relativeWorldPositionPearsonCorrelation: Object.fromEntries(
        AXES.map((axis) => [
          axis,
          roundCorrelation(pearsonCorrelation(firstData[axis], secondData[axis])),
        ]),
      ),
    }
  }

  mixer.stopAllAction()
  mixer.uncacheRoot(gltf.scene)

  return {
    file: absoluteFilePath,
    clip: clip.name,
    durationSeconds: roundNumber(clip.duration),
    trackCount: clip.tracks.length,
    sampleCount: samples,
    sampleInterval: 'closed [0, duration]',
    rootBone: root.name,
    bones: boneReports,
    pair: pairReport,
  }
}

function formatNumber(value) {
  return value === null ? 'n/a' : value.toFixed(6)
}

export function formatInspectClipMotionReport(report) {
  const lines = [
    `file: ${report.file}`,
    `clip: ${report.clip}`,
    `duration: ${report.durationSeconds.toFixed(6)} s`,
    `tracks: ${report.trackCount}`,
    `samples: ${report.sampleCount} (${report.sampleInterval})`,
    `root: ${report.rootBone}`,
  ]

  for (const [name, bone] of Object.entries(report.bones)) {
    lines.push(
      '',
      `bone: ${name}`,
      `  bound tracks: ${bone.trackCount}`,
      `  local rotation amplitude: ${bone.localRotationAmplitudeDegrees.toFixed(6)} deg`,
      '  world position relative to root (m):',
    )
    for (const axis of AXES) {
      const axisRange = bone.worldPositionRelativeToRootMeters[axis]
      lines.push(
        `    ${axis.toUpperCase()}: min ${formatNumber(axisRange.min)}, `
        + `max ${formatNumber(axisRange.max)}, range ${formatNumber(axisRange.amplitude)}`,
      )
    }
    lines.push(
      `  loop closure: rotation ${bone.loopClosure.localRotationErrorDegrees.toFixed(6)} deg, `
      + `position ${bone.loopClosure.relativeWorldPositionErrorMeters.toFixed(6)} m`,
    )
  }

  if (report.pair) {
    const correlation = report.pair.relativeWorldPositionPearsonCorrelation
    lines.push(
      '',
      `pair: ${report.pair.bones[0]} ↔ ${report.pair.bones[1]}`,
      '  relative world-position Pearson correlation:',
      `    X ${formatNumber(correlation.x)}, `
      + `Y ${formatNumber(correlation.y)}, Z ${formatNumber(correlation.z)}`,
    )
  }

  return lines.join('\n')
}

async function runCli() {
  try {
    const options = parseInspectClipMotionArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(USAGE)
      return
    }

    const report = await inspectClipMotion(options)
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatInspectClipMotionReport(report)}\n`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`inspect-clip-motion: ${message}\n`)
    if (error instanceof UsageError) {
      process.stderr.write(`\n${USAGE}`)
      process.exitCode = 2
    } else {
      process.exitCode = 1
    }
  }
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedAsScript) {
  await runCli()
}
