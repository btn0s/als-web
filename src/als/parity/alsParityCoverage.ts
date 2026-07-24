export type AlsParityCoverageStatus =
  | 'live'
  | 'partial-live'
  | 'implemented-not-live'
  | 'unported'

export interface AlsParitySourceEvidence {
  readonly definition: readonly [path: string, pattern: string]
  readonly productionCall?: readonly [path: string, pattern: string]
}

export interface AlsParityAssetCoverage {
  readonly asset: string
  readonly status: AlsParityCoverageStatus
  readonly evidence?: AlsParitySourceEvidence
}

export interface AlsParityMachineCoverage extends AlsParityAssetCoverage {
  readonly machine: string
  readonly occurrence: number
}

export interface AlsParityStageCoverage {
  readonly family: string
  readonly status: AlsParityCoverageStatus
  readonly evidence?: AlsParitySourceEvidence
}

type OracleTransition = Readonly<{
  PreviousStateName: string
  NextStateName: string
  CrossfadeDuration: number
  BlendMode: string
  LogicType: string
}>

export interface ExtractedAlsParityOracle {
  readonly assets: Readonly<Record<string, Readonly<{
    stateMachines?: readonly Readonly<{
      MachineName: string
      States: readonly unknown[]
      Transitions: readonly OracleTransition[]
    }>[]
  }>>>
}

type SourceLocation = readonly [path: string, pattern: string]

const animationInstanceDefinition = [
  'src/als/AlsAnimationInstance.ts',
  'export function createAlsAnimationInstance',
] as const

function graphDefinition(
  name: string,
  symbol: string,
): SourceLocation {
  return [
    `src/als/AnimGraph/${name}.ts`,
    `export function ${symbol}`,
  ]
}

const partial = (
  definition: SourceLocation,
  productionCall: SourceLocation,
): AlsParitySourceEvidence => ({ definition, productionCall })

const MAIN_GRAPH_EVIDENCE = partial(
  animationInstanceDefinition,
  [
    'src/als/AlsAnimationInstance.hooks.ts',
    'animationInstance.refresh(delta, frameControls)',
  ],
)
const GROUNDED_GRAPH_EVIDENCE = partial(
  graphDefinition('AB_Als_Grounded', 'refreshAlsGroundedRollGraph'),
  [
    'src/als/AlsAnimationInstance.ts',
    'refreshAlsGroundedRollGraph(',
  ],
)
const LAYERING_GRAPH_EVIDENCE = partial(
  graphDefinition('AlsLayering', 'evaluateAlsLayeringPose'),
  ['src/als/AlsAnimationInstance.ts', 'evaluateAlsLayeringPose('],
)
const LOCOMOTION_GRAPH_EVIDENCE = partial(
  graphDefinition(
    'AB_Als_Locomotion',
    'evaluateUpdatedAlsLocomotionPoseGraph',
  ),
  [
    'src/als/AlsAnimationInstance.ts',
    'const output = evaluateUpdatedAlsLocomotionPoseGraph(',
  ],
)
const DEFAULT_GRAPH_EVIDENCE = partial(
  graphDefinition('AB_Als_Default', 'evaluateAlsDefaultOverlayGraph'),
  [
    'src/als/AlsAnimationInstance.ts',
    'evaluateAlsDefaultOverlayGraph(',
  ],
)
const RIFLE_GRAPH_EVIDENCE = partial(
  graphDefinition('AB_Als_Rifle', 'evaluateAlsRifleRelaxedGraph'),
  [
    'src/als/AlsAnimationInstance.ts',
    'evaluateAlsRifleRelaxedGraph(',
  ],
)
const CROUCHING_GRAPH_EVIDENCE = partial(
  graphDefinition('AB_Als_Crouching', 'evaluateAlsCrouchingPoseGraph'),
  [
    'src/als/AlsAnimationInstance.ts',
    'evaluateAlsCrouchingPoseGraph(',
  ],
)
const STANDING_GRAPH_EVIDENCE = partial(
  graphDefinition('AB_Als_Standing', 'evaluateAlsStandingPoseGraph'),
  [
    'src/als/AlsAnimationInstance.ts',
    'evaluateAlsStandingPoseGraph(',
  ],
)

function partialAsset(
  asset: string,
  evidence: AlsParitySourceEvidence,
): AlsParityAssetCoverage {
  return { asset, status: 'partial-live', evidence }
}

