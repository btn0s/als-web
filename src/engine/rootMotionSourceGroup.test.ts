import { describe, expect, it } from 'vitest'
import type {
  AlsRootMotionSource_Mantling,
} from '../als/RootMotionSources/AlsRootMotionSource_Mantling'
import {
  INVALID_ROOT_MOTION_SOURCE_ID,
  MAX_ROOT_MOTION_SOURCE_ID,
  applyRootMotionSource,
  createRootMotionSourceGroup,
  getRootMotionSourceByID,
  prepareRootMotionSourceGroup,
  removeRootMotionSourceByID,
} from './rootMotionSourceGroup'
import type {
  RootMotionSource,
  RootMotionSourceStatus,
} from './rootMotionSourceGroup'

interface TestRootMotionSource extends RootMotionSource {
  readonly Name: string
}

function source(
  Name: string,
  Priority = 1000,
  Status: RootMotionSourceStatus = 'Active',
): TestRootMotionSource {
  return { Name, Priority, Status }
}

function mantlingSource(): AlsRootMotionSource_Mantling {
  return {
    Priority: 1000,
    Time: 0,
    Duration: 1,
    MantlingSettings: {} as AlsRootMotionSource_Mantling[
      'MantlingSettings'
    ],
    AuthoredRootMotion: {} as AlsRootMotionSource_Mantling[
      'AuthoredRootMotion'
    ],
    TargetPrimitive: {},
    TargetRelativeLocation: { x: 0, y: 0, z: 0 },
    TargetRelativeRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
    ActorFeetLocationOffset: { x: 0, y: 0, z: 0 },
    ActorRotationOffset: { Pitch: 0, Yaw: 0, Roll: 0 },
    TargetAnimationLocation: { x: 0, y: 0, z: 1 },
    MontageStartTime: 0.2,
    Status: 'Active',
  }
}

