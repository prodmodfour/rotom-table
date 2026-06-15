<script setup lang="ts">
import { computed, ref } from 'vue'
import MapSceneRenderer from '~/components/map/MapSceneRenderer.vue'
import MapSceneStatus from '~/components/map/MapSceneStatus.vue'
import MapMoveReactionPromptStack from '~/components/map/MapMoveReactionPromptStack.vue'
import MoveVfxDebugPanel from '~/components/map/MoveVfxDebugPanel.vue'
import InitiativeInfoBar from '~/components/map/InitiativeInfoBar.vue'
import MapActionSplash from '~/components/map/MapActionSplash.vue'
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
import type { MoveAnimationEvent, MoveVfxKind } from '~/types/moveAnimation'
import type { MapActionSplashState } from '~/types/mapActionSplash'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AttackOfOpportunityPrompt } from '~/utils/attackOfOpportunity'
import type { TokenAbilityMenuOption } from '~/utils/mapTokenAbilities'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import type { TokenManeuverMenuOption } from '~/utils/mapTokenManeuvers'
import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import type { TokenSendOutOption } from '~/utils/mapTokenSendOut'
import type { TokenPokeballOption } from '~/utils/pokeballCapture'
import type { MapSaveStatus } from '~/composables/useEditableMap'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'
import type { LivePlayConnectionState } from '~/composables/map-editor/useLivePlayStateMachine'
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
  smartTerrainCutawayEnabled: boolean
  hazardMode: boolean
  hazardTool: BuildTool
  hazardKind: MapHazardKind
  canDeleteTokens: boolean
  moveAutomationTargeting?: MoveAutomationTargetingOverlayState | null
  moveAutomationFeedback?: MoveAutomationFeedbackState | null
  moveAnimations?: readonly MoveAnimationEvent[]
  moveAnimationsReducedMotion?: boolean
  moveVfxDebugHarnessEnabled?: boolean
  actionSplash?: MapActionSplashState | null
  actionSplashSpeedLinesDurationMs?: number
  moveUsageError?: string | null
  spiteReactionPrompts?: MoveAutomationSpitePrompt[]
  cuteCharmReactionPrompts?: MoveAutomationCuteCharmPrompt[]
  poisonPointReactionPrompts?: MoveAutomationPoisonPointPrompt[]
  moxieTriggerPrompts?: MoveAutomationMoxiePrompt[]
  celebrateTriggerPrompts?: MoveAutomationCelebratePrompt[]
  attackOfOpportunityPrompts?: AttackOfOpportunityPrompt[]
  tokenMoveOptionsById?: Record<string, TokenMoveMenuOption[]>
  tokenManeuverOptionsById?: Record<string, TokenManeuverMenuOption[]>
  tokenAbilityOptionsById?: Record<string, TokenAbilityMenuOption[]>
  tokenOrderOptionsById?: Record<string, TokenOrderMenuOption[]>
  tokenSendOutOptionsById?: Record<string, TokenSendOutOption[]>
  tokenPokeballOptionsById?: Record<string, TokenPokeballOption[]>
  tokenControlNotice?: string | null
  livePlayState?: LivePlayConnectionState
  livePlayStatusMessage?: string | null
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
  (event: 'use-maneuver', payload: { id: string; maneuverName?: string | null }): void
  (event: 'use-ability', payload: { id: string; abilityName?: string | null }): void
  (event: 'use-order', payload: { id: string; orderName?: string | null }): void
  (event: 'send-out-pokemon', payload: { trainerId: string; pokemonSlug: string; position: GridAnchor }): void
  (event: 'throw-pokeball', payload: { id: string; pokeballName: string }): void
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
  (event: 'preview-move-vfx', kind: MoveVfxKind): void
  (event: 'preview-all-move-vfx'): void
  (event: 'clear-move-vfx'): void
  (event: 'move-vfx-settled', payload: { nowMs: number }): void
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
  buildCombatLogMessages(props.map?.metadata, {
    maxMessages: COMBAT_LOG_MESSAGE_LIMIT,
    actorAccents: props.spawnedPokemon,
  }),
)
const livePlayStateLabel = computed(() => {
  switch (props.livePlayState) {
    case 'saving-command':
      return 'saving command'
    case 'reconnecting':
      return 'reconnecting'
    case 'reconciling':
      return 'reconciling'
    case 'stale':
      return 'stale revision'
    case 'error':
      return 'attention needed'
    case 'loading':
      return 'loading'
    default:
      return 'ready'
  }
})
const showLivePlaySavingIcon = computed(() => props.livePlayState === 'saving-command')
const livePlaySavingIconLabel = computed(() => (
  props.livePlayStatusMessage ?? 'Sending live-play command to the server.'
))

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
        :smart-terrain-cutaway-enabled="smartTerrainCutawayEnabled"
        :hazard-mode="hazardMode"
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :can-delete-tokens="canDeleteTokens"
        :token-move-options-by-id="tokenMoveOptionsById"
        :token-maneuver-options-by-id="tokenManeuverOptionsById"
        :token-ability-options-by-id="tokenAbilityOptionsById"
        :token-order-options-by-id="tokenOrderOptionsById"
        :token-send-out-options-by-id="tokenSendOutOptionsById"
        :token-pokeball-options-by-id="tokenPokeballOptionsById"
        :move-automation-targeting="moveAutomationTargeting"
        :move-automation-feedback="moveAutomationFeedback"
        :move-animations="moveAnimations ?? []"
        :move-animations-reduced-motion="moveAnimationsReducedMotion === true"
        :attack-of-opportunity-prompts="props.attackOfOpportunityPrompts ?? []"
        @select-pokemon="emit('select-pokemon', $event)"
        @move-pokemon="emit('move-pokemon', $event)"
        @turn-pokemon="emit('turn-pokemon', $event)"
        @delete-pokemon="emit('delete-pokemon', $event)"
        @modify-hp="emit('modify-hp', $event)"
        @modify-combat-stages="emit('modify-combat-stages', $event)"
        @modify-conditions="emit('modify-conditions', $event)"
        @use-move="emit('use-move', $event)"
        @use-maneuver="emit('use-maneuver', $event)"
        @use-ability="emit('use-ability', $event)"
        @use-order="emit('use-order', $event)"
        @send-out-pokemon="emit('send-out-pokemon', $event)"
        @throw-pokeball="emit('throw-pokeball', $event)"
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
        @move-vfx-settled="emit('move-vfx-settled', $event)"
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

      <div
        v-if="props.map && canViewMap && showLivePlaySavingIcon"
        class="live-play-saving-icon"
        role="status"
        aria-live="polite"
      >
        <img src="/map/live-play-saving-icon.png" alt="" aria-hidden="true" />
        <span class="live-play-saving-icon__label">{{ livePlaySavingIconLabel }}</span>
      </div>

      <div
        v-if="props.map && canViewMap && props.livePlayStatusMessage && !showLivePlaySavingIcon"
        class="live-play-state-banner"
        :class="`live-play-state-banner--${props.livePlayState ?? 'ready'}`"
        role="status"
        aria-live="polite"
      >
        <strong>Live play {{ livePlayStateLabel }}.</strong>
        <span>{{ props.livePlayStatusMessage }}</span>
      </div>

      <div
        v-if="props.map && canViewMap && props.tokenControlNotice"
        class="token-control-notice"
        role="status"
        aria-live="polite"
      >
        {{ props.tokenControlNotice }}
      </div>

      <MapCombatLog
        v-if="props.map && canViewMap"
        :messages="combatLogMessages"
      />

      <MapActionSplash
        :splash="props.actionSplash ?? null"
        :speed-lines-duration-ms="props.actionSplashSpeedLinesDurationMs"
      />

      <div v-if="props.moveUsageError" class="move-usage-error" role="status">
        {{ props.moveUsageError }}
      </div>

      <MoveVfxDebugPanel
        v-if="props.map && canViewMap && props.moveVfxDebugHarnessEnabled"
        :selected-id="selectedId"
        :spawned-pokemon="spawnedPokemon"
        :controllable-placement-ids="controllablePlacementIds"
        :active-count="(props.moveAnimations ?? []).length"
        @preview-kind="emit('preview-move-vfx', $event)"
        @preview-all="emit('preview-all-move-vfx')"
        @clear="emit('clear-move-vfx')"
      />

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

