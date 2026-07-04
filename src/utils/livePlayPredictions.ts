import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayPatch,
  type LivePlayScope,
  type ModifyConditionsPayload,
  type ModifyHpPayload,
  type MoveTokenPayload,
  type SheetHpModifiedPatchPayload,
  type TokenMovedPatchPayload,
  type TokenTurnedPatchPayload,
  type TurnTokenPayload,
} from '#shared/livePlayCommands'
import { isRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import { deepCloneJson } from '~/utils/serialization'
import {
  isTokenFacingDirection,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import {
  normalizeTemporaryHpAmount,
  setTemporaryHpForPlacement,
  temporaryHpForPlacement,
} from '~/utils/mapTemporaryHitPoints'
import { normalizeMapSceneState } from '~/utils/mapSceneState'
import { normalizeConditionNames } from '~/utils/statusConditions'

export type LivePlayPredictionCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP
  | typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS

export type LivePlayPredictionPatchType =
  | typeof LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION
  | typeof LIVE_PLAY_PATCH_TYPES.TOKEN_FACING
  | typeof LIVE_PLAY_PATCH_TYPES.TOKEN_HP
  | typeof LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS

export type LivePlayPredictionHpPatchPayload = SheetHpModifiedPatchPayload & {
  readonly previousTemporaryHp: number
  readonly currentTemporaryHp: number
}

export interface LivePlayPredictionConditionsPatchPayload {
  readonly placementId: string
  readonly sheetKind: SheetPlacement['sheetKind']
  readonly sheetSlug: string
  readonly action: ModifyConditionsPayload['action']
  readonly conditions: readonly string[]
  readonly sheetRevision: number
}

export type LivePlayPredictionPatchPayload =
  | TokenMovedPatchPayload
  | TokenTurnedPatchPayload
  | LivePlayPredictionHpPatchPayload
  | LivePlayPredictionConditionsPatchPayload

/**
 * Runtime-only visual patch. These patches intentionally carry local-only
 * metadata and must never be sent to the server as authoritative patches.
 */
export type LivePlayPredictionPatch = LivePlayPatch<
  LivePlayPredictionPatchType,
  LivePlayPredictionPatchPayload,
  LivePlayScope
> & {
  readonly localOnly: true
  readonly predictionOpId: string
}

export type LivePlayPredictionPlacementField = 'position' | 'facing' | 'turned'
export type LivePlayPredictionMapField = 'temporaryHp'
export type LivePlayPredictionTokenMetadataField = 'conditions'
export type LivePlayPredictionChangedField =
  | LivePlayPredictionPlacementField
  | LivePlayPredictionMapField
  | LivePlayPredictionTokenMetadataField

export interface LivePlayPredictionConditionChange {
  readonly action: ModifyConditionsPayload['action']
  readonly conditions: readonly string[]
}

export interface LivePlayLocalPrediction {
  readonly kind: 'live-play-local-prediction'
  readonly localOnly: true
  readonly opId: string
  readonly commandType: LivePlayPredictionCommandType
  readonly mapSlug: string
  readonly baseRevision: number
  readonly placementId: string
  readonly scopes: readonly LivePlayScope[]
  readonly changedFields: readonly LivePlayPredictionChangedField[]
  readonly previousPlacement: SheetPlacement
  readonly predictedPlacement: SheetPlacement
  readonly previousTemporaryHp?: number
  readonly predictedTemporaryHp?: number
  readonly pendingConditionChange?: LivePlayPredictionConditionChange
  readonly patches: readonly LivePlayPredictionPatch[]
  readonly rollbackPatches: readonly LivePlayPredictionPatch[]
}

export interface BuildLivePlayPredictionInput {
  readonly map: TabletopMap | null | undefined
  readonly command: unknown
}

export type LivePlayPredictionApplyFailureReason =
  | 'missing-map'
  | 'map-slug-mismatch'
  | 'stale-map'
  | 'missing-placement'
  | 'invalid-prediction'

export interface LivePlayPredictionApplied {
  readonly ok: true
  readonly applied: true
}

export interface LivePlayPredictionRejected {
  readonly ok: false
  readonly applied: false
  readonly reason: LivePlayPredictionApplyFailureReason
  readonly message: string
}

export type LivePlayPredictionApplyResult = LivePlayPredictionApplied | LivePlayPredictionRejected

type JsonRecord = Record<string, unknown>

interface ParsedPredictionCommand {
  readonly opId: string
  readonly type: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly scopes: readonly LivePlayScope[]
  readonly payload: unknown
}

const isRecord = (value: unknown): value is JsonRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const finiteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
)

const isGridAnchor = (value: unknown): value is GridAnchor => (
  isRecord(value) && finiteNumber(value.x) && finiteNumber(value.y) && finiteNumber(value.z)
)

const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const clonePlacement = (placement: SheetPlacement): SheetPlacement => deepCloneJson(placement)

const sameAnchor = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

const placementHasField = (placement: SheetPlacement, field: 'facing' | 'turned'): boolean => hasOwn(placement, field)

const placementFieldsChanged = (
  previous: SheetPlacement,
  predicted: SheetPlacement,
): readonly LivePlayPredictionPlacementField[] => {
  const changed: LivePlayPredictionPlacementField[] = []
  if (!sameAnchor(previous.position, predicted.position)) changed.push('position')
  if (placementHasField(previous, 'facing') !== placementHasField(predicted, 'facing') || previous.facing !== predicted.facing) {
    changed.push('facing')
  }
  if (placementHasField(previous, 'turned') !== placementHasField(predicted, 'turned') || previous.turned !== predicted.turned) {
    changed.push('turned')
  }
  return changed
}

const parsePredictionCommand = (command: unknown): ParsedPredictionCommand | null => {
  if (!isRecord(command)) return null
  if (command.schemaVersion !== LIVE_PLAY_COMMAND_SCHEMA_VERSION) return null
  if (!nonEmptyString(command.opId)) return null
  if (!nonEmptyString(command.type)) return null
  if (!nonEmptyString(command.mapSlug)) return null
  if (!isRevision(command.baseRevision)) return null
  if (!Array.isArray(command.scopes)) return null

  return {
    opId: command.opId,
    type: command.type,
    mapSlug: command.mapSlug,
    baseRevision: command.baseRevision,
    scopes: deepCloneJson(command.scopes as readonly LivePlayScope[]),
    payload: command.payload,
  }
}

const parseMoveTokenPayload = (payload: unknown): MoveTokenPayload | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId) || !isGridAnchor(payload.position)) return null
  const pathLength = payload.pathLength
  if (
    pathLength !== undefined
    && pathLength !== null
    && (!finiteNumber(pathLength) || pathLength < 0)
  ) {
    return null
  }

  return {
    placementId: payload.placementId,
    position: cloneAnchor(payload.position),
    ...(pathLength === undefined ? {} : { pathLength }),
  }
}

