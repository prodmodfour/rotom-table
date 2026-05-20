<script setup lang="ts">
import { computed, ref } from 'vue'
import MapSceneRenderer from '~/components/map/MapSceneRenderer.vue'
import MapSceneStatus from '~/components/map/MapSceneStatus.vue'
import MapMoveReactionPromptStack from '~/components/map/MapMoveReactionPromptStack.vue'
import InitiativeInfoBar from '~/components/map/InitiativeInfoBar.vue'
import MapCombatLog from '~/components/map/MapCombatLog.vue'
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
import type {
  MoveAutomationAreaDirection,
  MoveAutomationFeedbackState,
  MoveAutomationHpUpdate,
  MoveAutomationCelebratePrompt,
  MoveAutomationCuteCharmPrompt,
  MoveAutomationMoxiePrompt,
  MoveAutomationPoisonPointPrompt,
  MoveAutomationSpitePrompt,
  MoveAutomationTargetingOverlayState,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AttackOfOpportunityPrompt } from '~/utils/attackOfOpportunity'
import type { TokenAbilityMenuOption } from '~/utils/mapTokenAbilities'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import type { TokenSendOutOption } from '~/utils/mapTokenSendOut'
import type { MapSaveStatus } from '~/composables/useEditableMap'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'
import { buildCombatLogMessages } from '~/utils/combatLog'
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
  initiativeRows?: InitiativeRow[]
  initiativeRound?: number
  canManageInitiative?: boolean
  mapVoxels: MapVoxelV2[]
  mapHazards: MapHazardV2[]
  mapFieldEffects?: MapFieldEffects
  mapGroundLevelY: number
  layerVisibility: LayerVisibility
  buildMode: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  buildGhostVoxel: boolean
  ghostVoxelsFaded: boolean
  hazardMode: boolean
  hazardTool: BuildTool
  hazardKind: MapHazardKind
  canDeleteTokens: boolean
  moveAutomationTargeting?: MoveAutomationTargetingOverlayState | null
  moveAutomationFeedback?: MoveAutomationFeedbackState | null
  moveUsageError?: string | null
  spiteReactionPrompts?: MoveAutomationSpitePrompt[]
  cuteCharmReactionPrompts?: MoveAutomationCuteCharmPrompt[]
  poisonPointReactionPrompts?: MoveAutomationPoisonPointPrompt[]
  moxieTriggerPrompts?: MoveAutomationMoxiePrompt[]
  celebrateTriggerPrompts?: MoveAutomationCelebratePrompt[]
  attackOfOpportunityPrompts?: AttackOfOpportunityPrompt[]
  tokenMoveOptionsById?: Record<string, TokenMoveMenuOption[]>
  tokenAbilityOptionsById?: Record<string, TokenAbilityMenuOption[]>
  tokenSendOutOptionsById?: Record<string, TokenSendOutOption[]>
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'focus-initiative-entry', id: string): void
  (event: 'previous-initiative'): void
  (event: 'next-initiative'): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'modify-hp', payload: MoveAutomationHpUpdate): void
  (event: 'modify-combat-stages', payload: { id: string; stages: CombatStageMap }): void
  (event: 'modify-conditions', payload: { id: string; conditions: string[] }): void
  (event: 'use-move', payload: { id: string; moveName?: string | null }): void
  (event: 'use-ability', payload: { id: string; abilityName?: string | null }): void
  (event: 'send-out-pokemon', payload: { trainerId: string; pokemonSlug: string; position: GridAnchor }): void
  (event: 'view-sheet', id: string): void
  (event: 'view-pokedex', id: string): void
  (event: 'preview-change', preview: PreviewState): void
  (event: 'place-voxel', voxel: MapVoxelV2): void
  (event: 'remove-voxel', cell: { x: number; y: number; z: number }): void
  (event: 'place-hazard', hazard: MapHazardV2): void
  (event: 'remove-hazard', cell: { x: number; y: number; z: number; kind?: MapHazardKind }): void
  (event: 'select-move-target', targetId: string): void
  (event: 'select-move-area-direction', direction: MoveAutomationAreaDirection): void
  (event: 'cancel-move-targeting'): void
  (event: 'dismiss-spite-reaction', id: string): void
  (event: 'apply-spite-reaction', id: string): void
  (event: 'dismiss-cute-charm-reaction', id: string): void
  (event: 'apply-cute-charm-reaction', id: string): void
  (event: 'dismiss-poison-point-reaction', id: string): void
  (event: 'apply-poison-point-reaction', id: string): void
  (event: 'dismiss-moxie-trigger', id: string): void
  (event: 'apply-moxie-trigger', id: string): void
  (event: 'dismiss-celebrate-trigger', id: string): void
  (event: 'apply-celebrate-trigger', id: string): void
  (event: 'use-attack-of-opportunity', payload: { promptId: string; moveName: string }): void
}>()

