import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  canStartIsometricFreeCameraRotation,
  createIsometricFreeCameraRotationController,
  ISOMETRIC_FREE_CAMERA_ROTATION_DRAG_THRESHOLD_PX,
} from '~/utils/isometric/freeCameraRotationInteraction'
import {
  createIsometricCamera,
  getIsometricOffsetYawAzimuth,
  ISO_POLAR_ANGLE,
} from '~/utils/isometric/cameraControls'

const rendererElement = () => ({
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
  hasPointerCapture: vi.fn(() => true),
}) as unknown as HTMLElement & {
  setPointerCapture: ReturnType<typeof vi.fn>
  releasePointerCapture: ReturnType<typeof vi.fn>
  hasPointerCapture: ReturnType<typeof vi.fn>
}

const pointerEvent = (overrides: Partial<PointerEvent> = {}) => ({
  button: 0,
  buttons: 1,
  clientX: 0,
  clientY: 0,
  pointerId: 7,
  pointerType: 'mouse',
  target: null,
  composedPath: vi.fn(() => []),
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...overrides,
} as unknown as PointerEvent)

const offsetFromYaw = (radius: number, yawRadians: number): THREE.Vector3 => {
  const horizontalRadius = radius * Math.sin(ISO_POLAR_ANGLE)
  return new THREE.Vector3(
    horizontalRadius * Math.cos(yawRadians),
    radius * Math.cos(ISO_POLAR_ANGLE),
    horizontalRadius * Math.sin(yawRadians),
  )
}

const offsetPolarAngle = (offset: THREE.Vector3): number => Math.acos(offset.y / offset.length())

const createRotationHarness = () => {
  const element = rendererElement()
  const camera = createIsometricCamera()
  const target = new THREE.Vector3(1, 2, 3)
  camera.position.copy(target.clone().add(offsetFromYaw(16, THREE.MathUtils.degToRad(45))))
  camera.zoom = 2
  const controls = {
    target: target.clone(),
    update: vi.fn(),
  } as unknown as Pick<OrbitControls, 'target' | 'update'>
  const refreshSmartTerrainCutaway = vi.fn()
  const requestCameraRender = vi.fn()
  const cancelPointerMove = vi.fn()
  const canStart = vi.fn(() => true)
  const controller = createIsometricFreeCameraRotationController({
    getCamera: () => camera,
    getControls: () => controls,
    canStart,
    getPointerCaptureElement: () => element,
    onRotationStart: cancelPointerMove,
    onRotate: () => {
      refreshSmartTerrainCutaway()
      requestCameraRender('camera')
    },
  })

  return {
    camera,
    controls,
    controller,
    element,
    canStart,
    cancelPointerMove,
    refreshSmartTerrainCutaway,
    requestCameraRender,
  }
}

