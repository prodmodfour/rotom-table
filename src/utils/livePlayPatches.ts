import {
  createEmptyEncounterState,
  isEncounterSideId,
  parseEncounterState,
  parseEncounterTurnResources,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  isLivePlayPatchType,
  type LivePlayPatch,
  type LivePlayPatchType,
} from '#shared/livePlayCommands'
import { parseLivePlayMoveStatePatchPayload, type LivePlayMoveStatePatchChanges } from '#shared/livePlayMoveState'
import { parseLivePlayMoveCorrectionPatchPayload } from '#shared/moveAutomation/correctionCommands'
import { normalizeRevision } from '#shared/sessionRevisions'
import type {
  GridAnchor,
  MapFieldEffects,
  MapHazardV2,
  MapSceneState,
  MapVoxelV2,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type { MapMoveUsageEntry, MapTrackedMoveFrequency } from '~/types/moveUsage'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import { clearCombatLogMetadata } from './combatLog'
import { clearMapSceneResources } from './mapSceneCleanup'
import { mapMoveUsageSceneMatches } from './moveUsage'
import {
  normalizeMapTemporaryHitPointsState,
  normalizeTemporaryHpAmount,
  setTemporaryHpForPlacement,
} from './mapTemporaryHitPoints'
import { deepCloneJson, sameJsonValue } from './serialization'

export type LivePlayPatchApplyFailureReason =
  | 'missing-map'
  | 'map-slug-mismatch'
  | 'stale-revision'
  | 'revision-gap'
  | 'empty-patches'
  | 'schema-version-mismatch'
  | 'patch-map-mismatch'
  | 'patch-revision-mismatch'
  | 'unknown-patch'
  | 'invalid-patch'

export interface ApplyLivePlayPatchesInput {
  readonly map: TabletopMap | null | undefined
  readonly mapSlug: string
  readonly previousRevision?: number | undefined
  readonly revision: number
  readonly patches: readonly LivePlayPatch[]
}

export interface LivePlayPatchesApplied {
  readonly ok: true
  readonly applied: true
  readonly revision: number
  readonly appliedPatchTypes: readonly LivePlayPatchType[]
  readonly terrainChanged: boolean
}

export interface LivePlayPatchesIgnored {
  readonly ok: true
  readonly applied: false
  readonly reason: 'stale-revision'
  readonly message: string
}

export interface LivePlayPatchesRejected {
  readonly ok: false
  readonly applied: false
  readonly reason: Exclude<LivePlayPatchApplyFailureReason, 'stale-revision'>
  readonly message: string
}

export type ApplyLivePlayPatchesResult =
  | LivePlayPatchesApplied
  | LivePlayPatchesIgnored
  | LivePlayPatchesRejected

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const failed = (
  reason: LivePlayPatchesRejected['reason'],
  message: string,
): LivePlayPatchesRejected => ({ ok: false, applied: false, reason, message })

const stale = (message: string): LivePlayPatchesIgnored => ({
  ok: true,
  applied: false,
  reason: 'stale-revision',
  message,
})

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isGridAnchor = (value: unknown): value is GridAnchor => (
  isRecord(value) && finiteNumber(value.x) && finiteNumber(value.y) && finiteNumber(value.z)
)

const cloneAnchor = (value: GridAnchor): GridAnchor => ({ x: value.x, y: value.y, z: value.z })

const isTokenFacingDirectionValue = (value: unknown): value is TokenFacingDirection => (
  value === 'north-east'
  || value === 'south-east'
  || value === 'south-west'
  || value === 'north-west'
)

const isSheetPlacement = (value: unknown): value is SheetPlacement => (
  isRecord(value)
  && nonEmptyString(value.id)
  && (value.sheetKind === 'pokemon' || value.sheetKind === 'trainer')
  && nonEmptyString(value.sheetSlug)
  && isGridAnchor(value.position)
  && (value.sideId === undefined || isEncounterSideId(value.sideId))
)

const clonePlacement = (placement: SheetPlacement): SheetPlacement => deepCloneJson(placement)
const cloneHazards = (hazards: readonly MapHazardV2[]): MapHazardV2[] => deepCloneJson([...hazards])
const cloneFieldEffects = (fieldEffects: MapFieldEffects): MapFieldEffects => deepCloneJson(fieldEffects)
const cloneVoxel = (voxel: MapVoxelV2): MapVoxelV2 => deepCloneJson(voxel)
const cloneScene = (scene: MapSceneState): MapSceneState => deepCloneJson(scene)

const placementIndex = (map: TabletopMap, placementId: string): number => (
  map.placements.findIndex((placement) => placement.id === placementId)
)

const appendMetadataEntry = (
  map: TabletopMap,
  key: string,
  entry: unknown,
): void => {
  if (!isRecord(entry)) return
  const metadata = { ...(map.metadata ?? {}) }
  const previous = Array.isArray(metadata[key]) ? metadata[key] : []
  if (previous.some((candidate) => sameJsonValue(candidate, entry))) {
    map.metadata = metadata
    return
  }
  metadata[key] = [...previous, deepCloneJson(entry)]
  map.metadata = metadata
}

const applyTokenMovedPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId) || !isGridAnchor(payload.position)) {
    return failed('invalid-patch', 'token.position patches require placementId and position payload fields')
  }
  const index = placementIndex(map, payload.placementId)
  if (index < 0) return failed('invalid-patch', `token.position patch references missing placement ${payload.placementId}`)

  let nextEncounter: EncounterState | null = null
  if (payload.turnResources !== undefined) {
    if (!isRecord(payload.turnResources)) {
      return failed('invalid-patch', 'token.position turnResources must be a lane change object')
    }
    try {
      const previous = parseEncounterTurnResources(payload.turnResources.previous)
      const currentResources = parseEncounterTurnResources(payload.turnResources.current)
      const encounter = parseEncounterState(
        map.encounterState ?? createEmptyEncounterState(),
      )
      if (!sameJsonValue(encounter.turnResources, previous)) {
        return failed(
          'invalid-patch',
          'token.position turnResources previous value does not match the local authoritative lane',
        )
      }
      nextEncounter = parseEncounterState({
        ...encounter,
        turnResources: currentResources,
      })
    }
    catch (error) {
      return failed(
        'invalid-patch',
        `token.position turnResources are invalid: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const current = map.placements[index]
  if (!current) return failed('invalid-patch', `token.position patch references missing placement ${payload.placementId}`)
  const next: SheetPlacement = {
    ...current,
    position: cloneAnchor(payload.position),
  }
  if (isTokenFacingDirectionValue(payload.facing)) next.facing = payload.facing
  if (typeof payload.turned === 'boolean') next.turned = payload.turned
  map.placements.splice(index, 1, next)
  appendMetadataEntry(map, 'movementLog', payload.movementLogEntry)
  if (nextEncounter) map.encounterState = nextEncounter
  return null
}

const applyTokenTurnedPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId)) {
    return failed('invalid-patch', 'token.facing patches require placementId')
  }
  const index = placementIndex(map, payload.placementId)
  if (index < 0) return failed('invalid-patch', `token.facing patch references missing placement ${payload.placementId}`)

  const current = map.placements[index]
  if (!current) return failed('invalid-patch', `token.facing patch references missing placement ${payload.placementId}`)
  const next: SheetPlacement = { ...current }
  if (isTokenFacingDirectionValue(payload.facing)) next.facing = payload.facing
  if (typeof payload.turned === 'boolean') next.turned = payload.turned
  map.placements.splice(index, 1, next)
  return null
}

const applyPlacementPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId)) {
    return failed('invalid-patch', 'map.placements patches require placementId')
  }
  const applyEncounterHistory = (): LivePlayPatchesRejected | null => {
    if (payload.currentEncounterState === undefined) return null
    if (payload.command !== LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
      && payload.command !== LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN) {
      return failed('invalid-patch', 'only Pokémon send-out and recall patches may carry currentEncounterState')
    }
    try { map.encounterState = parseEncounterState(payload.currentEncounterState) }
    catch { return failed('invalid-patch', 'map.placements patch currentEncounterState is malformed') }
    return null
  }
  if (
    payload.command === LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
    || payload.command === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
  ) {
    if (!isSheetPlacement(payload.current)) return failed('invalid-patch', `${payload.command} placement patches require a current placement`)
    const index = placementIndex(map, payload.placementId)
    const next = clonePlacement(payload.current)
    if (index >= 0) map.placements.splice(index, 1, next)
    else map.placements.push(next)
    return applyEncounterHistory()
  }

  if (
    payload.command === LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN
    || payload.command === LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL
  ) {
    const index = placementIndex(map, payload.placementId)
    if (index >= 0) map.placements.splice(index, 1)
    if (map.initiative?.activeId === payload.placementId) {
      map.initiative = { ...map.initiative, activeId: null }
    }
    return applyEncounterHistory()
  }

  return failed('unknown-patch', 'map.placements patch command must be spawnToken, sendOutPokemon, deleteToken, or throwPokeball')
}

const encounterLifecycleState = (
  map: TabletopMap,
  payload: UnknownRecord,
  patchLabel: 'map.initiative' | 'map.scene' | 'map.encounterLifecycle',
): {
  readonly encounterState: EncounterState
  readonly temporaryHitPoints: TabletopMap['temporaryHitPoints']
  readonly fieldEffects: MapFieldEffects
} | LivePlayPatchesRejected | null => {
  if (payload.lifecycle === undefined) return null
  if (!isRecord(payload.lifecycle)) {
    return failed('invalid-patch', `${patchLabel} lifecycle payload must be an object`)
  }
  const lifecycle = payload.lifecycle
  let encounterState: EncounterState
  try {
    encounterState = parseEncounterState(lifecycle.currentEncounterState)
  } catch (error) {
    return failed(
      'invalid-patch',
      `${patchLabel} lifecycle encounter state is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (
    lifecycle.currentFieldEffects !== undefined
    && !isRecord(lifecycle.currentFieldEffects)
  ) {
    return failed(
      'invalid-patch',
      `${patchLabel} lifecycle field effects must be an object when present`,
    )
  }
  const fieldEffects = lifecycle.currentFieldEffects === undefined
    ? cloneFieldEffects(map.fieldEffects ?? {})
    : cloneFieldEffects(lifecycle.currentFieldEffects as MapFieldEffects)
  if (
    lifecycle.currentTemporaryHitPoints !== null
    && !isRecord(lifecycle.currentTemporaryHitPoints)
  ) {
    return failed(
      'invalid-patch',
      `${patchLabel} lifecycle temporary HP must be an object or null`,
    )
  }
  const temporaryHitPoints = lifecycle.currentTemporaryHitPoints === null
    ? undefined
    : normalizeMapTemporaryHitPointsState(
        lifecycle.currentTemporaryHitPoints,
        map.activeScene,
      )
  if (lifecycle.currentTemporaryHitPoints !== null && temporaryHitPoints === undefined) {
    return failed(
      'invalid-patch',
      `${patchLabel} lifecycle temporary HP does not match the active scene`,
    )
  }
  return { encounterState, temporaryHitPoints, fieldEffects }
}

const applyInitiativePatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !isRecord(payload.current)) {
    return failed('invalid-patch', 'map.initiative patches require a current lane payload')
  }
  const lifecycle = encounterLifecycleState(map, payload, 'map.initiative')
  if (lifecycle && 'ok' in lifecycle) return lifecycle
  const current = payload.current
  const activeId = current.activeId === null || nonEmptyString(current.activeId) ? current.activeId : null
  const round = typeof current.round === 'number' && Number.isSafeInteger(current.round) && current.round > 0
    ? current.round
    : 1
  const manualOrderIds = Array.isArray(current.manualOrderIds)
    ? current.manualOrderIds.filter(nonEmptyString)
    : undefined
  map.initiative = {
    activeId,
    round,
    ...(manualOrderIds?.length ? { manualOrderIds } : {}),
  }

  if (Array.isArray(current.entries)) {
    const initiativeByToken = new Map<string, number | null>()
    for (const entry of current.entries) {
      if (!isRecord(entry) || !nonEmptyString(entry.tokenId)) continue
      initiativeByToken.set(entry.tokenId, typeof entry.initiative === 'number' ? entry.initiative : null)
    }
    map.placements.splice(0, map.placements.length, ...map.placements.map((placement) => ({
      ...placement,
      initiative: initiativeByToken.has(placement.id) ? initiativeByToken.get(placement.id) ?? null : placement.initiative,
    })))
  }

  if (lifecycle) {
    map.encounterState = lifecycle.encounterState
    map.fieldEffects = cloneFieldEffects(lifecycle.fieldEffects)
    if (lifecycle.temporaryHitPoints === undefined) delete map.temporaryHitPoints
    else map.temporaryHitPoints = deepCloneJson(lifecycle.temporaryHitPoints)
  }

  appendMetadataEntry(map, 'initiativeLog', payload.logEntry)
  return null
}

