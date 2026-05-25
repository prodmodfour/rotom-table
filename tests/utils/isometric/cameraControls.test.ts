import { describe, expect, it, vi, afterEach } from 'vitest'
import type { WebGLRenderer } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridDimensions } from '~/types/pokemon'
import {
  createIsometricCamera,
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

describe('isometric camera controls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
