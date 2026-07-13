<script setup lang="ts">
import { computed, ref } from 'vue'
import MapSceneRenderer from '~/components/map/MapSceneRenderer.vue'
import MapSceneStatus from '~/components/map/MapSceneStatus.vue'
import MapMoveResponsePanel from '~/components/map/MapMoveResponsePanel.vue'
import MoveVfxDebugPanel from '~/components/map/MoveVfxDebugPanel.vue'
import InitiativeInfoBar from '~/components/map/InitiativeInfoBar.vue'
import MapActionSplash from '~/components/map/MapActionSplash.vue'
import MapCombatLog from '~/components/map/MapCombatLog.vue'
import type { BuildTool } from '#shared/mapEditor'
import type { LivePlayPresenceAttentionTarget, LivePlayPresenceGridCell } from '#shared/livePlayPresence'
import type { PendingMoveResponseWindowView } from '#shared/moveAutomation/responseViews'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  GridAnchor,
  LayerVisibility,
  MapFieldEffects,
  MapHazardKind,
  MapHazardV2,
  MapSceneState,
  MapVoxelV2,
  TabletopMap,
  VoxelMaterial,
} from '~/types/map'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationFeedbackState,
  MoveAutomationHpUpdate,
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
import type { MoveAutomationTargetBranchSelectionState } from '~/composables/map-editor/useMoveAutomationPanel'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'
import type { LivePlayConnectionState } from '~/composables/map-editor/useLivePlayStateMachine'
import type {
  PendingMoveResponseOptionReference,
  PendingMoveResponseReference,
  PendingMoveResponseWindowState,
} from '~/composables/map-editor/usePendingMoveResponses'
import type { LivePlayTokenCorrectionNotice } from '~/types/livePlayUi'
import { buildCombatLogMessages } from '~/utils/combatLog'
import type { PreviewState } from '~/utils/gridPreview'
import type { MapTokenRemoteAttention } from '~/utils/mapPresenceTokenAttention'
import type { MapPresenceIntentOverlay } from '~/utils/mapPresenceIntentOverlays'
import type { IsometricPresencePing } from '~/utils/isometric/pingRenderer'
import type { TokenMovementCommitPayload } from '~/utils/isometric/tokenMovementInteraction'
import type { TokenMotionDebugMetrics } from '~/utils/isometric/tokenMotionDebugMetrics'

