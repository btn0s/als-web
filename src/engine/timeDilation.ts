export interface WorldTimeState {
  effectiveGlobalTimeDilation: number
}

export function createWorldTimeState(): WorldTimeState {
  return {
    effectiveGlobalTimeDilation: 1,
  }
}

/** UWorld::GetDeltaSeconds() at the web engine boundary. */
export function getWorldDeltaTime(
  state: Readonly<WorldTimeState>,
  deltaRealTime: number,
): number {
  return Math.max(0, deltaRealTime)
    * state.effectiveGlobalTimeDilation
}

/** UGameplayStatics::SetGlobalTimeDilation() for the standalone world. */
export function setGlobalTimeDilation(
  state: WorldTimeState,
  timeDilation: number,
): void {
  if (!Number.isFinite(timeDilation) || timeDilation <= 0) {
    throw new Error(
      `Global time dilation must be finite and positive; received ${timeDilation}`,
    )
  }
  state.effectiveGlobalTimeDilation = timeDilation
}
