/**
 * Framework-free counterpart of ALS Refactored's `FAlsMantlingState`.
 */
export interface AlsMantlingState {
  RootMotionSourceId: number
}

export function createAlsMantlingState(): AlsMantlingState {
  return {
    RootMotionSourceId: 0,
  }
}
