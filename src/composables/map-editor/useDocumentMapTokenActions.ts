import { ref, type Ref } from 'vue'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayOpId,
  type BuildTerrainVoxelPayload,
  type DeleteTokenPayload,
  type LivePlayCommandDuplicate,
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
  type UseMovePayload,
} from '#shared/livePlayCommands'
import { normalizeRevision } from '#shared/sessionRevisions'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { useApiClient } from '~/composables/useApiClient'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { GridAnchor, MapHazardV2, SheetPlacement, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export type DocumentMapTokenActionStatus = 'idle' | 'saving' | 'error'

export interface DocumentMapTokenActionSheetUpdate {
  kind: 'pokemon' | 'trainer'
  slug: string
  path?: string
  sheet: Record<string, unknown>
}

export interface DocumentMapTokenActionResponse {
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
  sheetUpdates?: DocumentMapTokenActionSheetUpdate[]
}

export type LivePlayMapTokenActionResponse = LivePlayCommandResult & {
  path?: string
  map?: TabletopMap
  placement?: SheetPlacement
  sheetUpdates?: DocumentMapTokenActionSheetUpdate[]
}

export interface DocumentMapTokenActionDispatchResult {
  dispatched: boolean
  message?: string
  response?: DocumentMapTokenActionResponse | LivePlayMapTokenActionResponse
}

export interface UseDocumentMapTokenActionsOptions {
  slug: string
  playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
  map?: ReadonlyValueRef<TabletopMap | null | undefined>
  mapRevision?: ReadonlyValueRef<number | null | undefined>
  livePlayCommandBlocked?: ReadonlyValueRef<boolean>
  livePlayCommandBlockedMessage?: ReadonlyValueRef<string | null | undefined>
  applyPersistedMap?: (map: TabletopMap) => void
  applySheetUpdate?: (update: DocumentMapTokenActionSheetUpdate) => void
}

export interface UseDocumentMapTokenActionsReturn {
  status: Ref<DocumentMapTokenActionStatus>
  lastError: Ref<string | null>
  clearError: () => void
  spawnToken: (payload: {
    placement: SheetPlacement
  }) => Promise<DocumentMapTokenActionDispatchResult>
  deleteToken: (payload: {
    placementId: string
  }) => Promise<DocumentMapTokenActionDispatchResult>
  moveToken: (payload: {
    placementId: string
    position: GridAnchor
    pathLength?: number | null
  }) => Promise<DocumentMapTokenActionDispatchResult>
  turnToken: (payload: {
    placementId: string
    facing: TokenFacingDirection
  }) => Promise<DocumentMapTokenActionDispatchResult>
  modifyHp: (payload: {
    placementId: string
    currentHp: number
    injuries?: number
  }) => Promise<DocumentMapTokenActionDispatchResult>
  modifyCombatStages: (payload: {
    placementId: string
    stages: ModifyCombatStagesPayload['stages']
  }) => Promise<DocumentMapTokenActionDispatchResult>
  modifyConditions: (payload: {
    placementId: string
    action?: ModifyConditionsPayload['action']
    conditions: readonly string[]
  }) => Promise<DocumentMapTokenActionDispatchResult>
  useMove: (payload: {
    placementId: string
    moveName: string
  }) => Promise<DocumentMapTokenActionDispatchResult>
  setInitiative: (payload: SetInitiativePayload) => Promise<DocumentMapTokenActionDispatchResult>
  nextInitiative: () => Promise<DocumentMapTokenActionDispatchResult>
  previousInitiative: () => Promise<DocumentMapTokenActionDispatchResult>
  placeHazard: (payload: {
    hazard: MapHazardV2
  }) => Promise<DocumentMapTokenActionDispatchResult>
  removeHazard: (payload: {
    cell: RemoveHazardPayload['cell']
  }) => Promise<DocumentMapTokenActionDispatchResult>
  buildTerrainVoxel: (payload: BuildTerrainVoxelPayload) => Promise<DocumentMapTokenActionDispatchResult>
  removeTerrainVoxel: (payload: RemoveTerrainVoxelPayload) => Promise<DocumentMapTokenActionDispatchResult>
  setFieldEffect: (payload: SetFieldEffectPayload) => Promise<DocumentMapTokenActionDispatchResult>
  removeFieldEffect: (payload: RemoveFieldEffectPayload) => Promise<DocumentMapTokenActionDispatchResult>
  tickFieldEffectDurations: (payload?: TickFieldEffectDurationsPayload) => Promise<DocumentMapTokenActionDispatchResult>
  useManeuver: (payload: {
    placementId: string
    maneuverName: string
    targetPlacementId?: string
  }) => Promise<DocumentMapTokenActionDispatchResult>
  useAbility: (payload: {
    placementId: string
    abilityName: string
    targetPlacementId?: string
  }) => Promise<DocumentMapTokenActionDispatchResult>
  useOrder: (payload: {
    placementId: string
    orderName: string
    targetPlacementId?: string
  }) => Promise<DocumentMapTokenActionDispatchResult>
}

type LivePlayDocumentCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS
  | typeof LIVE_PLAY_COMMAND_TYPES.USE_MOVE
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

type LivePlayMapEffectsCommandPayload =
  | PlaceHazardPayload
  | RemoveHazardPayload
  | BuildTerrainVoxelPayload
  | RemoveTerrainVoxelPayload
  | SetFieldEffectPayload
  | RemoveFieldEffectPayload
  | TickFieldEffectDurationsPayload

type LivePlayDocumentCommandPayload =
  | LivePlayTokenCommandPayload
  | SpawnTokenPayload
  | SetInitiativePayload
  | LivePlayMapEffectsCommandPayload
  | Record<string, never>

const isDuplicateResult = (response: LivePlayMapTokenActionResponse): response is LivePlayCommandDuplicate & LivePlayMapTokenActionResponse => (
  response.ok === true && 'duplicate' in response && response.duplicate === true
)

const livePlayResponseMessage = (response: LivePlayMapTokenActionResponse): string | null => {
  if (!response.ok) return response.message
  if (isDuplicateResult(response) && !response.original.ok) return response.original.message
  return null
}

const acceptedLivePlayResponse = (response: LivePlayMapTokenActionResponse): boolean => {
  if (!response.ok) return false
  return !isDuplicateResult(response) || response.original.ok
}

export const useDocumentMapTokenActions = (
  options: UseDocumentMapTokenActionsOptions,
): UseDocumentMapTokenActionsReturn => {
  const { postJson } = useApiClient()
  const status = ref<DocumentMapTokenActionStatus>('idle')
  const lastError = ref<string | null>(null)

  const clearError = () => {
    if (status.value === 'error') status.value = 'idle'
    lastError.value = null
  }

  const profileBody = (): { profileId?: PlayerProfileId } => {
    const profileId = options.playerProfileId?.value ?? null
    return profileId ? { profileId } : {}
  }

  const actionBody = (body: Record<string, unknown>): Record<string, unknown> => ({
    slug: options.slug,
    clientId: getClientId(),
    ...profileBody(),
    ...body,
  })

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
    type: LivePlayDocumentCommandType,
    payload: LivePlayDocumentCommandPayload,
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

  const runAction = async (
    request: string,
    body: Record<string, unknown>,
  ): Promise<DocumentMapTokenActionDispatchResult> => {
    status.value = 'saving'
    lastError.value = null
    try {
      const response = await postJson<DocumentMapTokenActionResponse>(request, actionBody(body))
      options.applyPersistedMap?.(response.map)
      for (const update of response.sheetUpdates ?? []) options.applySheetUpdate?.(update)
      status.value = 'idle'
      return { dispatched: true, response }
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Token action failed' })
      status.value = 'error'
      lastError.value = message
      return { dispatched: false, message }
    }
  }

  const runLivePlayCommand = async (
    request: string,
    body: Record<string, unknown>,
  ): Promise<DocumentMapTokenActionDispatchResult> => {
    if (options.livePlayCommandBlocked?.value) {
      const message = options.livePlayCommandBlockedMessage?.value
        ?? 'Live-play commands are paused until realtime reconciliation completes'
      status.value = 'error'
      lastError.value = message
      return { dispatched: false, message }
    }

    status.value = 'saving'
    lastError.value = null
    try {
      const response = await postJson<LivePlayMapTokenActionResponse>(request, body)
      if (!acceptedLivePlayResponse(response)) {
        const message = livePlayResponseMessage(response) ?? 'Token action was rejected'
        status.value = 'error'
        lastError.value = message
        return { dispatched: false, message, response }
      }

      if (response.map) options.applyPersistedMap?.(response.map)
      for (const update of response.sheetUpdates ?? []) options.applySheetUpdate?.(update)
      status.value = 'idle'
      return { dispatched: true, response }
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Token action failed' })
      status.value = 'error'
      lastError.value = message
      return { dispatched: false, message }
    }
  }

  const spawnToken: UseDocumentMapTokenActionsReturn['spawnToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.spawnToken,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
      { placement: payload.placement },
      [{ kind: 'token', placementId: payload.placement.id, field: 'spawn' }],
    ),
  )

  const deleteToken: UseDocumentMapTokenActionsReturn['deleteToken'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.deleteToken,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
      { placementId: payload.placementId },
      [{ kind: 'token', placementId: payload.placementId, field: 'delete' }],
    ),
  )

  const moveToken: UseDocumentMapTokenActionsReturn['moveToken'] = (payload) => runLivePlayCommand(
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

  const turnToken: UseDocumentMapTokenActionsReturn['turnToken'] = (payload) => runLivePlayCommand(
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

  const modifyHp: UseDocumentMapTokenActionsReturn['modifyHp'] = (payload) => runLivePlayCommand(
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

  const modifyCombatStages: UseDocumentMapTokenActionsReturn['modifyCombatStages'] = (payload) => runLivePlayCommand(
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

  const modifyConditions: UseDocumentMapTokenActionsReturn['modifyConditions'] = (payload) => runLivePlayCommand(
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

  const useMove: UseDocumentMapTokenActionsReturn['useMove'] = (payload) => {
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

  const setInitiative: UseDocumentMapTokenActionsReturn['setInitiative'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.setInitiative,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
      payload,
      [mapScope('initiative')],
    ),
  )

  const nextInitiative: UseDocumentMapTokenActionsReturn['nextInitiative'] = () => runLivePlayCommand(
    MAP_API_PATHS.nextInitiative,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      {},
      [mapScope('initiative')],
    ),
  )

  const previousInitiative: UseDocumentMapTokenActionsReturn['previousInitiative'] = () => runLivePlayCommand(
    MAP_API_PATHS.previousInitiative,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
      {},
      [mapScope('initiative')],
    ),
  )

  const placeHazard: UseDocumentMapTokenActionsReturn['placeHazard'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.placeHazard,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
      { hazard: payload.hazard },
      [mapScope('hazards')],
    ),
  )

  const removeHazard: UseDocumentMapTokenActionsReturn['removeHazard'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeHazard,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
      { cell: payload.cell },
      [mapScope('hazards')],
    ),
  )

  const buildTerrainVoxel: UseDocumentMapTokenActionsReturn['buildTerrainVoxel'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.buildTerrainVoxel,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
      { voxel: payload.voxel },
      [mapScope('terrain')],
    ),
  )

  const removeTerrainVoxel: UseDocumentMapTokenActionsReturn['removeTerrainVoxel'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeTerrainVoxel,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
      { cell: payload.cell },
      [mapScope('terrain')],
    ),
  )

  const setFieldEffect: UseDocumentMapTokenActionsReturn['setFieldEffect'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.setFieldEffect,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const removeFieldEffect: UseDocumentMapTokenActionsReturn['removeFieldEffect'] = (payload) => runLivePlayCommand(
    MAP_API_PATHS.removeFieldEffect,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const tickFieldEffectDurations: UseDocumentMapTokenActionsReturn['tickFieldEffectDurations'] = (payload = {}) => runLivePlayCommand(
    MAP_API_PATHS.tickFieldEffectDurations,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
      payload,
      [mapScope('fieldEffects')],
    ),
  )

  const useManeuver: UseDocumentMapTokenActionsReturn['useManeuver'] = (payload) => runAction(
    MAP_API_PATHS.useManeuver,
    {
      placementId: payload.placementId,
      maneuverName: payload.maneuverName,
      ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
    },
  )

  const useAbility: UseDocumentMapTokenActionsReturn['useAbility'] = (payload) => runAction(
    MAP_API_PATHS.useAbility,
    {
      placementId: payload.placementId,
      abilityName: payload.abilityName,
      ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
    },
  )

  const useOrder: UseDocumentMapTokenActionsReturn['useOrder'] = (payload) => runAction(
    MAP_API_PATHS.useOrder,
    {
      placementId: payload.placementId,
      orderName: payload.orderName,
      ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
    },
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