.live-play-saving-icon {
  position: absolute;
  z-index: 7;
  top: var(--map-overlay-gutter, 0.75rem);
  left: calc(var(--map-overlay-gutter, 0.75rem) + var(--map-nav-rail-width, 0px) + 0.75rem);
  display: grid;
  width: clamp(2.4rem, 4vw, 3.25rem);
  height: clamp(2.4rem, 4vw, 3.25rem);
  place-items: center;
  overflow: visible;
  border: 0;
  border-radius: 999px;
  background: transparent;
  pointer-events: none;
}

.live-play-saving-icon img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  filter: drop-shadow(0 10px 18px color-mix(in srgb, var(--pokemon-black) 28%, transparent));
  object-fit: cover;
}

.live-play-saving-icon__label {
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .live-play-saving-icon {
    animation: live-play-saving-icon-pulse 0.9s ease-in-out infinite alternate;
  }
}

@keyframes live-play-saving-icon-pulse {
  from {
    opacity: 0.72;
    transform: scale(0.96);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

.live-play-state-banner {
  position: absolute;
  z-index: 7;
  top: var(--map-overlay-gutter, 0.75rem);
  left: 50%;
  display: flex;
  max-width: min(42rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2rem));
  transform: translateX(-50%);
  flex-wrap: wrap;
  gap: 0.35rem 0.55rem;
  align-items: center;
  justify-content: center;
  padding: 0.65rem 0.9rem;
  border: 1px solid color-mix(in srgb, var(--accent) 48%, var(--rule-soft));
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper-soft) 91%, transparent);
  color: color-mix(in srgb, var(--ink-bright) 90%, transparent);
  box-shadow: 0 14px 36px color-mix(in srgb, var(--pokemon-black) 22%, transparent);
  font-size: 0.8rem;
  font-weight: 800;
  line-height: 1.28;
  pointer-events: none;
  text-align: center;
}

