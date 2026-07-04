import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { isAuthRole, type AuthRole } from '#shared/auth'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayOpId,
  isLivePlayMapCommandType,
  type AdvanceInitiativePayload,
  type BuildTerrainVoxelPayload,
  type DeleteTokenPayload,
  type GrantExperiencePayload,
  type LivePlayCommandAccepted,
  type LivePlayCommandDuplicate,
  type LivePlayCommandRejectionReason,
  type LivePlayCommandResult,
  type LivePlayMapCommandType,
  type LivePlayMapScope,
  type LivePlayScope,
  type LivePlaySheetScope,
  type LivePlayTokenScope,
  type ModifyCombatStagesPayload,
  type ModifyConditionsPayload,
  type ModifyHpPayload,
  type MoveTokenPayload,
  type PlaceHazardPayload,
  type RemoveFieldEffectPayload,
  type RemoveHazardPayload,
  type RemoveTerrainVoxelPayload,
  type ResolveMoveLivePlayCommand,
  type SendOutPokemonPayload,
  type SetFieldEffectPayload,
  type SetInitiativePayload,
  type SetScenePayload,
  type SpawnTokenPayload,
  type ThrowPokeballPayload,
  type TickFieldEffectDurationsPayload,
  type TurnTokenPayload,
  type UseAbilityPayload,
  type UseManeuverPayload,
  type UseMovePayload,
  type UseOrderPayload,
} from '#shared/livePlayCommands'
import { validateTerminalResponseForCommand } from '#shared/livePlayCommandResults'
import { parseLivePlayOperationStatusResponse } from '#shared/livePlayOperationStatus'
import {
  parseLivePlayOperationAbandonmentResponse,
  type LivePlayOperationAbandonmentResponse,
} from '#shared/livePlayOperationAbandonment'
import type { LivePlayAcceptedRealtimeEvent } from '#shared/livePlayRealtimeEvents'
import {
  parseResolveMoveIntent,
  type LivePlayResolvedMoveResult,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { normalizeRevision } from '#shared/sessionRevisions'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import {
  applyLivePlayPredictionToMap,
  buildLivePlayPrediction,
  reapplyLivePlayPredictionToMap,
  rollbackLivePlayPredictionFromMap,
  type LivePlayLocalPrediction,
} from '~/utils/livePlayPredictions'
import { bindPendingLivePlayCommandUnloadWarning } from '~/utils/livePlayCommandUnloadWarning'
import {
  createLivePlayCommandTracer,
  LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES,
  type LivePlayCommandTraceEventDetail,
  type LivePlayCommandTraceEventType,
  type LivePlayCommandTraceMetadata,
  type LivePlayCommandTraceSnapshot,
} from '~/utils/livePlayCommandTrace'
import {
  findLivePlayScopeConflict,
  type LivePlayScopeConflictDescriptor,
} from '~/utils/livePlayScopeConflicts'
import { findLivePlayPredictionConflicts } from '~/utils/livePlayPredictionConflicts'
import type { LivePlayPatchAdoptionContext } from '~/utils/livePlayPatchAdoption'
import {
  createLivePlayCommandOutboxFingerprint,
  getLivePlayCommandOutbox,
  type LivePlayCommandOutbox,
  type LivePlayCommandOutboxAuthContext,
  type LivePlayCommandOutboxEntry,
} from '~/utils/livePlayCommandOutbox'
import { getErrorMessage } from '~/utils/errorMessages'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { extractResolvedMoveResult } from '~/utils/livePlayResolvedMoveResponse'
import { useApiClient } from '~/composables/useApiClient'
import type { AttackOfOpportunityStateUpdatePayload } from '#shared/attackOfOpportunityState'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { StartTurnModalStateUpdatePayload } from '#shared/startTurnModalState'
import type { GridAnchor, MapHazardV2, SheetPlacement, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import type { PokeballCaptureOutcomeEvent } from '~/utils/pokeballCapture'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export type LivePlayCommandStatus = 'idle' | 'saving' | 'error'
export type LivePlayCommandTransportStatus = 'idle' | 'sending'
export type LivePlayCommandOutboxRecoveryStatus = 'idle' | 'loading' | 'retrying' | 'checking' | 'abandoning' | 'synchronizing' | 'error'

export interface LivePlayCommandSheetUpdate {
  kind: 'pokemon' | 'trainer'
  slug: string
  path?: string
  sheet: Record<string, unknown>
}

export type LivePlayCommandResponse = LivePlayCommandResult & {
  path?: string
  map?: TabletopMap
  placement?: SheetPlacement
  sheetUpdates?: LivePlayCommandSheetUpdate[]
  capture?: PokeballCaptureOutcomeEvent
  move?: LivePlayResolvedMoveResult
}

export interface LivePlayCommandDispatchResult {
  readonly dispatched: boolean
  readonly message?: string
  readonly response?: LivePlayCommandResponse
  readonly opId?: string
  readonly uncertain?: boolean
  readonly recoveredByRealtime?: boolean
  readonly outboxError?: string
}

export type LivePlayPendingCommandState = 'queued' | 'sending'

type LivePlayCommandDispatchResolver = (result: LivePlayCommandDispatchResult) => void

interface QueuedMoveTokenCommand {
  readonly opId: string
  readonly placementId: string
  readonly requestPath: typeof MAP_API_PATHS.moveToken
  readonly authContext: LivePlayCommandOutboxAuthContext
  readonly payload: MoveTokenPayload
  body: Record<string, unknown>
  started: boolean
  readonly promise: Promise<LivePlayCommandDispatchResult>
  readonly resolve: LivePlayCommandDispatchResolver
}

interface MoveTokenCoalescingQueue {
  queued: QueuedMoveTokenCommand | null
  sending: QueuedMoveTokenCommand | null
  drainScheduled: boolean
}

export interface LivePlayPendingCommand {
  readonly opId: string
  readonly requestPath: string
  readonly commandType: LivePlayMapCommandType
  readonly baseRevision: number
  readonly scopes: readonly LivePlayScope[]
  readonly body: Readonly<Record<string, unknown>>
  readonly state: LivePlayPendingCommandState
}

export interface LivePlayResolveMoveDispatchResult extends LivePlayCommandDispatchResult {
  /**
   * The original server-generated move result.
   * Null means the durable command was accepted but presentation data
   * could not be validated or recovered.
   */
  readonly move: LivePlayResolvedMoveResult | null
  readonly presentationError?: string
}

export type LivePlayRealtimeAcknowledgementResult =
  | {
      readonly status: 'acknowledged'
      readonly opId: string
    }
  | {
      readonly status: 'not-local'
      readonly opId: string
    }
  | {
      readonly status: 'invalid'
      readonly message: string
    }
  | {
      readonly status: 'error'
      readonly opId?: string
      readonly message: string
    }

export type LivePlayOperationStatusCheckResult =
  | {
      readonly status: 'unknown'
      readonly opId: string
      readonly message: string
    }
  | {
      readonly status: 'accepted'
      readonly opId: string
      readonly response: LivePlayCommandResponse
      readonly message?: string
    }
  | {
      readonly status: 'rejected'
      readonly opId: string
      readonly response: LivePlayCommandResponse
      readonly message?: string
    }
  | {
      readonly status: 'error'
      readonly opId: string
      readonly message: string
    }

export type LivePlayOperationAbandonmentClientResult =
  | {
      readonly status: 'abandoned'
      readonly opId: string
      readonly response: LivePlayOperationAbandonmentResponse
      readonly message: string
    }
  | {
      readonly status: 'accepted'
      readonly opId: string
      readonly response: LivePlayOperationAbandonmentResponse
      readonly commandResponse: LivePlayCommandResponse
      readonly message?: string
    }
  | {
      readonly status: 'rejected'
      readonly opId: string
      readonly response: LivePlayOperationAbandonmentResponse
      readonly commandResponse: LivePlayCommandResponse
      readonly message?: string
    }
  | {
      readonly status: 'error'
      readonly opId: string
      readonly message: string
    }

export interface UseLivePlayCommandsOptions {
  slug: string
  authRole: ReadonlyValueRef<AuthRole | null | undefined>
  playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
  map?: ReadonlyValueRef<TabletopMap | null | undefined>
  mapRevision?: ReadonlyValueRef<number | null | undefined>
  livePlayCommandBlocked?: ReadonlyValueRef<boolean>
  livePlayCommandBlockedMessage?: ReadonlyValueRef<string | null | undefined>
  newCommandBlocked?: ReadonlyValueRef<boolean>
  newCommandBlockedMessage?: ReadonlyValueRef<string | null | undefined>
  applyPersistedMap?: (map: TabletopMap) => void
  applySheetUpdate?: (update: LivePlayCommandSheetUpdate) => void
  requestReconciliation?: (reason: LivePlayCommandReconciliationRequest) => void | Promise<void>
  onCommandStarted?: () => void
  onCommandAccepted?: (response: LivePlayCommandResponse) => void
  onCommandRejected?: (transition: {
    reason?: LivePlayCommandRejectionReason | null
    message: string
    response: LivePlayCommandResponse
  }) => void
  onCommandFailed?: (message: string) => void
  onCommandBlocked?: (message: string) => void
  onCommandErrorCleared?: () => void
  outbox?: LivePlayCommandOutbox
  leaseOwner?: string
}

export interface LivePlayCommandReconciliationRequest {
  request: string
  response: LivePlayCommandResponse
}

export interface UseLivePlayCommandsReturn {
  status: Ref<LivePlayCommandStatus>
  transportStatus: ComputedRef<LivePlayCommandTransportStatus>
  lastError: Ref<string | null>
  outboxEntries: ComputedRef<readonly LivePlayCommandOutboxEntry[]>
  outboxRecoveryStatus: Ref<LivePlayCommandOutboxRecoveryStatus>
  outboxRecoveryError: Ref<string | null>
  pendingCommands: ComputedRef<Readonly<Record<string, LivePlayPendingCommand>>>
  pendingCommandCount: ComputedRef<number>
  pendingPredictions: ComputedRef<Readonly<Record<string, LivePlayLocalPrediction>>>
  commandTraces: ComputedRef<Readonly<Record<string, LivePlayCommandTraceSnapshot>>>
  pendingPredictionCount: ComputedRef<number>
  hasPendingOutboxCommands: ComputedRef<boolean>
  clearError: () => void
  refreshOutboxEntries: () => Promise<readonly LivePlayCommandOutboxEntry[]>
  recoverInterruptedOutboxCommands: () => Promise<readonly LivePlayCommandOutboxEntry[]>
  retryOutboxCommand: (opId: string) => Promise<LivePlayCommandDispatchResult>
  checkOutboxCommandStatus: (opId: string) => Promise<LivePlayOperationStatusCheckResult>
  abandonOutboxCommand: (opId: string) => Promise<LivePlayOperationAbandonmentClientResult>
  acknowledgeAcceptedRealtimeEvent: (
    event: LivePlayAcceptedRealtimeEvent,
  ) => Promise<LivePlayRealtimeAcknowledgementResult>
  beforeLivePlayPatchesApply: (context: LivePlayPatchAdoptionContext) => void
  afterLivePlayPatchesApply: (context: LivePlayPatchAdoptionContext) => void
  spawnToken: (payload: {
    placement: SheetPlacement
  }) => Promise<LivePlayCommandDispatchResult>
  sendOutPokemon: (payload: {
    trainerId: string
    pokemonSlug: string
    tokenId: string
    position: GridAnchor
    facing?: TokenFacingDirection
  }) => Promise<LivePlayCommandDispatchResult>
  deleteToken: (payload: {
    placementId: string
  }) => Promise<LivePlayCommandDispatchResult>
  throwPokeball: (payload: {
    trainerPlacementId: string
    targetPlacementId: string
    pokeballName: string
  }) => Promise<LivePlayCommandDispatchResult>
  moveToken: (payload: {
    placementId: string
    position: GridAnchor
    pathLength?: number | null
  }) => Promise<LivePlayCommandDispatchResult>
  turnToken: (payload: {
    placementId: string
    facing: TokenFacingDirection
  }) => Promise<LivePlayCommandDispatchResult>
  modifyHp: (payload: {
    placementId: string
    currentHp: number
    temporaryHp?: number
    injuries?: number
  }) => Promise<LivePlayCommandDispatchResult>
  modifyCombatStages: (payload: {
    placementId: string
    stages: ModifyCombatStagesPayload['stages']
  }) => Promise<LivePlayCommandDispatchResult>
  modifyConditions: (payload: {
    placementId: string
    action?: ModifyConditionsPayload['action']
    conditions: readonly string[]
  }) => Promise<LivePlayCommandDispatchResult>
  grantExperience: (payload: {
    placementId: string
    amount: number
  }) => Promise<LivePlayCommandDispatchResult>
  useMove: (payload: {
    placementId: string
    moveName: string
  }) => Promise<LivePlayCommandDispatchResult>
  resolveMove: (input: {
    readonly intent: ResolveMoveIntent
    readonly candidateScopePlacementIds?: readonly string[]
  }) => Promise<LivePlayResolveMoveDispatchResult>
  setInitiative: (payload: SetInitiativePayload) => Promise<LivePlayCommandDispatchResult>
  nextInitiative: (payload: AdvanceInitiativePayload) => Promise<LivePlayCommandDispatchResult>
  previousInitiative: (payload: AdvanceInitiativePayload) => Promise<LivePlayCommandDispatchResult>
  placeHazard: (payload: {
    hazard: MapHazardV2
  }) => Promise<LivePlayCommandDispatchResult>
  removeHazard: (payload: {
    cell: RemoveHazardPayload['cell']
  }) => Promise<LivePlayCommandDispatchResult>
  buildTerrainVoxel: (payload: BuildTerrainVoxelPayload) => Promise<LivePlayCommandDispatchResult>
  removeTerrainVoxel: (payload: RemoveTerrainVoxelPayload) => Promise<LivePlayCommandDispatchResult>
  setFieldEffect: (payload: SetFieldEffectPayload) => Promise<LivePlayCommandDispatchResult>
  removeFieldEffect: (payload: RemoveFieldEffectPayload) => Promise<LivePlayCommandDispatchResult>
  tickFieldEffectDurations: (payload?: TickFieldEffectDurationsPayload) => Promise<LivePlayCommandDispatchResult>
  useManeuver: (payload: {
    placementId: string
    maneuverName: string
    targetPlacementId?: string
  }) => Promise<LivePlayCommandDispatchResult>
  useAbility: (payload: {
    placementId: string
    abilityName: string
    targetPlacementId?: string
  }) => Promise<LivePlayCommandDispatchResult>
  useOrder: (payload: {
    placementId: string
    orderName: string
    targetPlacementId?: string
  }) => Promise<LivePlayCommandDispatchResult>
  setScene: (payload: SetScenePayload) => Promise<LivePlayCommandDispatchResult>
  updateAttackOfOpportunity: (payload: AttackOfOpportunityStateUpdatePayload) => Promise<LivePlayCommandDispatchResult>
  updateStartTurnModal: (payload: StartTurnModalStateUpdatePayload) => Promise<LivePlayCommandDispatchResult>
}

type LivePlayClientCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
  | typeof LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS
  | typeof LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_MOVE
  | typeof LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_ABILITY
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_ORDER
  | typeof LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE
  | typeof LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE
  | typeof LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE
  | typeof LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD
  | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD
  | typeof LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL
  | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL
  | typeof LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT
  | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT
  | typeof LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS
  | typeof LIVE_PLAY_COMMAND_TYPES.SET_SCENE
  | typeof LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY
  | typeof LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL

type LivePlayTokenCommandPayload =
  | MoveTokenPayload
  | TurnTokenPayload
  | DeleteTokenPayload
  | ModifyHpPayload
  | ModifyCombatStagesPayload
  | ModifyConditionsPayload
  | GrantExperiencePayload
  | UseMovePayload
  | UseManeuverPayload
  | UseAbilityPayload
  | UseOrderPayload

type LivePlayMapEffectsCommandPayload =
  | PlaceHazardPayload
  | RemoveHazardPayload
  | BuildTerrainVoxelPayload
  | RemoveTerrainVoxelPayload
  | SetFieldEffectPayload
  | RemoveFieldEffectPayload
  | TickFieldEffectDurationsPayload

type LivePlayClientCommandPayload =
  | LivePlayTokenCommandPayload
  | SpawnTokenPayload
  | SendOutPokemonPayload
  | ThrowPokeballPayload
  | SetInitiativePayload
  | AdvanceInitiativePayload
  | LivePlayMapEffectsCommandPayload
  | ResolveMoveLivePlayCommand['payload']
  | SetScenePayload
  | AttackOfOpportunityStateUpdatePayload
  | StartTurnModalStateUpdatePayload
  | Record<string, never>

type LivePlayCommandBodyFactory = (
  authContext: LivePlayCommandOutboxAuthContext,
) => Record<string, unknown>

const livePlayLeaseOwner = (): string => `live-play-command:${getClientId()}`

const LIVE_PLAY_COMMAND_REQUEST_PATHS = new Set<string>([
  MAP_API_PATHS.spawnToken,
  MAP_API_PATHS.sendOutPokemon,
  MAP_API_PATHS.deleteToken,
  MAP_API_PATHS.throwPokeball,
  MAP_API_PATHS.moveToken,
  MAP_API_PATHS.turnToken,
  MAP_API_PATHS.modifyHp,
  MAP_API_PATHS.modifyCombatStages,
  MAP_API_PATHS.modifyConditions,
  MAP_API_PATHS.grantExperience,
  MAP_API_PATHS.useMove,
  MAP_API_PATHS.resolveMove,
  MAP_API_PATHS.setInitiative,
  MAP_API_PATHS.nextInitiative,
  MAP_API_PATHS.previousInitiative,
  MAP_API_PATHS.placeHazard,
  MAP_API_PATHS.removeHazard,
  MAP_API_PATHS.buildTerrainVoxel,
  MAP_API_PATHS.removeTerrainVoxel,
  MAP_API_PATHS.setFieldEffect,
  MAP_API_PATHS.removeFieldEffect,
  MAP_API_PATHS.tickFieldEffectDurations,
  MAP_API_PATHS.useManeuver,
  MAP_API_PATHS.useAbility,
  MAP_API_PATHS.useOrder,
  MAP_API_PATHS.setScene,
  MAP_API_PATHS.updateAttackOfOpportunity,
  MAP_API_PATHS.updateStartTurnModal,
])

const REALTIME_ACKNOWLEDGEMENT_SYNC_MESSAGE =
  'Synchronizing accepted command with the authoritative live table snapshot.'

const SUPERSEDED_MOVE_TOKEN_MESSAGE = 'This token move was superseded by a newer destination before it was sent.'
const CANCELLED_SUPERSEDING_MOVE_TOKEN_MESSAGE =
  'The queued token move was not sent because the previous move did not receive an authoritative acceptance.'

const NON_CONCURRENT_LIVE_PLAY_COMMAND_TYPES = new Set<LivePlayMapCommandType>([
  LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
])

const isNonConcurrentLivePlayCommandType = (commandType: unknown): commandType is LivePlayMapCommandType => (
  isLivePlayMapCommandType(commandType) && NON_CONCURRENT_LIVE_PLAY_COMMAND_TYPES.has(commandType)
)

interface LivePlayPredictionPatchAdoptionSession {
  readonly key: string
  readonly rolledBackOpIds: ReadonlySet<string>
  readonly acceptedPrediction: LivePlayLocalPrediction | null
  readonly conflictingPredictions: readonly LivePlayLocalPrediction[]
  readonly reapplyPredictions: readonly LivePlayLocalPrediction[]
}

interface LivePlayAcceptedResponsePatchHandling {
  readonly handled: boolean
  readonly applied: boolean
  readonly revision?: number
}

const pendingConflictResourceLabel = (descriptor: LivePlayScopeConflictDescriptor): string => {
  if (descriptor.kind === 'token-field') return `this token ${descriptor.field}`
  if (descriptor.kind === 'sheet-field') return `this ${descriptor.sheetKind} sheet ${descriptor.field}`
  if (descriptor.kind === 'map-lane') return `this map ${descriptor.lane} lane`
  if (descriptor.kind === 'terrain-cell') return `terrain cell ${descriptor.x},${descriptor.y},${descriptor.z}`
  return 'this live-play resource'
}

const pendingScopeConflictMessage = (descriptor: LivePlayScopeConflictDescriptor): string => (
  `Another pending command is already changing ${pendingConflictResourceLabel(descriptor)}.`
)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const pokeballCaptureFromAcceptedRealtimeEvent = (
  event: Pick<LivePlayAcceptedRealtimeEvent, 'patches'>,
): PokeballCaptureOutcomeEvent | undefined => {
  for (const patch of event.patches) {
    if (!isRecord(patch.payload)) continue
    const capture = patch.payload.capture
    if (isRecord(capture) && isRecord(capture.result)) return capture as unknown as PokeballCaptureOutcomeEvent
  }
  return undefined
}

const validationIssueSummary = (
  issues: readonly { readonly path: string; readonly message: string }[],
): string => issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const isDuplicateResult = (response: LivePlayCommandResponse): response is LivePlayCommandDuplicate & LivePlayCommandResponse => (
  response.ok === true && 'duplicate' in response && response.duplicate === true
)

const livePlayResponseMessage = (response: LivePlayCommandResponse): string | null => {
  if (!response.ok) return response.message
  if (isDuplicateResult(response) && !response.original.ok) return response.original.message
  return null
}

const livePlayResponseRejectionReason = (response: LivePlayCommandResponse): LivePlayCommandRejectionReason | null => {
  if (!response.ok) return response.reason
  if (isDuplicateResult(response) && !response.original.ok) return response.original.reason
  return null
}

const acceptedLivePlayResponse = (response: LivePlayCommandResponse): boolean => {
  if (!response.ok) return false
  return !isDuplicateResult(response) || response.original.ok
}

const acceptedResultPatches = (response: LivePlayCommandResponse) => {
  if (!response.ok) return []
  if (isDuplicateResult(response)) return response.original.ok ? response.original.patches : []
  return response.patches
}

const acceptedResultRequiresReconciliation = (response: LivePlayCommandResponse): boolean => (
  acceptedResultPatches(response).length > 0
)

const acceptedPatchResult = (response: LivePlayCommandResponse): LivePlayCommandAccepted | null => {
  if (!response.ok) return null
  if (isDuplicateResult(response)) return response.original.ok ? response.original : null
  return response
}

const livePlayResponseCurrentRevision = (response: LivePlayCommandResponse): number | null => {
  if (!response.ok) {
    return typeof response.currentRevision === 'number' ? normalizeRevision(response.currentRevision) : null
  }
  if (isDuplicateResult(response) && !response.original.ok) {
    return typeof response.original.currentRevision === 'number'
      ? normalizeRevision(response.original.currentRevision)
      : null
  }
  return null
}

const rejectionNeedsReconciliation = (
  reason: LivePlayCommandRejectionReason | null,
  response: LivePlayCommandResponse,
  localRevision: number,
): boolean => {
  if (reason === 'stale-revision') return true
  if (reason !== 'conflict') return false
  const currentRevision = livePlayResponseCurrentRevision(response)
  return currentRevision !== null && currentRevision >= localRevision
}

export const useLivePlayCommands = (
  options: UseLivePlayCommandsOptions,
): UseLivePlayCommandsReturn => {
  const { postJson } = useApiClient()
  const outbox = options.outbox ?? getLivePlayCommandOutbox()
  const leaseOwner = options.leaseOwner ?? livePlayLeaseOwner()
  const status = ref<LivePlayCommandStatus>('idle')
  const lastError = ref<string | null>(null)
  const outboxEntrySnapshot = ref<readonly LivePlayCommandOutboxEntry[]>([])
  const outboxRecoveryStatus = ref<LivePlayCommandOutboxRecoveryStatus>('idle')
  const outboxRecoveryError = ref<string | null>(null)
  const pendingCommandRecords = ref<Record<string, LivePlayPendingCommand>>({})
  const localPredictionRecords = ref<Record<string, LivePlayLocalPrediction>>({})
  const commandTraceRecorder = createLivePlayCommandTracer()
  const commandTraceRecords = ref<Readonly<Record<string, LivePlayCommandTraceSnapshot>>>({})
  const pendingCommands = computed<Readonly<Record<string, LivePlayPendingCommand>>>(() => pendingCommandRecords.value)
  const pendingCommandCount = computed(() => Object.keys(pendingCommandRecords.value).length)
  const pendingPredictions = computed<Readonly<Record<string, LivePlayLocalPrediction>>>(() => localPredictionRecords.value)
  const pendingPredictionCount = computed(() => Object.keys(localPredictionRecords.value).length)
  const commandTraces = computed<Readonly<Record<string, LivePlayCommandTraceSnapshot>>>(() => commandTraceRecords.value)
  const transportStatus = computed<LivePlayCommandTransportStatus>(() => (
    status.value === 'saving' || pendingCommandCount.value > 0 ? 'sending' : 'idle'
  ))
  let recoveryRetryActive = false
  let activeSavingOpId: string | null = null
  let activeStatusCheck: Promise<LivePlayOperationStatusCheckResult> | null = null
  let activeStatusCheckOpId: string | null = null
  let activeAbandonment: Promise<LivePlayOperationAbandonmentClientResult> | null = null
  let activeAbandonmentOpId: string | null = null
  const realtimeAcknowledgedResponses = new Map<string, LivePlayCommandResponse>()
  const realtimeAcknowledgementFailures = new Map<string, string>()
  const realtimeAcknowledgementAdoptions = new Map<string, Promise<string | undefined>>()
  let activePredictionPatchAdoptionSession: LivePlayPredictionPatchAdoptionSession | null = null

  if (getCurrentScope()) {
    const removePendingCommandUnloadWarning = bindPendingLivePlayCommandUnloadWarning(() => transportStatus.value === 'sending')
    onScopeDispose(() => {
      removePendingCommandUnloadWarning?.()
    })
  }

  const clearError = () => {
    if (status.value === 'error') status.value = 'idle'
    lastError.value = null
    options.onCommandErrorCleared?.()
  }

  const beginSavingOperation = (opId: string | null): void => {
    activeSavingOpId = opId
    status.value = 'saving'
    lastError.value = null
  }

  const clearSavingOperation = (opId: string): void => {
    if (activeSavingOpId === opId) activeSavingOpId = null
  }

  const settleSavingStatusIfIdle = (): void => {
    if (
      status.value === 'saving'
      && activeSavingOpId === null
      && Object.keys(pendingCommandRecords.value).length === 0
    ) {
      status.value = 'idle'
    }
  }

  const commandCompletionBelongsToCurrentOperation = (opId: string): boolean => (
    activeSavingOpId === null || activeSavingOpId === opId
  )

  const removePendingCommand = (opId: string): void => {
    if (!pendingCommandRecords.value[opId]) return
    const next = { ...pendingCommandRecords.value }
    delete next[opId]
    pendingCommandRecords.value = next
  }

  const removeLocalPrediction = (opId: string): void => {
    if (!localPredictionRecords.value[opId]) return
    const next = { ...localPredictionRecords.value }
    delete next[opId]
    localPredictionRecords.value = next
  }

  const rollbackLocalPrediction = (opId: string): void => {
    const prediction = localPredictionRecords.value[opId]
    if (!prediction) return
    rollbackLivePlayPredictionFromMap(options.map?.value, prediction)
    removeLocalPrediction(opId)
    recordCommandRollbackTrace(prediction)
  }

  const sameGridAnchor = (left: GridAnchor, right: GridAnchor): boolean => (
    left.x === right.x && left.y === right.y && left.z === right.z
  )

  const placementHasOwnField = (placement: SheetPlacement, field: 'facing' | 'turned'): boolean => (
    Object.prototype.hasOwnProperty.call(placement, field)
  )

  const localPredictionCurrentlyApplied = (prediction: LivePlayLocalPrediction): boolean => {
    const placement = options.map?.value?.placements.find((candidate) => candidate.id === prediction.placementId)
    if (!placement) return false

    for (const field of prediction.changedFields) {
      if (field === 'position') {
        if (!sameGridAnchor(placement.position, prediction.predictedPlacement.position)) return false
      } else if (
        placementHasOwnField(placement, field) !== placementHasOwnField(prediction.predictedPlacement, field)
        || placement[field] !== prediction.predictedPlacement[field]
      ) {
        return false
      }
    }

    return true
  }

  const rollbackLocalPredictionIfCurrentlyApplied = (opId: string): void => {
    const prediction = localPredictionRecords.value[opId]
    if (!prediction) return
    const applied = localPredictionCurrentlyApplied(prediction)
    if (applied) rollbackLivePlayPredictionFromMap(options.map?.value, prediction)
    removeLocalPrediction(opId)
    recordCommandRollbackTrace(prediction, { applied })
  }

  const confirmLocalPrediction = (opId: string): void => {
    removeLocalPrediction(opId)
  }

  const markOperationAccepted = (opId: string): void => {
    if (commandCompletionBelongsToCurrentOperation(opId)) {
      status.value = 'idle'
      lastError.value = null
    }
    confirmLocalPrediction(opId)
    removePendingCommand(opId)
    clearSavingOperation(opId)
    recordCommandTraceEvent(
      { opId },
      LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CONFIRMED,
      undefined,
      { once: true },
    )
  }

  const markOperationFailed = (opId: string | null, message: string): void => {
    if (opId === null || commandCompletionBelongsToCurrentOperation(opId)) {
      status.value = 'error'
      lastError.value = message
    }
    if (opId !== null) {
      rollbackLocalPrediction(opId)
      removePendingCommand(opId)
      clearSavingOperation(opId)
    }
  }

  const blockedCommandMessage = (): string | null => {
    if (!options.livePlayCommandBlocked?.value) return null
    return options.livePlayCommandBlockedMessage?.value
      ?? 'Live-play commands are paused until realtime reconciliation completes'
  }

  const newCommandBlockedMessage = (): string | null => {
    if (!options.newCommandBlocked?.value) return null
    return options.newCommandBlockedMessage?.value
      ?? 'Live-play commands are paused until durable command recovery completes'
  }

  const realtimeAcknowledgementBlockedMessage = (): string | null => (
    outboxRecoveryStatus.value === 'synchronizing'
      ? REALTIME_ACKNOWLEDGEMENT_SYNC_MESSAGE
      : null
  )

  const localInFlightCommandBlockedMessage = (): string | null => {
    if (activeAbandonment !== null) {
      return 'A live-play command abandonment is already active. Wait for it to finish before sending another command.'
    }
    if (recoveryRetryActive) return 'A live-play command is already in flight.'
    return null
  }

  const profileBody = (authContext: LivePlayCommandOutboxAuthContext): { profileId?: PlayerProfileId } => {
    if (authContext.role !== 'player') return {}
    return authContext.profileId ? { profileId: authContext.profileId } : {}
  }

  const tokenScope = (payload: LivePlayTokenCommandPayload, field: LivePlayTokenScope['field']): LivePlayTokenScope => ({
    kind: 'token',
    placementId: payload.placementId,
    field,
  })

  const mapScope = (lane: LivePlayMapScope['lane']): LivePlayMapScope => ({
    kind: 'map',
    lane,
  })

  const placementForPayload = (payload: LivePlayTokenCommandPayload): SheetPlacement | null => (
    options.map?.value?.placements.find((placement) => placement.id === payload.placementId) ?? null
  )

  const sheetScopeForPlacementId = (
    placementId: string,
    field: string,
  ): LivePlaySheetScope | null => {
    const placement = options.map?.value?.placements.find((candidate) => candidate.id === placementId) ?? null
    if (!placement) return null
    return {
      kind: 'sheet',
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      field,
    }
  }

  const sheetScope = (
    payload: LivePlayTokenCommandPayload,
    field: string,
  ): LivePlaySheetScope | null => sheetScopeForPlacementId(payload.placementId, field)

  const currentCommandBaseRevision = (): number => Math.max(
    normalizeRevision(options.mapRevision?.value),
    normalizeRevision(options.map?.value?.revision),
  )

  const commandBody = (
    authContext: LivePlayCommandOutboxAuthContext,
    type: LivePlayClientCommandType,
    payload: LivePlayClientCommandPayload,
    scopes: readonly LivePlayScope[],
    commandOptions: { readonly opId?: string; readonly baseRevision?: number } = {},
  ): Record<string, unknown> => ({
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: commandOptions.opId ?? createLivePlayOpId(),
    mapSlug: options.slug,
    baseRevision: commandOptions.baseRevision ?? currentCommandBaseRevision(),
    type,
    scopes,
    payload,
    clientId: getClientId(),
    ...profileBody(authContext),
  })

  const tokenCommandBody = (
    authContext: LivePlayCommandOutboxAuthContext,
    type: typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
    payload: MoveTokenPayload | TurnTokenPayload,
    field: LivePlayTokenScope['field'],
    commandOptions: { readonly opId?: string; readonly baseRevision?: number } = {},
  ): Record<string, unknown> => commandBody(authContext, type, payload, [tokenScope(payload, field)], commandOptions)

  const moveTokenCommandBody = (
    authContext: LivePlayCommandOutboxAuthContext,
    payload: MoveTokenPayload,
    commandOptions: { readonly opId?: string; readonly baseRevision?: number } = {},
  ): Record<string, unknown> => tokenCommandBody(
    authContext,
    LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    payload,
    'position',
    commandOptions,
  )

  const sheetCommandBody = (
    authContext: LivePlayCommandOutboxAuthContext,
    type: typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS | typeof LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
    payload: ModifyHpPayload | ModifyCombatStagesPayload | ModifyConditionsPayload | GrantExperiencePayload,
    field: LivePlayTokenScope['field'],
    sheetField: string,
  ): Record<string, unknown> => {
    const sheet = sheetScope(payload, sheetField)
    return commandBody(authContext, type, payload, [
      tokenScope(payload, field),
      ...(sheet ? [sheet] : []),
    ])
  }

  const tableActionCommandBody = (
    authContext: LivePlayCommandOutboxAuthContext,
    type: typeof LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER | typeof LIVE_PLAY_COMMAND_TYPES.USE_ABILITY | typeof LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
    payload: UseManeuverPayload | UseAbilityPayload | UseOrderPayload,
  ): Record<string, unknown> => {
    const sheetScopes = type === LIVE_PLAY_COMMAND_TYPES.USE_ABILITY
      ? [
          sheetScopeForPlacementId(payload.placementId, 'ability'),
          ...(payload.targetPlacementId ? [sheetScopeForPlacementId(payload.targetPlacementId, 'ability')] : []),
        ].filter((scope): scope is LivePlaySheetScope => scope !== null)
      : []
    return commandBody(authContext, type, payload, [
      tokenScope(payload, 'action'),
      mapScope('metadata'),
      ...sheetScopes,
    ])
  }

  const resultOpId = (metadata: Omit<LivePlayCommandDispatchResult, 'dispatched' | 'message'>): string | null => (
    typeof metadata.opId === 'string' ? metadata.opId : null
  )

  const localCommandBlockedResult = (
    message: string,
    metadata: Omit<LivePlayCommandDispatchResult, 'dispatched' | 'message'> = {},
  ): LivePlayCommandDispatchResult => {
    markOperationFailed(resultOpId(metadata), message)
    options.onCommandBlocked?.(message)
    return { dispatched: false, message, ...metadata }
  }

  const localCommandFailedResult = (
    message: string,
    metadata: Omit<LivePlayCommandDispatchResult, 'dispatched' | 'message'> = {},
  ): LivePlayCommandDispatchResult => {
    markOperationFailed(resultOpId(metadata), message)
    options.onCommandFailed?.(message)
    return { dispatched: false, message, ...metadata }
  }

  const currentAuthContext = (): LivePlayCommandOutboxAuthContext | null => {
    const role = options.authRole.value
    if (!isAuthRole(role)) return null
    if (role === 'gm') return { role: 'gm', profileId: null }
    return { role: 'player', profileId: options.playerProfileId?.value ?? null }
  }

  const validateCommandBodyAuthContext = (
    body: Record<string, unknown>,
    authContext: LivePlayCommandOutboxAuthContext,
  ): string | null => {
    const hasProfileId = Object.prototype.hasOwnProperty.call(body, 'profileId')
    if (authContext.role === 'gm') {
      return hasProfileId
        ? 'GM live-play command bodies must not contain a profile ID.'
        : null
    }

    const expectedProfileId = authContext.profileId ?? null
    if (expectedProfileId === null) {
      return hasProfileId
        ? 'Unprofiled player live-play command bodies must not contain a profile ID.'
        : null
    }

    return body.profileId === expectedProfileId
      ? null
      : 'Player live-play command body profile ID must match the durable outbox auth context.'
  }

  const authContextsEqual = (
    left: LivePlayCommandOutboxAuthContext,
    right: LivePlayCommandOutboxAuthContext,
  ): boolean => left.role === right.role && (left.profileId ?? null) === (right.profileId ?? null)

  const isStoredLivePlayCommandRequestPath = (requestPath: string): boolean => {
    if (typeof requestPath !== 'string') return false
    if (!requestPath.startsWith('/api/')) return false
    if (requestPath.includes('?') || requestPath.includes('#')) return false
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(requestPath) || requestPath.startsWith('//') || requestPath.includes('://')) return false
    if (/\p{C}/u.test(requestPath)) return false
    return LIVE_PLAY_COMMAND_REQUEST_PATHS.has(requestPath)
  }

  const entryMatchesAuthContext = (
    entry: LivePlayCommandOutboxEntry,
    authContext: LivePlayCommandOutboxAuthContext,
  ): boolean => entry.mapSlug === options.slug && authContextsEqual(entry.authContext, authContext)

  const entryMatchesCurrentContext = (entry: LivePlayCommandOutboxEntry): boolean => {
    const authContext = currentAuthContext()
    return authContext !== null && entryMatchesAuthContext(entry, authContext)
  }

  const outboxEntries = computed<readonly LivePlayCommandOutboxEntry[]>(() => (
    outboxEntrySnapshot.value.filter(entryMatchesCurrentContext)
  ))
  const hasPendingOutboxCommands = computed(() => outboxEntries.value.length > 0)

  const commandEnvelopeOpId = (body: Record<string, unknown>): string | null => (
    typeof body.opId === 'string' ? body.opId : null
  )

  const resourceIdentifierSuffix = (value: string): string => {
    const normalized = value.trim()
    if (!normalized) return 'unknown'
    const suffix = normalized.slice(-6)
    return `…${suffix}`
  }

  const scopeResourceSummary = (scope: Record<string, unknown>): string | null => {
    if (scope.kind === 'token' && typeof scope.placementId === 'string' && typeof scope.field === 'string') {
      return `token ${resourceIdentifierSuffix(scope.placementId)} ${scope.field}`
    }
    if (scope.kind === 'map' && typeof scope.lane === 'string') return `map ${scope.lane}`
    if (scope.kind === 'sheet' && typeof scope.sheetKind === 'string' && typeof scope.field === 'string') {
      return `${scope.sheetKind} sheet ${scope.field}`
    }
    return null
  }

  const livePlayCommandResourceSummary = (body: Record<string, unknown>): string | undefined => {
    if (!Array.isArray(body.scopes)) return undefined
    const summaries = body.scopes
      .filter(isRecord)
      .map(scopeResourceSummary)
      .filter((summary): summary is string => summary !== null)
    if (summaries.length === 0) return undefined

    const uniqueSummaries = [...new Set(summaries)]
    const visibleSummaries = uniqueSummaries.slice(0, 3)
    const remaining = uniqueSummaries.length - visibleSummaries.length
    return remaining > 0
      ? `${visibleSummaries.join(', ')} +${remaining} more`
      : visibleSummaries.join(', ')
  }

  const pendingCommandFromBody = (
    requestPath: string,
    body: Record<string, unknown>,
    state: LivePlayPendingCommandState,
    fallbackCommandType?: LivePlayMapCommandType,
  ): LivePlayPendingCommand | null => {
    const opId = commandEnvelopeOpId(body)
    const commandType = isLivePlayMapCommandType(body.type) ? body.type : fallbackCommandType
    if (!opId || !commandType) return null
    return {
      opId,
      requestPath,
      commandType,
      baseRevision: normalizeRevision(body.baseRevision),
      scopes: Array.isArray(body.scopes) ? [...body.scopes] as LivePlayScope[] : [],
      body,
      state,
    }
  }

  const pendingCommandFromEntry = (
    entry: LivePlayCommandOutboxEntry,
    state: LivePlayPendingCommandState,
  ): LivePlayPendingCommand | null => pendingCommandFromBody(
    entry.requestPath,
    entry.body,
    state,
    isLivePlayMapCommandType(entry.commandType) ? entry.commandType : undefined,
  )

  const bodyCommandType = (body: Record<string, unknown>): LivePlayMapCommandType | null => (
    isLivePlayMapCommandType(body.type) ? body.type : null
  )

  const commandTraceMetadataFromBody = (
    requestPath: string | undefined,
    body: Record<string, unknown>,
  ): LivePlayCommandTraceMetadata | null => {
    const opId = commandEnvelopeOpId(body)
    if (!opId) return null
    const commandType = bodyCommandType(body) ?? undefined
    const baseRevision = typeof body.baseRevision === 'number' ? normalizeRevision(body.baseRevision) : undefined
    const resourceSummary = livePlayCommandResourceSummary(body)
    return {
      opId,
      ...(requestPath === undefined ? {} : { requestPath }),
      ...(commandType === undefined ? {} : { commandType }),
      ...(baseRevision === undefined ? {} : { baseRevision }),
      ...(resourceSummary === undefined ? {} : { resourceSummary }),
    }
  }

  const commandTraceMetadataFromPendingCommand = (
    command: LivePlayPendingCommand,
  ): LivePlayCommandTraceMetadata => {
    const resourceSummary = livePlayCommandResourceSummary(command.body)
    return {
      opId: command.opId,
      requestPath: command.requestPath,
      commandType: command.commandType,
      baseRevision: command.baseRevision,
      ...(resourceSummary === undefined ? {} : { resourceSummary }),
    }
  }

  const commandTraceMetadataFromEntry = (
    entry: LivePlayCommandOutboxEntry,
  ): LivePlayCommandTraceMetadata => {
    const resourceSummary = livePlayCommandResourceSummary(entry.body)
    return {
      opId: entry.opId,
      requestPath: entry.requestPath,
      ...(isLivePlayMapCommandType(entry.commandType) ? { commandType: entry.commandType } : {}),
      ...(typeof entry.body.baseRevision === 'number' ? { baseRevision: normalizeRevision(entry.body.baseRevision) } : {}),
      ...(resourceSummary === undefined ? {} : { resourceSummary }),
    }
  }

  const commandTraceMetadataFromResponse = (
    response: LivePlayCommandResponse,
  ): LivePlayCommandTraceMetadata | null => (
    typeof response.opId === 'string' ? { opId: response.opId } : null
  )

  const recordCommandTraceEvent = (
    metadata: LivePlayCommandTraceMetadata | null,
    event: LivePlayCommandTraceEventType,
    detail?: LivePlayCommandTraceEventDetail,
    traceOptions: { readonly once?: boolean } = {},
  ): void => {
    if (!metadata) return
    if (traceOptions.once && commandTraceRecorder.hasEvent(metadata.opId, event)) return
    commandTraceRecorder.record({ ...metadata, event, ...(detail === undefined ? {} : { detail }) })
    commandTraceRecords.value = commandTraceRecorder.snapshot()
  }

  const recordCommandBuiltTrace = (
    requestPath: string,
    body: Record<string, unknown>,
  ): void => {
    recordCommandTraceEvent(
      commandTraceMetadataFromBody(requestPath, body),
      LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.BUILT,
    )
  }

  const recordCommandPredictionTrace = (command: LivePlayPendingCommand): void => {
    recordCommandTraceEvent(
      commandTraceMetadataFromPendingCommand(command),
      LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PREDICTED,
    )
  }

  const recordCommandRollbackTrace = (
    prediction: LivePlayLocalPrediction,
    detail?: LivePlayCommandTraceEventDetail,
  ): void => {
    recordCommandTraceEvent(
      {
        opId: prediction.opId,
        commandType: prediction.commandType,
        baseRevision: prediction.baseRevision,
      },
      LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.ROLLED_BACK,
      detail,
    )
  }

  const localPendingCommandBlockedMessage = (
    body: Record<string, unknown>,
    options: { readonly ignoredOpIds?: ReadonlySet<string> } = {},
  ): string | null => {
    const pendingCommands = Object.values(pendingCommandRecords.value).filter((command) => (
      !options.ignoredOpIds?.has(command.opId)
    ))
    if (pendingCommands.length === 0) return null

    const commandType = bodyCommandType(body)
    if (isNonConcurrentLivePlayCommandType(commandType)) {
      return `${commandType} waits for all pending live-play commands to finish before it can be sent.`
    }

    const nonConcurrentPendingCommand = pendingCommands.find((command) => (
      isNonConcurrentLivePlayCommandType(command.commandType)
    ))
    if (nonConcurrentPendingCommand) {
      return `Pending ${nonConcurrentPendingCommand.commandType} must finish before another live-play command can be sent.`
    }

    const scopes = Array.isArray(body.scopes) ? body.scopes as LivePlayScope[] : []
    for (const pendingCommand of pendingCommands) {
      const conflict = findLivePlayScopeConflict(
        { scopes, command: body },
        { scopes: pendingCommand.scopes, command: pendingCommand.body },
      )
      if (conflict) return pendingScopeConflictMessage(conflict.left)
    }

    return null
  }

  const trackLocalPrediction = (command: LivePlayPendingCommand): void => {
    if (localPredictionRecords.value[command.opId]) return
    const prediction = buildLivePlayPrediction({
      map: options.map?.value,
      command: command.body,
    })
    if (!prediction) return

    const result = applyLivePlayPredictionToMap(options.map?.value, prediction)
    if (!result.ok) return

    localPredictionRecords.value = {
      ...localPredictionRecords.value,
      [command.opId]: prediction,
    }
    recordCommandPredictionTrace(command)
  }

  const trackPendingCommand = (command: LivePlayPendingCommand | null): void => {
    if (!command) return
    pendingCommandRecords.value = {
      ...pendingCommandRecords.value,
      [command.opId]: command,
    }
    trackLocalPrediction(command)
  }

  const trackPendingCommandBody = (
    requestPath: string,
    body: Record<string, unknown>,
    state: LivePlayPendingCommandState,
  ): void => {
    trackPendingCommand(pendingCommandFromBody(requestPath, body, state))
  }

  const trackPendingCommandEntry = (
    entry: LivePlayCommandOutboxEntry,
    state: LivePlayPendingCommandState,
  ): void => {
    trackPendingCommand(pendingCommandFromEntry(entry, state))
  }

  const predictionPatchAdoptionSessionKey = (context: LivePlayPatchAdoptionContext): string => (
    `${context.mapSlug}:${context.opId ?? 'remote'}:${context.previousRevision}->${context.nextRevision}:${context.patches.length}`
  )

  const addPredictionTokenScopeIfMissing = (
    scopes: LivePlayScope[],
    prediction: LivePlayLocalPrediction,
    field: LivePlayTokenScope['field'],
  ): void => {
    if (scopes.some((scope) => (
      scope.kind === 'token'
      && scope.placementId === prediction.placementId
      && scope.field === field
    ))) return
    scopes.push({ kind: 'token', placementId: prediction.placementId, field })
  }

  const predictionRebaseConflictScopes = (prediction: LivePlayLocalPrediction): readonly LivePlayScope[] => {
    const scopes = [...prediction.scopes]
    for (const field of prediction.changedFields) {
      addPredictionTokenScopeIfMissing(scopes, prediction, field === 'position' ? 'position' : 'facing')
    }
    return scopes
  }

  const pendingPredictionsForPatchAdoption = (
    context: LivePlayPatchAdoptionContext,
  ): readonly LivePlayLocalPrediction[] => Object.values(localPredictionRecords.value).filter((prediction) => (
    prediction.mapSlug === context.mapSlug
  ))

  const rollbackPredictionForPatchAdoption = (prediction: LivePlayLocalPrediction): boolean => {
    if (!localPredictionCurrentlyApplied(prediction)) return false
    const result = rollbackLivePlayPredictionFromMap(options.map?.value, prediction)
    if (!result.ok) throw new Error(result.message)
    return true
  }

  const conflictOpIdsForPatchAdoption = (
    context: LivePlayPatchAdoptionContext,
    predictions: readonly LivePlayLocalPrediction[],
  ): ReadonlySet<string> => {
    const conflictCandidates = predictions
      .filter((prediction) => prediction.opId !== context.opId)
      .map((prediction) => ({
        ...prediction,
        scopes: predictionRebaseConflictScopes(prediction),
        command: prediction,
      }))
    const summary = findLivePlayPredictionConflicts({
      pendingPredictions: conflictCandidates,
      patches: context.patches,
    })
    return new Set(summary.conflicts.map((conflict) => conflict.opId))
  }

  const predictionConflictResponse = (
    prediction: LivePlayLocalPrediction,
    context: LivePlayPatchAdoptionContext,
    message: string,
  ): LivePlayCommandResponse => ({
    ok: false,
    opId: prediction.opId,
    mapSlug: context.mapSlug,
    reason: 'conflict',
    message,
    currentRevision: context.nextRevision,
  })

  const notifyPredictionCorrectedByAuthoritativePatch = (
    prediction: LivePlayLocalPrediction,
    context: LivePlayPatchAdoptionContext,
  ): void => {
    const message = 'A newer authoritative live-play update corrected a local prediction before this command finished.'
    options.onCommandRejected?.({
      reason: 'conflict',
      message,
      response: predictionConflictResponse(prediction, context, message),
    })
  }

  const beforeLivePlayPatchesApply: UseLivePlayCommandsReturn['beforeLivePlayPatchesApply'] = (context) => {
    activePredictionPatchAdoptionSession = null
    const predictions = pendingPredictionsForPatchAdoption(context)
    if (predictions.length === 0) return

    const acceptedPrediction = context.opId === undefined
      ? null
      : predictions.find((prediction) => prediction.opId === context.opId) ?? null
    const conflictOpIds = conflictOpIdsForPatchAdoption(context, predictions)
    const rolledBackOpIds = new Set<string>()
    for (const prediction of predictions) {
      if (rollbackPredictionForPatchAdoption(prediction)) rolledBackOpIds.add(prediction.opId)
    }

    activePredictionPatchAdoptionSession = {
      key: predictionPatchAdoptionSessionKey(context),
      rolledBackOpIds,
      acceptedPrediction,
      conflictingPredictions: predictions.filter((prediction) => conflictOpIds.has(prediction.opId)),
      reapplyPredictions: predictions.filter((prediction) => (
        rolledBackOpIds.has(prediction.opId)
        && prediction.opId !== acceptedPrediction?.opId
        && !conflictOpIds.has(prediction.opId)
      )),
    }
  }

  const afterLivePlayPatchesApply: UseLivePlayCommandsReturn['afterLivePlayPatchesApply'] = (context) => {
    const session = activePredictionPatchAdoptionSession
    activePredictionPatchAdoptionSession = null
    if (!session || session.key !== predictionPatchAdoptionSessionKey(context)) return

    if (session.acceptedPrediction) removeLocalPrediction(session.acceptedPrediction.opId)

    for (const prediction of session.conflictingPredictions) {
      removeLocalPrediction(prediction.opId)
      recordCommandRollbackTrace(prediction, {
        applied: session.rolledBackOpIds.has(prediction.opId),
        reason: 'authoritative-conflict',
        revision: context.nextRevision,
      })
      notifyPredictionCorrectedByAuthoritativePatch(prediction, context)
    }

    for (const prediction of session.reapplyPredictions) {
      if (!localPredictionRecords.value[prediction.opId]) continue
      const result = reapplyLivePlayPredictionToMap(options.map?.value, prediction)
      if (!result.ok) {
        removeLocalPrediction(prediction.opId)
        recordCommandRollbackTrace(prediction, {
          applied: false,
          reason: `reapply-${result.reason}`,
          revision: context.nextRevision,
        })
        throw new Error(result.message)
      }
    }
  }

  const outboxErrorMessage = (error: unknown): string => (
    getErrorMessage(error, { fallback: 'Durable live-play command storage failed' })
  )

  const combineOutboxWarnings = (
    ...warnings: readonly (string | null | undefined)[]
  ): string | undefined => {
    const messages = warnings.filter((warning): warning is string => (
      typeof warning === 'string' && warning.trim().length > 0
    ))
    return messages.length === 0 ? undefined : messages.join(' ')
  }

  const outboxRefreshAuthErrorMessage = (): string => (
    'A valid GM or player auth role is required before refreshing durable live-play command recovery entries.'
  )

  const outboxRefreshFailureMessage = (error: unknown): string => (
    `Failed to refresh durable live-play command recovery entries: ${outboxErrorMessage(error)}`
  )

  const setOutboxRecoveryFailure = (message: string): void => {
    outboxRecoveryStatus.value = 'error'
    outboxRecoveryError.value = message
  }

  const replaceOutboxEntriesForCurrentContext = (
    entries: readonly LivePlayCommandOutboxEntry[],
  ): readonly LivePlayCommandOutboxEntry[] => {
    outboxEntrySnapshot.value = entries
    return outboxEntries.value
  }

  const removeAcknowledgedEntryFromSnapshot = (opId: string): void => {
    outboxEntrySnapshot.value = outboxEntrySnapshot.value.filter((entry) => entry.opId !== opId)
  }

  const listCurrentOutboxEntries = async (
    authContext: LivePlayCommandOutboxAuthContext,
  ): Promise<readonly LivePlayCommandOutboxEntry[]> => outbox.list({
    mapSlug: options.slug,
    authContext,
  })

  const refreshOutboxEntriesQuiet = async (
    options: { readonly preserveRecoveryError?: boolean } = {},
  ): Promise<string | undefined> => {
    const authContext = currentAuthContext()
    if (!authContext) {
      const message = outboxRefreshAuthErrorMessage()
      outboxEntrySnapshot.value = []
      setOutboxRecoveryFailure(message)
      return message
    }

    try {
      replaceOutboxEntriesForCurrentContext(await listCurrentOutboxEntries(authContext))
      if (outboxRecoveryStatus.value === 'error' && !options.preserveRecoveryError) {
        outboxRecoveryStatus.value = 'idle'
        outboxRecoveryError.value = null
      }
      return undefined
    } catch (error) {
      const message = outboxRefreshFailureMessage(error)
      setOutboxRecoveryFailure(message)
      return message
    }
  }

  const refreshOutboxEntries: UseLivePlayCommandsReturn['refreshOutboxEntries'] = async () => {
    if (activeAbandonment !== null) {
      await activeAbandonment.catch(() => undefined)
      return outboxEntries.value
    }

    outboxRecoveryStatus.value = 'loading'
    outboxRecoveryError.value = null

    const authContext = currentAuthContext()
    if (!authContext) {
      const message = outboxRefreshAuthErrorMessage()
      outboxEntrySnapshot.value = []
      setOutboxRecoveryFailure(message)
      throw new Error(message)
    }

    try {
      const entries = replaceOutboxEntriesForCurrentContext(await listCurrentOutboxEntries(authContext))
      outboxRecoveryStatus.value = 'idle'
      outboxRecoveryError.value = null
      return entries
    } catch (error) {
      const message = outboxRefreshFailureMessage(error)
      setOutboxRecoveryFailure(message)
      throw new Error(message, { cause: error })
    }
  }

  const markClaimedEntryUncertain = async (
    entry: LivePlayCommandOutboxEntry,
    error: string,
  ): Promise<string | undefined> => {
    let markWarning: string | undefined
    try {
      await outbox.markUncertain({ opId: entry.opId, leaseOwner, error })
    } catch (markError) {
      markWarning = getErrorMessage(markError, {
        fallback: `Failed to mark live-play operation ${entry.opId} as uncertain`,
      })
    }

    const refreshWarning = await refreshOutboxEntriesQuiet()
    return combineOutboxWarnings(markWarning, refreshWarning)
  }

  const consumeRealtimeAcknowledgedResponse = async (opId: string): Promise<{
    readonly response: LivePlayCommandResponse
    readonly acknowledgementFailure?: string
  } | null> => {
    const response = realtimeAcknowledgedResponses.get(opId)
    if (!response) return null

    const adoption = realtimeAcknowledgementAdoptions.get(opId)
    const adoptionFailure = adoption ? await adoption : undefined
    if (adoptionFailure) realtimeAcknowledgementFailures.set(opId, adoptionFailure)

    const acknowledgementFailure = realtimeAcknowledgementFailures.get(opId)
    realtimeAcknowledgedResponses.delete(opId)
    realtimeAcknowledgementFailures.delete(opId)
    realtimeAcknowledgementAdoptions.delete(opId)
    return {
      response,
      ...(acknowledgementFailure === undefined ? {} : { acknowledgementFailure }),
    }
  }

  const realtimeRecoveredResult = async (
    entry: LivePlayCommandOutboxEntry,
    detail: string,
  ): Promise<LivePlayCommandDispatchResult | null> => {
    const recovered = await consumeRealtimeAcknowledgedResponse(entry.opId)
    if (!recovered) return null

    const refreshWarning = await refreshOutboxEntriesQuiet({
      preserveRecoveryError: recovered.acknowledgementFailure !== undefined,
    })
    if (!recovered.acknowledgementFailure) markOperationAccepted(entry.opId)
    const message = combineOutboxWarnings(
      recovered.acknowledgementFailure
        ?? `Live-play operation ${entry.opId} was accepted by realtime before the original HTTP response completed. ${detail}`,
      refreshWarning,
    )
    return {
      dispatched: true,
      opId: entry.opId,
      response: recovered.response,
      recoveredByRealtime: true,
      ...(message === undefined ? {} : { message }),
      ...(refreshWarning === undefined ? {} : { outboxError: refreshWarning }),
    }
  }

  const uncertaintyResult = async (
    entry: LivePlayCommandOutboxEntry,
    detail: string,
    origin: 'immediate' | 'recovery',
  ): Promise<LivePlayCommandDispatchResult> => {
    const recovered = await realtimeRecoveredResult(entry, detail)
    if (recovered) return recovered

    const message = `The server outcome for live-play operation ${entry.opId} is unknown. Retrying the same operation ID will be safe later. ${detail}`
    const outboxWarning = await markClaimedEntryUncertain(entry, message)
    markOperationFailed(entry.opId, message)
    recordCommandTraceEvent(
      commandTraceMetadataFromEntry(entry),
      LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.UNCERTAIN,
      { origin },
      { once: true },
    )
    if (origin === 'recovery') setOutboxRecoveryFailure(message)
    options.onCommandFailed?.(message)
    return {
      dispatched: false,
      message,
      opId: entry.opId,
      uncertain: true,
      ...(outboxWarning === undefined ? {} : { outboxError: outboxWarning }),
    }
  }

  const acknowledgeTerminalResponse = async (opId: string): Promise<string | undefined> => {
    try {
      await outbox.acknowledgeTerminal(opId)
      return undefined
    } catch (error) {
      return `Live-play operation ${opId} received a terminal response, but removing it from durable command storage failed: ${outboxErrorMessage(error)}`
    }
  }

  const withOutboxWarning = <TResult extends LivePlayCommandDispatchResult>(
    result: TResult,
    outboxWarning: string | undefined,
  ): TResult => {
    const combinedWarning = combineOutboxWarnings(result.outboxError, outboxWarning)
    return combinedWarning === undefined ? result : { ...result, outboxError: combinedWarning }
  }

  const acceptedResponseRevision = (response: LivePlayCommandResponse): number | null => {
    const patchResult = acceptedPatchResult(response)
    return patchResult === null ? null : normalizeRevision(patchResult.revision)
  }

  const currentPresentationRevision = (): number | null => {
    const revisions: number[] = []
    if (options.map?.value) revisions.push(normalizeRevision(options.map.value.revision))
    if (typeof options.mapRevision?.value === 'number') revisions.push(normalizeRevision(options.mapRevision.value))
    return revisions.length === 0 ? null : Math.max(...revisions)
  }

  const acceptedResponseIsStaleForPresentation = (response: LivePlayCommandResponse): boolean => {
    const responseRevision = acceptedResponseRevision(response)
    const presentationRevision = currentPresentationRevision()
    return responseRevision !== null && presentationRevision !== null && presentationRevision > responseRevision
  }

  const acceptedHttpTerminalTraceDetail = (response: LivePlayCommandResponse): LivePlayCommandTraceEventDetail => {
    if (!acceptedLivePlayResponse(response)) return { outcome: 'rejected' }
    const responseRevision = acceptedResponseRevision(response)
    if (!acceptedResponseIsStaleForPresentation(response)) return { outcome: 'accepted' }
    return responseRevision === null
      ? { outcome: 'accepted-stale' }
      : { outcome: 'accepted-stale', revision: responseRevision }
  }

  const tryApplyAcceptedResponsePatches = (response: LivePlayCommandResponse): LivePlayAcceptedResponsePatchHandling => {
    const patchResult = acceptedPatchResult(response)
    if (!patchResult || patchResult.patches.length === 0 || !options.map?.value) {
      return { handled: false, applied: false }
    }

    const applied = applyLivePlayPatchesToMap({
      map: options.map.value,
      mapSlug: patchResult.mapSlug,
      previousRevision: patchResult.previousRevision,
      revision: patchResult.revision,
      patches: patchResult.patches,
    })
    if (!applied.ok) return { handled: false, applied: false }
    return {
      handled: true,
      applied: applied.applied,
      revision: applied.applied ? applied.revision : normalizeRevision(patchResult.revision),
    }
  }

  const applyAcceptedResponseMapFallback = (response: LivePlayCommandResponse): boolean => {
    if (!response.map || !options.applyPersistedMap) return false
    if (acceptedResponseIsStaleForPresentation(response)) return false
    options.applyPersistedMap(response.map)
    return true
  }

  const adoptAcceptedLivePlayResponse = async (
    request: string,
    response: LivePlayCommandResponse,
    adoptOptions: { readonly reconcileOnPatchFailure?: boolean } = {},
  ): Promise<void> => {
    const reconcileOnPatchFailure = adoptOptions.reconcileOnPatchFailure ?? true
    const patchResult = acceptedPatchResult(response)
    const patchHandling = tryApplyAcceptedResponsePatches(response)
    const mapFallbackApplied = patchHandling.handled ? false : applyAcceptedResponseMapFallback(response)
    if (!patchHandling.handled && !mapFallbackApplied && acceptedResultRequiresReconciliation(response) && reconcileOnPatchFailure) {
      await options.requestReconciliation?.({ request, response })
    }
    for (const update of response.sheetUpdates ?? []) options.applySheetUpdate?.(update)
    const sheetUpdatesApplied = (response.sheetUpdates?.length ?? 0) > 0
    if (patchHandling.applied || mapFallbackApplied || sheetUpdatesApplied) {
      recordCommandTraceEvent(
        commandTraceMetadataFromResponse(response),
        LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PATCH_ADOPTED,
        patchHandling.revision === undefined && patchResult === null
          ? undefined
          : { revision: patchHandling.revision ?? normalizeRevision(patchResult!.revision) },
      )
    }
  }

  const requestPresentationReconciliation = async (
    request: string,
    response: LivePlayCommandResponse,
  ): Promise<void> => {
    try {
      await options.requestReconciliation?.({ request, response })
    } catch (reconciliationError) {
      options.onCommandFailed?.(getErrorMessage(reconciliationError, { fallback: 'Live-play reconciliation failed' }))
    }
  }

  const requestRecoveryReconciliation = async (
    request: string,
    response: LivePlayCommandResponse,
  ): Promise<string | undefined> => {
    if (!options.requestReconciliation) return undefined
    try {
      await options.requestReconciliation({ request, response })
      return undefined
    } catch (reconciliationError) {
      return getErrorMessage(reconciliationError, { fallback: 'Live-play recovery reconciliation failed' })
    }
  }

  const processRejectedTerminalResponse = async (
    request: string,
    response: LivePlayCommandResponse,
    opId: string,
    outboxWarning: string | undefined,
  ): Promise<LivePlayCommandDispatchResult> => {
    const message = livePlayResponseMessage(response) ?? 'Token action was rejected'
    const reason = livePlayResponseRejectionReason(response)

    try {
      markOperationFailed(opId, message)
      recordCommandTraceEvent(
        { opId },
        LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.REJECTED,
        reason === null ? undefined : { reason },
        { once: true },
      )
      options.onCommandRejected?.({ reason, message, response })
      const needsReconciliation = rejectionNeedsReconciliation(
        reason,
        response,
        normalizeRevision(options.mapRevision?.value),
      )
      if (needsReconciliation && options.requestReconciliation) {
        try {
          await options.requestReconciliation({ request, response })
          clearError()
        } catch (reconciliationError) {
          options.onCommandFailed?.(getErrorMessage(reconciliationError, { fallback: 'Live-play reconciliation failed' }))
        }
      }
    } catch (processingError) {
      const processingMessage = getErrorMessage(processingError, {
        fallback: 'Live-play rejection response was terminal, but local response processing failed',
      })
      markOperationFailed(opId, processingMessage)
      options.onCommandFailed?.(processingMessage)
      return withOutboxWarning({ dispatched: false, message: processingMessage, response, opId }, outboxWarning)
    }

    return withOutboxWarning({ dispatched: false, message, response, opId }, outboxWarning)
  }

  const processAcceptedTerminalResponse = async (
    request: string,
    response: LivePlayCommandResponse,
    opId: string,
    outboxWarning: string | undefined,
    origin: 'immediate' | 'recovery',
  ): Promise<LivePlayCommandDispatchResult> => {
    const recovered = await consumeRealtimeAcknowledgedResponse(opId)
    if (recovered) {
      if (!recovered.acknowledgementFailure) markOperationAccepted(opId)
      return withOutboxWarning({
        dispatched: true,
        recoveredByRealtime: true,
        ...(recovered.acknowledgementFailure === undefined ? {} : { message: recovered.acknowledgementFailure }),
        response: recovered.response,
        opId,
      }, outboxWarning)
    }

    try {
      await adoptAcceptedLivePlayResponse(request, response)
      const recoveryReconciliationWarning = origin === 'recovery'
        ? await requestRecoveryReconciliation(request, response)
        : undefined
      markOperationAccepted(opId)
      options.onCommandAccepted?.(response)
      return withOutboxWarning({
        dispatched: true,
        ...(recoveryReconciliationWarning === undefined ? {} : { message: recoveryReconciliationWarning }),
        response,
        opId,
      }, outboxWarning)
    } catch (processingError) {
      const message = getErrorMessage(processingError, {
        fallback: 'Live-play command was accepted, but local response processing failed. Requesting authoritative reconciliation.',
      })
      markOperationFailed(opId, message)
      options.onCommandFailed?.(message)
      await requestPresentationReconciliation(request, response)
      return withOutboxWarning({ dispatched: true, message, response, opId }, outboxWarning)
    }
  }

  const processTerminalResponse = async (
    request: string,
    response: LivePlayCommandResponse,
    opId: string,
    outboxWarning: string | undefined,
    origin: 'immediate' | 'recovery',
  ): Promise<LivePlayCommandDispatchResult> => (
    acceptedLivePlayResponse(response)
      ? processAcceptedTerminalResponse(request, response, opId, outboxWarning, origin)
      : processRejectedTerminalResponse(request, response, opId, outboxWarning)
  )

  const sendClaimedOutboxEntry = async (input: {
    readonly entry: LivePlayCommandOutboxEntry
    readonly origin: 'immediate' | 'recovery'
  }): Promise<LivePlayCommandDispatchResult> => {
    const { entry, origin } = input
    let rawResponse: unknown
    const traceMetadata = commandTraceMetadataFromEntry(entry)
    recordCommandTraceEvent(traceMetadata, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.SENT)
    try {
      rawResponse = await postJson<unknown>(entry.requestPath, entry.body)
    } catch (postError) {
      const detail = getErrorMessage(postError, { fallback: 'The HTTP request failed before a terminal command result was received.' })
      return uncertaintyResult(entry, detail, origin)
    }

    if (realtimeAcknowledgedResponses.has(entry.opId)) {
      recordCommandTraceEvent(traceMetadata, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.HTTP_TERMINAL, {
        outcome: 'ignored-after-realtime',
      })
    }
    const recoveredBeforeValidation = await realtimeRecoveredResult(
      entry,
      'The later HTTP response was ignored because realtime already supplied the terminal accepted result.',
    )
    if (recoveredBeforeValidation) return recoveredBeforeValidation

    const validation = validateTerminalResponseForCommand({
      response: rawResponse,
      command: entry.body,
    })
    if (!validation.valid) {
      recordCommandTraceEvent(traceMetadata, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.HTTP_TERMINAL, {
        outcome: 'invalid',
      })
      return uncertaintyResult(
        entry,
        `The command response was not trustworthy: ${validationIssueSummary(validation.issues)}`,
        origin,
      )
    }

    const response = rawResponse as LivePlayCommandResponse
    recordCommandTraceEvent(
      traceMetadata,
      LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.HTTP_TERMINAL,
      acceptedHttpTerminalTraceDetail(response),
    )
    const acknowledgeWarning = await acknowledgeTerminalResponse(entry.opId)
    const refreshWarning = await refreshOutboxEntriesQuiet()
    return processTerminalResponse(
      entry.requestPath,
      response,
      entry.opId,
      combineOutboxWarnings(acknowledgeWarning, refreshWarning),
      origin,
    )
  }

  const preliminaryCommandBlockedResult = (): LivePlayCommandDispatchResult | null => {
    const localInFlightMessage = localInFlightCommandBlockedMessage()
    if (localInFlightMessage) {
      options.onCommandBlocked?.(localInFlightMessage)
      return { dispatched: false, message: localInFlightMessage }
    }

    const blockedMessage = blockedCommandMessage()
    if (blockedMessage) return localCommandBlockedResult(blockedMessage)

    const realtimeAckBlockedMessage = realtimeAcknowledgementBlockedMessage()
    if (realtimeAckBlockedMessage) return localCommandBlockedResult(realtimeAckBlockedMessage)

    const pendingCommandMessage = newCommandBlockedMessage()
    if (pendingCommandMessage) return localCommandBlockedResult(pendingCommandMessage)

    return null
  }

  const buildAuthenticatedCommandBody = (
    buildBody: LivePlayCommandBodyFactory,
  ): { readonly ok: true; readonly authContext: LivePlayCommandOutboxAuthContext; readonly body: Record<string, unknown>; readonly opId: string | null }
    | { readonly ok: false; readonly result: LivePlayCommandDispatchResult } => {
    const authContext = currentAuthContext()
    if (!authContext) {
      return {
        ok: false,
        result: localCommandBlockedResult('A valid GM or player auth role is required before sending live-play commands.'),
      }
    }

    let body: Record<string, unknown>
    try {
      body = buildBody(authContext)
    } catch (buildError) {
      return {
        ok: false,
        result: localCommandFailedResult(getErrorMessage(buildError, { fallback: 'Live-play command body could not be built' })),
      }
    }

    const opId = commandEnvelopeOpId(body)
    const authBodyIssue = validateCommandBodyAuthContext(body, authContext)
    if (authBodyIssue) {
      return {
        ok: false,
        result: localCommandFailedResult(authBodyIssue, opId ? { opId } : {}),
      }
    }

    return { ok: true, authContext, body, opId }
  }

  const dispatchPreparedLivePlayCommand = async (input: {
    readonly request: string
    readonly body: Record<string, unknown>
    readonly authContext: LivePlayCommandOutboxAuthContext
  }): Promise<LivePlayCommandDispatchResult> => {
    const { request, body, authContext } = input
    const opId = commandEnvelopeOpId(body)
    let enqueuedEntry: LivePlayCommandOutboxEntry
    try {
      enqueuedEntry = await outbox.enqueue({ requestPath: request, body, authContext })
      recordCommandTraceEvent(
        commandTraceMetadataFromEntry(enqueuedEntry),
        LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.ENQUEUED,
      )
      trackPendingCommandEntry(enqueuedEntry, 'queued')
    } catch (enqueueError) {
      const outboxError = outboxErrorMessage(enqueueError)
      const message = `Live-play command ${opId ?? '(unknown operation)'} was not sent because durable command storage was unavailable: ${outboxError}`
      return localCommandFailedResult(message, {
        ...(opId ? { opId } : {}),
        outboxError,
      })
    }

    let outboxSyncWarning = await refreshOutboxEntriesQuiet()

    let claimResult: Awaited<ReturnType<LivePlayCommandOutbox['claimForSend']>>
    try {
      claimResult = await outbox.claimForSend({ opId: enqueuedEntry.opId, leaseOwner })
    } catch (claimError) {
      const refreshWarning = await refreshOutboxEntriesQuiet()
      const outboxError = combineOutboxWarnings(outboxErrorMessage(claimError), refreshWarning)
      const message = `Live-play command ${enqueuedEntry.opId} was not sent because durable command storage could not claim it for sending: ${outboxError}`
      return localCommandFailedResult(message, { opId: enqueuedEntry.opId, outboxError })
    }

    outboxSyncWarning = combineOutboxWarnings(outboxSyncWarning, await refreshOutboxEntriesQuiet())

    if (!claimResult.claimed) {
      if (claimResult.reason === 'missing') {
        return localCommandFailedResult(
          `Live-play command ${enqueuedEntry.opId} was not sent because its durable outbox entry disappeared before sending.`,
          { opId: enqueuedEntry.opId, ...(outboxSyncWarning === undefined ? {} : { outboxError: outboxSyncWarning }) },
        )
      }

      return localCommandBlockedResult(
        `Live-play command ${enqueuedEntry.opId} was not sent because another tab or page instance is already sending that operation.`,
        { opId: enqueuedEntry.opId, ...(outboxSyncWarning === undefined ? {} : { outboxError: outboxSyncWarning }) },
      )
    }

    recordCommandTraceEvent(
      commandTraceMetadataFromEntry(claimResult.entry),
      LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CLAIMED,
    )
    trackPendingCommandEntry(claimResult.entry, 'sending')

    return withOutboxWarning(
      await sendClaimedOutboxEntry({ entry: claimResult.entry, origin: 'immediate' }),
      outboxSyncWarning,
    )
  }

  const runLivePlayCommand = async (
    request: string,
    buildBody: LivePlayCommandBodyFactory,
  ): Promise<LivePlayCommandDispatchResult> => {
    const preliminaryBlock = preliminaryCommandBlockedResult()
    if (preliminaryBlock) return preliminaryBlock

    const prepared = buildAuthenticatedCommandBody(buildBody)
    if (!prepared.ok) return prepared.result
    recordCommandBuiltTrace(request, prepared.body)

    const pendingBlockedMessage = localPendingCommandBlockedMessage(prepared.body)
    if (pendingBlockedMessage) {
      options.onCommandBlocked?.(pendingBlockedMessage)
      return { dispatched: false, message: pendingBlockedMessage }
    }

    beginSavingOperation(prepared.opId)
    trackPendingCommandBody(request, prepared.body, 'queued')
    options.onCommandStarted?.()

    return dispatchPreparedLivePlayCommand({
      request,
      body: prepared.body,
      authContext: prepared.authContext,
    })
  }

  const moveTokenCoalescingQueues = new Map<string, MoveTokenCoalescingQueue>()

  const moveTokenQueueForPlacement = (placementId: string): MoveTokenCoalescingQueue => {
    const existing = moveTokenCoalescingQueues.get(placementId)
    if (existing) return existing
    const queue: MoveTokenCoalescingQueue = { queued: null, sending: null, drainScheduled: false }
    moveTokenCoalescingQueues.set(placementId, queue)
    return queue
  }

  const cleanupMoveTokenQueueIfIdle = (placementId: string, queue: MoveTokenCoalescingQueue): void => {
    if (!queue.queued && !queue.sending && !queue.drainScheduled) moveTokenCoalescingQueues.delete(placementId)
  }

  const coalescedMoveOpIdsForPlacement = (placementId: string): ReadonlySet<string> => {
    const queue = moveTokenCoalescingQueues.get(placementId)
    const opIds = new Set<string>()
    if (queue?.queued) opIds.add(queue.queued.opId)
    if (queue?.sending) opIds.add(queue.sending.opId)
    return opIds
  }

  const normalizeMoveTokenPayload = (payload: Parameters<UseLivePlayCommandsReturn['moveToken']>[0]): MoveTokenPayload => ({
    placementId: payload.placementId,
    position: { ...payload.position },
    ...(payload.pathLength === undefined || payload.pathLength === null ? {} : { pathLength: payload.pathLength }),
  })

  const createQueuedMoveTokenCommand = (input: {
    readonly authContext: LivePlayCommandOutboxAuthContext
    readonly body: Record<string, unknown>
    readonly payload: MoveTokenPayload
  }): QueuedMoveTokenCommand | null => {
    const opId = commandEnvelopeOpId(input.body)
    if (!opId) return null

    let resolveCommand!: LivePlayCommandDispatchResolver
    const promise = new Promise<LivePlayCommandDispatchResult>((resolve) => {
      resolveCommand = resolve
    })

    return {
      opId,
      placementId: input.payload.placementId,
      requestPath: MAP_API_PATHS.moveToken,
      authContext: input.authContext,
      payload: input.payload,
      body: input.body,
      started: false,
      promise,
      resolve: resolveCommand,
    }
  }

  const trackQueuedMoveTokenCommand = (
    command: QueuedMoveTokenCommand,
    trackOptions: { readonly activateTransport: boolean },
  ): void => {
    if (trackOptions.activateTransport) {
      beginSavingOperation(command.opId)
      options.onCommandStarted?.()
      command.started = true
    }
    trackPendingCommandBody(command.requestPath, command.body, 'queued')
  }

  const resolveQueuedMoveTokenCommand = (
    command: QueuedMoveTokenCommand,
    result: LivePlayCommandDispatchResult,
  ): void => {
    command.resolve(result)
  }

  const supersedeQueuedMoveTokenCommand = (command: QueuedMoveTokenCommand): void => {
    rollbackLocalPredictionIfCurrentlyApplied(command.opId)
    removePendingCommand(command.opId)
    clearSavingOperation(command.opId)
    settleSavingStatusIfIdle()
    resolveQueuedMoveTokenCommand(command, {
      dispatched: false,
      message: SUPERSEDED_MOVE_TOKEN_MESSAGE,
      opId: command.opId,
    })
  }

  const cancelQueuedMoveTokenCommand = (
    command: QueuedMoveTokenCommand,
    message = CANCELLED_SUPERSEDING_MOVE_TOKEN_MESSAGE,
  ): void => {
    rollbackLocalPredictionIfCurrentlyApplied(command.opId)
    removePendingCommand(command.opId)
    clearSavingOperation(command.opId)
    settleSavingStatusIfIdle()
    resolveQueuedMoveTokenCommand(command, {
      dispatched: false,
      message,
      opId: command.opId,
    })
  }

  const refreshMoveTokenCommandBeforeSend = (command: QueuedMoveTokenCommand): void => {
    rollbackLocalPrediction(command.opId)
    command.body = moveTokenCommandBody(command.authContext, command.payload, { opId: command.opId })
    recordCommandBuiltTrace(command.requestPath, command.body)
    trackPendingCommandBody(command.requestPath, command.body, 'queued')
  }

  const coalescedMoveCanDrainAfter = (result: LivePlayCommandDispatchResult): boolean => (
    result.dispatched
    && result.response !== undefined
    && acceptedLivePlayResponse(result.response)
    && status.value !== 'error'
  )

  const drainMoveTokenQueue = async (placementId: string): Promise<void> => {
    const queue = moveTokenCoalescingQueues.get(placementId)
    if (!queue) return

    queue.drainScheduled = false
    if (queue.sending || !queue.queued) {
      cleanupMoveTokenQueueIfIdle(placementId, queue)
      return
    }

    const command = queue.queued
    queue.queued = null
    queue.sending = command

    refreshMoveTokenCommandBeforeSend(command)
    beginSavingOperation(command.opId)
    if (!command.started) {
      options.onCommandStarted?.()
      command.started = true
    }
    trackPendingCommandBody(command.requestPath, command.body, 'sending')

    let result: LivePlayCommandDispatchResult
    try {
      result = await dispatchPreparedLivePlayCommand({
        request: command.requestPath,
        body: command.body,
        authContext: command.authContext,
      })
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Live-play move command failed before it could be sent.' })
      markOperationFailed(command.opId, message)
      options.onCommandFailed?.(message)
      result = { dispatched: false, message, opId: command.opId }
    }

    resolveQueuedMoveTokenCommand(command, result)
    if (queue.sending?.opId === command.opId) queue.sending = null

    if (coalescedMoveCanDrainAfter(result)) {
      if (queue.queued) scheduleMoveTokenQueueDrain(placementId)
    } else if (queue.queued) {
      cancelQueuedMoveTokenCommand(queue.queued)
      queue.queued = null
    }

    cleanupMoveTokenQueueIfIdle(placementId, queue)
  }

  const scheduleMoveTokenQueueDrain = (placementId: string): void => {
    const queue = moveTokenQueueForPlacement(placementId)
    if (queue.drainScheduled || queue.sending || !queue.queued) return
    queue.drainScheduled = true
    void Promise.resolve()
      .then(() => drainMoveTokenQueue(placementId))
      .catch((error) => {
        const failedQueue = moveTokenCoalescingQueues.get(placementId)
        const queued = failedQueue?.queued ?? null
        if (queued) {
          cancelQueuedMoveTokenCommand(
            queued,
            getErrorMessage(error, { fallback: 'Live-play move queue processing failed.' }),
          )
          if (failedQueue) failedQueue.queued = null
        }
        if (failedQueue) {
          failedQueue.drainScheduled = false
          cleanupMoveTokenQueueIfIdle(placementId, failedQueue)
        }
      })
  }

  const enqueueCoalescedMoveTokenCommand = (command: QueuedMoveTokenCommand): Promise<LivePlayCommandDispatchResult> => {
    const queue = moveTokenQueueForPlacement(command.placementId)
    const activateTransport = queue.sending === null

    if (queue.queued) supersedeQueuedMoveTokenCommand(queue.queued)
    queue.queued = command
    trackQueuedMoveTokenCommand(command, { activateTransport })
    if (!queue.sending) scheduleMoveTokenQueueDrain(command.placementId)
    return command.promise
  }

  const runCoalescedMoveTokenCommand = (
    payload: Parameters<UseLivePlayCommandsReturn['moveToken']>[0],
  ): Promise<LivePlayCommandDispatchResult> => {
    const preliminaryBlock = preliminaryCommandBlockedResult()
    if (preliminaryBlock) return Promise.resolve(preliminaryBlock)

    const commandPayload = normalizeMoveTokenPayload(payload)
    const prepared = buildAuthenticatedCommandBody((authContext) => moveTokenCommandBody(authContext, commandPayload))
    if (!prepared.ok) return Promise.resolve(prepared.result)
    recordCommandBuiltTrace(MAP_API_PATHS.moveToken, prepared.body)

    const pendingBlockedMessage = localPendingCommandBlockedMessage(prepared.body, {
      ignoredOpIds: coalescedMoveOpIdsForPlacement(commandPayload.placementId),
    })
    if (pendingBlockedMessage) {
      options.onCommandBlocked?.(pendingBlockedMessage)
      return Promise.resolve({ dispatched: false, message: pendingBlockedMessage })
    }

    const queuedCommand = createQueuedMoveTokenCommand({
      authContext: prepared.authContext,
      body: prepared.body,
      payload: commandPayload,
    })
    if (!queuedCommand) {
      return Promise.resolve(localCommandFailedResult('Live-play move command body did not include an operation ID.'))
    }

    return enqueueCoalescedMoveTokenCommand(queuedCommand)
  }

  const spawnToken: UseLivePlayCommandsReturn['spawnToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.spawnToken,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
      { placement: payload.placement },
      [{ kind: 'token', placementId: payload.placement.id, field: 'spawn' }],
    ),
  )

  const sendOutPokemon: UseLivePlayCommandsReturn['sendOutPokemon'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.sendOutPokemon,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
      {
        trainerId: payload.trainerId,
        pokemonSlug: payload.pokemonSlug,
        tokenId: payload.tokenId,
        position: payload.position,
        ...(payload.facing === undefined ? {} : { facing: payload.facing }),
      },
      [
        { kind: 'token', placementId: payload.trainerId, field: 'sendOut' },
        { kind: 'token', placementId: payload.tokenId, field: 'spawn' },
      ],
    ),
  )

  const deleteToken: UseLivePlayCommandsReturn['deleteToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.deleteToken,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
      { placementId: payload.placementId },
      [{ kind: 'token', placementId: payload.placementId, field: 'delete' }],
    ),
  )

  const throwPokeball: UseLivePlayCommandsReturn['throwPokeball'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.throwPokeball,
    (authContext) => {
      const trainerPlacement = options.map?.value?.placements.find((placement) => placement.id === payload.trainerPlacementId) ?? null
      const targetPlacement = options.map?.value?.placements.find((placement) => placement.id === payload.targetPlacementId) ?? null
      const scopes: LivePlayScope[] = [
        { kind: 'token', placementId: payload.trainerPlacementId, field: 'action' },
        { kind: 'token', placementId: payload.targetPlacementId, field: 'action' },
        mapScope('metadata'),
        mapScope('placements'),
        ...(trainerPlacement ? [
          { kind: 'sheet' as const, sheetKind: trainerPlacement.sheetKind, sheetSlug: trainerPlacement.sheetSlug, field: 'inventory' },
          { kind: 'sheet' as const, sheetKind: trainerPlacement.sheetKind, sheetSlug: trainerPlacement.sheetSlug, field: 'pokemonRoster' },
        ] : []),
        ...(targetPlacement ? [
          { kind: 'sheet' as const, sheetKind: targetPlacement.sheetKind, sheetSlug: targetPlacement.sheetSlug, field: 'caughtBall' },
        ] : []),
      ]
      return commandBody(
        authContext,
        LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
        {
          trainerPlacementId: payload.trainerPlacementId,
          targetPlacementId: payload.targetPlacementId,
          pokeballName: payload.pokeballName,
        },
        scopes,
      )
    },
  )

  const moveToken: UseLivePlayCommandsReturn['moveToken'] = (payload) => runCoalescedMoveTokenCommand(payload)

  const turnToken: UseLivePlayCommandsReturn['turnToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.turnToken,
    (authContext) => tokenCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
      {
        placementId: payload.placementId,
        facing: payload.facing,
      },
      'facing',
    ),
  )

  const modifyHp: UseLivePlayCommandsReturn['modifyHp'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.modifyHp,
    (authContext) => sheetCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      {
        placementId: payload.placementId,
        currentHp: payload.currentHp,
        ...(payload.temporaryHp === undefined ? {} : { temporaryHp: payload.temporaryHp }),
        ...(payload.injuries === undefined ? {} : { injuries: payload.injuries }),
      },
      'hp',
      'hp',
    ),
  )

  const modifyCombatStages: UseLivePlayCommandsReturn['modifyCombatStages'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.modifyCombatStages,
    (authContext) => sheetCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
      {
        placementId: payload.placementId,
        stages: payload.stages,
      },
      'combatStages',
      'combatStages',
    ),
  )

  const modifyConditions: UseLivePlayCommandsReturn['modifyConditions'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.modifyConditions,
    (authContext) => sheetCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
      {
        placementId: payload.placementId,
        action: payload.action ?? 'replace',
        conditions: payload.conditions,
      },
      'conditions',
      'conditions',
    ),
  )

  const grantExperience: UseLivePlayCommandsReturn['grantExperience'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.grantExperience,
    (authContext) => sheetCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
      {
        placementId: payload.placementId,
        amount: payload.amount,
      },
      'experience',
      'experience',
    ),
  )

  const useMove: UseLivePlayCommandsReturn['useMove'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.useMove,
    (authContext) => {
      const commandPayload = {
        placementId: payload.placementId,
        moveName: payload.moveName,
      }
      const sheet = sheetScope(commandPayload, 'moveUsage')
      return commandBody(
        authContext,
        LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
        commandPayload,
        [
          tokenScope(commandPayload, 'moveUsage'),
          ...(sheet ? [sheet] : []),
        ],
      )
    },
  )

  const resolveMove: UseLivePlayCommandsReturn['resolveMove'] = async (input) => {
    const localInFlightMessage = localInFlightCommandBlockedMessage()
    if (localInFlightMessage) {
      options.onCommandBlocked?.(localInFlightMessage)
      return { dispatched: false, move: null, message: localInFlightMessage }
    }

    const blockedMessage = blockedCommandMessage()
    if (blockedMessage) {
      return { ...localCommandBlockedResult(blockedMessage), move: null }
    }

    const realtimeAckBlockedMessage = realtimeAcknowledgementBlockedMessage()
    if (realtimeAckBlockedMessage) {
      return { ...localCommandBlockedResult(realtimeAckBlockedMessage), move: null }
    }

    const pendingCommandMessage = newCommandBlockedMessage()
    if (pendingCommandMessage) {
      return { ...localCommandBlockedResult(pendingCommandMessage), move: null }
    }

    const intentResult = parseResolveMoveIntent(input.intent)
    if (!intentResult.valid) {
      const message = `Move intent is invalid: ${intentResult.issues.map((issue) => issue.message).join(' ')}`
      return { ...localCommandBlockedResult(message), move: null }
    }

    const currentMap = options.map?.value ?? null
    if (!currentMap) {
      const message = 'Cannot resolve a move before the current map has loaded.'
      return { ...localCommandBlockedResult(message), move: null }
    }

    const scopeResult = buildResolveMoveScopes({
      map: currentMap,
      intent: intentResult.intent,
      candidateScopePlacementIds: input.candidateScopePlacementIds,
    })
    if (!scopeResult.ok) {
      return { ...localCommandBlockedResult(scopeResult.message), move: null }
    }

    const result = await runLivePlayCommand(
      MAP_API_PATHS.resolveMove,
      (authContext) => commandBody(
        authContext,
        LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
        intentResult.intent,
        scopeResult.scopes,
      ),
    )
    if (!result.dispatched) return { ...result, move: null }

    const response = result.response
    if (!response) {
      const presentationError = 'Resolve-move command was accepted without a response body.'
      status.value = 'error'
      lastError.value = presentationError
      options.onCommandFailed?.(presentationError)
      return { ...result, move: null, message: presentationError, presentationError }
    }

    const extracted = extractResolvedMoveResult(response)
    if (extracted.ok) return { ...result, move: extracted.move }

    const presentationError = `Resolve-move presentation data is unavailable: ${extracted.message}`
    status.value = 'error'
    lastError.value = presentationError
    options.onCommandFailed?.(presentationError)
    await requestPresentationReconciliation(MAP_API_PATHS.resolveMove, response)
    return {
      ...result,
      dispatched: true,
      move: null,
      message: presentationError,
      presentationError,
    }
  }

  const setInitiative: UseLivePlayCommandsReturn['setInitiative'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.setInitiative,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
      payload,
      [mapScope('initiative')],
    ),
  )

  const nextInitiative: UseLivePlayCommandsReturn['nextInitiative'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.nextInitiative,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      payload,
      [mapScope('initiative'), mapScope('metadata')],
    ),
  )

  const previousInitiative: UseLivePlayCommandsReturn['previousInitiative'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.previousInitiative,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
      payload,
      [mapScope('initiative'), mapScope('metadata')],
    ),
  )

  const placeHazard: UseLivePlayCommandsReturn['placeHazard'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.placeHazard,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
      { hazard: payload.hazard },
      [mapScope('hazards')],
    ),
  )

  const removeHazard: UseLivePlayCommandsReturn['removeHazard'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeHazard,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
      { cell: payload.cell },
      [mapScope('hazards')],
    ),
  )

  const buildTerrainVoxel: UseLivePlayCommandsReturn['buildTerrainVoxel'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.buildTerrainVoxel,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
      { voxel: payload.voxel },
      [mapScope('terrain')],
    ),
  )

  const removeTerrainVoxel: UseLivePlayCommandsReturn['removeTerrainVoxel'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeTerrainVoxel,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
      { cell: payload.cell },
      [mapScope('terrain')],
    ),
  )

  const setFieldEffect: UseLivePlayCommandsReturn['setFieldEffect'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.setFieldEffect,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const removeFieldEffect: UseLivePlayCommandsReturn['removeFieldEffect'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeFieldEffect,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const tickFieldEffectDurations: UseLivePlayCommandsReturn['tickFieldEffectDurations'] = (payload = {}) => runLivePlayCommand(
    MAP_API_PATHS.tickFieldEffectDurations,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const useManeuver: UseLivePlayCommandsReturn['useManeuver'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.useManeuver,
    (authContext) => tableActionCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
      {
        placementId: payload.placementId,
        maneuverName: payload.maneuverName,
        ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
      },
    ),
  )

  const useAbility: UseLivePlayCommandsReturn['useAbility'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.useAbility,
    (authContext) => tableActionCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      {
        placementId: payload.placementId,
        abilityName: payload.abilityName,
        ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
      },
    ),
  )

  const useOrder: UseLivePlayCommandsReturn['useOrder'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.useOrder,
    (authContext) => tableActionCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
      {
        placementId: payload.placementId,
        orderName: payload.orderName,
        ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
      },
    ),
  )

  const setScene: UseLivePlayCommandsReturn['setScene'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.setScene,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
      payload,
      [mapScope('scene')],
    ),
  )

  const updateAttackOfOpportunity: UseLivePlayCommandsReturn['updateAttackOfOpportunity'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.updateAttackOfOpportunity,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
      payload,
      [mapScope('metadata')],
    ),
  )

  const updateStartTurnModal: UseLivePlayCommandsReturn['updateStartTurnModal'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.updateStartTurnModal,
    (authContext) => commandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL,
      payload,
      [mapScope('metadata')],
    ),
  )

  const recoverInterruptedOutboxCommands: UseLivePlayCommandsReturn['recoverInterruptedOutboxCommands'] = async () => {
    if (activeAbandonment !== null) {
      await activeAbandonment.catch(() => undefined)
      return outboxEntries.value
    }

    outboxRecoveryStatus.value = 'loading'
    outboxRecoveryError.value = null

    try {
      await outbox.recoverExpiredLeases()
    } catch (error) {
      const message = `Failed to recover interrupted durable live-play command sends: ${outboxErrorMessage(error)}`
      setOutboxRecoveryFailure(message)
      throw new Error(message, { cause: error })
    }

    return refreshOutboxEntries()
  }

  const validateStoredEntryIdentity = (
    entry: LivePlayCommandOutboxEntry,
    action: 'retried' | 'checked' | 'abandoned',
  ): string | null => {
    if (!isStoredLivePlayCommandRequestPath(entry.requestPath)) {
      return `Live-play operation ${entry.opId} has an invalid stored API request path.`
    }

    if (!isRecord(entry.body)) {
      return `Live-play operation ${entry.opId} has an invalid stored command body.`
    }
    if (entry.body.opId !== entry.opId) {
      return `Live-play operation ${entry.opId} cannot be ${action} because body.opId does not match the outbox entry.`
    }
    if (entry.body.mapSlug !== entry.mapSlug) {
      return `Live-play operation ${entry.opId} cannot be ${action} because body.mapSlug does not match the outbox entry.`
    }
    if (entry.body.type !== entry.commandType) {
      return `Live-play operation ${entry.opId} cannot be ${action} because body.type does not match the outbox entry.`
    }

    try {
      const expectedFingerprint = createLivePlayCommandOutboxFingerprint({
        requestPath: entry.requestPath,
        body: entry.body,
        authContext: entry.authContext,
      })
      if (entry.fingerprint !== expectedFingerprint) {
        return `Live-play operation ${entry.opId} cannot be ${action} because its stored command fingerprint does not match its metadata.`
      }
    } catch (error) {
      return `Live-play operation ${entry.opId} cannot be ${action} because its stored command identity is invalid: ${outboxErrorMessage(error)}`
    }

    return validateCommandBodyAuthContext(entry.body, entry.authContext)
  }

  const validateStoredEntryForRetry = (
    entry: LivePlayCommandOutboxEntry,
    authContext: LivePlayCommandOutboxAuthContext,
  ): string | null => {
    if (entry.mapSlug !== options.slug) {
      return `Live-play operation ${entry.opId} belongs to map ${entry.mapSlug}, not the current map ${options.slug}.`
    }

    if (!authContextsEqual(entry.authContext, authContext)) {
      return `Live-play operation ${entry.opId} belongs to a different auth/profile context and cannot be retried here.`
    }

    if (entry.state === 'sending') {
      return `Live-play operation ${entry.opId} is already leased for sending. Recover expired leases before retrying it.`
    }
    if (entry.state !== 'queued' && entry.state !== 'uncertain') {
      return `Live-play operation ${entry.opId} is not in a retryable outbox state.`
    }

    return validateStoredEntryIdentity(entry, 'retried')
  }

  const validateStoredEntryForStatusCheck = (
    entry: LivePlayCommandOutboxEntry,
    authContext: LivePlayCommandOutboxAuthContext,
  ): string | null => {
    if (entry.mapSlug !== options.slug) {
      return `Live-play operation ${entry.opId} belongs to map ${entry.mapSlug}, not the current map ${options.slug}.`
    }

    if (!authContextsEqual(entry.authContext, authContext)) {
      return `Live-play operation ${entry.opId} belongs to a different auth/profile context and cannot be checked here.`
    }

    if (entry.state !== 'queued' && entry.state !== 'sending' && entry.state !== 'uncertain') {
      return `Live-play operation ${entry.opId} is not in a checkable outbox state.`
    }

    return validateStoredEntryIdentity(entry, 'checked')
  }

  const validateStoredEntryForAbandonment = (
    entry: LivePlayCommandOutboxEntry,
    authContext: LivePlayCommandOutboxAuthContext,
  ): string | null => {
    if (entry.mapSlug !== options.slug) {
      return `Live-play operation ${entry.opId} belongs to map ${entry.mapSlug}, not the current map ${options.slug}.`
    }

    if (!authContextsEqual(entry.authContext, authContext)) {
      return `Live-play operation ${entry.opId} belongs to a different auth/profile context and cannot be abandoned here.`
    }

    if (entry.state !== 'queued' && entry.state !== 'sending' && entry.state !== 'uncertain') {
      return `Live-play operation ${entry.opId} is not in an abandonable outbox state.`
    }

    return validateStoredEntryIdentity(entry, 'abandoned')
  }

  const recoveryLocalFailedResult = (
    message: string,
    metadata: Omit<LivePlayCommandDispatchResult, 'dispatched' | 'message'> = {},
  ): LivePlayCommandDispatchResult => {
    setOutboxRecoveryFailure(message)
    return localCommandFailedResult(message, metadata)
  }

  const recoveryLocalBlockedResult = (
    message: string,
    metadata: Omit<LivePlayCommandDispatchResult, 'dispatched' | 'message'> = {},
  ): LivePlayCommandDispatchResult => {
    setOutboxRecoveryFailure(message)
    return localCommandBlockedResult(message, metadata)
  }

  const finalizeRecoveryRetryResult = (
    result: LivePlayCommandDispatchResult,
  ): LivePlayCommandDispatchResult => {
    const terminalRejected = result.response !== undefined && !acceptedLivePlayResponse(result.response)
    if (result.uncertain) {
      setOutboxRecoveryFailure(result.message ?? 'The recovered live-play command outcome is uncertain.')
    } else if (result.outboxError) {
      setOutboxRecoveryFailure(result.outboxError)
    } else if (!terminalRejected && status.value === 'error' && result.message) {
      setOutboxRecoveryFailure(result.message)
    } else {
      outboxRecoveryStatus.value = 'idle'
      outboxRecoveryError.value = null
    }
    return result
  }

  const retryOutboxCommand: UseLivePlayCommandsReturn['retryOutboxCommand'] = async (opId) => {
    if (activeAbandonment !== null) {
      const message = 'A live-play command abandonment is already active. Wait for it to finish before retrying another operation.'
      options.onCommandBlocked?.(message)
      return { dispatched: false, message, opId }
    }

    if (transportStatus.value === 'sending' || recoveryRetryActive) {
      const message = 'A live-play command is already in flight.'
      setOutboxRecoveryFailure(message)
      options.onCommandBlocked?.(message)
      return { dispatched: false, message, opId }
    }

    if (activeStatusCheck !== null) {
      const message = 'A live-play command status check is already in flight.'
      setOutboxRecoveryFailure(message)
      options.onCommandBlocked?.(message)
      return { dispatched: false, message, opId }
    }

    const blockedMessage = blockedCommandMessage()
    if (blockedMessage) {
      setOutboxRecoveryFailure(blockedMessage)
      return localCommandBlockedResult(blockedMessage, { opId })
    }

    const realtimeAckBlockedMessage = realtimeAcknowledgementBlockedMessage()
    if (realtimeAckBlockedMessage) {
      return recoveryLocalBlockedResult(realtimeAckBlockedMessage, { opId })
    }

    recoveryRetryActive = true
    outboxRecoveryStatus.value = 'retrying'
    outboxRecoveryError.value = null

    try {
      const authContext = currentAuthContext()
      if (!authContext) {
        const message = 'A valid GM or player auth role is required before retrying durable live-play commands.'
        outboxEntrySnapshot.value = []
        return recoveryLocalFailedResult(message, { opId })
      }

      let entry: LivePlayCommandOutboxEntry | null
      try {
        entry = await outbox.get(opId)
      } catch (error) {
        const refreshWarning = await refreshOutboxEntriesQuiet()
        const outboxError = combineOutboxWarnings(outboxErrorMessage(error), refreshWarning)
        return recoveryLocalFailedResult(
          `Live-play operation ${opId} could not be read from durable command storage: ${outboxError}`,
          { opId, outboxError },
        )
      }

      if (!entry) {
        const refreshWarning = await refreshOutboxEntriesQuiet()
        return recoveryLocalFailedResult(
          `Live-play operation ${opId} is no longer present in durable command storage.`,
          { opId, ...(refreshWarning === undefined ? {} : { outboxError: refreshWarning }) },
        )
      }

      const validationIssue = validateStoredEntryForRetry(entry, authContext)
      if (validationIssue) {
        const refreshWarning = await refreshOutboxEntriesQuiet()
        return recoveryLocalFailedResult(
          validationIssue,
          { opId: entry.opId, ...(refreshWarning === undefined ? {} : { outboxError: refreshWarning }) },
        )
      }

      beginSavingOperation(entry.opId)
      trackPendingCommandEntry(entry, 'queued')
      options.onCommandStarted?.()

      let claimResult: Awaited<ReturnType<LivePlayCommandOutbox['claimForSend']>>
      try {
        claimResult = await outbox.claimForSend({ opId: entry.opId, leaseOwner })
      } catch (error) {
        const refreshWarning = await refreshOutboxEntriesQuiet()
        const outboxError = combineOutboxWarnings(outboxErrorMessage(error), refreshWarning)
        return recoveryLocalFailedResult(
          `Live-play operation ${entry.opId} could not be claimed for retry: ${outboxError}`,
          { opId: entry.opId, outboxError },
        )
      }

      const claimRefreshWarning = await refreshOutboxEntriesQuiet()
      if (!claimResult.claimed) {
        if (claimResult.reason === 'missing') {
          return recoveryLocalFailedResult(
            `Live-play operation ${entry.opId} disappeared from durable command storage before it could be retried.`,
            { opId: entry.opId, ...(claimRefreshWarning === undefined ? {} : { outboxError: claimRefreshWarning }) },
          )
        }

        return recoveryLocalBlockedResult(
          `Live-play operation ${entry.opId} is being sent by another tab or page instance.`,
          { opId: entry.opId, ...(claimRefreshWarning === undefined ? {} : { outboxError: claimRefreshWarning }) },
        )
      }

      recordCommandTraceEvent(
        commandTraceMetadataFromEntry(claimResult.entry),
        LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CLAIMED,
      )
      trackPendingCommandEntry(claimResult.entry, 'sending')

      const result = withOutboxWarning(
        await sendClaimedOutboxEntry({ entry: claimResult.entry, origin: 'recovery' }),
        claimRefreshWarning,
      )
      return finalizeRecoveryRetryResult(result)
    } finally {
      recoveryRetryActive = false
    }
  }

  const operationStatusFailure = (
    opId: string,
    message: string,
  ): LivePlayOperationStatusCheckResult => {
    setOutboxRecoveryFailure(message)
    return { status: 'error', opId, message }
  }

  const operationStatusBlocked = (
    opId: string,
    message: string,
  ): LivePlayOperationStatusCheckResult => {
    setOutboxRecoveryFailure(message)
    return { status: 'error', opId, message }
  }

  const operationStatusConcurrentBlocked = (
    opId: string,
    message: string,
  ): LivePlayOperationStatusCheckResult => ({ status: 'error', opId, message })

  const processAcceptedStatusTerminalResponse = async (
    response: LivePlayCommandResponse,
    opId: string,
  ): Promise<LivePlayOperationStatusCheckResult> => {
    let message: string | undefined

    try {
      await adoptAcceptedLivePlayResponse(MAP_API_PATHS.operationStatus, response, {
        reconcileOnPatchFailure: false,
      })
    } catch (processingError) {
      message = getErrorMessage(processingError, {
        fallback: 'Live-play command status was accepted, but local response processing failed. Requesting authoritative reconciliation.',
      })
      status.value = 'error'
      lastError.value = message
      options.onCommandFailed?.(message)
    }

    const reconciliationWarning = await requestRecoveryReconciliation(MAP_API_PATHS.operationStatus, response)
    message = combineOutboxWarnings(message, reconciliationWarning)

    if (message === undefined) {
      status.value = 'idle'
      lastError.value = null
      outboxRecoveryStatus.value = 'idle'
      outboxRecoveryError.value = null
    } else {
      setOutboxRecoveryFailure(message)
    }

    return {
      status: 'accepted',
      opId,
      response,
      ...(message === undefined ? {} : { message }),
    }
  }

  const processRejectedStatusTerminalResponse = async (
    entry: LivePlayCommandOutboxEntry,
    response: LivePlayCommandResponse,
  ): Promise<LivePlayOperationStatusCheckResult> => {
    const result = await processRejectedTerminalResponse(entry.requestPath, response, entry.opId, undefined)
    outboxRecoveryStatus.value = 'idle'
    outboxRecoveryError.value = null
    return {
      status: 'rejected',
      opId: entry.opId,
      response,
      ...(result.message === undefined ? {} : { message: result.message }),
    }
  }

  const checkOutboxCommandStatusOnce = async (opId: string): Promise<LivePlayOperationStatusCheckResult> => {
    const authContext = currentAuthContext()
    if (!authContext) {
      outboxEntrySnapshot.value = []
      return operationStatusFailure(
        opId,
        'A valid GM or player auth role is required before checking durable live-play command status.',
      )
    }

    let entry: LivePlayCommandOutboxEntry | null
    try {
      entry = await outbox.get(opId)
    } catch (error) {
      const refreshWarning = await refreshOutboxEntriesQuiet()
      const outboxError = combineOutboxWarnings(outboxErrorMessage(error), refreshWarning)
      return operationStatusFailure(
        opId,
        `Live-play operation ${opId} could not be read from durable command storage: ${outboxError}`,
      )
    }

    if (!entry) {
      const refreshWarning = await refreshOutboxEntriesQuiet()
      return operationStatusFailure(
        opId,
        combineOutboxWarnings(
          `Live-play operation ${opId} is no longer present in durable command storage.`,
          refreshWarning,
        ) ?? `Live-play operation ${opId} is no longer present in durable command storage.`,
      )
    }

    const validationIssue = validateStoredEntryForStatusCheck(entry, authContext)
    if (validationIssue) {
      const refreshWarning = await refreshOutboxEntriesQuiet()
      return operationStatusFailure(
        entry.opId,
        combineOutboxWarnings(validationIssue, refreshWarning) ?? validationIssue,
      )
    }

    let rawStatus: unknown
    try {
      rawStatus = await postJson<unknown>(MAP_API_PATHS.operationStatus, { command: entry.body })
    } catch (error) {
      return operationStatusFailure(
        entry.opId,
        `Live-play operation ${entry.opId} status could not be checked. The outbox entry was left unchanged. ${getErrorMessage(error, { fallback: 'The HTTP request failed before an operation status was received.' })}`,
      )
    }

    let operationStatus
    try {
      operationStatus = parseLivePlayOperationStatusResponse(rawStatus)
    } catch (error) {
      return operationStatusFailure(
        entry.opId,
        `Live-play operation ${entry.opId} status response was not trustworthy. The outbox entry was left unchanged. ${getErrorMessage(error, { fallback: 'Invalid operation status response' })}`,
      )
    }

    if (operationStatus.mapSlug !== entry.mapSlug || operationStatus.opId !== entry.opId) {
      return operationStatusFailure(
        entry.opId,
        `Live-play operation ${entry.opId} status response did not match the stored outbox entry. The outbox entry was left unchanged.`,
      )
    }

    if (operationStatus.status === 'unknown') {
      outboxRecoveryStatus.value = 'idle'
      outboxRecoveryError.value = null
      return {
        status: 'unknown',
        opId: entry.opId,
        message: `The server has no terminal record for live-play operation ${entry.opId} yet. The outbox entry was left unchanged; an earlier in-flight request may still finish later.`,
      }
    }

    const terminalValidation = validateTerminalResponseForCommand({
      response: operationStatus.result,
      command: entry.body,
    })
    if (!terminalValidation.valid) {
      return operationStatusFailure(
        entry.opId,
        `Live-play operation ${entry.opId} terminal status did not match the stored command. The outbox entry was left unchanged. ${validationIssueSummary(terminalValidation.issues)}`,
      )
    }

    outboxRecoveryStatus.value = 'synchronizing'
    outboxRecoveryError.value = null

    const acknowledgeWarning = await acknowledgeTerminalResponse(entry.opId)
    if (acknowledgeWarning) {
      await refreshOutboxEntriesQuiet({ preserveRecoveryError: true })
      return operationStatusFailure(entry.opId, acknowledgeWarning)
    }

    const refreshWarning = await refreshOutboxEntriesQuiet()
    if (refreshWarning) {
      return operationStatusFailure(entry.opId, refreshWarning)
    }

    const response = operationStatus.result as LivePlayCommandResponse
    return acceptedLivePlayResponse(response)
      ? await processAcceptedStatusTerminalResponse(response, entry.opId)
      : await processRejectedStatusTerminalResponse(entry, response)
  }

  const checkOutboxCommandStatus: UseLivePlayCommandsReturn['checkOutboxCommandStatus'] = (opId) => {
    if (activeAbandonment !== null) {
      return Promise.resolve(operationStatusConcurrentBlocked(
        opId,
        'A live-play command abandonment is already active. Wait for it to finish before checking the server.',
      ))
    }

    if (activeStatusCheck !== null) {
      if (activeStatusCheckOpId === opId) return activeStatusCheck
      return Promise.resolve(operationStatusConcurrentBlocked(
        opId,
        `Live-play operation ${activeStatusCheckOpId ?? '(unknown)'} is already being checked with the server. Wait for that read-only status check to finish before checking another operation.`,
      ))
    }

    if (transportStatus.value === 'sending' || recoveryRetryActive) {
      return Promise.resolve(operationStatusBlocked(opId, 'A live-play command is already in flight.'))
    }

    outboxRecoveryStatus.value = 'checking'
    outboxRecoveryError.value = null
    activeStatusCheckOpId = opId
    activeStatusCheck = checkOutboxCommandStatusOnce(opId)
      .finally(() => {
        if (activeStatusCheckOpId === opId) {
          activeStatusCheckOpId = null
          activeStatusCheck = null
        }
      })

    return activeStatusCheck
  }

  const ABANDONED_OPERATION_MESSAGE =
    'The operation was safely abandoned before execution. Future requests using this operation ID cannot apply its effects.'
  const ALREADY_ACCEPTED_ABANDONMENT_MESSAGE =
    'The operation had already been accepted by the server. The authoritative table state was synchronized.'

  const abandonmentFailure = (
    opId: string,
    message: string,
  ): LivePlayOperationAbandonmentClientResult => {
    setOutboxRecoveryFailure(message)
    return { status: 'error', opId, message }
  }

  const abandonmentConcurrentBlocked = (
    opId: string,
    message: string,
  ): LivePlayOperationAbandonmentClientResult => ({ status: 'error', opId, message })

  const finishAbandonmentRecovery = (message: string | undefined): void => {
    status.value = 'idle'
    lastError.value = null
    if (message === undefined) {
      outboxRecoveryStatus.value = 'idle'
      outboxRecoveryError.value = null
      return
    }
    setOutboxRecoveryFailure(message)
  }

  const validateAbandonmentResponseForEntry = (
    entry: LivePlayCommandOutboxEntry,
    rawResponse: unknown,
  ): { readonly ok: true; readonly response: LivePlayOperationAbandonmentResponse } | { readonly ok: false; readonly message: string } => {
    let response: LivePlayOperationAbandonmentResponse
    try {
      response = parseLivePlayOperationAbandonmentResponse(rawResponse)
    } catch (error) {
      return {
        ok: false,
        message: `Live-play operation ${entry.opId} abandonment response was not trustworthy. The outbox entry was left unchanged. ${getErrorMessage(error, { fallback: 'Invalid operation-abandonment response' })}`,
      }
    }

    if (response.opId !== entry.opId || response.mapSlug !== entry.mapSlug || response.mapSlug !== options.slug) {
      return {
        ok: false,
        message: `Live-play operation ${entry.opId} abandonment response did not match the stored outbox entry and current map. The outbox entry was left unchanged.`,
      }
    }

    if (response.result.opId !== entry.opId || response.result.mapSlug !== entry.mapSlug) {
      return {
        ok: false,
        message: `Live-play operation ${entry.opId} abandonment terminal result did not match the stored outbox entry. The outbox entry was left unchanged.`,
      }
    }

    const terminalValidation = validateTerminalResponseForCommand({
      response: response.result,
      command: entry.body,
    })
    if (!terminalValidation.valid) {
      return {
        ok: false,
        message: `Live-play operation ${entry.opId} abandonment terminal result did not match the stored command. The outbox entry was left unchanged. ${validationIssueSummary(terminalValidation.issues)}`,
      }
    }

    return { ok: true, response }
  }

  const acknowledgeAbandonmentTerminalResponse = async (opId: string): Promise<string | undefined> => {
    try {
      await outbox.acknowledgeTerminal(opId)
      removeAcknowledgedEntryFromSnapshot(opId)
      return undefined
    } catch (error) {
      return `Live-play operation ${opId} received a trustworthy terminal server result, but local durable recovery state could not be removed: ${outboxErrorMessage(error)} You may safely repeat Abandon or Check server later.`
    }
  }

  const processAbandonedAbandonmentResponse = async (
    abandonmentResponse: LivePlayOperationAbandonmentResponse,
    opId: string,
    warning: string | undefined,
  ): Promise<LivePlayOperationAbandonmentClientResult> => {
    const commandResponse = abandonmentResponse.result as LivePlayCommandResponse
    if (commandResponse.ok !== false || commandResponse.reason !== 'abandoned') {
      return abandonmentFailure(
        opId,
        `Live-play operation ${opId} abandonment response did not contain an abandoned terminal rejection. The outbox entry was left unchanged.`,
      )
    }

    const reconciliationWarning = await requestRecoveryReconciliation(MAP_API_PATHS.operationAbandon, commandResponse)
    const combinedWarning = combineOutboxWarnings(warning, reconciliationWarning)
    finishAbandonmentRecovery(combinedWarning)

    return {
      status: 'abandoned',
      opId,
      response: abandonmentResponse,
      message: combineOutboxWarnings(ABANDONED_OPERATION_MESSAGE, combinedWarning) ?? ABANDONED_OPERATION_MESSAGE,
    }
  }

  const processAcceptedAbandonmentResponse = async (
    abandonmentResponse: LivePlayOperationAbandonmentResponse,
    opId: string,
    warning: string | undefined,
  ): Promise<LivePlayOperationAbandonmentClientResult> => {
    const commandResponse = abandonmentResponse.result as LivePlayCommandResponse
    let processingWarning: string | undefined

    try {
      await adoptAcceptedLivePlayResponse(MAP_API_PATHS.operationAbandon, commandResponse, {
        reconcileOnPatchFailure: false,
      })
    } catch (error) {
      processingWarning = getErrorMessage(error, {
        fallback: 'Live-play command was already accepted, but local durable state adoption failed.',
      })
    }

    const reconciliationWarning = await requestRecoveryReconciliation(MAP_API_PATHS.operationAbandon, commandResponse)
    const combinedWarning = combineOutboxWarnings(warning, processingWarning, reconciliationWarning)
    finishAbandonmentRecovery(combinedWarning)

    return {
      status: 'accepted',
      opId,
      response: abandonmentResponse,
      commandResponse,
      message: combineOutboxWarnings(ALREADY_ACCEPTED_ABANDONMENT_MESSAGE, combinedWarning),
    }
  }

  const processRejectedAbandonmentResponse = async (
    entry: LivePlayCommandOutboxEntry,
    abandonmentResponse: LivePlayOperationAbandonmentResponse,
    warning: string | undefined,
  ): Promise<LivePlayOperationAbandonmentClientResult> => {
    const commandResponse = abandonmentResponse.result as LivePlayCommandResponse
    const result = await processRejectedTerminalResponse(entry.requestPath, commandResponse, entry.opId, warning)

    if (result.outboxError) setOutboxRecoveryFailure(result.outboxError)
    else {
      outboxRecoveryStatus.value = 'idle'
      outboxRecoveryError.value = null
    }

    return {
      status: 'rejected',
      opId: entry.opId,
      response: abandonmentResponse,
      commandResponse,
      ...(combineOutboxWarnings(result.message, result.outboxError) === undefined
        ? {}
        : { message: combineOutboxWarnings(result.message, result.outboxError) }),
    }
  }

  const processAbandonmentTerminalResponse = async (
    entry: LivePlayCommandOutboxEntry,
    abandonmentResponse: LivePlayOperationAbandonmentResponse,
    warning: string | undefined,
  ): Promise<LivePlayOperationAbandonmentClientResult> => {
    const commandResponse = abandonmentResponse.result as LivePlayCommandResponse
    if (abandonmentResponse.disposition === 'abandoned') {
      return processAbandonedAbandonmentResponse(abandonmentResponse, entry.opId, warning)
    }
    if (acceptedLivePlayResponse(commandResponse)) {
      return processAcceptedAbandonmentResponse(abandonmentResponse, entry.opId, warning)
    }
    if (!commandResponse.ok && commandResponse.reason === 'abandoned') {
      return processAbandonedAbandonmentResponse(abandonmentResponse, entry.opId, warning)
    }
    return processRejectedAbandonmentResponse(entry, abandonmentResponse, warning)
  }

  const abandonOutboxCommandOnce = async (opId: string): Promise<LivePlayOperationAbandonmentClientResult> => {
    const authContext = currentAuthContext()
    if (!authContext) {
      return abandonmentFailure(
        opId,
        'A valid GM or player auth role is required before abandoning durable live-play commands.',
      )
    }

    let entry: LivePlayCommandOutboxEntry | null
    try {
      entry = await outbox.get(opId)
    } catch (error) {
      return abandonmentFailure(
        opId,
        `Live-play operation ${opId} could not be read from durable command storage: ${outboxErrorMessage(error)}`,
      )
    }

    if (!entry) {
      return abandonmentFailure(
        opId,
        `Live-play operation ${opId} is no longer present in durable command storage.`,
      )
    }

    const validationIssue = validateStoredEntryForAbandonment(entry, authContext)
    if (validationIssue) return abandonmentFailure(entry.opId, validationIssue)

    let rawResponse: unknown
    try {
      rawResponse = await postJson<unknown>(MAP_API_PATHS.operationAbandon, { command: entry.body })
    } catch (error) {
      return abandonmentFailure(
        entry.opId,
        `Live-play operation ${entry.opId} abandonment request failed before a terminal server response was received. The outbox entry was left unchanged. ${getErrorMessage(error, { fallback: 'The HTTP request failed.' })}`,
      )
    }

    const validation = validateAbandonmentResponseForEntry(entry, rawResponse)
    if (!validation.ok) return abandonmentFailure(entry.opId, validation.message)

    const acknowledgeWarning = await acknowledgeAbandonmentTerminalResponse(entry.opId)
    if (acknowledgeWarning) {
      const refreshWarning = await refreshOutboxEntriesQuiet({ preserveRecoveryError: true })
      return abandonmentFailure(
        entry.opId,
        combineOutboxWarnings(acknowledgeWarning, refreshWarning) ?? acknowledgeWarning,
      )
    }

    const refreshWarning = await refreshOutboxEntriesQuiet()
    return processAbandonmentTerminalResponse(entry, validation.response, refreshWarning)
  }

  const abandonOutboxCommand: UseLivePlayCommandsReturn['abandonOutboxCommand'] = (opId) => {
    if (activeAbandonment !== null) {
      if (activeAbandonmentOpId === opId) return activeAbandonment
      return Promise.resolve(abandonmentConcurrentBlocked(
        opId,
        `Live-play operation ${activeAbandonmentOpId ?? '(unknown)'} is already being abandoned. Wait for that server-confirmed abandonment to finish before abandoning another operation.`,
      ))
    }

    if (recoveryRetryActive) {
      return Promise.resolve(abandonmentConcurrentBlocked(
        opId,
        'A live-play command retry is already active. Wait for it to finish before abandoning an operation.',
      ))
    }

    if (activeStatusCheck !== null) {
      return Promise.resolve(abandonmentConcurrentBlocked(
        opId,
        'A live-play command status check is already active. Wait for it to finish before abandoning an operation.',
      ))
    }

    if (outboxRecoveryStatus.value === 'loading') {
      return Promise.resolve(abandonmentFailure(
        opId,
        'Durable command recovery inspection is still loading. Wait for it to finish before abandoning an operation.',
      ))
    }

    if (outboxRecoveryStatus.value === 'synchronizing') {
      return Promise.resolve(abandonmentFailure(
        opId,
        'Accepted-command synchronization is active. Wait for it to finish before abandoning an operation.',
      ))
    }

    outboxRecoveryStatus.value = 'abandoning'
    outboxRecoveryError.value = null
    activeAbandonmentOpId = opId
    activeAbandonment = abandonOutboxCommandOnce(opId)
      .catch((error): LivePlayOperationAbandonmentClientResult => abandonmentFailure(
        opId,
        getErrorMessage(error, { fallback: 'Live-play operation abandonment failed.' }),
      ))
      .finally(() => {
        if (activeAbandonmentOpId === opId) {
          activeAbandonmentOpId = null
          activeAbandonment = null
        }
      })

    return activeAbandonment
  }

  const resolvedMoveFromRealtimeResponse = (
    response: LivePlayCommandResponse,
  ): LivePlayResolvedMoveResult | undefined => {
    const extracted = extractResolvedMoveResult(response)
    return extracted.ok ? extracted.move : undefined
  }

  const acceptedRealtimeResponse = (
    event: LivePlayAcceptedRealtimeEvent,
  ): LivePlayCommandResponse => {
    const response: LivePlayCommandResponse = {
      ok: true,
      opId: event.opId,
      mapSlug: event.mapSlug,
      previousRevision: event.previousRevision,
      revision: event.revision,
      patches: [...event.patches],
    }
    const move = resolvedMoveFromRealtimeResponse(response)
    const capture = pokeballCaptureFromAcceptedRealtimeEvent(event)

    return {
      ...response,
      ...(move === undefined ? {} : { move }),
      ...(capture === undefined ? {} : { capture }),
    }
  }

  const validateEntryForRealtimeAcknowledgement = (
    entry: LivePlayCommandOutboxEntry,
    event: LivePlayAcceptedRealtimeEvent,
  ): string | null => {
    if (event.mapSlug !== options.slug) {
      return 'Accepted live-play command event belongs to a different map.'
    }
    if (entry.mapSlug !== options.slug || entry.mapSlug !== event.mapSlug) {
      return `Live-play operation ${event.opId} does not belong to this map.`
    }
    if (!isRecord(entry.body)) {
      return `Live-play operation ${event.opId} has an invalid stored command body.`
    }
    if (entry.body.opId !== entry.opId || entry.body.opId !== event.opId) {
      return `Live-play operation ${event.opId} cannot be acknowledged because its stored operation ID does not match.`
    }
    if (entry.body.mapSlug !== entry.mapSlug || entry.body.mapSlug !== event.mapSlug) {
      return `Live-play operation ${event.opId} cannot be acknowledged because its stored map identity does not match.`
    }
    if (entry.state !== 'queued' && entry.state !== 'sending' && entry.state !== 'uncertain') {
      return `Live-play operation ${event.opId} is not in an acknowledgeable outbox state.`
    }
    if (!isStoredLivePlayCommandRequestPath(entry.requestPath)) {
      return `Live-play operation ${event.opId} has an invalid stored API request path.`
    }
    return null
  }

  const adoptAcceptedRealtimeEvent = (
    entry: LivePlayCommandOutboxEntry,
    event: LivePlayAcceptedRealtimeEvent,
  ): Promise<void> => adoptAcceptedLivePlayResponse(
    entry.requestPath,
    acceptedRealtimeResponse(event),
  )

  const acknowledgeAcceptedRealtimeEvent: UseLivePlayCommandsReturn['acknowledgeAcceptedRealtimeEvent'] = async (event) => {
    if (event.mapSlug !== options.slug) {
      return {
        status: 'invalid',
        message: 'Accepted live-play command event belongs to a different map.',
      }
    }

    let entry: LivePlayCommandOutboxEntry | null
    try {
      entry = await outbox.get(event.opId)
    } catch (error) {
      const message = `Accepted live-play operation ${event.opId} could not be read from durable command storage: ${outboxErrorMessage(error)}`
      status.value = 'error'
      lastError.value = message
      setOutboxRecoveryFailure(message)
      return { status: 'error', opId: event.opId, message }
    }

    if (!entry) return { status: 'not-local', opId: event.opId }

    const validationIssue = validateEntryForRealtimeAcknowledgement(entry, event)
    if (validationIssue) return { status: 'invalid', message: validationIssue }

    recordCommandTraceEvent(commandTraceMetadataFromEntry(entry), LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.SSE_TERMINAL, {
      outcome: 'accepted',
      revision: event.revision,
    })

    outboxRecoveryStatus.value = 'synchronizing'
    outboxRecoveryError.value = null

    const response = acceptedRealtimeResponse(event)
    const wasLocalPendingCommand = pendingCommandRecords.value[event.opId] !== undefined

    try {
      await outbox.acknowledgeTerminal(event.opId)
    } catch (error) {
      const message = `Accepted live-play operation ${event.opId} was committed by the server, but removing it from durable command storage failed: ${outboxErrorMessage(error)}`
      markOperationFailed(event.opId, message)
      setOutboxRecoveryFailure(message)
      await refreshOutboxEntriesQuiet({ preserveRecoveryError: true })
      return { status: 'error', opId: event.opId, message }
    }

    if (wasLocalPendingCommand) realtimeAcknowledgedResponses.set(event.opId, response)
    else realtimeAcknowledgedResponses.delete(event.opId)
    realtimeAcknowledgementFailures.delete(event.opId)
    realtimeAcknowledgementAdoptions.delete(event.opId)

    const adoptionProcessing = adoptAcceptedRealtimeEvent(entry, event).then(
      () => undefined,
      (error) => `Accepted live-play operation ${event.opId} was acknowledged, but authoritative synchronization failed: ${getErrorMessage(error, { fallback: 'Live-play realtime acknowledgement reconciliation failed' })}`,
    )

    if (wasLocalPendingCommand) realtimeAcknowledgementAdoptions.set(event.opId, adoptionProcessing)

    const refreshWarning = await refreshOutboxEntriesQuiet()
    const adoptionFailureMessage = await adoptionProcessing
    if (realtimeAcknowledgementAdoptions.get(event.opId) === adoptionProcessing) {
      realtimeAcknowledgementAdoptions.delete(event.opId)
    }

    if (adoptionFailureMessage) {
      if (realtimeAcknowledgedResponses.has(event.opId)) realtimeAcknowledgementFailures.set(event.opId, adoptionFailureMessage)
      markOperationFailed(event.opId, adoptionFailureMessage)
      setOutboxRecoveryFailure(adoptionFailureMessage)
      return { status: 'error', opId: event.opId, message: adoptionFailureMessage }
    }

    markOperationAccepted(event.opId)
    if (wasLocalPendingCommand) options.onCommandAccepted?.(response)

    if (refreshWarning) {
      const message = `Accepted live-play operation ${event.opId} was acknowledged, but durable command recovery state could not be refreshed: ${refreshWarning}`
      if (realtimeAcknowledgedResponses.has(event.opId)) realtimeAcknowledgementFailures.set(event.opId, message)
      setOutboxRecoveryFailure(message)
      return { status: 'error', opId: event.opId, message }
    }

    outboxRecoveryStatus.value = 'idle'
    outboxRecoveryError.value = null
    return { status: 'acknowledged', opId: event.opId }
  }

  return {
    status,
    transportStatus,
    lastError,
    outboxEntries,
    outboxRecoveryStatus,
    outboxRecoveryError,
    pendingCommands,
    pendingCommandCount,
    pendingPredictions,
    pendingPredictionCount,
    commandTraces,
    hasPendingOutboxCommands,
    clearError,
    refreshOutboxEntries,
    recoverInterruptedOutboxCommands,
    retryOutboxCommand,
    checkOutboxCommandStatus,
    abandonOutboxCommand,
    acknowledgeAcceptedRealtimeEvent,
    beforeLivePlayPatchesApply,
    afterLivePlayPatchesApply,
    spawnToken,
    sendOutPokemon,
    deleteToken,
    throwPokeball,
    moveToken,
    turnToken,
    modifyHp,
    modifyCombatStages,
    modifyConditions,
    grantExperience,
    useMove,
    resolveMove,
    setInitiative,
    nextInitiative,
    previousInitiative,
    placeHazard,
    removeHazard,
    buildTerrainVoxel,
    removeTerrainVoxel,
    setFieldEffect,
    removeFieldEffect,
    tickFieldEffectDurations,
    useManeuver,
    useAbility,
    useOrder,
    setScene,
    updateAttackOfOpportunity,
    updateStartTurnModal,
  }
}
