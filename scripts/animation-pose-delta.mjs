#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createServer } from 'vite'

const RIFLE_CLIPS = [
  'A_Als_Rifle_Poses',
  'A_Als_Rifle_Run_Arms',
  'A_Als_Rifle_Sprint_Arms',
  'A_Als_Rifle_Sprint_Impulse_Arms',
]
const ARM_BONE = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky).*_[lr]$/i
const SIDE_PAIR_BONES = ['upperarm', 'lowerarm', 'hand']
const SOURCE_VALUE_EPSILON = 2e-6

function usage() {
  return `Usage:
  pnpm diagnose:animation [all|roll|rifle] [--json] [--source-dump <path>]

Runs the owned pose-buffer runtime without a browser or server port, compares it
to ALS-authored poses, and prints only the first failing stage and ranked bones.

The Rifle check also compares every shipped arm channel to the cached fresh
CUE4Parse dump at ~/.cache/als-extract/als-dump.json when it is available.`
}

function parseArguments(argv) {
  let scenario = 'all'
  let json = false
  let sourceDump = resolve(
    homedir(),
    '.cache/als-extract/als-dump.json',
  )
  let useSourceDump = true
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--json') {
      json = true
    } else if (argument === '--no-source') {
      useSourceDump = false
    } else if (argument === '--source-dump') {
      const value = argv[++index]
      if (!value) throw new Error('--source-dump requires a path')
      sourceDump = resolve(value)
    } else if (argument === '--help' || argument === '-h') {
      return { help: true }
    } else if (['all', 'roll', 'rifle'].includes(argument)) {
      scenario = argument
    } else {
      throw new Error(`Unknown argument "${argument}"`)
    }
  }
  return {
    help: false,
    scenario,
    json,
    sourceDump,
    useSourceDump,
  }
}

async function loadGltf(path) {
  const bytes = await readFile(path)
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return new GLTFLoader().parseAsync(data, '')
}

function quaternionToMatrix([x, y, z, w]) {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ]
}

function matrixToQuaternion(matrix) {
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = matrix
  const trace = m00 + m11 + m22
  let quaternion
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2
    quaternion = [
      (m21 - m12) / scale,
      (m02 - m20) / scale,
      (m10 - m01) / scale,
      scale / 4,
    ]
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2
    quaternion = [
      scale / 4,
      (m01 + m10) / scale,
      (m02 + m20) / scale,
      (m21 - m12) / scale,
    ]
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2
    quaternion = [
      (m01 + m10) / scale,
      scale / 4,
      (m12 + m21) / scale,
      (m02 - m20) / scale,
    ]
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2
    quaternion = [
      (m02 + m20) / scale,
      (m12 + m21) / scale,
      scale / 4,
      (m10 - m01) / scale,
    ]
  }
  const length = Math.hypot(...quaternion)
  return quaternion.map((value) => value / length)
}

// Exact C-basis conversion used by assemble-glb.mjs.
function convertQuaternion(quaternion) {
  const matrix = quaternionToMatrix(quaternion)
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = matrix
  return matrixToQuaternion([
    m00, m20, m10,
    m02, m22, m12,
    m01, m21, m11,
  ])
}

function convertPosition([x, y, z]) {
  return [x * 0.01, z * 0.01, y * 0.01]
}

function trackBinding(animation, boneName, property) {
  return animation.tracks.find((track) => {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name)
    return (
      parsed.nodeName?.toLowerCase() === boneName.toLowerCase()
      && parsed.propertyName === property
    )
  })
}

function maximumQuaternionComponentError(expected, actual, offset) {
  let direct = 0
  let negated = 0
  for (let component = 0; component < 4; component++) {
    direct = Math.max(
      direct,
      Math.abs(expected[component] - actual[offset + component]),
    )
    negated = Math.max(
      negated,
      Math.abs(expected[component] + actual[offset + component]),
    )
  }
  return Math.min(direct, negated)
}