const parseTurnTokenPayload = (payload: unknown): TurnTokenPayload | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId) || !isTokenFacingDirection(payload.facing)) return null
  return {
    placementId: payload.placementId,
    facing: payload.facing,
  }
}

const parseModifyHpPayload = (payload: unknown): ModifyHpPayload | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId) || !finiteNumber(payload.currentHp)) return null
  if (payload.temporaryHp !== undefined && !finiteNumber(payload.temporaryHp)) return null
  if (payload.injuries !== undefined && !finiteNumber(payload.injuries)) return null

  return {
    placementId: payload.placementId,
    currentHp: payload.currentHp,
    ...(payload.temporaryHp === undefined ? {} : { temporaryHp: normalizeTemporaryHpAmount(payload.temporaryHp) }),
    ...(payload.injuries === undefined ? {} : { injuries: payload.injuries }),
  }
}

const isModifyConditionsAction = (value: unknown): value is ModifyConditionsPayload['action'] => (
  value === 'add' || value === 'remove' || value === 'replace'
)

const parseModifyConditionsPayload = (payload: unknown): ModifyConditionsPayload | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId) || !isModifyConditionsAction(payload.action)) return null
  if (!Array.isArray(payload.conditions)) return null

  const conditions = normalizeConditionNames(payload.conditions)
  if (payload.action !== 'replace' && conditions.length === 0) return null

  return {
    placementId: payload.placementId,
    action: payload.action,
    conditions,
  }
}

const clampAxis = (value: number, fallback: number, max: number): number => {
  const upper = Math.max(0, Math.floor(Number.isFinite(max) ? max : 1) - 1)
  if (!Number.isFinite(value)) return fallback
  return Math.min(upper, Math.max(0, Math.round(value)))
}