function unportedAsset(asset: string): AlsParityAssetCoverage {
  return { asset, status: 'unported' }
}

export const ALS_PARITY_ASSET_COVERAGE = [
  partialAsset('AB_Als', MAIN_GRAPH_EVIDENCE),
  unportedAsset('AB_Als_Monolithic'),
  unportedAsset('ALI_Overlay'),
  partialAsset('AB_Als_Grounded', GROUNDED_GRAPH_EVIDENCE),
  partialAsset('AB_Als_Layering', LAYERING_GRAPH_EVIDENCE),
  partialAsset('AB_Als_Locomotion', LOCOMOTION_GRAPH_EVIDENCE),
  {
    asset: 'AB_Als_Ragdolling',
    status: 'implemented-not-live',
    evidence: {
      definition: graphDefinition(
        'AB_Als_Ragdolling',
        'createAlsRagdollingGraphState',
      ),
    },
  },
  unportedAsset('AB_Als_View'),
  unportedAsset('AB_Als_Barrel'),
  unportedAsset('AB_Als_Binoculars'),
  unportedAsset('AB_Als_Bow'),
  unportedAsset('AB_Als_Box'),
  partialAsset('AB_Als_Default', DEFAULT_GRAPH_EVIDENCE),
  unportedAsset('AB_Als_Feminine'),
  unportedAsset('AB_Als_HandsTied'),
  unportedAsset('AB_Als_Injured'),
  unportedAsset('AB_Als_Masculine'),
  unportedAsset('AB_Als_PistolOneHanded'),
  unportedAsset('AB_Als_PistolTwoHanded'),
  partialAsset('AB_Als_Rifle', RIFLE_GRAPH_EVIDENCE),
  unportedAsset('AB_Als_Torch'),
  partialAsset('AB_Als_Crouching', CROUCHING_GRAPH_EVIDENCE),
  partialAsset('AB_Als_Standing', STANDING_GRAPH_EVIDENCE),
] as const satisfies readonly AlsParityAssetCoverage[]

const machine = (
  asset: string,
  name: string,
  occurrence: number,
  status: AlsParityCoverageStatus,
  evidence?: AlsParitySourceEvidence,
): AlsParityMachineCoverage => ({
  asset,
  machine: name,
  occurrence,
  status,
  evidence,
})

const monolithic = (name: string, occurrence = 0) =>
  machine('AB_Als_Monolithic', name, occurrence, 'unported')

const partialMachine = (
  asset: string,
  name: string,
  occurrence: number,
  evidence: AlsParitySourceEvidence,
) => machine(asset, name, occurrence, 'partial-live', evidence)

export const ALS_PARITY_MACHINE_COVERAGE = [
  monolithic('Crouching States'),
  monolithic('Look States'),
  monolithic('Locomotion States'),
  monolithic('Jump States'),
  monolithic('Grounded States'),
  monolithic('Movement States', 0),
  monolithic('Standing States'),
  monolithic('Stop States'),
  monolithic('Movement Details States'),
  monolithic('Movement States', 1),
  partialMachine(
    'AB_Als_Grounded',
    'Grounded States',
    0,
    GROUNDED_GRAPH_EVIDENCE,
  ),
  partialMachine(
    'AB_Als_Locomotion',
    'Locomotion States',
    0,
    LOCOMOTION_GRAPH_EVIDENCE,
  ),
  partialMachine(
    'AB_Als_Locomotion',
    'Jump States',
    0,
    LOCOMOTION_GRAPH_EVIDENCE,
  ),
  machine('AB_Als_View', 'Look States', 0, 'unported'),
  machine('AB_Als_Bow', 'Bow States', 0, 'unported'),
  machine(
    'AB_Als_PistolOneHanded',
    'Pistol States',
    0,
    'unported',
  ),
  machine(
    'AB_Als_PistolTwoHanded',
    'Pistol States',
    0,
    'unported',
  ),
  partialMachine(
    'AB_Als_Rifle',
    'Rifle States',
    0,
    RIFLE_GRAPH_EVIDENCE,
  ),
  partialMachine(
    'AB_Als_Crouching',
    'Movement States',
    0,
    CROUCHING_GRAPH_EVIDENCE,
  ),
  partialMachine(
    'AB_Als_Crouching',
    'Crouching States',
    0,
    CROUCHING_GRAPH_EVIDENCE,
  ),
  partialMachine(
    'AB_Als_Standing',
    'Movement States',
    0,
    STANDING_GRAPH_EVIDENCE,
  ),
  partialMachine(
    'AB_Als_Standing',
    'Movement Details States',
    0,
    STANDING_GRAPH_EVIDENCE,
  ),
  partialMachine(
    'AB_Als_Standing',
    'Standing States',
    0,
    STANDING_GRAPH_EVIDENCE,
  ),
  partialMachine(
    'AB_Als_Standing',
    'Stop States',
    0,
    STANDING_GRAPH_EVIDENCE,
  ),
] as const satisfies readonly AlsParityMachineCoverage[]

