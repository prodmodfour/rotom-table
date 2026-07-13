<script setup lang="ts">
import { ref } from 'vue'
import IsometricGrid from '~/components/IsometricGrid.client.vue'
import type { BuildTool } from '#shared/mapEditor'
import type { LivePlayPresenceAttentionTarget, LivePlayPresenceGridCell } from '#shared/livePlayPresence'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationFeedbackState,
  MoveAutomationHpUpdate,
  MoveAutomationTargetingOverlayState,
} from '~/types/moveAutomation'
import type { MoveAnimationEvent } from '~/types/moveAnimation'
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
import type { TokenAbilityMenuOption } from '~/utils/mapTokenAbilities'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import type { TokenManeuverMenuOption } from '~/utils/mapTokenManeuvers'
import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import type { TokenSendOutOption } from '~/utils/mapTokenSendOut'
import type { TokenPokeballOption } from '~/utils/pokeballCapture'
import type { MoveAutomationTargetBranchSelectionState } from '~/composables/map-editor/useMoveAutomationPanel'
import type { MapTokenRemoteAttention } from '~/utils/mapPresenceTokenAttention'
import type { MapPresenceIntentOverlay } from '~/utils/mapPresenceIntentOverlays'
import type { IsometricPresencePing } from '~/utils/isometric/pingRenderer'
import type { TokenMovementCommitPayload } from '~/utils/isometric/tokenMovementInteraction'
import type { TokenMotionDebugMetrics } from '~/utils/isometric/tokenMotionDebugMetrics'
import type {
  PendingMoveMovementChoiceReference,
  PendingMoveResponseOptionReference,
} from '~/composables/map-editor/usePendingMoveResponses'

interface IsometricGridHandle {
  focusPokemon: (id: string) => boolean
  focusCell: (cell: LivePlayPresenceGridCell) => boolean
}

defineProps<{
  map: TabletopMap
  spawnedPokemon: SpawnedPokemon[]
  selectedId: string | null
  controllablePlacementIds: string[]
  activeInitiativeId: string | null | undefined
  initiativeRound?: number
  initiativeAutoFocusEnabled?: boolean
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
  tokenMoveOptionsById?: Record<string, TokenMoveMenuOption[]>
  tokenManeuverOptionsById?: Record<string, TokenManeuverMenuOption[]>
  tokenAbilityOptionsById?: Record<string, TokenAbilityMenuOption[]>
  tokenOrderOptionsById?: Record<string, TokenOrderMenuOption[]>
  tokenSendOutOptionsById?: Record<string, TokenSendOutOption[]>
  tokenPokeballOptionsById?: Record<string, TokenPokeballOption[]>
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
  moveAutomationTargeting?: MoveAutomationTargetingOverlayState | null
  moveAutomationTargetBranchSelection?: MoveAutomationTargetBranchSelectionState | null
  moveAutomationFeedback?: MoveAutomationFeedbackState | null
  moveAnimations?: readonly MoveAnimationEvent[]
  moveAnimationsReducedMotion?: boolean
  pendingMoveMovementChoices?: readonly PendingMoveMovementChoiceReference[]
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'hover-pokemon', id: string | null): void
  (event: 'place-presence-ping', payload: { cell: LivePlayPresenceGridCell }): void
  (event: 'request-gm-attention', payload: { target: LivePlayPresenceAttentionTarget }): void
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
  (event: 'choose-pending-move-response', payload: PendingMoveResponseOptionReference): void
  (event: 'move-vfx-settled', payload: { nowMs: number }): void
  (event: 'token-motion-debug-metrics', metrics: TokenMotionDebugMetrics): void
}>()

const gridRef = ref<IsometricGridHandle | null>(null)

const focusPokemon = (id: string): boolean => gridRef.value?.focusPokemon(id) ?? false
const focusCell = (cell: LivePlayPresenceGridCell): boolean => gridRef.value?.focusCell(cell) ?? false

defineExpose({ focusPokemon, focusCell })
</script>

<template>
  <IsometricGrid
    ref="gridRef"
    :dimensions="map.dimensions"
    :pokemons="spawnedPokemon"
    :selected-id="selectedId"
    :controllable-ids="controllablePlacementIds"
    :active-turn-id="activeInitiativeId"
    :initiative-round="initiativeRound"
    :initiative-auto-focus-enabled="initiativeAutoFocusEnabled !== false"
    :voxels="mapVoxels"
    :hazards="mapHazards"
    :field-effects="mapFieldEffects"
    :ground-level-y="mapGroundLevelY"
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
    :pending-move-movement-choices="pendingMoveMovementChoices ?? []"
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
    @choose-pending-move-response="emit('choose-pending-move-response', $event)"
    @move-vfx-settled="emit('move-vfx-settled', $event)"
    @token-motion-debug-metrics="emit('token-motion-debug-metrics', $event)"
  />
</template>
