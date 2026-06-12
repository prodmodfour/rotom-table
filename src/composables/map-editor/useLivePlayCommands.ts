import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayOpId,
  type BuildTerrainVoxelPayload,
  type DeleteTokenPayload,
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
  type SetFieldEffectPayload,
  type SetInitiativePayload,
  type SpawnTokenPayload,
  type TickFieldEffectDurationsPayload,
  type TurnTokenPayload,
  type UseAbilityPayload,
  type UseManeuverPayload,
  type UseMovePayload,
  type UseOrderPayload,
} from '#shared/livePlayCommands'
import { normalizeRevision } from '#shared/sessionRevisions'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import { bindPendingLivePlayCommandUnloadWarning } from '~/utils/livePlayCommandUnloadWarning'
import { getErrorMessage } from '~/utils/errorMessages'
import { useApiClient } from '~/composables/useApiClient'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { GridAnchor, MapHazardV2, SheetPlacement, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export type LivePlayCommandStatus = 'idle' | 'saving' | 'error'

export interface LivePlayCommandSheetUpdate {
  kind: 'pokemon' | 'trainer'
  slug: string
  path?: string
  sheet: Record<string, unknown>
}

export interface MapTokenTableActionResponse {
  ok: true
  path: string
  map: TabletopMap
  placement?: SheetPlacement
  action?: {
    type: 'maneuver' | 'ability' | 'order'
    placementId: string
    targetPlacementId?: string
    name: string
    category?: string
  }
  sheetUpdates?: LivePlayCommandSheetUpdate[]
}

export type LivePlayCommandResponse = LivePlayCommandResult & {
  path?: string
  map?: TabletopMap
  placement?: SheetPlacement
  sheetUpdates?: LivePlayCommandSheetUpdate[]
}

export interface LivePlayCommandDispatchResult {
  dispatched: boolean
  message?: string
  response?: MapTokenTableActionResponse | LivePlayCommandResponse
}

export interface UseLivePlayCommandsOptions {
  slug: string
  playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
  map?: ReadonlyValueRef<TabletopMap | null | undefined>
  mapRevision?: ReadonlyValueRef<number | null | undefined>
  livePlayCommandBlocked?: ReadonlyValueRef<boolean>
  livePlayCommandBlockedMessage?: ReadonlyValueRef<string | null | undefined>
  applyPersistedMap?: (map: TabletopMap) => void
  applySheetUpdate?: (update: LivePlayCommandSheetUpdate) => void
  requestReconciliation?: (reason: LivePlayCommandReconciliationRequest) => void | Promise<void>
  onCommandStarted?: () => void
  onCommandAccepted?: (response: MapTokenTableActionResponse | LivePlayCommandResponse) => void
  onCommandRejected?: (transition: {
    reason?: LivePlayCommandRejectionReason | null
    message: string
    response: LivePlayCommandResponse
  }) => void
  onCommandFailed?: (message: string) => void
  onCommandBlocked?: (message: string) => void
  onCommandErrorCleared?: () => void
}

export interface LivePlayCommandReconciliationRequest {
  request: string
  response: LivePlayCommandResponse
}

export interface UseLivePlayCommandsReturn {
  status: Ref<LivePlayCommandStatus>
  lastError: Ref<string | null>
  clearError: () => void
  spawnToken: (payload: {
    placement: SheetPlacement
  }) => Promise<LivePlayCommandDispatchResult>
  deleteToken: (payload: {
    placementId: string
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
  useMove: (payload: {
    placementId: string
    moveName: string
  }) => Promise<LivePlayCommandDispatchResult>
  setInitiative: (payload: SetInitiativePayload) => Promise<LivePlayCommandDispatchResult>
  nextInitiative: () => Promise<LivePlayCommandDispatchResult>
  previousInitiative: () => Promise<LivePlayCommandDispatchResult>
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
}

type LivePlayClientCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_MOVE
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

type LivePlayTokenCommandPayload =
  | MoveTokenPayload
  | TurnTokenPayload
  | DeleteTokenPayload
  | ModifyHpPayload
  | ModifyCombatStagesPayload
  | ModifyConditionsPayload
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
  | SetInitiativePayload
  | LivePlayMapEffectsCommandPayload
  | Record<string, never>

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

const rejectionNeedsStateTransition = (reason: LivePlayCommandRejectionReason | null): boolean => (
  reason === 'stale-revision' || reason === 'persistence-failed'
)

export const useLivePlayCommands = (
  options: UseLivePlayCommandsOptions,
): UseLivePlayCommandsReturn => {
  const { postJson } = useApiClient()
  const status = ref<LivePlayCommandStatus>('idle')
  const lastError = ref<string | null>(null)

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

  const profileBody = (): { profileId?: PlayerProfileId } => {
    const profileId = options.playerProfileId?.value ?? null
    return profileId ? { profileId } : {}
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

  const sheetScope = (
    payload: LivePlayTokenCommandPayload,
    field: string,
  ): LivePlaySheetScope | null => {
    const placement = placementForPayload(payload)
    if (!placement) return null
    return {
      kind: 'sheet',
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      field,
    }
  }

  const commandBody = (
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
    ...profileBody(),
  })

  const tokenCommandBody = (
    type: typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
    payload: MoveTokenPayload | TurnTokenPayload,
    field: LivePlayTokenScope['field'],
  ): Record<string, unknown> => commandBody(type, payload, [tokenScope(payload, field)])

  const sheetCommandBody = (
    type: typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
    payload: ModifyHpPayload | ModifyCombatStagesPayload | ModifyConditionsPayload,
    field: LivePlayTokenScope['field'],
    sheetField: string,
  ): Record<string, unknown> => {
    const sheet = sheetScope(payload, sheetField)
    return commandBody(type, payload, [
      tokenScope(payload, field),
      ...(sheet ? [sheet] : []),
    ])
  }

  const tableActionCommandBody = (
    type: typeof LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER | typeof LIVE_PLAY_COMMAND_TYPES.USE_ABILITY | typeof LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
    payload: UseManeuverPayload | UseAbilityPayload | UseOrderPayload,
  ): Record<string, unknown> => ({
    ...commandBody(type, payload, [tokenScope(payload, 'action')]),
    // Table action routes still read these compatibility fields while their
    // server-side command executors are migrated; keep the canonical envelope
    // fields beside them so the UI does not own endpoint-specific context.
    slug: options.slug,
    ...payload,
  })

  const runAction = async (
    request: string,
    body: Record<string, unknown>,
  ): Promise<LivePlayCommandDispatchResult> => {
    const blockedMessage = blockedCommandMessage()
    if (blockedMessage) {
      status.value = 'error'
      lastError.value = blockedMessage
      options.onCommandBlocked?.(blockedMessage)
      return { dispatched: false, message: blockedMessage }
    }

    status.value = 'saving'
    lastError.value = null
    options.onCommandStarted?.()
    try {
      const response = await postJson<MapTokenTableActionResponse>(request, body)
      options.applyPersistedMap?.(response.map)
      for (const update of response.sheetUpdates ?? []) options.applySheetUpdate?.(update)
      status.value = 'idle'
      options.onCommandAccepted?.(response)
      return { dispatched: true, response }
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Token action failed' })
      status.value = 'error'
      lastError.value = message
      options.onCommandFailed?.(message)
      return { dispatched: false, message }
    }
  }

  const runLivePlayCommand = async (
    request: string,
    body: Record<string, unknown>,
  ): Promise<LivePlayCommandDispatchResult> => {
    const blockedMessage = blockedCommandMessage()
    if (blockedMessage) {
      status.value = 'error'
      lastError.value = blockedMessage
      options.onCommandBlocked?.(blockedMessage)
      return { dispatched: false, message: blockedMessage }
    }

    status.value = 'saving'
    lastError.value = null
    options.onCommandStarted?.()
    try {
      const response = await postJson<LivePlayCommandResponse>(request, body)
      if (!acceptedLivePlayResponse(response)) {
        const message = livePlayResponseMessage(response) ?? 'Token action was rejected'
        const reason = livePlayResponseRejectionReason(response)
        status.value = 'error'
        lastError.value = message
        if (rejectionNeedsStateTransition(reason)) options.onCommandRejected?.({ reason, message, response })
        if (reason === 'stale-revision') await options.requestReconciliation?.({ request, response })
        return { dispatched: false, message, response }
      }

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
        if (!applied.ok) await options.requestReconciliation?.({ request, response })
      } else if (acceptedResultRequiresReconciliation(response)) {
        await options.requestReconciliation?.({ request, response })
      }
      for (const update of response.sheetUpdates ?? []) options.applySheetUpdate?.(update)
      status.value = 'idle'
      options.onCommandAccepted?.(response)
      return { dispatched: true, response }
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Token action failed' })
      status.value = 'error'
      lastError.value = message
      options.onCommandFailed?.(message)
      return { dispatched: false, message }
    }
  }

  const spawnToken: UseLivePlayCommandsReturn['spawnToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.spawnToken,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
      { placement: payload.placement },
      [{ kind: 'token', placementId: payload.placement.id, field: 'spawn' }],
    ),
  )

  const deleteToken: UseLivePlayCommandsReturn['deleteToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.deleteToken,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
      { placementId: payload.placementId },
      [{ kind: 'token', placementId: payload.placementId, field: 'delete' }],
    ),
  )

  const moveToken: UseLivePlayCommandsReturn['moveToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.moveToken,
    tokenCommandBody(
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
    tokenCommandBody(
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
    sheetCommandBody(
      LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      {
        placementId: payload.placementId,
        currentHp: payload.currentHp,
        ...(payload.injuries === undefined ? {} : { injuries: payload.injuries }),
      },
      'hp',
      'hp',
    ),
  )

  const modifyCombatStages: UseLivePlayCommandsReturn['modifyCombatStages'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.modifyCombatStages,
    sheetCommandBody(
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
    sheetCommandBody(
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

  const useMove: UseLivePlayCommandsReturn['useMove'] = (payload) => {
    const commandPayload = {
      placementId: payload.placementId,
      moveName: payload.moveName,
    }
    const sheet = sheetScope(commandPayload, 'moveUsage')
    return runLivePlayCommand(
      MAP_API_PATHS.useMove,
      commandBody(
        LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
        commandPayload,
        [
          tokenScope(commandPayload, 'moveUsage'),
          ...(sheet ? [sheet] : []),
        ],
      ),
    )
  }

  const setInitiative: UseLivePlayCommandsReturn['setInitiative'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.setInitiative,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
      payload,
      [mapScope('initiative')],
    ),
  )

  const nextInitiative: UseLivePlayCommandsReturn['nextInitiative'] = () => runLivePlayCommand(
    MAP_API_PATHS.nextInitiative,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      {},
      [mapScope('initiative')],
    ),
  )

  const previousInitiative: UseLivePlayCommandsReturn['previousInitiative'] = () => runLivePlayCommand(
    MAP_API_PATHS.previousInitiative,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
      {},
      [mapScope('initiative')],
    ),
  )

  const placeHazard: UseLivePlayCommandsReturn['placeHazard'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.placeHazard,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
      { hazard: payload.hazard },
      [mapScope('hazards')],
    ),
  )

  const removeHazard: UseLivePlayCommandsReturn['removeHazard'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeHazard,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
      { cell: payload.cell },
      [mapScope('hazards')],
    ),
  )

  const buildTerrainVoxel: UseLivePlayCommandsReturn['buildTerrainVoxel'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.buildTerrainVoxel,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
      { voxel: payload.voxel },
      [mapScope('terrain')],
    ),
  )

  const removeTerrainVoxel: UseLivePlayCommandsReturn['removeTerrainVoxel'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeTerrainVoxel,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
      { cell: payload.cell },
      [mapScope('terrain')],
    ),
  )

  const setFieldEffect: UseLivePlayCommandsReturn['setFieldEffect'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.setFieldEffect,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const removeFieldEffect: UseLivePlayCommandsReturn['removeFieldEffect'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeFieldEffect,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const tickFieldEffectDurations: UseLivePlayCommandsReturn['tickFieldEffectDurations'] = (payload = {}) => runLivePlayCommand(
    MAP_API_PATHS.tickFieldEffectDurations,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const useManeuver: UseLivePlayCommandsReturn['useManeuver'] = (payload) => runAction(
    MAP_API_PATHS.useManeuver,
    tableActionCommandBody(
      LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
      {
        placementId: payload.placementId,
        maneuverName: payload.maneuverName,
        ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
      },
    ),
  )

  const useAbility: UseLivePlayCommandsReturn['useAbility'] = (payload) => runAction(
    MAP_API_PATHS.useAbility,
    tableActionCommandBody(
      LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      {
        placementId: payload.placementId,
        abilityName: payload.abilityName,
        ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
      },
    ),
  )

  const useOrder: UseLivePlayCommandsReturn['useOrder'] = (payload) => runAction(
    MAP_API_PATHS.useOrder,
    tableActionCommandBody(
      LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
      {
        placementId: payload.placementId,
        orderName: payload.orderName,
        ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
      },
    ),
  )

  return {
    status,
    lastError,
    clearError,
    spawnToken,
    deleteToken,
    moveToken,
    turnToken,
    modifyHp,
    modifyCombatStages,
    modifyConditions,
    useMove,
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
  }
}
