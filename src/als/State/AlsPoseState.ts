export interface AlsPoseState {
  amount: number
  walking: number
  running: number
  sprinting: number
}

export function createAlsPoseState(): AlsPoseState {
  return { amount: 0, walking: 0, running: 0, sprinting: 0 }
}