const clampAnchorToMap = (value: GridAnchor, fallback: GridAnchor, map: TabletopMap): GridAnchor => ({
  x: clampAxis(value.x, fallback.x, map.dimensions.x),
  y: clampAxis(value.y, fallback.y, map.dimensions.y),
  z: clampAxis(value.z, fallback.z, map.dimensions.z),
})

const mapCanAcceptPrediction = (
  map: TabletopMap | null | undefined,
  command: ParsedPredictionCommand,
): map is TabletopMap => (
  !!map
  && map.slug === command.mapSlug
  && normalizeRevision(map.revision) === command.baseRevision
)

const placementForPayload = (map: TabletopMap, placementId: string): SheetPlacement | null => (
  map.placements.find((placement) => placement.id === placementId) ?? null
)

const localPatch = <TPayload extends LivePlayPredictionPatchPayload>(
  command: ParsedPredictionCommand,
  type: LivePlayPredictionPatchType,
  payload: TPayload,
): LivePlayPredictionPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type,
  mapSlug: command.mapSlug,
  // Local predictions stay pinned to the authoritative base revision. Keeping
  // this equal to baseRevision prevents accidental use as an advancing server
  // patch while still preserving the familiar live-play patch shape.
  revision: command.baseRevision,
  scopes: deepCloneJson(command.scopes),
  payload: deepCloneJson(payload),
  localOnly: true,
  predictionOpId: command.opId,
})

const movePatchPayload = (
  placementId: string,
  position: GridAnchor,
  facing: TokenFacingDirection | null,
): TokenMovedPatchPayload => ({
  placementId,
  position: cloneAnchor(position),
  ...(facing === null
    ? {}
    : {
        facing,
        turned: tokenFacingStoresLegacyTurned(facing),
      }),
})

const rollbackMovePatchPayload = (placement: SheetPlacement): TokenMovedPatchPayload => ({
  placementId: placement.id,
  position: cloneAnchor(placement.position),
  ...(placement.facing === undefined ? {} : { facing: placement.facing }),
  ...(placement.turned === undefined ? {} : { turned: placement.turned }),
})

const turnPatchPayload = (placementId: string, facing: TokenFacingDirection): TokenTurnedPatchPayload => ({
  placementId,
  facing,
  turned: tokenFacingStoresLegacyTurned(facing),
})

const rollbackTurnPatchPayload = (placement: SheetPlacement): TokenTurnedPatchPayload => ({
  placementId: placement.id,
  ...(placement.facing === undefined ? {} : { facing: placement.facing }),
  ...(placement.turned === undefined ? {} : { turned: placement.turned }),
})

const hpPatchPayload = (
  placement: SheetPlacement,
  previousTemporaryHp: number,
  currentTemporaryHp: number,
  sheetRevision: number,
): LivePlayPredictionHpPatchPayload => ({
  placementId: placement.id,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
  // HP prediction is map-HUD metadata only. The sheet documents stay empty in
  // local-only patches so callers cannot mistake this for authoritative sheet
  // state.
  previous: {},
  current: {},
  previousTemporaryHp,
  currentTemporaryHp,
  sheetRevision,
})

const conditionsPatchPayload = (
  placement: SheetPlacement,
  change: LivePlayPredictionConditionChange,
  sheetRevision: number,
): LivePlayPredictionConditionsPatchPayload => ({
  placementId: placement.id,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
  action: change.action,
  conditions: [...change.conditions],
  // This is local presentation metadata only. The authoritative condition
  // lists live in sheet updates; prediction patches must not be persisted or
  // treated as sheet state.
  sheetRevision,
})

