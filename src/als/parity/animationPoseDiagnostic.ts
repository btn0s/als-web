import * as THREE from 'three'
import {
  applyAdditivePose,
  applyMeshSpaceAdditivePose,
  createMeshSpaceBlendScratch,
  makeDynamicAdditivePose,
} from '../../engine/blend'
import {
  compileClipSampler,
  sampleClip,
} from '../../engine/clipSampler'
import {
  compileClipCurveSamplers,
  type ClipCurveSamplers,
} from '../../engine/curves'
import {
  captureLocalPose,
  createPoseDeltaReport,
  formatPoseDeltaReport,
  type PoseDeltaReport,
} from '../../engine/poseDelta'
import {
  copyPose,
  createPoseBuffer,
  resetPoseToReference,
  type LocalPoseBuffer,
} from '../../engine/poseBuffer'
import { createRigDefinition, type RigDefinition } from '../../engine/rig'
import {
  captureSkinnedMeshWorldBounds,
} from '../../engine/skinnedMeshBounds'
import {
  createAlsDefaultOverlayGraphRuntime,
  createAlsDefaultOverlayGraphState,
  evaluateAlsDefaultOverlayGraph,
  refreshAlsDefaultOverlayGraph,
} from '../AnimGraph/AB_Als_Default'
import {
  createAlsRifleRelaxedRuntime,
  evaluateAlsRifleRelaxedGraph,
  refreshAlsRifleRelaxedState,
  type AlsRifleRelaxedSources,
} from '../AnimGraph/AB_Als_Rifle'
import {
  createAlsControlRigHandIkRuntime,
  evaluateAlsControlRigHandIk,
} from '../AnimGraph/CR_Als'
import {
  composeAlsLayeringFinalCurves,
  createAlsLayeringPoseRuntime,
  evaluateAlsLayeringPose,
} from '../AnimGraph/AlsLayering'
import {
  ALS_ROLLING_MONTAGE,
  ALS_ROLL_SEQUENCE,
} from '../AnimGraph/rolling'
import {
  createAlsAnimationInstance,
  type AlsAnimationInstanceControls,
} from '../AlsAnimationInstance'
import { ALS_VIRTUAL_BONES } from '../Utility/AlsVirtualBones'

export type AnimationPoseDiagnosticScenario = 'roll' | 'rifle'

export interface AnimationPoseDiagnosticGltf {
  readonly animations: THREE.AnimationClip[]
  readonly scene: THREE.Group
}

export interface AnimationPoseDiagnosticStage {
  readonly name: string
  readonly report: PoseDeltaReport
}

export interface AnimationPoseDiagnosticContact {
  readonly authoredMinimumY: number
  readonly expectedGraphMinimumY: number
  readonly runtimeMinimumY: number
}

export interface AnimationPoseSideMotion {
  readonly leftBone: string
  readonly rightBone: string
  readonly authoredDeltaSeparationDegrees: number
  readonly runtimeDeltaSeparationDegrees: number
  readonly runtimeLeftAmplitudeDegrees: number
  readonly runtimeRightAmplitudeDegrees: number
  readonly collapsed: boolean
}

export interface AnimationPoseDiagnosticReport {
  readonly scenario: AnimationPoseDiagnosticScenario
  readonly label: string
  readonly stages: readonly AnimationPoseDiagnosticStage[]
  readonly firstFailingStage: string | null
  readonly contact: AnimationPoseDiagnosticContact
  readonly sideMotion?: readonly AnimationPoseSideMotion[]
}

const IDLE_ADDITIVE_WEIGHT = 0.75
const SETTLE_FRAME_COUNT = 30
const SETTLE_DELTA_TIME = 1 / 60
const ROLL_SAMPLE_TIME = 0.89
const ROLL_PLAY_RATE = 1.3
const DIAGNOSTIC_DELTA_OPTIONS = {
  thresholds: {
    localPositionMeters: 1e-4,
    localRotationDegrees: 0.1,
    localScale: 1e-4,
    componentPositionMeters: 1e-3,
    componentRotationDegrees: 0.1,
  },
} as const
const RIFLE_ARM_BONE = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky).*_[lr]$/

const IDLE_CONTROLS: AlsAnimationInstanceControls = {
  gait: 'Walking',
  stance: 'Standing',
  rotationMode: 'ViewDirection',
  overlayMode: 'Default',
  speed: 0,
  direction: 0,
  relativeAccelerationAmount: { x: 0, y: 0 },
  rotateInPlace: false,
  viewYawAngle: 0,
  viewYawSpeed: 0,
  moving: false,
  movingSmooth: false,
  locomotionAction: null,
}