export const ALS_PARITY_STAGE_COVERAGE = [
  {
    family: 'RefreshLayering',
    status: 'partial-live',
    evidence: partial(
      [
        'src/als/AnimGraph/AlsLayering.ts',
        'export function resolveAlsLayeringState',
      ],
      [
        'src/als/AlsAnimationInstance.ts',
        'resolveAlsLayeringState(',
      ],
    ),
  },
  {
    family: 'RefreshPose',
    status: 'live',
    evidence: partial(
      ['src/als/AlsAnimationInstance.ts', 'export function refreshPose'],
      ['src/als/AlsAnimationInstance.ts', 'refreshPose(publishedCurves, gaitAmounts)'],
    ),
  },
  {
    family: 'RefreshView',
    status: 'partial-live',
    evidence: partial(
      ['src/als/State/AlsSpineState.ts', 'export function refreshSpine'],
      ['src/als/AlsAnimationInstance.ts', 'refreshSpine(spineState, {'],
    ),
  },
  {
    family: 'RefreshFeet',
    status: 'partial-live',
    evidence: partial(
      ['src/engine/alsFeetPoseBridge.ts', 'export function createAlsFeetPoseBridge'],
      ['src/als/AlsAnimationInstance.ts', 'feetPoseBridge?.refresh(feetState, {'],
    ),
  },
  {
    family: 'RefreshTransitions',
    status: 'partial-live',
    evidence: partial(
      ['src/als/State/AlsTransitionsState.ts', 'export function refreshTransitions'],
      ['src/als/AlsAnimationInstance.ts', 'refreshTransitions(\n      transitionsState,'],
    ),
  },
  {
    family: 'RefreshGrounded',
    status: 'partial-live',
    evidence: partial(
      graphDefinition(
        'AB_Als_Standing',
        'evaluateAlsStandingPoseGraph',
      ),
      [
        'src/als/AlsAnimationInstance.ts',
        'evaluateAlsStandingPoseGraph(',
      ],
    ),
  },
  {
    family: 'RefreshGroundedMovement',
    status: 'partial-live',
    evidence: partial(
      [
        'src/als/AnimGraph/groundedLocomotion.ts',
        'export function refreshMovementDirection',
      ],
      [
        'src/als/AlsAnimationInstance.ts',
        'refreshMovementDirection(',
      ],
    ),
  },
  {
    family: 'RefreshStandingMovement',
    status: 'partial-live',
    evidence: partial(
      [
        'src/als/AnimGraph/groundedLocomotion.ts',
        'export function refreshStandingMovement',
      ],
      [
        'src/als/AlsAnimationInstance.ts',
        'refreshStandingMovement(',
      ],
    ),
  },
  {
    family: 'RefreshCrouchingMovement',
    status: 'partial-live',
    evidence: partial(
      graphDefinition(
        'AB_Als_Crouching',
        'evaluateAlsCrouchingPoseGraph',
      ),
      [
        'src/als/AlsAnimationInstance.ts',
        'evaluateAlsCrouchingMovementState(',
      ],
    ),
  },
  {
    family: 'RefreshInAir',
    status: 'partial-live',
    evidence: partial(
      [
        'src/als/State/AlsInAirState.ts',
        'export function refreshInAir',
      ],
      ['src/als/AlsAnimationInstance.ts', 'refreshInAir('],
    ),
  },
  {
    family: 'RefreshDynamicTransitions',
    status: 'partial-live',
    evidence: partial(
      [
        'src/als/State/AlsDynamicTransitionsState.ts',
        'export function refreshDynamicTransitions',
      ],
      [
        'src/als/AlsAnimationInstance.ts',
        'return refreshDynamicTransitions(',
      ],
    ),
  },
  {
    family: 'RefreshRotateInPlace',
    status: 'partial-live',
    evidence: partial(
      [
        'src/als/State/AlsRotateInPlaceState.ts',
        'export function refreshRotateInPlace',
      ],
      [
        'src/als/AlsAnimationInstance.ts',
        'refreshRotateInPlaceState(rotateInPlaceState, {',
      ],
    ),
  },
  {
    family: 'RefreshTurnInPlace',
    status: 'partial-live',
    evidence: partial(
      [
        'src/als/State/AlsTurnInPlaceState.ts',
        'export function refreshTurnInPlace',
      ],
      [
        'src/als/AlsAnimationInstance.ts',
        'refreshTurnInPlaceState(turnInPlaceState, {',
      ],
    ),
  },
  { family: 'RefreshLook', status: 'unported' },
] as const satisfies readonly AlsParityStageCoverage[]

