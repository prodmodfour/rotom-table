import { describe, expect, it } from 'vitest'
import { createIsometricSceneGraph } from '~/utils/isometric/sceneGraph'

describe('isometric scene graph', () => {
  it('creates the expected top-level scene groups', () => {
    const graph = createIsometricSceneGraph()

    expect(graph.scene.children).toEqual([
      graph.gridGroup,
      graph.worldGroup,
      graph.previewGroup,
    ])
  })

  it('nests render containers under the world group in draw-order order', () => {
    const graph = createIsometricSceneGraph()

    expect(graph.worldGroup.children).toEqual([
      graph.fieldEffectContainer,
      graph.voxelContainer,
      graph.hazardContainer,
    ])
  })

  it('exposes a shared raycaster and animation clock for the adapter', () => {
    const graph = createIsometricSceneGraph()

    expect(graph.raycaster.ray).toBeDefined()
    expect(typeof graph.clock.getDelta).toBe('function')
  })
})