const isHazardCellPatchCommand = (value: unknown): boolean => (
  value === LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD
  || value === LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD
)

const applyHazardsPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !Array.isArray(payload.current)) {
    return failed('invalid-patch', 'map.hazards patches require a current hazard array')
  }

  const current = cloneHazards(payload.current as MapHazardV2[])
  if (isHazardCellPatchCommand(payload.command) && isGridAnchor(payload.cell)) {
    map.hazards = [
      ...cloneHazards(map.hazards ?? []).filter((hazard) => !cellMatches(hazard, payload.cell as GridAnchor)),
      ...current,
    ]
    return null
  }

  map.hazards = current
  return null
}

const applyFieldEffectsPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !isRecord(payload.current)) {
    return failed('invalid-patch', 'map.fieldEffects patches require a current field-effects object')
  }
  let encounterState: EncounterState | undefined
  if (payload.currentEncounterState !== undefined) {
    try {
      encounterState = parseEncounterState(payload.currentEncounterState)
    }
    catch (error) {
      return failed(
        'invalid-patch',
        `map.fieldEffects encounter state is invalid: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  map.fieldEffects = cloneFieldEffects(payload.current as MapFieldEffects)
  if (encounterState) map.encounterState = encounterState
  return null
}

const cellMatches = (left: Pick<GridAnchor, 'x' | 'y' | 'z'>, right: Pick<GridAnchor, 'x' | 'y' | 'z'>): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const applyTerrainCellPatch = (map: TabletopMap, payload: UnknownRecord): LivePlayPatchesRejected | null => {
  if (!isGridAnchor(payload.cell)) {
    return failed('invalid-patch', 'map.terrain patches require a terrain cell')
  }
  const index = map.voxels.findIndex((voxel) => cellMatches(voxel, payload.cell as GridAnchor))
  if (isRecord(payload.current)) {
    const next = cloneVoxel(payload.current as unknown as MapVoxelV2)
    if (index >= 0) map.voxels.splice(index, 1, next)
    else map.voxels.push(next)
    return null
  }
  if (payload.current === null) {
    if (index >= 0) map.voxels.splice(index, 1)
    return null
  }
  return failed('invalid-patch', 'map.terrain patches require current to be a voxel or null')
}

const applyTerrainBatchPatch = (map: TabletopMap, payload: UnknownRecord): LivePlayPatchesRejected | null => {
  if (!Array.isArray(payload.changes)) {
    return failed('invalid-patch', 'map.terrain editTerrainVoxels patches require a changes array')
  }

  const changes: UnknownRecord[] = []
  for (const [index, change] of payload.changes.entries()) {
    if (!isRecord(change)) {
      return failed('invalid-patch', `map.terrain changes[${index}] must be an object`)
    }
    if (!isGridAnchor(change.cell)) {
      return failed('invalid-patch', `map.terrain changes[${index}] requires a terrain cell`)
    }
    if (!isRecord(change.current) && change.current !== null) {
      return failed('invalid-patch', `map.terrain changes[${index}] requires current to be a voxel or null`)
    }
    changes.push(change)
  }

  for (const change of changes) {
    const result = applyTerrainCellPatch(map, change)
    if (result) return result
  }
  return null
}

const applyTerrainPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload)) return failed('invalid-patch', 'map.terrain patches require an object payload')
  if (payload.command === LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS || Array.isArray(payload.changes)) {
    return applyTerrainBatchPatch(map, payload)
  }
  return applyTerrainCellPatch(map, payload)
}

const mapTrackedFrequency = (value: unknown): MapTrackedMoveFrequency | null => {
  if (value === 'eot' || value === 'scene' || value === 'daily') return value
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (/^eot\b/.test(text)) return 'eot'
  if (/^scene\b/.test(text)) return 'scene'
  if (/^daily\b/.test(text)) return 'daily'
  return null
}

const applyMoveUsagePatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId) || !nonEmptyString(payload.moveKey) || !nonEmptyString(payload.moveName)) {
    return failed('invalid-patch', 'token.moveUsage patches require placementId, moveKey, and moveName')
  }

  if (payload.tracking === 'none') {
    appendMetadataEntry(map, 'moveLog', payload.moveLogEntry)
    return null
  }

  const frequency = mapTrackedFrequency(payload.frequencyKind) ?? mapTrackedFrequency(payload.frequency)
  const shouldTrackMapUsage = payload.tracking === 'map' || (payload.tracking === 'sheet' && frequency === 'daily')
  if (!shouldTrackMapUsage) {
    appendMetadataEntry(map, 'moveLog', payload.moveLogEntry)
    return null
  }
  if (payload.tracking !== 'map' && payload.tracking !== 'sheet') return null
  const usage = isRecord(payload.usage) ? payload.usage : null
  if (!usage && payload.tracking === 'sheet') {
    appendMetadataEntry(map, 'moveLog', payload.moveLogEntry)
    return null
  }
  const rawUses = frequency === 'daily' && typeof usage?.sceneUses === 'number' ? usage.sceneUses : usage?.uses
  const uses = typeof rawUses === 'number' && Number.isFinite(rawUses) ? Math.max(0, Math.trunc(rawUses)) : null
  if (!frequency || uses === null) return failed('invalid-patch', 'map-tracked token.moveUsage patches require frequency and usage.uses')

  appendMetadataEntry(map, 'moveLog', payload.moveLogEntry)
  const scene = isMapSceneState(map.activeScene) ? cloneScene(map.activeScene) : undefined
  const entry: MapMoveUsageEntry = {
    moveName: payload.moveName,
    frequency,
    uses,
    ...(typeof usage?.lastUsedRound === 'number' ? { lastUsedRound: usage.lastUsedRound } : {}),
  }
  const sourceMoveUsage = mapMoveUsageSceneMatches(map.moveUsage, scene)
    ? map.moveUsage
    : undefined
  const moveUsage = deepCloneJson(sourceMoveUsage ?? { byPlacementId: {} })
  if (scene) moveUsage.scene = scene
  else delete moveUsage.scene
  moveUsage.byPlacementId[payload.placementId] = {
    ...(moveUsage.byPlacementId[payload.placementId] ?? {}),
    [payload.moveKey]: entry,
  }
  map.moveUsage = moveUsage
  return null
}

const isMapSceneState = (value: unknown): value is MapSceneState => (
  isRecord(value) && nonEmptyString(value.name)
)

const applyScenePatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || (!isMapSceneState(payload.current) && payload.current !== null)) {
    return failed('invalid-patch', 'map.scene patches require current to be a scene state or null')
  }
  map.activeScene = payload.current === null ? null : cloneScene(payload.current)
  const cleaned = payload.lifecycle === undefined
    ? { ...map, metadata: clearCombatLogMetadata(map.metadata) }
    : clearMapSceneResources(map)
  delete map.temporaryHitPoints
  delete map.moveUsage
  if (cleaned.metadata) map.metadata = cleaned.metadata
  else delete map.metadata

  const lifecycle = encounterLifecycleState(map, payload, 'map.scene')
  if (lifecycle && 'ok' in lifecycle) return lifecycle
  if (lifecycle) {
    map.encounterState = lifecycle.encounterState
    map.fieldEffects = cloneFieldEffects(lifecycle.fieldEffects)
    if (lifecycle.temporaryHitPoints === undefined) delete map.temporaryHitPoints
    else map.temporaryHitPoints = deepCloneJson(lifecycle.temporaryHitPoints)
  }
  const initiativeChanges = isRecord(payload.lifecycle)
    ? payload.lifecycle.placementInitiativeChanges
    : undefined
  if (initiativeChanges !== undefined) {
    if (!Array.isArray(initiativeChanges)) {
      return failed('invalid-patch', 'map.scene placement initiative changes must be an array')
    }
    const seen = new Set<string>()
    for (const raw of initiativeChanges) {
      if (!isRecord(raw) || !nonEmptyString(raw.placementId)
        || (raw.previous !== null && typeof raw.previous !== 'number')
        || (raw.current !== null && typeof raw.current !== 'number')
        || seen.has(raw.placementId)) {
        return failed('invalid-patch', 'map.scene placement initiative changes are malformed')
      }
      const placement = map.placements.find(candidate => candidate.id === raw.placementId)
      const previous = typeof placement?.initiative === 'number' ? placement.initiative : null
      if (!placement || previous !== raw.previous) {
        return failed('patch-revision-mismatch', 'map.scene placement initiative authority changed before patch application')
      }
      seen.add(raw.placementId)
      placement.initiative = raw.current as number | null
    }
  }
  return null
}

const applyEncounterDurationLifecyclePatch = (
  map: TabletopMap,
  payload: unknown,
): LivePlayPatchesRejected | null => {
  if (!isRecord(payload)
    || (payload.command !== LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER
      && payload.command !== LIVE_PLAY_COMMAND_TYPES.DISMISS_ENCOUNTER_EFFECT)) {
    return failed('invalid-patch', 'map.encounterLifecycle patches require a supported lifecycle command')
  }
  const lifecycle = encounterLifecycleState(map, payload, 'map.encounterLifecycle')
  if (!lifecycle) return failed('invalid-patch', 'map.encounterLifecycle patches require authoritative lifecycle state')
  if ('ok' in lifecycle) return lifecycle
  map.encounterState = lifecycle.encounterState
  map.fieldEffects = cloneFieldEffects(lifecycle.fieldEffects)
  if (lifecycle.temporaryHitPoints === undefined) delete map.temporaryHitPoints
  else map.temporaryHitPoints = deepCloneJson(lifecycle.temporaryHitPoints)
  return null
}

const applyTokenHpPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !nonEmptyString(payload.placementId)) {
    return failed('invalid-patch', 'token.hp patches require placementId')
  }
  const index = placementIndex(map, payload.placementId)
  if (index < 0) return failed('invalid-patch', `token.hp patch references missing placement ${payload.placementId}`)

  const rawTemporaryHp = payload.currentTemporaryHp ?? (isRecord(payload.current) ? payload.current.temporaryHp : undefined)
  if (rawTemporaryHp !== undefined) {
    if (!finiteNumber(rawTemporaryHp)) return failed('invalid-patch', 'token.hp temporary HP must be a finite number')
    setTemporaryHpForPlacement(map, payload.placementId, normalizeTemporaryHpAmount(rawTemporaryHp))
  }
  return null
}

const applyMetadataPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload)) return failed('invalid-patch', 'map.metadata patches require an object payload')
  if (isRecord(payload.current)) map.metadata = deepCloneJson(payload.current)
  return null
}

const applyMoveDerivedStateChanges = (
  map: TabletopMap,
  changes: LivePlayMoveStatePatchChanges,
  updatedAt: number,
): void => {
  if (changes.placements) map.placements = deepCloneJson([...changes.placements.current])

  if (changes.temporaryHitPoints) {
    if (changes.temporaryHitPoints.current === null) delete map.temporaryHitPoints
    else map.temporaryHitPoints = deepCloneJson(changes.temporaryHitPoints.current)
  }

  if (changes.moveUsage) {
    if (changes.moveUsage.current === null) delete map.moveUsage
    else map.moveUsage = deepCloneJson(changes.moveUsage.current)
  }

  if (changes.hazards) map.hazards = deepCloneJson([...changes.hazards.current])
  if (changes.fieldEffects) map.fieldEffects = deepCloneJson(changes.fieldEffects.current)

  if (changes.metadata) {
    if (changes.metadata.current === null) delete map.metadata
    else map.metadata = deepCloneJson(changes.metadata.current)
  }

  if (changes.initiative) {
    if (changes.initiative.current === null) delete map.initiative
    else map.initiative = deepCloneJson(changes.initiative.current)
  }

  if (changes.encounterState) {
    map.encounterState = deepCloneJson(changes.encounterState.current)
  }

  map.updatedAt = updatedAt
}

const applyMoveStatePatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  const parsed = parseLivePlayMoveStatePatchPayload(payload)
  if (!parsed.valid) {
    return failed(
      'invalid-patch',
      `move.state patch payload is invalid: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    )
  }

  applyMoveDerivedStateChanges(map, parsed.payload.changes, parsed.payload.updatedAt)
  return null
}

const applyMoveCorrectionPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  const parsed = parseLivePlayMoveCorrectionPatchPayload(payload)
  if (!parsed.valid) {
    return failed(
      'invalid-patch',
      `move.correction patch payload is invalid: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    )
  }

  const mapResource = parsed.payload.resources.find(resource => resource.kind === 'map')
  if (!mapResource || mapResource.mapSlug !== map.slug) {
    return failed('invalid-patch', 'move.correction patch audit resource must match the current map')
  }
  applyMoveDerivedStateChanges(map, parsed.payload.changes, parsed.payload.updatedAt)
  return null
}

const applyKnownPatch = (map: TabletopMap, patch: LivePlayPatch): LivePlayPatchesRejected | null => {
  switch (patch.type) {
    case LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION:
      return applyTokenMovedPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.TOKEN_FACING:
      return applyTokenTurnedPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS:
      return applyPlacementPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE:
      return applyInitiativePatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS:
      return applyHazardsPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS:
      return applyFieldEffectsPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN:
      return applyTerrainPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MAP_SCENE:
      return applyScenePatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MAP_ENCOUNTER_LIFECYCLE:
      return applyEncounterDurationLifecyclePatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE:
    case LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION:
      return applyMoveUsagePatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.TOKEN_HP:
      return applyTokenHpPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS:
    case LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES:
    case LIVE_PLAY_PATCH_TYPES.TOKEN_EXPERIENCE:
    case LIVE_PLAY_PATCH_TYPES.SHEET_FIELD:
      return null
    case LIVE_PLAY_PATCH_TYPES.MOVE_STATE:
      return applyMoveStatePatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MOVE_CORRECTION:
      return applyMoveCorrectionPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.MAP_METADATA:
      return applyMetadataPatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED:
      return failed('unknown-patch', 'reconciliation.required patches require reloading the authoritative map')
    default:
      return failed('unknown-patch', `Unsupported live-play patch type ${String(patch.type)}`)
  }
}

export const applyLivePlayPatchesToMap = ({
  map,
  mapSlug,
  previousRevision,
  revision,
  patches,
}: ApplyLivePlayPatchesInput): ApplyLivePlayPatchesResult => {
  if (!map) return failed('missing-map', 'Cannot apply live-play patches before the map has loaded')
  if (map.slug !== mapSlug) return failed('map-slug-mismatch', `Patch event for ${mapSlug} cannot apply to map ${map.slug}`)

  const currentRevision = normalizeRevision(map.revision)
  const nextRevision = normalizeRevision(revision)
  if (nextRevision <= currentRevision) {
    return stale(`Live-play patch revision ${nextRevision} is not newer than current map revision ${currentRevision}`)
  }

  if (previousRevision !== undefined && normalizeRevision(previousRevision) !== currentRevision) {
    return failed(
      'revision-gap',
      `Live-play patch previousRevision ${normalizeRevision(previousRevision)} does not match current map revision ${currentRevision}`,
    )
  }
  if (previousRevision === undefined && nextRevision !== currentRevision + 1) {
    return failed('revision-gap', `Live-play patch revision ${nextRevision} skips current map revision ${currentRevision}`)
  }
  if (patches.length === 0) return failed('empty-patches', 'Accepted live-play command event did not include patches')

  for (const [index, patch] of patches.entries()) {
    if (patch.schemaVersion !== LIVE_PLAY_COMMAND_SCHEMA_VERSION) {
      return failed('schema-version-mismatch', `Patch ${index} uses unsupported schema version ${String(patch.schemaVersion)}`)
    }
    if (patch.mapSlug !== mapSlug) {
      return failed('patch-map-mismatch', `Patch ${index} targets ${patch.mapSlug} instead of ${mapSlug}`)
    }
    if (normalizeRevision(patch.revision) !== nextRevision) {
      return failed('patch-revision-mismatch', `Patch ${index} revision ${patch.revision} does not match event revision ${nextRevision}`)
    }
    if (!isLivePlayPatchType(patch.type)) {
      return failed('unknown-patch', `Patch ${index} type ${String(patch.type)} is not supported by this client`)
    }
  }

  let terrainChanged = false
  const appliedPatchTypes: LivePlayPatchType[] = []
  for (const patch of patches) {
    const result = applyKnownPatch(map, patch)
    if (result) return result
    if (patch.type === LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN) terrainChanged = true
    appliedPatchTypes.push(patch.type)
  }

  map.revision = nextRevision
  return {
    ok: true,
    applied: true,
    revision: nextRevision,
    appliedPatchTypes,
    terrainChanged,
  }
}