const createPrediction = (
  command: ParsedPredictionCommand,
  input: {
    readonly commandType: LivePlayPredictionCommandType
    readonly placementId: string
    readonly previousPlacement: SheetPlacement
    readonly predictedPlacement: SheetPlacement
    readonly changedFields?: readonly LivePlayPredictionChangedField[]
    readonly previousTemporaryHp?: number
    readonly predictedTemporaryHp?: number
    readonly pendingConditionChange?: LivePlayPredictionConditionChange
    readonly patches: readonly LivePlayPredictionPatch[]
    readonly rollbackPatches: readonly LivePlayPredictionPatch[]
  },
): LivePlayLocalPrediction | null => {
  const changedFields = input.changedFields ?? placementFieldsChanged(input.previousPlacement, input.predictedPlacement)
  if (changedFields.length === 0) return null

  return {
    kind: 'live-play-local-prediction',
    localOnly: true,
    opId: command.opId,
    commandType: input.commandType,
    mapSlug: command.mapSlug,
    baseRevision: command.baseRevision,
    placementId: input.placementId,
    scopes: deepCloneJson(command.scopes),
    changedFields,
    previousPlacement: clonePlacement(input.previousPlacement),
    predictedPlacement: clonePlacement(input.predictedPlacement),
    ...(input.previousTemporaryHp === undefined ? {} : { previousTemporaryHp: input.previousTemporaryHp }),
    ...(input.predictedTemporaryHp === undefined ? {} : { predictedTemporaryHp: input.predictedTemporaryHp }),
    ...(input.pendingConditionChange === undefined ? {} : { pendingConditionChange: deepCloneJson(input.pendingConditionChange) }),
    patches: deepCloneJson(input.patches),
    rollbackPatches: deepCloneJson(input.rollbackPatches),
  }
}

const buildMoveTokenPredictionFromCommand = (
  map: TabletopMap | null | undefined,
  command: ParsedPredictionCommand,
): LivePlayLocalPrediction | null => {
  const payload = parseMoveTokenPayload(command.payload)
  if (!payload || !mapCanAcceptPrediction(map, command)) return null

  const placement = placementForPayload(map, payload.placementId)
  if (!placement) return null

  const previousPlacement = clonePlacement(placement)
  const position = clampAnchorToMap(payload.position, placement.position, map)
  const facing = sameAnchor(placement.position, position)
    ? null
    : tokenFacingTowardPoint(placement.position, position, tokenFacingForPlacement(placement))
  const predictedPlacement: SheetPlacement = {
    ...previousPlacement,
    position,
    ...(facing === null
      ? {}
      : {
          facing,
          turned: tokenFacingStoresLegacyTurned(facing),
        }),
  }

  return createPrediction(command, {
    commandType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    placementId: payload.placementId,
    previousPlacement,
    predictedPlacement,
    patches: [localPatch(
      command,
      LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
      movePatchPayload(payload.placementId, position, facing),
    )],
    rollbackPatches: [localPatch(
      command,
      LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
      rollbackMovePatchPayload(previousPlacement),
    )],
  })
}

const buildTurnTokenPredictionFromCommand = (
  map: TabletopMap | null | undefined,
  command: ParsedPredictionCommand,
): LivePlayLocalPrediction | null => {
  const payload = parseTurnTokenPayload(command.payload)
  if (!payload || !mapCanAcceptPrediction(map, command)) return null

  const placement = placementForPayload(map, payload.placementId)
  if (!placement) return null

  const previousPlacement = clonePlacement(placement)
  const predictedPlacement: SheetPlacement = {
    ...previousPlacement,
    facing: payload.facing,
    turned: tokenFacingStoresLegacyTurned(payload.facing),
  }

  return createPrediction(command, {
    commandType: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
    placementId: payload.placementId,
    previousPlacement,
    predictedPlacement,
    patches: [localPatch(
      command,
      LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
      turnPatchPayload(payload.placementId, payload.facing),
    )],
    rollbackPatches: [localPatch(
      command,
      LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
      rollbackTurnPatchPayload(previousPlacement),
    )],
  })
}

const buildModifyHpPredictionFromCommand = (
  map: TabletopMap | null | undefined,
  command: ParsedPredictionCommand,
): LivePlayLocalPrediction | null => {
  const payload = parseModifyHpPayload(command.payload)
  if (!payload || payload.temporaryHp === undefined || !mapCanAcceptPrediction(map, command)) return null

  const placement = placementForPayload(map, payload.placementId)
  if (!placement) return null

  const previousTemporaryHp = temporaryHpForPlacement(map, payload.placementId)
  const predictedTemporaryHp = normalizeTemporaryHpAmount(payload.temporaryHp)
  if (previousTemporaryHp === predictedTemporaryHp) return null
  if (predictedTemporaryHp > 0 && !normalizeMapSceneState(map.activeScene)) return null

  const previousPlacement = clonePlacement(placement)
  const predictedPlacement = clonePlacement(placement)

  return createPrediction(command, {
    commandType: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
    placementId: payload.placementId,
    previousPlacement,
    predictedPlacement,
    changedFields: ['temporaryHp'],
    previousTemporaryHp,
    predictedTemporaryHp,
    patches: [localPatch(
      command,
      LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
      hpPatchPayload(previousPlacement, previousTemporaryHp, predictedTemporaryHp, command.baseRevision),
    )],
    rollbackPatches: [localPatch(
      command,
      LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
      hpPatchPayload(previousPlacement, predictedTemporaryHp, previousTemporaryHp, command.baseRevision),
    )],
  })
}