function quaternionAngleDegrees(a, b) {
  const dot = Math.abs(
    a[0] * b[0]
    + a[1] * b[1]
    + a[2] * b[2]
    + a[3] * b[3],
  )
  return THREE.MathUtils.radToDeg(
    2 * Math.acos(Math.min(1, Math.max(-1, dot))),
  )
}

function sourceKey(values, index, fallback) {
  if (!Array.isArray(values) || values.length === 0) return fallback
  return values[Math.min(index, values.length - 1)]
}

export function compareRifleGlbToSourceDump(dump, gltf) {
  const canonicalByLower = new Map(
    dump.skeleton.bones.map((bone) => [
      bone.name.toLowerCase(),
      bone.name,
    ]),
  )
  const referenceByName = new Map(
    dump.skeleton.bones.map((bone) => [bone.name, bone]),
  )
  const mismatches = []
  let comparedTrackCount = 0
  let maximumError = 0

  for (const clipName of RIFLE_CLIPS) {
    const source = dump.anims.find(({ name }) => name === clipName)
    const animation = gltf.animations.find(({ name }) => name === clipName)
    if (!source || !animation) {
      mismatches.push({
        clip: clipName,
        bone: '(clip)',
        property: 'missing',
        maximumError: Infinity,
      })
      continue
    }
    for (const sourceTrack of source.tracks) {
      const canonical = canonicalByLower.get(
        sourceTrack.bone.toLowerCase(),
      )
      if (!canonical || !ARM_BONE.test(canonical)) continue
      const reference = referenceByName.get(canonical)
      if (!reference) continue
      for (const property of ['position', 'quaternion']) {
        const track = trackBinding(animation, canonical, property)
        comparedTrackCount++
        let trackMaximum = 0
        if (!track) {
          trackMaximum = Infinity
        } else {
          const size = property === 'position' ? 3 : 4
          for (let keyIndex = 0; keyIndex < source.numberOfKeys; keyIndex++) {
            const sourceValue = property === 'position'
              ? convertPosition(sourceKey(
                  sourceTrack.pos,
                  keyIndex,
                  reference.t,
                ))
              : convertQuaternion(sourceKey(
                  sourceTrack.rot,
                  keyIndex,
                  reference.r,
                ))
            const offset = keyIndex * size
            if (property === 'quaternion') {
              trackMaximum = Math.max(
                trackMaximum,
                maximumQuaternionComponentError(
                  sourceValue,
                  track.values,
                  offset,
                ),
              )
            } else {
              for (let component = 0; component < size; component++) {
                trackMaximum = Math.max(
                  trackMaximum,
                  Math.abs(
                    sourceValue[component]
                    - track.values[offset + component],
                  ),
                )
              }
            }
          }
        }
        maximumError = Math.max(maximumError, trackMaximum)
        if (trackMaximum > SOURCE_VALUE_EPSILON) {
          mismatches.push({
            clip: clipName,
            bone: canonical,
            property,
            maximumError: trackMaximum,
          })
        }
      }
    }
  }
  mismatches.sort((a, b) => b.maximumError - a.maximumError)

  const sidePairs = []
  for (const clipName of RIFLE_CLIPS) {
    const source = dump.anims.find(({ name }) => name === clipName)
    if (!source) continue
    for (const baseName of SIDE_PAIR_BONES) {
      const left = source.tracks.find(
        ({ bone }) => bone.toLowerCase() === `${baseName}_l`,
      )
      const right = source.tracks.find(
        ({ bone }) => bone.toLowerCase() === `${baseName}_r`,
      )
      if (!left || !right) continue
      let maximumRotationSeparationDegrees = 0
      for (let keyIndex = 0; keyIndex < source.numberOfKeys; keyIndex++) {
        const leftRotation = convertQuaternion(sourceKey(
          left.rot,
          keyIndex,
          referenceByName.get(`${baseName}_l`)?.r ?? [0, 0, 0, 1],
        ))
        const rightRotation = convertQuaternion(sourceKey(
          right.rot,
          keyIndex,
          referenceByName.get(`${baseName}_r`)?.r ?? [0, 0, 0, 1],
        ))
        maximumRotationSeparationDegrees = Math.max(
          maximumRotationSeparationDegrees,
          quaternionAngleDegrees(leftRotation, rightRotation),
        )
      }
      sidePairs.push({
        clip: clipName,
        bones: [`${baseName}_l`, `${baseName}_r`],
        maximumRotationSeparationDegrees,
      })
    }
  }
  return {
    matches: mismatches.length === 0,
    sourceDumpClipCount: RIFLE_CLIPS.length,
    comparedTrackCount,
    maximumError,
    mismatchedTrackCount: mismatches.length,
    worstMismatches: mismatches.slice(0, 8),
    sidePairs,
  }
}

