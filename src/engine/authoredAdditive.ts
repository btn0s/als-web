export type AuthoredAdditiveType =
  | 'AAT_LocalSpaceBase'
  | 'AAT_RotationOffsetMeshSpace'

export type AuthoredAdditiveSpace = 'local' | 'mesh'

interface AuthoredAdditiveClipExtras {
  readonly additiveType?: unknown
  readonly refPoseSeq?: unknown
  readonly refFrameIndex?: unknown
}

export interface ClipWithAuthoredAdditiveExtras {
  readonly name: string
  readonly userData?: AuthoredAdditiveClipExtras
}

/**
 * Validated, runtime-ready form of Unreal's UAnimSequence additive settings.
 *
 * Reference-sequence resolution remains lazy because the curated runtime pack does not need every
 * reference used by every currently deferred additive clip.
 */
export interface CompiledAuthoredAdditive {
  readonly clipName: string
  readonly additiveType: AuthoredAdditiveType
  readonly additiveSpace: AuthoredAdditiveSpace
  readonly refPoseSeq: string
  readonly refFrameIndex: number
}

const ADDITIVE_SPACES: Readonly<
  Record<AuthoredAdditiveType, AuthoredAdditiveSpace>
> = {
  AAT_LocalSpaceBase: 'local',
  AAT_RotationOffsetMeshSpace: 'mesh',
}

/**
 * Compiles the additive metadata emitted by `scripts/extract-als/assemble-glb.mjs`.
 *
 * `AAT_None` and clips with no additive metadata return undefined. Partial or malformed additive
 * metadata is fatal instead of silently treating a full source pose as an additive delta.
 */
export function compileAuthoredAdditive(
  clip: ClipWithAuthoredAdditiveExtras,
): CompiledAuthoredAdditive | undefined {
  const extras = clip.userData
  const additiveType = extras?.additiveType
  if (additiveType === undefined) {
    if (extras?.refPoseSeq !== undefined || extras?.refFrameIndex !== undefined) {
      throw new Error(`${clip.name} has additive reference metadata without additiveType`)
    }
    return undefined
  }
  if (additiveType === 'AAT_None') return undefined
  if (
    additiveType !== 'AAT_LocalSpaceBase'
    && additiveType !== 'AAT_RotationOffsetMeshSpace'
  ) {
    throw new Error(`${clip.name} has unsupported additiveType ${String(additiveType)}`)
  }
  if (typeof extras?.refPoseSeq !== 'string' || extras.refPoseSeq.length === 0) {
    throw new Error(`${clip.name} has no authored additive reference sequence`)
  }
  if (
    typeof extras.refFrameIndex !== 'number'
    || !Number.isInteger(extras.refFrameIndex)
    || extras.refFrameIndex < 0
  ) {
    throw new Error(`${clip.name} has an invalid authored additive reference frame`)
  }

  return {
    clipName: clip.name,
    additiveType,
    additiveSpace: ADDITIVE_SPACES[additiveType],
    refPoseSeq: extras.refPoseSeq,
    refFrameIndex: extras.refFrameIndex,
  }
}