const buildModifyConditionsPredictionFromCommand = (
  map: TabletopMap | null | undefined,
  command: ParsedPredictionCommand,
): LivePlayLocalPrediction | null => {
  const payload = parseModifyConditionsPayload(command.payload)
  if (!payload || !mapCanAcceptPrediction(map, command)) return null

  const placement = placementForPayload(map, payload.placementId)
  if (!placement) return null

  const previousPlacement = clonePlacement(placement)
  const predictedPlacement = clonePlacement(placement)
  const pendingConditionChange: LivePlayPredictionConditionChange = {
    action: payload.action,
    conditions: [...payload.conditions],
  }

  return createPrediction(command, {
    commandType: LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
    placementId: payload.placementId,
    previousPlacement,
    predictedPlacement,
    changedFields: ['conditions'],
    pendingConditionChange,
    patches: [localPatch(
      command,
      LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS,
      conditionsPatchPayload(previousPlacement, pendingConditionChange, command.baseRevision),
    )],
    rollbackPatches: [],
  })
}

export const buildMoveTokenPrediction = (input: BuildLivePlayPredictionInput): LivePlayLocalPrediction | null => {
  const command = parsePredictionCommand(input.command)
  if (!command || command.type !== LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) return null
  return buildMoveTokenPredictionFromCommand(input.map, command)
}

export const buildTurnTokenPrediction = (input: BuildLivePlayPredictionInput): LivePlayLocalPrediction | null => {
  const command = parsePredictionCommand(input.command)
  if (!command || command.type !== LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN) return null
  return buildTurnTokenPredictionFromCommand(input.map, command)
}

export const buildModifyHpPrediction = (input: BuildLivePlayPredictionInput): LivePlayLocalPrediction | null => {
  const command = parsePredictionCommand(input.command)
  if (!command || command.type !== LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) return null
  return buildModifyHpPredictionFromCommand(input.map, command)
}

export const buildModifyConditionsPrediction = (input: BuildLivePlayPredictionInput): LivePlayLocalPrediction | null => {
  const command = parsePredictionCommand(input.command)
  if (!command || command.type !== LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS) return null
  return buildModifyConditionsPredictionFromCommand(input.map, command)
}

export const buildLivePlayPrediction = (input: BuildLivePlayPredictionInput): LivePlayLocalPrediction | null => {
  const command = parsePredictionCommand(input.command)
  if (!command) return null

  if (command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) {
    return buildMoveTokenPredictionFromCommand(input.map, command)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN) {
    return buildTurnTokenPredictionFromCommand(input.map, command)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_HP) {
    return buildModifyHpPredictionFromCommand(input.map, command)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS) {
    return buildModifyConditionsPredictionFromCommand(input.map, command)
  }
  return null
}

const failedApply = (
  reason: LivePlayPredictionApplyFailureReason,
  message: string,
): LivePlayPredictionRejected => ({ ok: false, applied: false, reason, message })

const setOptionalPlacementField = <TKey extends 'facing' | 'turned'>(
  placement: SheetPlacement,
  source: SheetPlacement,
  key: TKey,
): void => {
  if (placementHasField(source, key)) {
    placement[key] = source[key] as SheetPlacement[TKey]
  } else {
    delete placement[key]
  }
}

interface LivePlayPredictionStateSource {
  readonly placement: SheetPlacement
  readonly temporaryHp?: number
}

const predictionChangesPlacement = (prediction: LivePlayLocalPrediction): boolean => (
  prediction.changedFields.some((field) => field === 'position' || field === 'facing' || field === 'turned')
)