function clip(
  gltf: AnimationPoseDiagnosticGltf,
  name: string,
) {
  const animation = gltf.animations.find(
    (candidate) => candidate.name === name,
  )
  if (!animation) throw new Error(`Missing ALS animation "${name}"`)
  return animation
}

function rootLockedPoseClip(animation: THREE.AnimationClip) {
  return new THREE.AnimationClip(
    animation.name,
    animation.duration,
    animation.tracks.filter(({ name }) => !name.startsWith('root.')),
  )
}

function sampledCurves(
  samplers: ClipCurveSamplers,
  time: number,
) {
  const values = new Map<string, number>()
  for (const [name, sampler] of Object.entries(samplers)) {
    values.set(name, sampler(time))
  }
  return values
}

function samplePose(
  rig: RigDefinition,
  animation: THREE.AnimationClip,
  time: number,
  loop = false,
  fallback: 'reference' | LocalPoseBuffer = 'reference',
) {
  return sampleClip(
    compileClipSampler(animation, rig),
    rig,
    time,
    createPoseBuffer(rig.boneCount),
    loop,
    fallback,
  )
}

function applyIdleAdditive(
  gltf: AnimationPoseDiagnosticGltf,
  rig: RigDefinition,
  standReference: LocalPoseBuffer,
  target: LocalPoseBuffer,
  time: number,
) {
  const idle = clip(gltf, 'A_Als_Idle')
  const sampled = samplePose(
    rig,
    idle,
    time,
    true,
    standReference,
  )
  const additive = createPoseBuffer(rig.boneCount)
  const scratch = createMeshSpaceBlendScratch(rig.boneCount)
  makeDynamicAdditivePose(
    sampled,
    standReference,
    rig,
    additive,
    'local',
    scratch,
  )
  applyAdditivePose(target, additive, IDLE_ADDITIVE_WEIGHT)
}

function minimumY(root: THREE.Object3D) {
  const bounds = captureSkinnedMeshWorldBounds(root)
  if (!bounds) throw new Error('SKM_Als has no skinned mesh bounds')
  return bounds.min[1]
}

function applyPoseToScene(
  root: THREE.Object3D,
  rig: RigDefinition,
  pose: LocalPoseBuffer,
) {
  const bones = new Map<string, THREE.Bone>()
  root.traverse((object) => {
    if (object instanceof THREE.Bone && !bones.has(object.name)) {
      bones.set(object.name, object)
    }
  })
  for (let bone = 0; bone < rig.physicalBoneCount; bone++) {
    const object = bones.get(rig.boneNames[bone])
    if (!object) throw new Error(`Missing SK_Als bone "${rig.boneNames[bone]}"`)
    const p = bone * 3
    const q = bone * 4
    object.position.fromArray(pose.positions, p)
    object.quaternion.fromArray(pose.rotations, q)
    object.scale.fromArray(pose.scales, p)
  }
  root.updateMatrixWorld(true)
}

function finishReport(
  scenario: AnimationPoseDiagnosticScenario,
  label: string,
  stages: readonly AnimationPoseDiagnosticStage[],
  contact: AnimationPoseDiagnosticContact,
  sideMotion?: readonly AnimationPoseSideMotion[],
): AnimationPoseDiagnosticReport {
  const collapsedSideMotion = sideMotion?.some(({ collapsed }) => collapsed)
  return {
    scenario,
    label,
    stages,
    firstFailingStage:
      stages.find(({ report }) => !report.matches)?.name
      ?? (collapsedSideMotion ? 'left/right motion collapse' : null),
    contact,
    sideMotion,
  }
}

interface PairQuaternionFrame {
  readonly left: THREE.Quaternion
  readonly right: THREE.Quaternion
}