interface MapSceneRendererHandle {
  focusPokemon: (id: string) => boolean
  focusCell: (cell: LivePlayPresenceGridCell) => boolean
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
  initiativeAutoFocusEnabled?: boolean
  activeScene?: MapSceneState | null
  canManageScene?: boolean
  sceneControlsDisabled?: boolean
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
  moveAutomationTargetBranchSelection?: MoveAutomationTargetBranchSelectionState | null
  moveAutomationFeedback?: MoveAutomationFeedbackState | null
  moveAnimations?: readonly MoveAnimationEvent[]
  moveAnimationsReducedMotion?: boolean
  moveVfxDebugHarnessEnabled?: boolean
  actionSplash?: MapActionSplashState | null
  actionSplashSpeedLinesDurationMs?: number
  moveUsageError?: string | null
  pendingMoveResponseWindows?: readonly PendingMoveResponseWindowView[]
  pendingMoveResponseStateByWindow?: Readonly<Record<string, PendingMoveResponseWindowState>>
  pendingMoveResponseActorLabels?: Readonly<Record<string, string>>
  pendingMoveResponseOwnerLabel?: string
  pendingMoveResponsesLoading?: boolean
  pendingMoveResponsesError?: string | null
  canManagePendingMoveResponses?: boolean
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
  livePlayPendingTokenIds?: string[]
  livePlayPendingConditionsByTokenId?: Readonly<Record<string, readonly string[]>>
  livePlayCorrectionTokenIds?: string[]
  livePlayCorrectionMotionTokenIds?: string[]
  livePlaySnapCorrectionTokenIds?: string[]
  livePlayRemoteAcceptedTokenIds?: string[]
  mapDataRevision?: number
  remoteTokenAttention?: readonly MapTokenRemoteAttention[]
  presencePings?: readonly IsometricPresencePing[]
  presenceIntentOverlays?: readonly MapPresenceIntentOverlay[]
  presenceServerTimeOffsetMs?: number
  canRequestGmAttention?: boolean
  livePlayTokenCorrectionNotice?: LivePlayTokenCorrectionNotice | null
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'hover-pokemon', id: string | null): void
  (event: 'place-presence-ping', payload: { cell: LivePlayPresenceGridCell }): void
  (event: 'request-gm-attention', payload: { target: LivePlayPresenceAttentionTarget }): void
  (event: 'focus-initiative-entry', id: string): void
  (event: 'previous-initiative'): void
  (event: 'next-initiative'): void
  (event: 'start-scene'): void
  (event: 'end-scene'): void
  (event: 'move-pokemon', payload: TokenMovementCommitPayload): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'modify-hp', payload: MoveAutomationHpUpdate): void
  (event: 'modify-combat-stages', payload: { id: string; stages: CombatStageMap }): void
  (event: 'modify-conditions', payload: { id: string; conditions: string[] }): void
  (event: 'grant-experience', payload: { id: string; amount: number }): void
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
  (event: 'confirm-move-target-count'): void
  (event: 'select-move-area-template', templateId: string): void
  (event: 'select-move-area-direction', direction: MoveAutomationAreaDirection): void
  (event: 'aim-move-area', center: GridAnchor): void
  (event: 'select-move-target-branch', branchId: string): void
  (event: 'cancel-move-targeting'): void
  (event: 'preview-move-vfx', kind: MoveVfxKind): void
  (event: 'preview-all-move-vfx'): void
  (event: 'clear-move-vfx'): void
  (event: 'move-vfx-settled', payload: { nowMs: number }): void
  (event: 'choose-pending-move-response', payload: PendingMoveResponseOptionReference): void
  (event: 'pass-pending-move-response', payload: PendingMoveResponseReference): void
  (event: 'force-pass-pending-move-response', payload: PendingMoveResponseReference): void
  (event: 'cancel-pending-move-resolution', resolutionId: string): void
  (event: 'retry-pending-move-response', opId: string): void
  (event: 'refresh-pending-move-responses'): void
  (event: 'use-attack-of-opportunity', payload: { promptId: string; moveName: string }): void
  (event: 'clear-attack-of-opportunity', promptId: string): void
  (event: 'token-motion-debug-metrics', metrics: TokenMotionDebugMetrics): void
}>()

const COMBAT_LOG_MESSAGE_LIMIT = 24