export interface AlsParityTransitionSignature {
  readonly asset: string
  readonly machine: string
  readonly occurrence: number
  readonly from: string
  readonly to: string
  readonly duration: number
  readonly blendMode: string
  readonly logicType: string
  /** Serialized order disambiguates identical parallel edges. */
  readonly transition: number
}

export function getAlsParityMachineKeys(
  oracle: ExtractedAlsParityOracle,
): readonly string[] {
  return Object.entries(oracle.assets).flatMap(([asset, entry]) => {
    const occurrences = new Map<string, number>()
    return (entry.stateMachines ?? []).map((machineData) => {
      const occurrence = occurrences.get(machineData.MachineName) ?? 0
      occurrences.set(machineData.MachineName, occurrence + 1)
      return `${asset}:${machineData.MachineName}:${occurrence}`
    })
  })
}

export function getAlsParityTransitionSignatures(
  oracle: ExtractedAlsParityOracle,
): readonly AlsParityTransitionSignature[] {
  return Object.entries(oracle.assets).flatMap(([asset, entry]) => {
    const occurrences = new Map<string, number>()
    return (entry.stateMachines ?? []).flatMap((machineData) => {
      const occurrence = occurrences.get(machineData.MachineName) ?? 0
      occurrences.set(machineData.MachineName, occurrence + 1)
      return machineData.Transitions.map((
        transition,
        transitionIndex,
      ) => ({
        asset,
        machine: machineData.MachineName,
        occurrence,
        from: transition.PreviousStateName,
        to: transition.NextStateName,
        duration: transition.CrossfadeDuration,
        blendMode: transition.BlendMode,
        logicType: transition.LogicType,
        transition: transitionIndex,
      }))
    })
  })
}

function fingerprint(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function assertAlsParityCoverage(
  oracle: ExtractedAlsParityOracle,
  assets: readonly AlsParityAssetCoverage[] = ALS_PARITY_ASSET_COVERAGE,
  machines: readonly AlsParityMachineCoverage[] = ALS_PARITY_MACHINE_COVERAGE,
) {
  const oracleAssets = Object.keys(oracle.assets).sort()
  const declaredAssets = assets.map((entry) => entry.asset).sort()
  if (
    new Set(declaredAssets).size !== declaredAssets.length
    || JSON.stringify(declaredAssets) !== JSON.stringify(oracleAssets)
  ) {
    throw new Error(
      'ALS parity asset coverage is incomplete, duplicated, or stale',
    )
  }
  const actualMachines = [...getAlsParityMachineKeys(oracle)].sort()
  const declaredMachines = machines
    .map((entry) => (
      `${entry.asset}:${entry.machine}:${entry.occurrence}`
    ))
    .sort()
  if (
    new Set(declaredMachines).size !== declaredMachines.length
    || JSON.stringify(actualMachines) !== JSON.stringify(declaredMachines)
  ) {
    throw new Error(
      'ALS parity state-machine coverage is incomplete, duplicated, or stale',
    )
  }
  const transitions = getAlsParityTransitionSignatures(oracle)
  const uniqueTransitions = new Set(
    transitions.map((entry) => JSON.stringify(entry)),
  )
  if (
    transitions.length !== 304
    || uniqueTransitions.size !== transitions.length
  ) {
    throw new Error('ALS parity transitions are incomplete or duplicated')
  }
  const topologyFingerprint = fingerprint(JSON.stringify(transitions))
  if (topologyFingerprint !== '7110355d') {
    throw new Error(
      `ALS extracted transition inventory changed: ${topologyFingerprint}`,
    )
  }
  return {
    assets: oracleAssets.length,
    machines: actualMachines.length,
    transitions: transitions.length,
    topologyFingerprint,
  }
}