.live-play-state-banner--error,
.live-play-state-banner--stale {
  border-color: color-mix(in srgb, var(--bad) 60%, var(--rule-soft));
  color: var(--bad);
}

.live-play-state-banner--reconnecting,
.live-play-state-banner--reconciling,
.live-play-state-banner--saving-command,
.live-play-state-banner--loading {
  border-color: color-mix(in srgb, var(--accent) 62%, var(--rule-soft));
}

.token-control-notice {
  position: absolute;
  z-index: 6;
  top: calc(var(--map-overlay-gutter, 0.75rem) + 6.8rem);
  left: calc(var(--map-overlay-gutter, 0.75rem) + var(--map-nav-rail-width, 0px) + 0.75rem);
  width: min(32rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2.5rem));
  padding: 0.62rem 0.78rem;
  border: 1px solid color-mix(in srgb, var(--accent) 48%, var(--rule-soft));
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--paper-soft) 88%, transparent);
  color: color-mix(in srgb, var(--ink-bright) 88%, transparent);
  box-shadow: 0 14px 36px color-mix(in srgb, var(--pokemon-black) 22%, transparent);
  font-size: 0.78rem;
  font-weight: 850;
  line-height: 1.32;
  pointer-events: none;
}

.move-usage-error {
  position: absolute;
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.6rem));
  left: 50%;
  z-index: 10800;
  max-width: min(32rem, calc(100vw - 2rem));
  transform: translateX(-50%);
  padding: 0.7rem 0.95rem;
  border: 1px solid color-mix(in srgb, var(--bad) 65%, var(--rule-soft));
  border-radius: 999px;
  background: color-mix(in srgb, var(--bad) 18%, var(--paper-soft));
  color: var(--bad);
  box-shadow: 0 14px 40px color-mix(in srgb, var(--pokemon-black) 24%, transparent);
  font-size: 0.86rem;
  font-weight: 900;
  text-align: center;
  pointer-events: none;
}

@media (max-width: 840px) {
  .token-control-notice {
    left: var(--map-overlay-gutter, 0.75rem);
    width: min(30rem, calc(100vw - 1.5rem));
  }
}
</style>