const rendererRef = ref<MapSceneRendererHandle | null>(null)
const combatLogMessages = computed(() =>
  buildCombatLogMessages(props.map?.metadata, {
    maxMessages: COMBAT_LOG_MESSAGE_LIMIT,
    actorAccents: props.spawnedPokemon,
    actorProfiles: props.initiativeRows ?? [],
    scene: props.activeScene ?? null,
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
const showLivePlayStateBanner = computed(() => (
  Boolean(props.livePlayStatusMessage)
  && (props.livePlayState ?? 'ready') !== 'ready'
))
const livePlaySavingIconLabel = computed(() => (
  props.livePlayStatusMessage ?? 'Sending live-play command to the server.'
))
const initiativeControlsEnabled = computed(() => props.canManageInitiative === true)
const activeSceneName = computed(() => props.activeScene?.name?.trim() ?? '')
const hasActiveScene = computed(() => activeSceneName.value.length > 0)
const sceneControlDisabled = computed(() => props.sceneControlsDisabled === true)
const sceneControlLabel = computed(() => (hasActiveScene.value ? 'End Scene' : 'Start Scene'))
const sceneControlAriaLabel = computed(() => (
  hasActiveScene.value ? `End scene ${activeSceneName.value}` : 'Start a new scene'
))

const emitSceneControl = () => {
  if (sceneControlDisabled.value) return
  if (hasActiveScene.value) emit('end-scene')
  else emit('start-scene')
}

const focusPokemon = (id: string): boolean => rendererRef.value?.focusPokemon(id) ?? false
const focusCell = (cell: LivePlayPresenceGridCell): boolean => rendererRef.value?.focusCell(cell) ?? false

defineExpose({ focusPokemon, focusCell })
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
        :initiative-round="initiativeRound"
        :initiative-auto-focus-enabled="initiativeAutoFocusEnabled !== false"
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
        :live-play-pending-token-ids="livePlayPendingTokenIds ?? []"
        :live-play-pending-conditions-by-token-id="livePlayPendingConditionsByTokenId ?? {}"
        :live-play-correction-token-ids="livePlayCorrectionTokenIds ?? []"
        :live-play-correction-motion-token-ids="livePlayCorrectionMotionTokenIds ?? []"
        :live-play-snap-correction-token-ids="livePlaySnapCorrectionTokenIds ?? []"
        :live-play-remote-accepted-token-ids="livePlayRemoteAcceptedTokenIds ?? []"
        :map-data-revision="mapDataRevision ?? 0"
        :remote-token-attention="remoteTokenAttention ?? []"
        :presence-pings="presencePings ?? []"
        :presence-intent-overlays="presenceIntentOverlays ?? []"
        :presence-server-time-offset-ms="presenceServerTimeOffsetMs ?? 0"
        :can-request-gm-attention="canRequestGmAttention === true"
        :move-automation-targeting="moveAutomationTargeting"
        :move-automation-target-branch-selection="moveAutomationTargetBranchSelection"
        :move-automation-feedback="moveAutomationFeedback"
        :move-animations="moveAnimations ?? []"
        :move-animations-reduced-motion="moveAnimationsReducedMotion === true"
        :attack-of-opportunity-prompts="props.attackOfOpportunityPrompts ?? []"
        @select-pokemon="emit('select-pokemon', $event)"
        @hover-pokemon="emit('hover-pokemon', $event)"
        @place-presence-ping="emit('place-presence-ping', $event)"
        @request-gm-attention="emit('request-gm-attention', $event)"
        @move-pokemon="emit('move-pokemon', $event)"
        @turn-pokemon="emit('turn-pokemon', $event)"
        @delete-pokemon="emit('delete-pokemon', $event)"
        @modify-hp="emit('modify-hp', $event)"
        @modify-combat-stages="emit('modify-combat-stages', $event)"
        @modify-conditions="emit('modify-conditions', $event)"
        @grant-experience="emit('grant-experience', $event)"
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
        @confirm-move-target-count="emit('confirm-move-target-count')"
        @select-move-area-template="emit('select-move-area-template', $event)"
        @select-move-area-direction="emit('select-move-area-direction', $event)"
        @aim-move-area="emit('aim-move-area', $event)"
        @select-move-target-branch="emit('select-move-target-branch', $event)"
        @cancel-move-targeting="emit('cancel-move-targeting')"
        @use-attack-of-opportunity="emit('use-attack-of-opportunity', $event)"
        @clear-attack-of-opportunity="emit('clear-attack-of-opportunity', $event)"
        @move-vfx-settled="emit('move-vfx-settled', $event)"
        @token-motion-debug-metrics="emit('token-motion-debug-metrics', $event)"
      />
      <MapSceneStatus v-else :status="status" :error="error" :slug="slug" />

      <InitiativeInfoBar
        v-if="props.map && canViewMap"
        :rows="initiativeRows ?? []"
        :active-id="activeInitiativeId"
        :round="initiativeRound ?? 1"
        :can-manage="initiativeControlsEnabled"
        @focus="emit('focus-initiative-entry', $event)"
        @previous="emit('previous-initiative')"
        @next="emit('next-initiative')"
      />

      <button
        v-if="props.map && canViewMap && props.canManageScene"
        type="button"
        class="scene-control-button"
        :class="{ 'scene-control-button--ending': hasActiveScene }"
        :disabled="sceneControlDisabled"
        :aria-label="sceneControlAriaLabel"
        @click="emitSceneControl"
      >
        {{ sceneControlLabel }}
      </button>

      <div
        v-if="props.map && canViewMap && hasActiveScene"
        class="active-scene-banner"
        role="status"
        aria-live="polite"
      >
        <span class="active-scene-banner__eyebrow">Scene</span>
        <span class="active-scene-banner__name">{{ activeSceneName }}</span>
      </div>

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
        v-if="props.map && canViewMap && showLivePlayStateBanner && !showLivePlaySavingIcon"
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

      <div
        v-if="props.map && canViewMap && props.livePlayTokenCorrectionNotice"
        class="live-play-token-correction-notice"
        role="status"
        aria-live="polite"
      >
        <strong>Correction applied</strong>
        <span>{{ props.livePlayTokenCorrectionNotice.message }}</span>
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

      <MapMoveResponsePanel
        :windows="props.pendingMoveResponseWindows ?? []"
        :state-by-window="props.pendingMoveResponseStateByWindow ?? {}"
        :actor-labels="props.pendingMoveResponseActorLabels ?? {}"
        :eligible-owner-label="props.pendingMoveResponseOwnerLabel ?? 'Eligible participant'"
        :loading="props.pendingMoveResponsesLoading === true"
        :error="props.pendingMoveResponsesError ?? null"
        :can-manage="props.canManagePendingMoveResponses === true"
        @choose="emit('choose-pending-move-response', $event)"
        @pass="emit('pass-pending-move-response', $event)"
        @force-pass="emit('force-pass-pending-move-response', $event)"
        @cancel="emit('cancel-pending-move-resolution', $event)"
        @retry="emit('retry-pending-move-response', $event)"
        @refresh="emit('refresh-pending-move-responses')"
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

.scene-control-button {
  position: absolute;
  z-index: 8;
  top: var(--map-overlay-gutter, 0.75rem);
  left: calc(var(--map-overlay-gutter, 0.75rem) + var(--map-nav-rail-width, 0px) + 0.75rem);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.35rem;
  padding: 0.55rem 0.8rem;
  border: 1px solid color-mix(in srgb, var(--accent) 62%, var(--rule-soft));
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper-soft) 92%, transparent);
  color: var(--ink-bright);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--pokemon-black) 24%, transparent);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.02em;
  line-height: 1;
  pointer-events: auto;
  text-transform: uppercase;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease,
    transform 0.15s ease;
}

