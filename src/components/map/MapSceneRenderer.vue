<script setup lang="ts">
import { ref } from 'vue'
import IsometricGrid from '~/components/IsometricGrid.client.vue'
import type { BuildTool } from '#shared/mapEditor'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  GridAnchor,
  LayerVisibility,
  MapFieldEffects,
  MapHazardKind,
  MapHazardV2,
  MapVoxelV2,
  TabletopMap,
  VoxelMaterial,
} from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { PreviewState } from '~/utils/gridPreview'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'

interface IsometricGridHandle {
  focusPokemon: (id: string) => boolean
}

defineProps<{
  map: TabletopMap
  spawnedPokemon: SpawnedPokemon[]
  selectedId: string | null
  controllablePlacementIds: string[]
  activeInitiativeId: string | null | undefined
  mapVoxels: MapVoxelV2[]
  mapHazards: MapHazardV2[]
  mapFieldEffects?: MapFieldEffects
  mapGroundLevelY: number
  layerVisibility: LayerVisibility
  buildMode: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  hazardMode: boolean
  hazardTool: BuildTool
  hazardKind: MapHazardKind
  canDeleteTokens: boolean
  tokenMoveOptionsById?: Record<string, TokenMoveMenuOption[]>
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'modify-hp', payload: { id: string; currentHp: number }): void
  (event: 'modify-combat-stages', payload: { id: string; stages: CombatStageMap }): void
  (event: 'modify-conditions', payload: { id: string; conditions: string[] }): void
  (event: 'use-move', payload: { id: string; moveName?: string | null }): void
  (event: 'view-sheet', id: string): void
  (event: 'view-pokedex', id: string): void
  (event: 'preview-change', preview: PreviewState): void
  (event: 'place-voxel', voxel: MapVoxelV2): void
  (event: 'remove-voxel', cell: { x: number; y: number; z: number }): void
  (event: 'place-hazard', hazard: MapHazardV2): void
  (event: 'remove-hazard', cell: { x: number; y: number; z: number; kind?: MapHazardKind }): void
}>()

const gridRef = ref<IsometricGridHandle | null>(null)

const focusPokemon = (id: string): boolean => gridRef.value?.focusPokemon(id) ?? false

defineExpose({ focusPokemon })
</script>

<template>
  <IsometricGrid
    ref="gridRef"
    :dimensions="map.dimensions"
    :pokemons="spawnedPokemon"
    :selected-id="selectedId"
    :controllable-ids="controllablePlacementIds"
    :active-turn-id="activeInitiativeId"
    :voxels="mapVoxels"
    :hazards="mapHazards"
    :field-effects="mapFieldEffects"
    :ground-level-y="mapGroundLevelY"
    :layer-visibility="layerVisibility"
    :build-mode="buildMode"
    :build-tool="buildTool"
    :build-material="buildMaterial"
    :build-color="buildColor"
    :hazard-mode="hazardMode"
    :hazard-tool="hazardTool"
    :hazard-kind="hazardKind"
    :can-delete-tokens="canDeleteTokens"
    :token-move-options-by-id="tokenMoveOptionsById"
    @select-pokemon="emit('select-pokemon', $event)"
    @move-pokemon="emit('move-pokemon', $event)"
    @turn-pokemon="emit('turn-pokemon', $event)"
    @delete-pokemon="emit('delete-pokemon', $event)"
    @modify-hp="emit('modify-hp', $event)"
    @modify-combat-stages="emit('modify-combat-stages', $event)"
    @modify-conditions="emit('modify-conditions', $event)"
    @use-move="emit('use-move', $event)"
    @view-sheet="emit('view-sheet', $event)"
    @view-pokedex="emit('view-pokedex', $event)"
    @preview-change="emit('preview-change', $event)"
    @place-voxel="emit('place-voxel', $event)"
    @remove-voxel="emit('remove-voxel', $event)"
    @place-hazard="emit('place-hazard', $event)"
    @remove-hazard="emit('remove-hazard', $event)"
  />
</template>