function formatSourceReport(report, path) {
  if (!report) {
    return `SKIP Rifle source extraction — no dump at ${path}`
  }
  const pairRanges = new Map()
  for (const pair of report.sidePairs) {
    const previous = pairRanges.get(pair.clip)
    pairRanges.set(pair.clip, {
      minimum: Math.min(
        previous?.minimum ?? Infinity,
        pair.maximumRotationSeparationDegrees,
      ),
      maximum: Math.max(
        previous?.maximum ?? 0,
        pair.maximumRotationSeparationDegrees,
      ),
    })
  }
  const lines = [
    `${report.matches ? 'PASS' : 'FAIL'} Rifle source extraction`,
    `  arm channels: ${report.comparedTrackCount - report.mismatchedTrackCount}`
      + `/${report.comparedTrackCount} match fresh CUE4Parse source`,
    `  left/right authored separation: ${[...pairRanges].map(([
      clip,
      range,
    ]) => (
      `${clip.replace('A_Als_Rifle_', '')} `
      + `${range.minimum.toFixed(1)}–${range.maximum.toFixed(1)}°`
    )).join(', ')}`,
  ]
  for (const mismatch of report.worstMismatches) {
    lines.push(
      `  ${mismatch.clip} ${mismatch.bone}.${mismatch.property}: `
      + `${mismatch.maximumError.toExponential(3)}`,
    )
  }
  return lines.join('\n')
}

async function sourceReport(path, gltf) {
  try {
    await access(path)
  } catch {
    return null
  }
  const dump = JSON.parse(await readFile(path, 'utf8'))
  return compareRifleGlbToSourceDump(dump, gltf)
}

export async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`)
    return 2
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }

  const assetPath = resolve('public/assets/skm-als.glb')
  globalThis.window ??= {}
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'silent',
  })
  try {
    const diagnostic = await vite.ssrLoadModule(
      '/src/als/parity/animationPoseDiagnostic.ts',
    )
    const reports = []
    if (options.scenario === 'all' || options.scenario === 'roll') {
      reports.push(diagnostic.runRollAnimationPoseDiagnostic(
        await loadGltf(assetPath),
        await loadGltf(assetPath),
      ))
    }

    let extraction = null
    if (options.scenario === 'all' || options.scenario === 'rifle') {
      const sourceGltf = await loadGltf(assetPath)
      reports.push(diagnostic.runRifleAnimationPoseDiagnostic(
        await loadGltf(assetPath),
        sourceGltf,
      ))
      if (options.useSourceDump) {
        extraction = await sourceReport(options.sourceDump, sourceGltf)
      }
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify({
        reports,
        rifleSourceExtraction: extraction,
      }, null, 2)}\n`)
    } else {
      const sections = reports.map(
        diagnostic.formatAnimationPoseDiagnostic,
      )
      if (options.scenario === 'all' || options.scenario === 'rifle') {
        sections.push(formatSourceReport(extraction, options.sourceDump))
      }
      process.stdout.write(`${sections.join('\n\n')}\n`)
    }
    const failed = (
      reports.some(({ firstFailingStage }) => firstFailingStage !== null)
      || extraction?.matches === false
    )
    return failed ? 1 : 0
  } finally {
    await vite.close()
  }
}

const isMain = (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
if (isMain) {
  process.exitCode = await main()
}