describe('isometric free camera rotation interaction', () => {
  it('starts free yaw rotation after a small plain left-drag threshold', () => {
    const harness = createRotationHarness()
    const down = pointerEvent({ target: harness.element })
    const firstYaw = getIsometricOffsetYawAzimuth(harness.camera.position.clone().sub(harness.controls.target))

    expect(harness.controller.handlePointerDown(down)).toBe(true)
    expect(harness.controller.state()).toBe('pending-left-drag')

    const belowThreshold = pointerEvent({ clientX: ISOMETRIC_FREE_CAMERA_ROTATION_DRAG_THRESHOLD_PX - 1, target: harness.element })
    expect(harness.controller.handlePointerMove(belowThreshold)).toBe(false)
    expect(harness.controls.update).not.toHaveBeenCalled()

    const rotateMove = pointerEvent({ clientX: 10, target: harness.element })
    expect(harness.controller.handlePointerMove(rotateMove)).toBe(true)

    const offset = harness.camera.position.clone().sub(harness.controls.target)
    expect(harness.controller.state()).toBe('rotating')
    expect(harness.element.setPointerCapture).toHaveBeenCalledWith(7)
    expect(harness.cancelPointerMove).toHaveBeenCalledOnce()
    expect(getIsometricOffsetYawAzimuth(offset)).not.toBeCloseTo(firstYaw, 8)
    expect(offset.length()).toBeCloseTo(16, 8)
    expect(offsetPolarAngle(offset)).toBeCloseTo(ISO_POLAR_ANGLE, 8)
    expect(harness.camera.zoom).toBe(2)
    expect(harness.controls.update).toHaveBeenCalledOnce()
    expect(rotateMove.preventDefault).toHaveBeenCalledOnce()
    expect(rotateMove.stopPropagation).toHaveBeenCalledOnce()
  })

  it('does not rotate or suppress an empty-map click that never crosses the drag threshold', () => {
    const harness = createRotationHarness()

    harness.controller.handlePointerDown(pointerEvent({ target: harness.element }))
    const up = pointerEvent({ clientX: 2, clientY: 1, buttons: 0, target: harness.element })

    expect(harness.controller.handlePointerUp(up)).toBe(false)
    expect(harness.controller.state()).toBe('idle')
    expect(harness.controls.update).not.toHaveBeenCalled()
    expect(harness.refreshSmartTerrainCutaway).not.toHaveBeenCalled()
    expect(up.preventDefault).not.toHaveBeenCalled()
  })

  it('requests camera renders and refreshes smart terrain cutaway during rotation moves', () => {
    const harness = createRotationHarness()

    harness.controller.handlePointerDown(pointerEvent({ target: harness.element }))
    harness.controller.handlePointerMove(pointerEvent({ clientX: 8, target: harness.element }))
    harness.controller.handlePointerMove(pointerEvent({ clientX: 14, target: harness.element }))

    expect(harness.refreshSmartTerrainCutaway).toHaveBeenCalledTimes(2)
    expect(harness.requestCameraRender).toHaveBeenCalledTimes(2)
    expect(harness.requestCameraRender).toHaveBeenCalledWith('camera')
  })

  it('suppresses the trailing pointerup click after a rotation drag and releases pointer capture', () => {
    const harness = createRotationHarness()

    harness.controller.handlePointerDown(pointerEvent({ target: harness.element }))
    harness.controller.handlePointerMove(pointerEvent({ clientX: 9, target: harness.element }))
    const up = pointerEvent({ clientX: 9, buttons: 0, target: harness.element })

    expect(harness.controller.handlePointerUp(up)).toBe(true)
    expect(harness.controller.state()).toBe('idle')
    expect(up.preventDefault).toHaveBeenCalledOnce()
    expect(up.stopPropagation).toHaveBeenCalledOnce()
    expect(harness.element.releasePointerCapture).toHaveBeenCalledWith(7)
  })

  it('does not start rotation when higher-priority map interactions are active', () => {
    const element = rendererElement()
    const event = pointerEvent({ target: element })
    const pickPokemonId = vi.fn(() => null)
    const baseOptions = {
      event,
      rendererElement: element,
      buildMode: false,
      pickPokemonId,
    }

    expect(canStartIsometricFreeCameraRotation(baseOptions)).toBe(true)

    expect(canStartIsometricFreeCameraRotation({ ...baseOptions, buildMode: true })).toBe(false)
    expect(canStartIsometricFreeCameraRotation({ ...baseOptions, hazardMode: true })).toBe(false)
    expect(canStartIsometricFreeCameraRotation({ ...baseOptions, selectedPokemonActive: true })).toBe(false)
    expect(canStartIsometricFreeCameraRotation({ ...baseOptions, moveAutomationTargetingActive: true })).toBe(false)
    expect(canStartIsometricFreeCameraRotation({ ...baseOptions, sendOutPlacementActive: true })).toBe(false)
    expect(canStartIsometricFreeCameraRotation({ ...baseOptions, blockingOverlayActive: true })).toBe(false)
  })

  it('does not start rotation from tokens, CSS overlays, non-left pointers, or touch', () => {
    const element = rendererElement()
    const tokenPick = vi.fn(() => 'token-1')

    expect(canStartIsometricFreeCameraRotation({
      event: pointerEvent({ target: element }),
      rendererElement: element,
      buildMode: false,
      pickPokemonId: tokenPick,
    })).toBe(false)

    expect(canStartIsometricFreeCameraRotation({
      event: pointerEvent({ target: {} as EventTarget }),
      rendererElement: element,
      buildMode: false,
      pickPokemonId: vi.fn(() => null),
    })).toBe(false)

    expect(canStartIsometricFreeCameraRotation({
      event: pointerEvent({ button: 1, target: element }),
      rendererElement: element,
      buildMode: false,
      pickPokemonId: vi.fn(() => null),
    })).toBe(false)

    expect(canStartIsometricFreeCameraRotation({
      event: pointerEvent({ pointerType: 'touch', target: element }),
      rendererElement: element,
      buildMode: false,
      pickPokemonId: vi.fn(() => null),
    })).toBe(false)
  })
})
