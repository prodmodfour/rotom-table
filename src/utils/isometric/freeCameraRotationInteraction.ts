import type { OrthographicCamera } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { rotateIsometricYawByDelta } from '~/utils/isometric/cameraControls'

export const ISOMETRIC_FREE_CAMERA_ROTATION_DRAG_THRESHOLD_PX = 4
export const ISOMETRIC_FREE_CAMERA_ROTATION_YAW_RADIANS_PER_PIXEL = 0.008

export type IsometricFreeCameraRotationState = 'idle' | 'pending-left-drag' | 'rotating'

type IsometricFreeCameraRotationControls = Pick<OrbitControls, 'target' | 'update'>

type PointerCaptureElement = Pick<HTMLElement, 'setPointerCapture' | 'releasePointerCapture' | 'hasPointerCapture'>

interface PointerDragState {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  captureElement: PointerCaptureElement | null
}

export interface IsometricFreeCameraRotationPreflightOptions {
  event: PointerEvent
  rendererElement: HTMLElement | null | undefined
  buildMode: boolean
  hazardMode?: boolean | null
  selectedPokemonActive?: boolean | null
  moveAutomationTargetingActive?: boolean | null
  sendOutPlacementActive?: boolean | null
  blockingOverlayActive?: boolean | null
  pickPokemonId: (event: PointerEvent) => string | null
}

export interface IsometricFreeCameraRotationControllerOptions {
  getCamera: () => OrthographicCamera | null
  getControls: () => IsometricFreeCameraRotationControls | null
  canStart: (event: PointerEvent) => boolean
  getPointerCaptureElement?: (event: PointerEvent) => HTMLElement | null
  onRotationStart?: () => void
  onRotate?: () => void
  dragThresholdPx?: number
  yawRadiansPerPixel?: number
}

const pointerEventUsesPrimaryLeftButton = (event: PointerEvent): boolean => {
  if (event.button !== 0) return false
  if (event.pointerType === 'touch') return false

  return true
}

const pointerMoveKeepsLeftButtonPressed = (event: PointerEvent): boolean => (
  typeof event.buttons !== 'number'
  || (event.buttons & 1) === 1
)

const pointerTargetsRendererElement = (event: PointerEvent, rendererElement: HTMLElement): boolean => {
  if (event.target === rendererElement) return true

  const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : []
  return composedPath.includes(rendererElement)
}

export const canStartIsometricFreeCameraRotation = ({
  event,
  rendererElement,
  buildMode,
  hazardMode = false,
  selectedPokemonActive = false,
  moveAutomationTargetingActive = false,
  sendOutPlacementActive = false,
  blockingOverlayActive = false,
  pickPokemonId,
}: IsometricFreeCameraRotationPreflightOptions): boolean => {
  if (!rendererElement) return false
  if (!pointerEventUsesPrimaryLeftButton(event)) return false
  if (!pointerTargetsRendererElement(event, rendererElement)) return false
  if (blockingOverlayActive) return false
  if (buildMode || hazardMode) return false
  if (moveAutomationTargetingActive || sendOutPlacementActive) return false
  if (selectedPokemonActive) return false

  return !pickPokemonId(event)
}

const pointerTravelFromStart = (state: PointerDragState, event: PointerEvent): number => (
  Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
)

const consumePointerEvent = (event: PointerEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

const capturePointerSafely = (element: PointerCaptureElement | null, pointerId: number) => {
  if (!element || typeof element.setPointerCapture !== 'function') return

  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Pointer capture can fail when the pointer already ended or the element is detached.
  }
}

const releasePointerSafely = (element: PointerCaptureElement | null, pointerId: number) => {
  if (!element || typeof element.releasePointerCapture !== 'function') return

  try {
    if (typeof element.hasPointerCapture === 'function' && !element.hasPointerCapture(pointerId)) return
    element.releasePointerCapture(pointerId)
  } catch {
    // Releasing capture is best-effort; stale pointer ids should not break cleanup.
  }
}

export const createIsometricFreeCameraRotationController = ({
  getCamera,
  getControls,
  canStart,
  getPointerCaptureElement = () => null,
  onRotationStart = () => {},
  onRotate = () => {},
  dragThresholdPx = ISOMETRIC_FREE_CAMERA_ROTATION_DRAG_THRESHOLD_PX,
  yawRadiansPerPixel = ISOMETRIC_FREE_CAMERA_ROTATION_YAW_RADIANS_PER_PIXEL,
}: IsometricFreeCameraRotationControllerOptions) => {
  let stateName: IsometricFreeCameraRotationState = 'idle'
  let dragState: PointerDragState | null = null

  const reset = () => {
    if (dragState) releasePointerSafely(dragState.captureElement, dragState.pointerId)
    dragState = null
    stateName = 'idle'
  }

  const rotateByPointerDelta = (deltaX: number): boolean => {
    if (deltaX === 0) return false

    const camera = getCamera()
    const controls = getControls()
    if (!camera || !controls) return false

    const rotated = rotateIsometricYawByDelta({
      camera,
      controls,
      deltaRadians: -deltaX * yawRadiansPerPixel,
    })
    if (rotated) onRotate()
    return rotated
  }

  const startRotating = (event: PointerEvent, state: PointerDragState) => {
    stateName = 'rotating'
    state.captureElement = getPointerCaptureElement(event)
    capturePointerSafely(state.captureElement, state.pointerId)
    onRotationStart()
  }

  const handlePointerDown = (event: PointerEvent): boolean => {
    if (!canStart(event)) return false

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      captureElement: null,
    }
    stateName = 'pending-left-drag'
    return true
  }

  const handlePointerMove = (event: PointerEvent): boolean => {
    if (!dragState || event.pointerId !== dragState.pointerId) return false

    if (!pointerMoveKeepsLeftButtonPressed(event)) {
      reset()
      return false
    }

    if (stateName === 'pending-left-drag') {
      if (pointerTravelFromStart(dragState, event) < dragThresholdPx) {
        dragState.lastX = event.clientX
        dragState.lastY = event.clientY
        return false
      }

      startRotating(event, dragState)
    }

    if (stateName !== 'rotating') return false

    const deltaX = event.clientX - dragState.lastX
    dragState.lastX = event.clientX
    dragState.lastY = event.clientY

    consumePointerEvent(event)
    rotateByPointerDelta(deltaX)
    return true
  }

  const handlePointerUp = (event: PointerEvent): boolean => {
    if (!dragState || event.pointerId !== dragState.pointerId) return false

    const suppressClick = stateName === 'rotating'
    if (suppressClick) consumePointerEvent(event)
    reset()
    return suppressClick
  }

  const handlePointerCancel = (event?: PointerEvent): boolean => {
    if (!dragState) return false
    if (event && event.pointerId !== dragState.pointerId) return false

    const wasRotating = stateName === 'rotating'
    if (wasRotating && event) consumePointerEvent(event)
    reset()
    return wasRotating
  }

  const handlePointerLeave = (event?: PointerEvent): boolean => handlePointerCancel(event)

  return {
    state: () => stateName,
    isPending: () => stateName === 'pending-left-drag',
    isRotating: () => stateName === 'rotating',
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    reset,
  }
}
