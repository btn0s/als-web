export {}

declare global {
  interface Window {
    __appReady: boolean
    __characterStatus: 'glb' | 'placeholder'
  }
}
