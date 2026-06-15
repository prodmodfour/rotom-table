import { describe, expect, it, vi, afterEach } from 'vitest'
import * as THREE from 'three'
import type { WebGLRenderer } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import {
  bindIsometricCameraControlChangeInvalidation,
  createIsometricCamera,
  createIsometricOrbitControls,
  focusCameraOnPokemon,
  getIsometricOffsetYawAzimuth,
  ISO_POLAR_ANGLE,
  readIsometricCameraControlState,
  isSameIsometricCameraControlState,
  rotateIsometricYawCameraState,
  rotateIsometricYawStep,
  syncIsometricRendererSize,
} from '~/utils/isometric/cameraControls'

const dimensions = (overrides: Partial<GridDimensions> = {}): GridDimensions => ({
  x: 12,
  y: 6,
  z: 10,
  ...overrides,
})

const createRendererSizeHarness = (bounds: { width: number; height: number }) => {
  const renderer = {
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
  } as unknown as WebGLRenderer
  const cssRenderer = {
    setSize: vi.fn(),
  } as unknown as CSS3DRenderer
  const camera = createIsometricCamera()
  const updateProjectionMatrix = vi.spyOn(camera, 'updateProjectionMatrix')
  const controls = { maxZoom: 0 } as unknown as OrbitControls
  const container = {
    getBoundingClientRect: vi.fn(() => bounds),
  } as unknown as HTMLElement

  return { renderer, cssRenderer, camera, updateProjectionMatrix, controls, container }
}

type ControlsChangeListener = () => void

const createControlsChangeHarness = () => {
  let changeListener: ControlsChangeListener | null = null
  const controls = {
    target: new THREE.Vector3(0, 0, 0),
    addEventListener: vi.fn((_type: 'change', listener: ControlsChangeListener) => {
      changeListener = listener
    }),
    removeEventListener: vi.fn((_type: 'change', listener: ControlsChangeListener) => {
      if (changeListener === listener) {
        changeListener = null
      }
    }),
  } as unknown as OrbitControls

  return {
    controls,
    dispatchChange: () => changeListener?.(),
  }
}

const createFakeOrbitControlsElement = (): HTMLElement => {
  const root = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }

  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getRootNode: vi.fn(() => root),
    style: {},
  } as unknown as HTMLElement
}

const offsetFromYaw = (radius: number, yawDegrees: number): THREE.Vector3 => {
  const yaw = THREE.MathUtils.degToRad(yawDegrees)
  const horizontalRadius = radius * Math.sin(ISO_POLAR_ANGLE)

  return new THREE.Vector3(
    horizontalRadius * Math.cos(yaw),
    radius * Math.cos(ISO_POLAR_ANGLE),
    horizontalRadius * Math.sin(yaw),
  )
}

const expectCloseVector = (actual: THREE.Vector3, expected: THREE.Vector3, precision = 8) => {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
  expect(actual.z).toBeCloseTo(expected.z, precision)
}

const offsetPolarAngle = (offset: THREE.Vector3): number => Math.acos(offset.y / offset.length())

const offsetYawDegrees = (offset: THREE.Vector3): number => (
  Math.round(THREE.MathUtils.radToDeg(getIsometricOffsetYawAzimuth(offset)))
)

