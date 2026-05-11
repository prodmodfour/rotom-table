<script setup lang="ts">
import { ref } from 'vue'
import MapMoveAutomationOverlay from '~/components/map/MapMoveAutomationOverlay.vue'
import MapSceneRenderer from '~/components/map/MapSceneRenderer.vue'
import MapSceneStatus from '~/components/map/MapSceneStatus.vue'
import type { BuildTool } from '~/shared/mapEditor'
import type { CharacterSheetMove } from '~/types/characterSheet'
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
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerMove } from '~/types/trainerSheet'
import type { MapSaveStatus } from '~/composables/useEditableMap'
import type { PreviewState } from '~/utils/gridPreview'

interface MapSceneRendererHandle {
  focusPokemon: (id: string) => boolean
}

const props = defineProps<{
  map: TabletopMap | null
  canViewMap: boolean
  status: MapSaveStatus
  error: string | null
  slug: string
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
  moveAutomationUser: SpawnedPokemon | null
  moveAutomationMoves: Array<CharacterSheetMove | TrainerMove>
  canApplyMapEffects: boolean
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'modify-hp', payload: { id: string; currentHp: number }): void
  (event: 'modify-combat-stages', payload: { id: string; stages: CombatStageMap }): void
  (event: 'modify-conditions', payload: { id: string; conditions: string[] }): void
  (event: 'use-move', id: string): void
  (event: 'view-sheet', id: string): void
  (event: 'view-pokedex', id: string): void
  (event: 'preview-change', preview: PreviewState): void
  (event: 'place-voxel', voxel: MapVoxelV2): void
  (event: 'remove-voxel', cell: { x: number; y: number; z: number }): void
  (event: 'place-hazard', hazard: MapHazardV2): void
  (event: 'remove-hazard', cell: { x: number; y: number; z: number; kind?: MapHazardKind }): void
  (event: 'close-move-automation'): void
  (event: 'apply-move-automation', transaction: MoveAutomationTransaction): void
}>()

const rendererRef = ref<MapSceneRendererHandle | null>(null)

const focusPokemon = (id: string): boolean => rendererRef.value?.focusPokemon(id) ?? false

defineExpose({ focusPokemon })
</script>

<template>
  <main class="scene-column">
    <ClientOnly>
      <MapSceneRenderer
        v-if="props.map && canViewMap"
        ref="rendererRef"
        :map="props.map"
        :spawned-pokemon="spawnedPokemon"
        :selected-id="selectedId"
        :controllable-placement-ids="controllablePlacementIds"
        :active-initiative-id="activeInitiativeId"
        :map-voxels="mapVoxels"
        :map-hazards="mapHazards"
        :map-field-effects="mapFieldEffects"
        :map-ground-level-y="mapGroundLevelY"
        :layer-visibility="layerVisibility"
        :build-mode="buildMode"
        :build-tool="buildTool"
        :build-material="buildMaterial"
        :build-color="buildColor"
        :hazard-mode="hazardMode"
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :can-delete-tokens="canDeleteTokens"
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
      <MapSceneStatus v-else :status="status" :error="error" :slug="slug" />

      <MapMoveAutomationOverlay
        :user="moveAutomationUser"
        :moves="moveAutomationMoves"
        :all-tokens="spawnedPokemon"
        :field-effects="mapFieldEffects"
        :can-apply-map-effects="canApplyMapEffects"
        @close="emit('close-move-automation')"
        @apply="emit('apply-move-automation', $event)"
      />

      <template #fallback>
        <MapSceneStatus
          status="loading"
          :error="null"
          slug=""
          loading-text="Loading the three.js tabletop…"
        />
      </template>
    </ClientOnly>
  </main>
</template>

<style scoped>
.scene-column {
  min-width: 0;
  min-height: 100vh;
  background: var(--paper);
}
</style>
