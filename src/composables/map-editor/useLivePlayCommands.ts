import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { isAuthRole, type AuthRole } from '#shared/auth'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayOpId,
  type AdvanceInitiativePayload,
  type BuildTerrainVoxelPayload,
  type DeleteTokenPayload,
  type GrantExperiencePayload,
  type LivePlayCommandAccepted,
  type LivePlayCommandDuplicate,
  type LivePlayCommandRejectionReason,
  type LivePlayCommandResult,
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
import { bindPendingLivePlayCommandUnloadWarning } from '~/utils/livePlayCommandUnloadWarning'
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
export type LivePlayCommandOutboxRecoveryStatus = 'idle' | 'loading' | 'retrying' | 'checking' | 'synchronizing' | 'error'

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
  readonly outboxError?: string
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
  lastError: Ref<string | null>
  outboxEntries: ComputedRef<readonly LivePlayCommandOutboxEntry[]>
  outboxRecoveryStatus: Ref<LivePlayCommandOutboxRecoveryStatus>
  outboxRecoveryError: Ref<string | null>
  hasPendingOutboxCommands: ComputedRef<boolean>
  clearError: () => void
  refreshOutboxEntries: () => Promise<readonly LivePlayCommandOutboxEntry[]>
  recoverInterruptedOutboxCommands: () => Promise<readonly LivePlayCommandOutboxEntry[]>
  retryOutboxCommand: (opId: string) => Promise<LivePlayCommandDispatchResult>
  checkOutboxCommandStatus: (opId: string) => Promise<LivePlayOperationStatusCheckResult>
  acknowledgeAcceptedRealtimeEvent: (
    event: LivePlayAcceptedRealtimeEvent,
  ) => Promise<LivePlayRealtimeAcknowledgementResult>
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

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

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
  let recoveryRetryActive = false
  let activeStatusCheck: Promise<LivePlayOperationStatusCheckResult> | null = null
  let activeStatusCheckOpId: string | null = null

  if (getCurrentScope()) {
    const removePendingCommandUnloadWarning = bindPendingLivePlayCommandUnloadWarning(() => status.value === 'saving')
    onScopeDispose(() => {
      removePendingCommandUnloadWarning?.()
    })
  }

  const clearError = () => {
    if (status.value === 'error') status.value = 'idle'
    lastError.value = null
    options.onCommandErrorCleared?.()
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

  const commandBody = (
    authContext: LivePlayCommandOutboxAuthContext,
    type: LivePlayClientCommandType,
    payload: LivePlayClientCommandPayload,
    scopes: readonly LivePlayScope[],
  ): Record<string, unknown> => ({
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: createLivePlayOpId(),
    mapSlug: options.slug,
    baseRevision: normalizeRevision(options.mapRevision?.value),
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
  ): Record<string, unknown> => commandBody(authContext, type, payload, [tokenScope(payload, field)])

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

  const localCommandBlockedResult = (
    message: string,
    metadata: Omit<LivePlayCommandDispatchResult, 'dispatched' | 'message'> = {},
  ): LivePlayCommandDispatchResult => {
    status.value = 'error'
    lastError.value = message
    options.onCommandBlocked?.(message)
    return { dispatched: false, message, ...metadata }
  }

  const localCommandFailedResult = (
    message: string,
    metadata: Omit<LivePlayCommandDispatchResult, 'dispatched' | 'message'> = {},
  ): LivePlayCommandDispatchResult => {
    status.value = 'error'
    lastError.value = message
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

  const uncertaintyResult = async (
    entry: LivePlayCommandOutboxEntry,
    detail: string,
    origin: 'immediate' | 'recovery',
  ): Promise<LivePlayCommandDispatchResult> => {
    const message = `The server outcome for live-play operation ${entry.opId} is unknown. Retrying the same operation ID will be safe later. ${detail}`
    const outboxWarning = await markClaimedEntryUncertain(entry, message)
    status.value = 'error'
    lastError.value = message
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

  const adoptAcceptedLivePlayResponse = async (
    request: string,
    response: LivePlayCommandResponse,
    adoptOptions: { readonly reconcileOnPatchFailure?: boolean } = {},
  ): Promise<void> => {
    const reconcileOnPatchFailure = adoptOptions.reconcileOnPatchFailure ?? true
    const patchResult = acceptedPatchResult(response)
    if (response.map) options.applyPersistedMap?.(response.map)
    else if (patchResult && options.map?.value) {
      const applied = applyLivePlayPatchesToMap({
        map: options.map.value,
        mapSlug: patchResult.mapSlug,
        previousRevision: patchResult.previousRevision,
        revision: patchResult.revision,
        patches: patchResult.patches,
      })
      if (!applied.ok && reconcileOnPatchFailure) await options.requestReconciliation?.({ request, response })
    } else if (acceptedResultRequiresReconciliation(response) && reconcileOnPatchFailure) {
      await options.requestReconciliation?.({ request, response })
    }
    for (const update of response.sheetUpdates ?? []) options.applySheetUpdate?.(update)
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
      status.value = 'error'
      lastError.value = message
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
      status.value = 'error'
      lastError.value = processingMessage
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
    try {
      await adoptAcceptedLivePlayResponse(request, response)
      const recoveryReconciliationWarning = origin === 'recovery'
        ? await requestRecoveryReconciliation(request, response)
        : undefined
      status.value = 'idle'
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
      status.value = 'error'
      lastError.value = message
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
    try {
      rawResponse = await postJson<unknown>(entry.requestPath, entry.body)
    } catch (postError) {
      const detail = getErrorMessage(postError, { fallback: 'The HTTP request failed before a terminal command result was received.' })
      return uncertaintyResult(entry, detail, origin)
    }

    const validation = validateTerminalResponseForCommand({
      response: rawResponse,
      command: entry.body,
    })
    if (!validation.valid) {
      return uncertaintyResult(
        entry,
        `The command response was not trustworthy: ${validationIssueSummary(validation.issues)}`,
        origin,
      )
    }

    const response = rawResponse as LivePlayCommandResponse
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

  const runLivePlayCommand = async (
    request: string,
    buildBody: LivePlayCommandBodyFactory,
  ): Promise<LivePlayCommandDispatchResult> => {
    if (status.value === 'saving' || recoveryRetryActive) {
      const message = 'A live-play command is already in flight.'
      options.onCommandBlocked?.(message)
      return { dispatched: false, message }
    }

    const blockedMessage = blockedCommandMessage()
    if (blockedMessage) return localCommandBlockedResult(blockedMessage)

    const realtimeAckBlockedMessage = realtimeAcknowledgementBlockedMessage()
    if (realtimeAckBlockedMessage) return localCommandBlockedResult(realtimeAckBlockedMessage)

    const pendingCommandMessage = newCommandBlockedMessage()
    if (pendingCommandMessage) return localCommandBlockedResult(pendingCommandMessage)

    const authContext = currentAuthContext()
    if (!authContext) {
      return localCommandBlockedResult('A valid GM or player auth role is required before sending live-play commands.')
    }

    let body: Record<string, unknown>
    try {
      body = buildBody(authContext)
    } catch (buildError) {
      return localCommandFailedResult(getErrorMessage(buildError, { fallback: 'Live-play command body could not be built' }))
    }

    const opId = commandEnvelopeOpId(body)
    const authBodyIssue = validateCommandBodyAuthContext(body, authContext)
    if (authBodyIssue) {
      return localCommandFailedResult(authBodyIssue, opId ? { opId } : {})
    }

    status.value = 'saving'
    lastError.value = null
    options.onCommandStarted?.()

    let enqueuedEntry: LivePlayCommandOutboxEntry
    try {
      enqueuedEntry = await outbox.enqueue({ requestPath: request, body, authContext })
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

    return withOutboxWarning(
      await sendClaimedOutboxEntry({ entry: claimResult.entry, origin: 'immediate' }),
      outboxSyncWarning,
    )
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

  const moveToken: UseLivePlayCommandsReturn['moveToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.moveToken,
    (authContext) => tokenCommandBody(
      authContext,
      LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      {
        placementId: payload.placementId,
        position: payload.position,
        ...(payload.pathLength === undefined || payload.pathLength === null ? {} : { pathLength: payload.pathLength }),
      },
      'position',
    ),
  )

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
    if (status.value === 'saving' || recoveryRetryActive) {
      const message = 'A live-play command is already in flight.'
      options.onCommandBlocked?.(message)
      return { dispatched: false, move: null, message }
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
    action: 'retried' | 'checked',
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
    if (status.value === 'saving' || recoveryRetryActive) {
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

      status.value = 'saving'
      lastError.value = null
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
    if (activeStatusCheck !== null) {
      if (activeStatusCheckOpId === opId) return activeStatusCheck
      return Promise.resolve(operationStatusConcurrentBlocked(
        opId,
        `Live-play operation ${activeStatusCheckOpId ?? '(unknown)'} is already being checked with the server. Wait for that read-only status check to finish before checking another operation.`,
      ))
    }

    if (status.value === 'saving' || recoveryRetryActive) {
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

  const acceptedRealtimeResponse = (
    event: LivePlayAcceptedRealtimeEvent,
  ): LivePlayCommandResponse => ({
    ok: true,
    opId: event.opId,
    mapSlug: event.mapSlug,
    previousRevision: event.previousRevision,
    revision: event.revision,
    patches: [...event.patches],
  })

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

  const startRealtimeAcknowledgementReconciliation = (
    entry: LivePlayCommandOutboxEntry,
    event: LivePlayAcceptedRealtimeEvent,
  ): Promise<void> => {
    if (!options.requestReconciliation) return Promise.resolve()
    try {
      return Promise.resolve(options.requestReconciliation({
        request: entry.requestPath,
        response: acceptedRealtimeResponse(event),
      }))
    } catch (error) {
      return Promise.reject(error)
    }
  }

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

    outboxRecoveryStatus.value = 'synchronizing'
    outboxRecoveryError.value = null

    try {
      await outbox.acknowledgeTerminal(event.opId)
    } catch (error) {
      const message = `Accepted live-play operation ${event.opId} was committed by the server, but removing it from durable command storage failed: ${outboxErrorMessage(error)}`
      status.value = 'error'
      lastError.value = message
      setOutboxRecoveryFailure(message)
      await refreshOutboxEntriesQuiet({ preserveRecoveryError: true })
      return { status: 'error', opId: event.opId, message }
    }

    const reconciliation = startRealtimeAcknowledgementReconciliation(entry, event)
    const refreshWarning = await refreshOutboxEntriesQuiet()

    try {
      await reconciliation
    } catch (error) {
      const message = `Accepted live-play operation ${event.opId} was acknowledged, but authoritative synchronization failed: ${getErrorMessage(error, { fallback: 'Live-play realtime acknowledgement reconciliation failed' })}`
      status.value = 'error'
      lastError.value = message
      setOutboxRecoveryFailure(message)
      return { status: 'error', opId: event.opId, message }
    }

    if (refreshWarning) {
      const message = `Accepted live-play operation ${event.opId} was acknowledged, but durable command recovery state could not be refreshed: ${refreshWarning}`
      status.value = 'error'
      lastError.value = message
      setOutboxRecoveryFailure(message)
      return { status: 'error', opId: event.opId, message }
    }

    if (status.value !== 'saving') {
      status.value = 'idle'
      lastError.value = null
    }
    outboxRecoveryStatus.value = 'idle'
    outboxRecoveryError.value = null
    return { status: 'acknowledged', opId: event.opId }
  }

  return {
    status,
    lastError,
    outboxEntries,
    outboxRecoveryStatus,
    outboxRecoveryError,
    hasPendingOutboxCommands,
    clearError,
    refreshOutboxEntries,
    recoverInterruptedOutboxCommands,
    retryOutboxCommand,
    checkOutboxCommandStatus,
    acknowledgeAcceptedRealtimeEvent,
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