.scene-control-button:hover:not(:disabled),
.scene-control-button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, var(--paper-soft));
  color: #ff5c67;
  outline: none;
  transform: translateY(-1px);
}

.scene-control-button:focus-visible {
  outline: 2px solid rgba(var(--accent-rgb), 0.35);
  outline-offset: 3px;
}

.scene-control-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.scene-control-button--ending {
  border-color: color-mix(in srgb, var(--bad) 56%, var(--rule-soft));
}

.active-scene-banner {
  position: absolute;
  z-index: 5;
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.6rem));
  left: 50%;
  display: inline-flex;
  max-width: min(34rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2rem));
  transform: translateX(-50%);
  align-items: center;
  gap: 0.45rem;
  padding: 0.48rem 0.8rem;
  border: 1px solid color-mix(in srgb, var(--accent) 52%, var(--rule-soft));
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper-soft) 88%, transparent);
  color: var(--ink-bright);
  box-shadow: 0 14px 36px color-mix(in srgb, var(--pokemon-black) 20%, transparent);
  font-size: 0.84rem;
  line-height: 1.15;
  pointer-events: none;
  text-align: center;
}

.active-scene-banner__eyebrow {
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 950;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.active-scene-banner__name {
  min-width: 0;
  overflow: hidden;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.live-play-token-correction-notice {
  position: absolute;
  z-index: 7;
  right: var(--map-overlay-gutter, 0.75rem);
  bottom: calc(var(--map-overlay-gutter, 0.75rem) + 1rem);
  display: grid;
  max-width: min(24rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2rem));
  gap: 0.2rem;
  padding: 0.62rem 0.78rem;
  border: 1px solid color-mix(in srgb, var(--bad) 58%, var(--rule-soft));
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--paper-soft) 91%, transparent);
  color: color-mix(in srgb, var(--ink-bright) 90%, transparent);
  box-shadow: 0 14px 36px color-mix(in srgb, var(--pokemon-black) 22%, transparent);
  font-size: 0.78rem;
  font-weight: 850;
  line-height: 1.32;
  pointer-events: none;
}

.live-play-token-correction-notice strong {
  color: var(--bad);
  font-size: 0.68rem;
  font-weight: 950;
  letter-spacing: 0.08em;
  text-transform: uppercase;
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
  .scene-control-button {
    left: var(--map-overlay-gutter, 0.75rem);
  }

  .active-scene-banner {
    max-width: calc(100vw - 1.5rem);
  }

  .token-control-notice {
    left: var(--map-overlay-gutter, 0.75rem);
    width: min(30rem, calc(100vw - 1.5rem));
  }

  .live-play-token-correction-notice {
    right: var(--map-overlay-gutter, 0.75rem);
    left: var(--map-overlay-gutter, 0.75rem);
    max-width: none;
  }
}
</style>