function pairMotion(
  leftBone: string,
  rightBone: string,
  authored: readonly PairQuaternionFrame[],
  runtime: readonly PairQuaternionFrame[],
): AnimationPoseSideMotion {
  const measure = (frames: readonly PairQuaternionFrame[]) => {
    const first = frames[0]
    if (!first) {
      return {
        deltaSeparationDegrees: 0,
        leftAmplitudeDegrees: 0,
        rightAmplitudeDegrees: 0,
      }
    }
    const leftInverse = first.left.clone().invert()
    const rightInverse = first.right.clone().invert()
    const leftDelta = new THREE.Quaternion()
    const rightDelta = new THREE.Quaternion()
    let deltaSeparationDegrees = 0
    let leftAmplitudeDegrees = 0
    let rightAmplitudeDegrees = 0
    for (const frame of frames) {
      leftDelta.copy(leftInverse).multiply(frame.left).normalize()
      rightDelta.copy(rightInverse).multiply(frame.right).normalize()
      deltaSeparationDegrees = Math.max(
        deltaSeparationDegrees,
        THREE.MathUtils.radToDeg(leftDelta.angleTo(rightDelta)),
      )
      leftAmplitudeDegrees = Math.max(
        leftAmplitudeDegrees,
        THREE.MathUtils.radToDeg(first.left.angleTo(frame.left)),
      )
      rightAmplitudeDegrees = Math.max(
        rightAmplitudeDegrees,
        THREE.MathUtils.radToDeg(first.right.angleTo(frame.right)),
      )
    }
    return {
      deltaSeparationDegrees,
      leftAmplitudeDegrees,
      rightAmplitudeDegrees,
    }
  }
  const authoredMotion = measure(authored)
  const runtimeMotion = measure(runtime)
  return {
    leftBone,
    rightBone,
    authoredDeltaSeparationDegrees:
      authoredMotion.deltaSeparationDegrees,
    runtimeDeltaSeparationDegrees:
      runtimeMotion.deltaSeparationDegrees,
    runtimeLeftAmplitudeDegrees:
      runtimeMotion.leftAmplitudeDegrees,
    runtimeRightAmplitudeDegrees:
      runtimeMotion.rightAmplitudeDegrees,
    collapsed: (
      authoredMotion.deltaSeparationDegrees
        > DIAGNOSTIC_DELTA_OPTIONS.thresholds.localRotationDegrees
      && runtimeMotion.deltaSeparationDegrees
        <= DIAGNOSTIC_DELTA_OPTIONS.thresholds.localRotationDegrees
    ),
  }
}

function posePairFrame(
  pose: LocalPoseBuffer,
  rig: RigDefinition,
  leftBone: string,
  rightBone: string,
): PairQuaternionFrame {
  const left = rig.boneNames.indexOf(leftBone)
  const right = rig.boneNames.indexOf(rightBone)
  if (left < 0 || right < 0) {
    throw new Error(`Missing side-motion pair ${leftBone}/${rightBone}`)
  }
  return {
    left: new THREE.Quaternion().fromArray(pose.rotations, left * 4),
    right: new THREE.Quaternion().fromArray(pose.rotations, right * 4),
  }
}

function scenePairFrame(
  root: THREE.Object3D,
  leftBone: string,
  rightBone: string,
): PairQuaternionFrame {
  const left = root.getObjectByName(leftBone)
  const right = root.getObjectByName(rightBone)
  if (!(left instanceof THREE.Bone) || !(right instanceof THREE.Bone)) {
    throw new Error(`Missing side-motion pair ${leftBone}/${rightBone}`)
  }
  return {
    left: left.quaternion.clone(),
    right: right.quaternion.clone(),
  }
}

