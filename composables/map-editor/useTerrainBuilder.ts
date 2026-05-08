import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { buildMapOccupancy } from '~/utils/mapOccupancy'
import {
  VOXEL_MATERIALS,
  buildAllVoxelOccupancy,
  cellInsidePokemonFootprint,
  getMaterialDef,
  hexColorString,
  voxelKey,
  withDefaultBuilderVoxelColor,
} from '~/utils/voxels'
import type { BuildTool } from '~/shared/mapEditor'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MapVoxelV2, TabletopMap, VoxelMaterial } from '~/types/map'

interface BooleanRef {
  readonly value: boolean
}

export interface UseTerrainBuilderOptions {
  map: Ref<TabletopMap | null>
  mapVoxels: ComputedRef<MapVoxelV2[]>
  mapGroundLevelY: ComputedRef<number>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  canEditMap: BooleanRef
  confirmClearAll?: (count: number) => boolean
}

const materialCanBeBuilt = (material: { transparent?: boolean; tags?: readonly string[] }) =>
  !material.transparent || (material.tags ?? []).includes('water')

export const useTerrainBuilder = ({
  map,
  mapVoxels,
  mapGroundLevelY,
  spawnedPokemon,
  canEditMap,
  confirmClearAll,
}: UseTerrainBuilderOptions) => {
  const buildMode = ref(false)
  const buildTool = ref<BuildTool>('pencil')
  const buildMaterial = ref<VoxelMaterial>('airship_floor_metal')
  const buildColor = ref<string | null>(null)

  const visibleVoxelMaterials = computed(() => VOXEL_MATERIALS.filter(materialCanBeBuilt))
  const activeMaterialDef = computed(() => getMaterialDef(buildMaterial.value))
  const colorPickerValue = computed(() =>
    buildColor.value ?? hexColorString(activeMaterialDef.value.baseColor),
  )

  const placeVoxel = (voxel: MapVoxelV2) => {
    if (!map.value || !canEditMap.value) return
    const styledVoxel = withDefaultBuilderVoxelColor(voxel)
    const next = map.value.voxels.filter(
      (v) => !(v.x === styledVoxel.x && v.y === styledVoxel.y && v.z === styledVoxel.z),
    )
    next.push(styledVoxel)
    map.value.voxels = next
  }

  const removeVoxel = (cell: { x: number; y: number; z: number }) => {
    if (!map.value || !canEditMap.value) return
    map.value.voxels = map.value.voxels.filter(
      (v) => !(v.x === cell.x && v.y === cell.y && v.z === cell.z),
    )
  }

  const selectMaterial = (material: VoxelMaterial) => {
    if (!canEditMap.value || !materialCanBeBuilt(getMaterialDef(material))) return
    buildMaterial.value = material
    buildColor.value = null
  }

  const setTool = (tool: BuildTool) => {
    if (!canEditMap.value) return
    buildTool.value = tool
  }

  const handleColorInput = (event: Event) => {
    if (!canEditMap.value) return
    buildColor.value = (event.target as HTMLInputElement).value
  }

  const clearCustomColor = () => {
    if (!canEditMap.value) return
    buildColor.value = null
  }

  const fillGround = () => {
    if (!map.value || !canEditMap.value) return
    const dims = map.value.dimensions
    const voxelOccupancy = buildAllVoxelOccupancy(mapVoxels.value)
    const mapOccupancy = buildMapOccupancy({ voxels: mapVoxels.value })
    const additions: MapVoxelV2[] = []
    const groundY = mapGroundLevelY.value
    for (let z = 0; z < dims.z; z += 1) {
      for (let x = 0; x < dims.x; x += 1) {
        const key = voxelKey(x, groundY, z)
        if (voxelOccupancy.has(key)) continue
        if (mapOccupancy.has(key)) continue
        if (cellInsidePokemonFootprint(x, groundY, z, spawnedPokemon.value)) continue
        const voxel: MapVoxelV2 = withDefaultBuilderVoxelColor({
          x,
          y: groundY,
          z,
          materialId: buildMaterial.value,
          ...(buildColor.value ? { color: buildColor.value } : {}),
        })
        additions.push(voxel)
      }
    }
    if (!additions.length) return
    map.value.voxels = [...map.value.voxels, ...additions]
  }

  const clearAllVoxels = () => {
    if (!map.value || !canEditMap.value) return
    const count = map.value.voxels.length
    if (!count) return
    const ok = confirmClearAll
      ? confirmClearAll(count)
      : typeof window === 'undefined' || window.confirm(`Remove all ${count} terrain blocks? This cannot be undone.`)
    if (!ok) return
    map.value.voxels = []
  }

  return {
    buildMode,
    buildTool,
    buildMaterial,
    buildColor,
    visibleVoxelMaterials,
    activeMaterialDef,
    colorPickerValue,
    placeVoxel,
    removeVoxel,
    selectMaterial,
    setTool,
    handleColorInput,
    clearCustomColor,
    fillGround,
    clearAllVoxels,
  }
}