const COMBAT_LOG_MESSAGE_LIMIT = 24

const rendererRef = ref<MapSceneRendererHandle | null>(null)
const combatLogMessages = computed(() =>
  buildCombatLogMessages(props.map?.metadata, { maxMessages: COMBAT_LOG_MESSAGE_LIMIT }),
)

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
        :build-ghost-voxel="buildGhostVoxel"
        :ghost-voxels-faded="ghostVoxelsFaded"
        :hazard-mode="hazardMode"
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :can-delete-tokens="canDeleteTokens"
        :token-move-options-by-id="tokenMoveOptionsById"
        :token-ability-options-by-id="tokenAbilityOptionsById"
        :token-send-out-options-by-id="tokenSendOutOptionsById"
        :move-automation-targeting="moveAutomationTargeting"
        :move-automation-feedback="moveAutomationFeedback"
        :attack-of-opportunity-prompts="props.attackOfOpportunityPrompts ?? []"
        @select-pokemon="emit('select-pokemon', $event)"
        @move-pokemon="emit('move-pokemon', $event)"
        @turn-pokemon="emit('turn-pokemon', $event)"
        @delete-pokemon="emit('delete-pokemon', $event)"
        @modify-hp="emit('modify-hp', $event)"
        @modify-combat-stages="emit('modify-combat-stages', $event)"
        @modify-conditions="emit('modify-conditions', $event)"
        @use-move="emit('use-move', $event)"
        @use-ability="emit('use-ability', $event)"
        @send-out-pokemon="emit('send-out-pokemon', $event)"
        @view-sheet="emit('view-sheet', $event)"
        @view-pokedex="emit('view-pokedex', $event)"
        @preview-change="emit('preview-change', $event)"
        @place-voxel="emit('place-voxel', $event)"
        @remove-voxel="emit('remove-voxel', $event)"
        @place-hazard="emit('place-hazard', $event)"
        @remove-hazard="emit('remove-hazard', $event)"
        @select-move-target="emit('select-move-target', $event)"
        @select-move-area-direction="emit('select-move-area-direction', $event)"
        @cancel-move-targeting="emit('cancel-move-targeting')"
        @use-attack-of-opportunity="emit('use-attack-of-opportunity', $event)"
      />
      <MapSceneStatus v-else :status="status" :error="error" :slug="slug" />

      <InitiativeInfoBar
        v-if="props.map && canViewMap"
        :rows="initiativeRows ?? []"
        :active-id="activeInitiativeId"
        :round="initiativeRound ?? 1"
        :can-manage="canManageInitiative ?? false"
        @focus="emit('focus-initiative-entry', $event)"
        @previous="emit('previous-initiative')"
        @next="emit('next-initiative')"
      />

      <MapCombatLog
        v-if="props.map && canViewMap"
        :messages="combatLogMessages"
      />

      <div v-if="props.moveUsageError" class="move-usage-error" role="status">
        {{ props.moveUsageError }}
      </div>

      <MapMoveReactionPromptStack
        :spite-prompts="props.spiteReactionPrompts ?? []"
        :cute-charm-prompts="props.cuteCharmReactionPrompts ?? []"
        :poison-point-prompts="props.poisonPointReactionPrompts ?? []"
        :moxie-prompts="props.moxieTriggerPrompts ?? []"
        :celebrate-prompts="props.celebrateTriggerPrompts ?? []"
        @dismiss="emit('dismiss-spite-reaction', $event)"
        @apply="emit('apply-spite-reaction', $event)"
        @dismiss-cute-charm="emit('dismiss-cute-charm-reaction', $event)"
        @apply-cute-charm="emit('apply-cute-charm-reaction', $event)"
        @dismiss-poison-point="emit('dismiss-poison-point-reaction', $event)"
        @apply-poison-point="emit('apply-poison-point-reaction', $event)"
        @dismiss-moxie="emit('dismiss-moxie-trigger', $event)"
        @apply-moxie="emit('apply-moxie-trigger', $event)"
        @dismiss-celebrate="emit('dismiss-celebrate-trigger', $event)"
        @apply-celebrate="emit('apply-celebrate-trigger', $event)"
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
  position: relative;
  min-width: 0;
  min-height: 100vh;
  background: var(--paper);
}

.move-usage-error {
  position: absolute;
  top: 1rem;
  left: 50%;
  z-index: 10800;
  max-width: min(32rem, calc(100vw - 2rem));
  transform: translateX(-50%);
  padding: 0.7rem 0.95rem;
  border: 1px solid color-mix(in srgb, var(--bad) 65%, rgba(255, 255, 255, 0.3));
  border-radius: 999px;
  background: rgba(60, 8, 12, 0.86);
  color: var(--ink-bright);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35);
  font-size: 0.86rem;
  font-weight: 900;
  text-align: center;
  pointer-events: none;
}
</style>