const applyPredictionState = (
  map: TabletopMap | null | undefined,
  prediction: LivePlayLocalPrediction,
  source: LivePlayPredictionStateSource,
  options: { readonly requireBaseRevision: boolean },
): LivePlayPredictionApplyResult => {
  if (!map) return failedApply('missing-map', 'Cannot apply a live-play prediction before the map has loaded')
  if (map.slug !== prediction.mapSlug) {
    return failedApply('map-slug-mismatch', `Prediction for ${prediction.mapSlug} cannot apply to map ${map.slug}`)
  }
  if (options.requireBaseRevision && normalizeRevision(map.revision) !== prediction.baseRevision) {
    return failedApply(
      'stale-map',
      `Prediction was built for map revision ${prediction.baseRevision}, but the loaded map is at revision ${normalizeRevision(map.revision)}`,
    )
  }

  const index = map.placements.findIndex((placement) => placement.id === prediction.placementId)
  const current = map.placements[index]
  if (index < 0 || !current) {
    return failedApply('missing-placement', `Prediction references missing placement ${prediction.placementId}`)
  }

  const applyTemporaryHp = prediction.changedFields.includes('temporaryHp')
  if (applyTemporaryHp && source.temporaryHp === undefined) {
    return failedApply('invalid-prediction', `Prediction ${prediction.opId} is missing temporary HP state`)
  }
  if (applyTemporaryHp && source.temporaryHp !== undefined && source.temporaryHp > 0 && !normalizeMapSceneState(map.activeScene)) {
    return failedApply('invalid-prediction', 'Temporary HP predictions require an active scene')
  }
  if (prediction.changedFields.includes('conditions') && !prediction.pendingConditionChange) {
    return failedApply('invalid-prediction', `Prediction ${prediction.opId} is missing pending condition state`)
  }

  if (predictionChangesPlacement(prediction)) {
    const next = clonePlacement(current)
    for (const field of prediction.changedFields) {
      if (field === 'position') next.position = cloneAnchor(source.placement.position)
      else if (field === 'facing' || field === 'turned') setOptionalPlacementField(next, source.placement, field)
    }
    map.placements.splice(index, 1, next)
  }

  if (applyTemporaryHp && source.temporaryHp !== undefined) {
    setTemporaryHpForPlacement(map, prediction.placementId, source.temporaryHp)
  }
  return { ok: true, applied: true }
}

export const applyLivePlayPredictionToMap = (
  map: TabletopMap | null | undefined,
  prediction: LivePlayLocalPrediction,
): LivePlayPredictionApplyResult => applyPredictionState(
  map,
  prediction,
  {
    placement: prediction.predictedPlacement,
    ...(prediction.predictedTemporaryHp === undefined ? {} : { temporaryHp: prediction.predictedTemporaryHp }),
  },
  { requireBaseRevision: true },
)

export const reapplyLivePlayPredictionToMap = (
  map: TabletopMap | null | undefined,
  prediction: LivePlayLocalPrediction,
): LivePlayPredictionApplyResult => applyPredictionState(
  map,
  prediction,
  {
    placement: prediction.predictedPlacement,
    ...(prediction.predictedTemporaryHp === undefined ? {} : { temporaryHp: prediction.predictedTemporaryHp }),
  },
  { requireBaseRevision: false },
)

export const rollbackLivePlayPredictionFromMap = (
  map: TabletopMap | null | undefined,
  prediction: LivePlayLocalPrediction,
): LivePlayPredictionApplyResult => applyPredictionState(
  map,
  prediction,
  {
    placement: prediction.previousPlacement,
    ...(prediction.previousTemporaryHp === undefined ? {} : { temporaryHp: prediction.previousTemporaryHp }),
  },
  { requireBaseRevision: false },
)

const conditionIdentityKey = (condition: string): string => condition.trim().toLocaleLowerCase()

export const livePlayConditionsForPrediction = (
  currentConditions: readonly unknown[] | undefined | null,
  prediction: Pick<LivePlayLocalPrediction, 'pendingConditionChange'>,
): string[] => {
  const current = normalizeConditionNames(currentConditions)
  const change = prediction.pendingConditionChange
  if (!change) return current

  if (change.action === 'replace') return [...change.conditions]
  if (change.action === 'add') return normalizeConditionNames([...current, ...change.conditions])

  const removeKeys = new Set(change.conditions.map(conditionIdentityKey))
  return current.filter((condition) => !removeKeys.has(conditionIdentityKey(condition)))
}
