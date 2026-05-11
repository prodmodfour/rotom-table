import * as THREE from 'three'
import type { GridDimensions } from '~/types/pokemon'
import type { MapFieldEffects, MapVoxelV2 } from '~/types/map'
import {
  MAP_ROOM_DEFINITIONS,
  MAP_TERRAIN_DEFINITIONS,
} from '~/utils/mapFieldEffects'
import { parseHexColor } from '~/utils/voxels'
import { disposeObject3D } from './resourceDisposal'
import { createWeatherVisualFactory } from './weatherEffects'

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

  const fieldEffectColor = (color: string, fallback = 0xfabd2f): number =>
    parseHexColor(color) ?? fallback

  const makeSurfaceFieldEffectMesh = (
    color: string,
    opacity: number,
    yOffset: number,
    inset: number,
    renderOrder: number,
  ): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
    const count = Math.max(1, input.dimensions.x * input.dimensions.z)
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(
        Math.max(0.2, 1 - inset),
        Math.max(0.2, 1 - inset),
      ),
      new THREE.MeshBasicMaterial({
        color: fieldEffectColor(color),
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      count,
    )

    const groundY = input.groundLevelY
    const columnTop = new Map<string, number>()
    for (const voxel of input.voxels) {
      const key = `${voxel.x},${voxel.z}`
      columnTop.set(key, Math.max(columnTop.get(key) ?? groundY, voxel.y + 1))
    }

    const rotation = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
    const translation = new THREE.Matrix4()
    const matrix = new THREE.Matrix4()
    let index = 0
    for (let z = 0; z < input.dimensions.z; z += 1) {
      for (let x = 0; x < input.dimensions.x; x += 1) {
        const y =
          Math.max(groundY, columnTop.get(`${x},${z}`) ?? groundY) + yOffset
        translation.makeTranslation(x + 0.5, y, z + 0.5)
        matrix.multiplyMatrices(translation, rotation)
        mesh.setMatrixAt(index, matrix)
        index += 1
      }
    }
    mesh.count = index
    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = renderOrder
    return mesh
  }

  const makeRoomBoundary = (
    color: string,
    opacity: number,
    y: number,
    inset: number,
  ): THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> => {
    const width = Math.max(0.2, input.dimensions.x - inset * 2)
    const depth = Math.max(0.2, input.dimensions.z - inset * 2)
    const height = Math.max(1, input.dimensions.y - y)
    const geometry = new THREE.BoxGeometry(width, height, depth)
    const edges = new THREE.EdgesGeometry(geometry)
    geometry.dispose()
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: fieldEffectColor(color),
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
      }),
    )
    lines.position.set(
      input.dimensions.x / 2,
      y + height / 2,
      input.dimensions.z / 2,
    )
    lines.renderOrder = 18
    return lines
  }

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
      const surface = makeSurfaceFieldEffectMesh(
        def.color,
        effects.terrains!.length > 1 ? 0.16 : 0.22,
        0.022 + index * 0.003,
        index * 0.18,
        9 + index,
      )
      container.add(surface)
      fieldEffectObjects.push(surface)
    })

    effects.rooms?.forEach((effect, index) => {
      const def = MAP_ROOM_DEFINITIONS[effect.kind]
      const boundary = makeRoomBoundary(
        def.color,
        effects.rooms!.length > 1 ? 0.42 : 0.62,
        groundY + 0.02,
        index * 0.18,
      )
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

    dispose() {
      disposeFieldEffectObjects()
      weatherVisualFactory.disposeTextureCache()
    },
  }
}
