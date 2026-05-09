export const ISOMETRIC_CLICK_TRAVEL_THRESHOLD = 6

export interface PointerCoordinates {
  clientX: number
  clientY: number
}

export interface PointerTravelTracker {
  start(point: PointerCoordinates): void
  move(point: PointerCoordinates): number
  travel(): number
  isClick(threshold?: number): boolean
}

export const createPointerTravelTracker = (): PointerTravelTracker => {
  let pointerDown = { x: 0, y: 0 }
  let pointerTravel = 0

  return {
    start(point) {
      pointerDown = { x: point.clientX, y: point.clientY }
      pointerTravel = 0
    },
    move(point) {
      pointerTravel = Math.max(
        pointerTravel,
        Math.hypot(point.clientX - pointerDown.x, point.clientY - pointerDown.y),
      )
      return pointerTravel
    },
    travel() {
      return pointerTravel
    },
    isClick(threshold = ISOMETRIC_CLICK_TRAVEL_THRESHOLD) {
      return pointerTravel <= threshold
    },
  }
}