describe('isometric camera controls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('compares camera and controls state snapshots', () => {
    const camera = createIsometricCamera()
    const controls = { target: new THREE.Vector3(1, 2, 3) } as OrbitControls
    const first = readIsometricCameraControlState(camera, controls)
    const duplicate = readIsometricCameraControlState(camera, controls)

    expect(isSameIsometricCameraControlState(first, duplicate)).toBe(true)

    camera.zoom += 0.25
    const zoomed = readIsometricCameraControlState(camera, controls)

    expect(isSameIsometricCameraControlState(first, zoomed)).toBe(false)

    controls.target.x += 1
    const retargeted = readIsometricCameraControlState(camera, controls)

    expect(isSameIsometricCameraControlState(zoomed, retargeted)).toBe(false)
  })

  it('configures OrbitControls for snapped yaw, panning, and locked isometric pitch', () => {
    const camera = createIsometricCamera()
    const controls = createIsometricOrbitControls(camera, createFakeOrbitControlsElement(), 8)

    expect(controls.enablePan).toBe(true)
    expect(controls.enableRotate).toBe(false)
    expect(controls.enableZoom).toBe(true)
    expect(controls.minPolarAngle).toBe(ISO_POLAR_ANGLE)
    expect(controls.maxPolarAngle).toBe(ISO_POLAR_ANGLE)
    expect(controls.maxZoom).toBe(8)

    controls.dispose()
  })

  it('rotates camera yaw without changing target, zoom, or target distance', () => {
    const target = new THREE.Vector3(3, 4, 5)
    const radius = 18
    const state = {
      position: target.clone().add(offsetFromYaw(radius, 45)),
      target,
      zoom: 2.25,
    }

    const rotated = rotateIsometricYawCameraState(state, 'left')

    expect(rotated).not.toBeNull()
    expectCloseVector(rotated!.target, target)
    expect(rotated!.zoom).toBe(state.zoom)
    expect(rotated!.position.distanceTo(rotated!.target)).toBeCloseTo(radius, 8)
    expect(offsetYawDegrees(rotated!.position.clone().sub(rotated!.target))).toBe(135)
  })

  it('cycles through the four snapped isometric azimuths in 90 degree steps', () => {
    const target = new THREE.Vector3(-2, 1, 7)
    const radius = 12
    const initialPosition = target.clone().add(offsetFromYaw(radius, 45))
    let state = {
      position: initialPosition.clone(),
      target,
      zoom: 1.75,
    }
    const yawDegrees: number[] = []

    for (let i = 0; i < 4; i += 1) {
      yawDegrees.push(offsetYawDegrees(state.position.clone().sub(state.target)))
      state = rotateIsometricYawCameraState(state, 'left')!
    }

    expect(yawDegrees).toEqual([45, 135, 225, 315])
    expectCloseVector(state.position, initialPosition)
  })

  it('keeps snapped yaw rotations at the isometric polar angle', () => {
    const target = new THREE.Vector3(0, 2, 0)
    let state = {
      position: target.clone().add(offsetFromYaw(16, 315)),
      target,
      zoom: 1,
    }

    for (let i = 0; i < 4; i += 1) {
      state = rotateIsometricYawCameraState(state, 'right')!
      const offset = state.position.clone().sub(state.target)

      expect(offsetPolarAngle(offset)).toBeCloseTo(ISO_POLAR_ANGLE, 8)
    }
  })

  it('applies snapped yaw to a camera and updates controls while preserving zoom', () => {
    const camera = createIsometricCamera()
    const target = new THREE.Vector3(4, 0.5, -3)
    camera.position.copy(target.clone().add(offsetFromYaw(20, 225)))
    camera.zoom = 3
    const controls = {
      target: target.clone(),
      update: vi.fn(),
    } as unknown as Pick<OrbitControls, 'target' | 'update'>

    expect(rotateIsometricYawStep({ camera, controls, direction: 'right' })).toBe(true)

    expectCloseVector(controls.target, target)
    expect(camera.zoom).toBe(3)
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(20, 8)
    expect(offsetYawDegrees(camera.position.clone().sub(controls.target))).toBe(135)
    expect(controls.update).toHaveBeenCalledOnce()
  })

  it('keeps focus-on-Pokemon behavior on the active snapped yaw', () => {
    const camera = createIsometricCamera()
    const target = new THREE.Vector3(0, 0, 0)
    camera.position.copy(target.clone().add(offsetFromYaw(20, 135)))
    const controls = {
      target: target.clone(),
      minZoom: 0.4,
      maxZoom: 10,
      update: vi.fn(),
    } as unknown as OrbitControls
    const pokemon = {
      base: 2,
      clearance: 3,
      width: 1,
      height: 1,
    } as SpawnedPokemon
    const center = new THREE.Vector3(6, 0, 8)

    focusCameraOnPokemon({
      camera,
      controls,
      dimensions: dimensions(),
      pokemon,
      center,
    })

    const offset = camera.position.clone().sub(controls.target)
    expect(offsetYawDegrees(offset)).toBe(135)
    expect(offsetPolarAngle(offset)).toBeCloseTo(ISO_POLAR_ANGLE, 8)
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(20, 8)
    expect(controls.target.y).toBeCloseTo(1.05, 8)
    expect(controls.update).toHaveBeenCalledOnce()
  })

  it('requests scheduler renders for real OrbitControls camera changes only', () => {
    const camera = createIsometricCamera()
    const { controls, dispatchChange } = createControlsChangeHarness()
    const requestRender = vi.fn()

    const cleanup = bindIsometricCameraControlChangeInvalidation({
      camera,
      controls,
      requestRender,
    })

    expect(controls.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    dispatchChange()
    expect(requestRender).not.toHaveBeenCalled()

    camera.position.x += 2
    dispatchChange()
    expect(requestRender).toHaveBeenCalledOnce()
    expect(requestRender).toHaveBeenCalledWith('camera')

    dispatchChange()
    expect(requestRender).toHaveBeenCalledOnce()

    controls.target.z += 3
    dispatchChange()
    expect(requestRender).toHaveBeenCalledTimes(2)
    expect(requestRender).toHaveBeenLastCalledWith('camera')

    cleanup()
    expect(controls.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    camera.position.y += 1
    dispatchChange()
    expect(requestRender).toHaveBeenCalledTimes(2)
  })

  it('skips redundant renderer size work when resize bounds are unchanged', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1.5 })
    const harness = createRendererSizeHarness({ width: 960, height: 540 })

    const first = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
    })

    expect(first.changed).toBe(true)
    expect(harness.renderer.setSize).toHaveBeenCalledWith(960, 540)
    expect(harness.renderer.setPixelRatio).toHaveBeenCalledWith(1.5)
    expect(harness.cssRenderer.setSize).toHaveBeenCalledWith(960, 540)
    expect(harness.updateProjectionMatrix).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()

    const second = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
      previousSize: first.size,
    })

    expect(second).toEqual({ changed: false, size: first.size })
    expect(harness.renderer.setSize).not.toHaveBeenCalled()
    expect(harness.renderer.setPixelRatio).not.toHaveBeenCalled()
    expect(harness.cssRenderer.setSize).not.toHaveBeenCalled()
    expect(harness.updateProjectionMatrix).not.toHaveBeenCalled()
  })

  it('keeps frustum updates when dimensions change with the same renderer bounds', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 })
    const harness = createRendererSizeHarness({ width: 800, height: 600 })
    const first = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
    })

    vi.clearAllMocks()

    const resizedForDimensions = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions({ x: 20 }),
      previousSize: first.size,
    })

    expect(resizedForDimensions.changed).toBe(true)
    expect(harness.renderer.setSize).not.toHaveBeenCalled()
    expect(harness.renderer.setPixelRatio).not.toHaveBeenCalled()
    expect(harness.cssRenderer.setSize).not.toHaveBeenCalled()
    expect(harness.updateProjectionMatrix).toHaveBeenCalledTimes(1)
    expect(resizedForDimensions.size).toMatchObject({
      width: 800,
      height: 600,
      dimensionsX: 20,
      dimensionsY: 6,
      dimensionsZ: 10,
    })
  })

  it('updates only the WebGL pixel ratio when device pixel ratio changes', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 })
    const harness = createRendererSizeHarness({ width: 800, height: 600 })
    const first = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
    })

    vi.clearAllMocks()
    vi.stubGlobal('window', { devicePixelRatio: 2 })

    const dprOnly = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
      previousSize: first.size,
    })

    expect(dprOnly.changed).toBe(true)
    expect(harness.renderer.setSize).not.toHaveBeenCalled()
    expect(harness.renderer.setPixelRatio).toHaveBeenCalledWith(2)
    expect(harness.cssRenderer.setSize).not.toHaveBeenCalled()
    expect(harness.updateProjectionMatrix).not.toHaveBeenCalled()
  })

  it('skips frustum recalculation when renderer bounds change without changing aspect ratio', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 })
    const bounds = { width: 800, height: 600 }
    const harness = createRendererSizeHarness(bounds)
    const first = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
    })

    vi.clearAllMocks()
    bounds.width = 1200
    bounds.height = 900

    const sameAspectResize = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
      previousSize: first.size,
    })

    expect(sameAspectResize.changed).toBe(true)
    expect(harness.renderer.setSize).toHaveBeenCalledWith(1200, 900)
    expect(harness.renderer.setPixelRatio).not.toHaveBeenCalled()
    expect(harness.cssRenderer.setSize).toHaveBeenCalledWith(1200, 900)
    expect(harness.updateProjectionMatrix).not.toHaveBeenCalled()
  })

  it('keeps frustum recalculation when renderer bounds change aspect ratio', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 })
    const bounds = { width: 800, height: 600 }
    const harness = createRendererSizeHarness(bounds)
    const first = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
    })

    vi.clearAllMocks()
    bounds.width = 1000
    bounds.height = 600

    const changedAspectResize = syncIsometricRendererSize({
      renderer: harness.renderer,
      cssRenderer: harness.cssRenderer,
      camera: harness.camera,
      controls: harness.controls,
      container: harness.container,
      dimensions: dimensions(),
      previousSize: first.size,
    })

    expect(changedAspectResize.changed).toBe(true)
    expect(harness.renderer.setSize).toHaveBeenCalledWith(1000, 600)
    expect(harness.renderer.setPixelRatio).not.toHaveBeenCalled()
    expect(harness.cssRenderer.setSize).toHaveBeenCalledWith(1000, 600)
    expect(harness.updateProjectionMatrix).toHaveBeenCalledTimes(1)
  })
})
