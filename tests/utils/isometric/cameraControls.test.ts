import { describe, expect, it, vi, afterEach } from 'vitest'
import * as THREE from 'three'
import type { WebGLRenderer } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridDimensions } from '~/types/pokemon'
import {
  bindIsometricCameraControlChangeInvalidation,
  createIsometricCamera,
  readIsometricCameraControlState,
  isSameIsometricCameraControlState,
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
    expect(harness.renderer.setSize).toHaveBeenCalledWith(800, 600)
    expect(harness.cssRenderer.setSize).toHaveBeenCalledWith(800, 600)
    expect(harness.updateProjectionMatrix).toHaveBeenCalledTimes(1)
    expect(resizedForDimensions.size).toMatchObject({
      width: 800,
      height: 600,
      dimensionsX: 20,
      dimensionsY: 6,
      dimensionsZ: 10,
    })
  })
})
