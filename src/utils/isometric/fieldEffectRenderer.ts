import * as THREE from 'three'
import type { GridDimensions } from '~/types/pokemon'
import type { MapFieldEffects, MapVoxelV2 } from '~/types/map'
import {
  MAP_ROOM_DEFINITIONS,
  MAP_TERRAIN_DEFINITIONS,
} from '~/utils/mapFieldEffectDefinitions'
import { disposeObject3D } from './resourceDisposal'
import {
  createFieldEffectRoomBoundary,
  createFieldEffectSurfaceMesh,
} from './fieldEffectOverlays'
import { createWeatherVisualFactory } from './weatherEffects'
import {
  createFieldEffectAnimationState,
  fieldEffectAnimationStateNeedsFrame,
  type FieldEffectAnimationState,
} from './fieldEffectAnimation'

export interface FieldEffectRendererInput {
  dimensions: GridDimensions
  voxels: ReadonlyArray<MapVoxelV2>
  groundLevelY: number
  effects: MapFieldEffects
}

export interface FieldEffectRenderer {
  sync(input: FieldEffectRendererInput): void
  update(delta: number, elapsed: number): void
  setVisible(visible: boolean): void
  getAnimationState(): FieldEffectAnimationState
  needsAnimationFrame(): boolean
  dispose(): void
}

export const createFieldEffectRenderer = (
  container: THREE.Group,
): FieldEffectRenderer => {
  const fieldEffectObjects: THREE.Object3D[] = []
  const fieldEffectAnimators: Array<(delta: number, elapsed: number) => void> =
    []
  let visible = true
  const weatherVisualFactory = createWeatherVisualFactory()
  let input: FieldEffectRendererInput = {
    dimensions: { x: 1, y: 1, z: 1 },
    voxels: [],
    groundLevelY: 0,
    effects: {},
  }

  const disposeFieldEffectObjects = () => {
    fieldEffectAnimators.splice(0)
    for (const object of fieldEffectObjects.splice(0)) disposeObject3D(object)
  }

  const getAnimationState = () => createFieldEffectAnimationState(
    visible,
    fieldEffectAnimators.length,
  )

  const sync = (nextInput: FieldEffectRendererInput) => {
    input = nextInput
    disposeFieldEffectObjects()

    const effects = input.effects
    const groundY = input.groundLevelY

    effects.weather?.forEach((effect, index) => {
      const visual = weatherVisualFactory.makeWeatherVisual(
        input,
        effect.kind,
        index,
        effects.weather!.length,
      )
      container.add(visual.group)
      fieldEffectObjects.push(visual.group)
      fieldEffectAnimators.push(visual.update)
    })

    effects.terrains?.forEach((effect, index) => {
      const def = MAP_TERRAIN_DEFINITIONS[effect.kind]
      const surface = createFieldEffectSurfaceMesh(input, {
        color: def.color,
        opacity: effects.terrains!.length > 1 ? 0.16 : 0.22,
        yOffset: 0.022 + index * 0.003,
        inset: index * 0.18,
        renderOrder: 9 + index,
      })
      container.add(surface)
      fieldEffectObjects.push(surface)
    })

    effects.rooms?.forEach((effect, index) => {
      const def = MAP_ROOM_DEFINITIONS[effect.kind]
      const boundary = createFieldEffectRoomBoundary(input, {
        color: def.color,
        opacity: effects.rooms!.length > 1 ? 0.42 : 0.62,
        y: groundY + 0.02,
        inset: index * 0.18,
      })
      container.add(boundary)
      fieldEffectObjects.push(boundary)
    })

    container.visible = visible
    for (const object of fieldEffectObjects) object.visible = visible
  }

  return {
    sync,

    update(delta, elapsed) {
      for (const updateFieldEffect of fieldEffectAnimators) {
        updateFieldEffect(delta, elapsed)
      }
    },

    setVisible(nextVisible) {
      visible = nextVisible
      container.visible = nextVisible
      for (const object of fieldEffectObjects) object.visible = nextVisible
    },

    getAnimationState,

    needsAnimationFrame() {
      return fieldEffectAnimationStateNeedsFrame(getAnimationState())
    },

    dispose() {
      disposeFieldEffectObjects()
      weatherVisualFactory.disposeTextureCache()
    },
  }
}