describe('FRootMotionSourceGroup', () => {
  it('allocates monotonic nonzero IDs independently of montage identity', () => {
    const firstGroup =
      createRootMotionSourceGroup<TestRootMotionSource>()
    const secondGroup =
      createRootMotionSourceGroup<TestRootMotionSource>()
    const first = applyRootMotionSource(firstGroup, source('first'))
    const second = applyRootMotionSource(
      secondGroup,
      source('second'),
    )

    expect(first).toBeGreaterThan(INVALID_ROOT_MOTION_SOURCE_ID)
    expect(second).toBe(
      first === MAX_ROOT_MOTION_SOURCE_ID ? 1 : first + 1,
    )
    expect(applyRootMotionSource(firstGroup, null))
      .toBe(INVALID_ROOT_MOTION_SOURCE_ID)

    // No montage instance ID enters either allocation or lookup API.
    expect(getRootMotionSourceByID(firstGroup, first)?.Name)
      .toBe('first')
    expect(getRootMotionSourceByID(secondGroup, second)?.Name)
      .toBe('second')
  })

  it('wraps uint16 IDs and scans past an in-flight collision', () => {
    const group =
      createRootMotionSourceGroup<TestRootMotionSource>()
    const occupiedAfterWrap = applyRootMotionSource(
      group,
      source('occupied-after-wrap'),
    )
    const releasedAfterWrap = applyRootMotionSource(
      group,
      source('released-after-wrap'),
    )

    for (
      let Count = 2;
      Count < MAX_ROOT_MOTION_SOURCE_ID;
      Count++
    ) {
      applyRootMotionSource(group, source(`filler-${Count}`))
    }

    expect(removeRootMotionSourceByID(group, releasedAfterWrap))
      .toBe(true)
    const cleanup = prepareRootMotionSourceGroup(group, {
      PrepareRootMotion() {},
    })
    expect(cleanup.RemovedSourceCount).toBe(1)

    const wrapped = applyRootMotionSource(
      group,
      source('wrapped'),
    )
    expect(wrapped).toBe(releasedAfterWrap)
    expect(wrapped).not.toBe(occupiedAfterWrap)
    expect(wrapped).toBeGreaterThan(INVALID_ROOT_MOTION_SOURCE_ID)
  })

  it('stores the exact ALS mantling source without creating another clock', () => {
    const group =
      createRootMotionSourceGroup<AlsRootMotionSource_Mantling>()
    const mantling = mantlingSource()
    const id = applyRootMotionSource(group, mantling)

    expect(group.RootMotionSources).toHaveLength(0)
    expect(group.PendingAddRootMotionSources).toHaveLength(1)
    expect(getRootMotionSourceByID(group, id)).toBe(mantling)

    const prepared: number[] = []
    const result = prepareRootMotionSourceGroup(group, {
      PrepareRootMotion(Source, LocalID) {
        prepared.push(LocalID)
        Source.Time += 0.1
      },
    })

    expect(prepared).toEqual([id])
    expect(result).toEqual({
      PreparedSourceCount: 1,
      RemovedSourceCount: 0,
    })
    expect(mantling.Time).toBeCloseTo(0.1, 8)
    expect(group.PendingAddRootMotionSources).toHaveLength(0)
  })

  it('prepares descending priority while preserving equal-priority order', () => {
    const group =
      createRootMotionSourceGroup<TestRootMotionSource>()
    const lowID = applyRootMotionSource(group, source('low', 500))
    const firstHighID = applyRootMotionSource(
      group,
      source('first-high', 1000),
    )
    const secondHighID = applyRootMotionSource(
      group,
      source('second-high', 1000),
    )
    const prepared: number[] = []

    prepareRootMotionSourceGroup(group, {
      PrepareRootMotion(_Source, LocalID) {
        prepared.push(LocalID)
      },
    })

    expect(prepared).toEqual([firstHighID, secondHighID, lowID])
  })

  it('retains MarkedForRemoval lookup until the next movement boundary', () => {
    const group =
      createRootMotionSourceGroup<TestRootMotionSource>()
    const pending = source('pending')
    const id = applyRootMotionSource(group, pending)

    expect(removeRootMotionSourceByID(group, id)).toBe(true)
    expect(pending.Status).toBe('MarkedForRemoval')
    expect(getRootMotionSourceByID(group, id)).toBe(pending)

    let prepareCount = 0
    const result = prepareRootMotionSourceGroup(group, {
      PrepareRootMotion() {
        prepareCount++
      },
    })

    expect(result.RemovedSourceCount).toBe(1)
    expect(result.PreparedSourceCount).toBe(0)
    expect(prepareCount).toBe(0)
    expect(getRootMotionSourceByID(group, id)).toBeNull()
  })

  it('retains a source finished during prepare until the following update', () => {
    const group =
      createRootMotionSourceGroup<TestRootMotionSource>()
    const finished = source('finished')
    const id = applyRootMotionSource(group, finished)
    let prepareCount = 0
    const removed: string[] = []
    const options = {
      PrepareRootMotion(Source: TestRootMotionSource) {
        prepareCount++
        Source.Status = 'Finished' as const
      },
      OnRootMotionSourceRemoved(Source: TestRootMotionSource) {
        removed.push(Source.Name)
      },
    }

    const finishingUpdate = prepareRootMotionSourceGroup(
      group,
      options,
    )
    expect(finishingUpdate.PreparedSourceCount).toBe(1)
    expect(finishingUpdate.RemovedSourceCount).toBe(0)
    expect(getRootMotionSourceByID(group, id)).toBe(finished)

    const cleanupUpdate = prepareRootMotionSourceGroup(
      group,
      options,
    )
    expect(cleanupUpdate.PreparedSourceCount).toBe(0)
    expect(cleanupUpdate.RemovedSourceCount).toBe(1)
    expect(prepareCount).toBe(1)
    expect(removed).toEqual(['finished'])
    expect(getRootMotionSourceByID(group, id)).toBeNull()
  })

  it('removes a marked source exactly once even after repeated requests', () => {
    const group =
      createRootMotionSourceGroup<TestRootMotionSource>()
    const active = source('active')
    const id = applyRootMotionSource(group, active)
    prepareRootMotionSourceGroup(group, {
      PrepareRootMotion() {},
    })

    expect(removeRootMotionSourceByID(group, id)).toBe(true)
    expect(removeRootMotionSourceByID(group, id)).toBe(true)
    expect(getRootMotionSourceByID(group, id)).toBe(active)

    const removed: number[] = []
    const options = {
      PrepareRootMotion() {},
      OnRootMotionSourceRemoved(
        _Source: TestRootMotionSource,
        LocalID: number,
      ) {
        removed.push(LocalID)
      },
    }
    prepareRootMotionSourceGroup(group, options)
    prepareRootMotionSourceGroup(group, options)

    expect(removed).toEqual([id])
    expect(removeRootMotionSourceByID(group, id)).toBe(false)
  })
})