export function runRollAnimationPoseDiagnostic(
  runtimeGltf: AnimationPoseDiagnosticGltf,
  oracleGltf: AnimationPoseDiagnosticGltf,
): AnimationPoseDiagnosticReport {
  const oracleRig = createRigDefinition(
    oracleGltf.scene,
    ALS_VIRTUAL_BONES,
  )
  const authoredRoll = clip(oracleGltf, ALS_ROLL_SEQUENCE.Name)
  const poseRoll = rootLockedPoseClip(authoredRoll)

  const mixer = new THREE.AnimationMixer(oracleGltf.scene)
  mixer.clipAction(poseRoll).play()
  mixer.setTime(ROLL_SAMPLE_TIME)
  const authoredPose = captureLocalPose(oracleGltf.scene, oracleRig)
  const authoredMinimumY = minimumY(oracleGltf.scene)

  const sampledRoll = samplePose(
    oracleRig,
    poseRoll,
    ROLL_SAMPLE_TIME,
  )
  const samplerReport = createPoseDeltaReport(
    oracleRig,
    authoredPose,
    sampledRoll,
    DIAGNOSTIC_DELTA_OPTIONS,
  )

  const standReference = samplePose(
    oracleRig,
    clip(oracleGltf, 'A_Als_Stand_Pose'),
    0,
  )
  const reconstructed = copyPose(
    standReference,
    createPoseBuffer(oracleRig.boneCount),
  )
  const dynamicAdditive = createPoseBuffer(oracleRig.boneCount)
  const meshSpaceScratch =
    createMeshSpaceBlendScratch(oracleRig.boneCount)
  makeDynamicAdditivePose(
    sampledRoll,
    standReference,
    oracleRig,
    dynamicAdditive,
    'mesh',
    meshSpaceScratch,
  )
  applyMeshSpaceAdditivePose(
    reconstructed,
    dynamicAdditive,
    oracleRig,
    1,
    meshSpaceScratch,
  )
  const additiveReport = createPoseDeltaReport(
    oracleRig,
    sampledRoll,
    reconstructed,
    DIAGNOSTIC_DELTA_OPTIONS,
  )

  const referencePose = resetPoseToReference(
    createPoseBuffer(oracleRig.boneCount),
    oracleRig,
  )
  const defaultPoses = clip(oracleGltf, 'A_Als_Default_Poses')
  const overlayRuntime = createAlsDefaultOverlayGraphRuntime(
    oracleRig,
    {
      sampler: compileClipSampler(defaultPoses, oracleRig),
      curves: compileClipCurveSamplers(defaultPoses),
    },
    referencePose,
  )
  const overlayPose = createPoseBuffer(oracleRig.boneCount)
  const overlayCurves = new Map<string, number>()
  evaluateAlsDefaultOverlayGraph(
    overlayRuntime,
    refreshAlsDefaultOverlayGraph(
      createAlsDefaultOverlayGraphState(),
      {
        gaitWalkingAmount: 0,
        standingAmount: 1,
        crouchingAmount: 0,
        inAirAmount: 0,
        groundPredictionAmount: 0,
        deltaTime: SETTLE_DELTA_TIME,
        relevant: true,
      },
    ),
    overlayPose,
    overlayCurves,
  )
  const idleTime = (
    SETTLE_FRAME_COUNT * SETTLE_DELTA_TIME
    + ROLL_SAMPLE_TIME / ROLL_PLAY_RATE
  )
  applyIdleAdditive(
    oracleGltf,
    oracleRig,
    standReference,
    overlayPose,
    idleTime,
  )
  const expectedGraphPose = createPoseBuffer(oracleRig.boneCount)
  evaluateAlsLayeringPose(
    createAlsLayeringPoseRuntime(oracleRig),
    {
      locomotionPose: sampledRoll,
      overlayPose,
      basePose: standReference,
      curves: composeAlsLayeringFinalCurves(
        sampledCurves(
          compileClipCurveSamplers(authoredRoll),
          ROLL_SAMPLE_TIME,
        ),
        overlayCurves,
      ),
    },
    expectedGraphPose,
  )
  applyPoseToScene(oracleGltf.scene, oracleRig, expectedGraphPose)
  const expectedGraphMinimumY = minimumY(oracleGltf.scene)

  const instance = createAlsAnimationInstance(runtimeGltf)
  for (let frame = 0; frame < SETTLE_FRAME_COUNT; frame++) {
    instance.refresh(SETTLE_DELTA_TIME, IDLE_CONTROLS)
  }
  const played = instance.rollingMontage.Montage_Play(
    ALS_ROLLING_MONTAGE.Name,
    ROLL_PLAY_RATE,
  )
  if (played <= 0) throw new Error('AM_Als_Roll did not start')
  const rollingControls: AlsAnimationInstanceControls = {
    ...IDLE_CONTROLS,
    stance: 'Crouching',
    locomotionAction: 'Rolling',
  }
  let montageTime = 0
  const step = 0.03
  const montageStep = step * ROLL_PLAY_RATE
  while (montageTime + montageStep < ROLL_SAMPLE_TIME) {
    instance.refresh(step, rollingControls)
    montageTime += montageStep
  }
  instance.refresh(
    (ROLL_SAMPLE_TIME - montageTime) / ROLL_PLAY_RATE,
    rollingControls,
  )
  const runtimeRig = createRigDefinition(
    runtimeGltf.scene,
    ALS_VIRTUAL_BONES,
  )
  const runtimePose = captureLocalPose(runtimeGltf.scene, runtimeRig)
  const runtimeReport = createPoseDeltaReport(
    runtimeRig,
    expectedGraphPose,
    runtimePose,
    DIAGNOSTIC_DELTA_OPTIONS,
  )

  return finishReport(
    'roll',
    `Roll @ ${ROLL_SAMPLE_TIME.toFixed(3)} s`,
    [
      { name: 'clip sampler', report: samplerReport },
      { name: 'mesh-space dynamic additive', report: additiveReport },
      { name: 'runtime graph publication', report: runtimeReport },
    ],
    {
      authoredMinimumY,
      expectedGraphMinimumY,
      runtimeMinimumY: minimumY(runtimeGltf.scene),
    },
  )
}

function rifleSources(
  gltf: AnimationPoseDiagnosticGltf,
  rig: RigDefinition,
): AlsRifleRelaxedSources {
  const source = (
    name: string,
  ) => {
    const animation = clip(gltf, name)
    return {
      sampler: compileClipSampler(animation, rig),
      curves: compileClipCurveSamplers(animation),
    }
  }
  return {
    poses: source('A_Als_Rifle_Poses'),
    runArms: {
      ...source('A_Als_Rifle_Run_Arms'),
      time: 0,
      loop: true,
    },
    sprintArms: {
      ...source('A_Als_Rifle_Sprint_Arms'),
      time: 0,
      loop: true,
    },
    sprintImpulseArms: {
      ...source('A_Als_Rifle_Sprint_Impulse_Arms'),
      time: 0,
      loop: true,
    },
  }
}

export function runRifleAnimationPoseDiagnostic(
  runtimeGltf: AnimationPoseDiagnosticGltf,
  oracleGltf: AnimationPoseDiagnosticGltf,
): AnimationPoseDiagnosticReport {
  const oracleRig = createRigDefinition(
    oracleGltf.scene,
    ALS_VIRTUAL_BONES,
  )
  const standReference = samplePose(
    oracleRig,
    clip(oracleGltf, 'A_Als_Stand_Pose'),
    0,
  )
  const rifleRuntime = createAlsRifleRelaxedRuntime(oracleRig)
  refreshAlsRifleRelaxedState(rifleRuntime, {
    relevant: true,
    deltaTime: SETTLE_DELTA_TIME,
    standingAmount: 1,
    crouchingAmount: 0,
    gaitWalkingAmount: 0,
    gaitRunningAmount: 0,
    gaitSprintingAmount: 0,
    inAirAmount: 0,
    groundPredictionAmount: 0,
    sprintAccelerationAmount: 0,
    velocityBlend: {
      forwardAmount: 0,
      backwardAmount: 0,
      leftAmount: 0,
      rightAmount: 0,
    },
  })
  const rifleOverlay = evaluateAlsRifleRelaxedGraph(
    rifleRuntime,
    rifleSources(oracleGltf, oracleRig),
  )
  const overlayPose = copyPose(
    rifleOverlay.pose,
    createPoseBuffer(oracleRig.boneCount),
  )
  applyIdleAdditive(
    oracleGltf,
    oracleRig,
    standReference,
    overlayPose,
    SETTLE_FRAME_COUNT * SETTLE_DELTA_TIME,
  )
  const finalCurves = composeAlsLayeringFinalCurves(
    new Map(),
    rifleOverlay.curves,
  )
  const expectedGraphPose = createPoseBuffer(oracleRig.boneCount)
  evaluateAlsLayeringPose(
    createAlsLayeringPoseRuntime(oracleRig),
    {
      locomotionPose: standReference,
      overlayPose,
      basePose: standReference,
      curves: finalCurves,
    },
    expectedGraphPose,
  )
  evaluateAlsControlRigHandIk(
    createAlsControlRigHandIkRuntime(oracleRig),
    {
      pose: expectedGraphPose,
      curves: finalCurves,
      useHandIkBones: true,
    },
  )
  applyPoseToScene(oracleGltf.scene, oracleRig, standReference)
  const authoredMinimumY = minimumY(oracleGltf.scene)
  applyPoseToScene(oracleGltf.scene, oracleRig, expectedGraphPose)
  const expectedGraphMinimumY = minimumY(oracleGltf.scene)

  const instance = createAlsAnimationInstance(runtimeGltf)
  const controls: AlsAnimationInstanceControls = {
    ...IDLE_CONTROLS,
    overlayMode: 'Rifle',
  }
  for (let frame = 0; frame < SETTLE_FRAME_COUNT; frame++) {
    instance.refresh(SETTLE_DELTA_TIME, controls)
  }
  const runtimeRig = createRigDefinition(
    runtimeGltf.scene,
    ALS_VIRTUAL_BONES,
  )
  const runtimePose = captureLocalPose(runtimeGltf.scene, runtimeRig)
  const runtimeReport = createPoseDeltaReport(
    runtimeRig,
    expectedGraphPose,
    runtimePose,
    {
      ...DIAGNOSTIC_DELTA_OPTIONS,
      includedBoneNames: new Set(
        runtimeRig.boneNames.filter((name) => RIFLE_ARM_BONE.test(name)),
      ),
    },
  )
  const runtimeMinimumY = minimumY(runtimeGltf.scene)
  const sidePairs = [
    ['upperarm_l', 'upperarm_r'],
    ['lowerarm_l', 'lowerarm_r'],
    ['hand_l', 'hand_r'],
  ] as const
  const authoredRun = clip(oracleGltf, 'A_Als_Rifle_Run_Arms')
  const authoredRunSampler = compileClipSampler(
    authoredRun,
    oracleRig,
  )
  const authoredPairFrames = new Map<string, PairQuaternionFrame[]>()
  const runtimePairFrames = new Map<string, PairQuaternionFrame[]>()
  for (const [leftBone, rightBone] of sidePairs) {
    const key = `${leftBone}/${rightBone}`
    authoredPairFrames.set(key, [])
    runtimePairFrames.set(key, [])
  }
  const authoredPose = createPoseBuffer(oracleRig.boneCount)
  for (let sampleIndex = 0; sampleIndex <= 60; sampleIndex++) {
    sampleClip(
      authoredRunSampler,
      oracleRig,
      authoredRun.duration * sampleIndex / 60,
      authoredPose,
      false,
    )
    for (const [leftBone, rightBone] of sidePairs) {
      authoredPairFrames.get(`${leftBone}/${rightBone}`)!.push(
        posePairFrame(
          authoredPose,
          oracleRig,
          leftBone,
          rightBone,
        ),
      )
    }
  }
  const movingControls: AlsAnimationInstanceControls = {
    ...controls,
    gait: 'Running',
    speed: 3.75,
    moving: true,
    movingSmooth: true,
    hasInput: true,
  }
  for (let frame = 0; frame < 60; frame++) {
    instance.refresh(SETTLE_DELTA_TIME, movingControls)
  }
  for (let frame = 0; frame < 96; frame++) {
    instance.refresh(SETTLE_DELTA_TIME, movingControls)
    for (const [leftBone, rightBone] of sidePairs) {
      runtimePairFrames.get(`${leftBone}/${rightBone}`)!.push(
        scenePairFrame(
          runtimeGltf.scene,
          leftBone,
          rightBone,
        ),
      )
    }
  }
  const sideMotion = sidePairs.map(([leftBone, rightBone]) => {
    const key = `${leftBone}/${rightBone}`
    return pairMotion(
      leftBone,
      rightBone,
      authoredPairFrames.get(key)!,
      runtimePairFrames.get(key)!,
    )
  })

  return finishReport(
    'rifle',
    'Rifle Relaxed idle pose + running arm motion',
    [{ name: 'runtime graph publication', report: runtimeReport }],
    {
      authoredMinimumY,
      expectedGraphMinimumY,
      runtimeMinimumY,
    },
    sideMotion,
  )
}

export function formatAnimationPoseDiagnostic(
  report: AnimationPoseDiagnosticReport,
) {
  const lines = [`Animation pose delta — ${report.label}`]
  for (const stage of report.stages) {
    lines.push(formatPoseDeltaReport(stage.name, stage.report))
  }
  lines.push(
    `  floor: authored ${(report.contact.authoredMinimumY * 100).toFixed(2)} cm, `
    + `expected graph ${(report.contact.expectedGraphMinimumY * 100).toFixed(2)} cm, `
    + `runtime ${(report.contact.runtimeMinimumY * 100).toFixed(2)} cm`,
  )
  for (const motion of report.sideMotion ?? []) {
    lines.push(
      `  ${motion.collapsed ? 'COLLAPSED' : 'distinct'} motion `
      + `${motion.leftBone}/${motion.rightBone}: authored delta `
      + `${motion.authoredDeltaSeparationDegrees.toFixed(1)}°, runtime `
      + `${motion.runtimeDeltaSeparationDegrees.toFixed(1)}° `
      + `(L ${motion.runtimeLeftAmplitudeDegrees.toFixed(1)}°, `
      + `R ${motion.runtimeRightAmplitudeDegrees.toFixed(1)}°)`,
    )
  }
  lines.push(
    report.firstFailingStage
      ? `  first failing stage: ${report.firstFailingStage}`
      : '  first failing stage: none',
  )
  return lines.join('\n')
}
