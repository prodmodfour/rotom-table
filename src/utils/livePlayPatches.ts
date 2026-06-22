import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  isLivePlayPatchType,
  type LivePlayPatch,
  type LivePlayPatchType,
} from '#shared/livePlayCommands'
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
import { mapMoveUsageSceneMatches } from './moveUsage'
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
  if (
    payload.command === LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
    || payload.command === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
  ) {
    if (!isSheetPlacement(payload.current)) return failed('invalid-patch', `${payload.command} placement patches require a current placement`)
    const index = placementIndex(map, payload.placementId)
    const next = clonePlacement(payload.current)
    if (index >= 0) map.placements.splice(index, 1, next)
    else map.placements.push(next)
    return null
  }

  if (payload.command === LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN) {
    const index = placementIndex(map, payload.placementId)
    if (index >= 0) map.placements.splice(index, 1)
    if (map.initiative?.activeId === payload.placementId) {
      map.initiative = { ...map.initiative, activeId: null }
    }
    return null
  }

  return failed('unknown-patch', 'map.placements patch command must be spawnToken, sendOutPokemon, or deleteToken')
}

const applyInitiativePatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !isRecord(payload.current)) {
    return failed('invalid-patch', 'map.initiative patches require a current lane payload')
  }
  const current = payload.current
  const activeId = current.activeId === null || nonEmptyString(current.activeId) ? current.activeId : null
  const round = typeof current.round === 'number' && Number.isSafeInteger(current.round) && current.round > 0
    ? current.round
    : 1
  map.initiative = { activeId, round }

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

  appendMetadataEntry(map, 'initiativeLog', payload.logEntry)
  return null
}

const applyHazardsPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !Array.isArray(payload.current)) {
    return failed('invalid-patch', 'map.hazards patches require a current hazard array')
  }
  map.hazards = cloneHazards(payload.current as MapHazardV2[])
  return null
}

const applyFieldEffectsPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !isRecord(payload.current)) {
    return failed('invalid-patch', 'map.fieldEffects patches require a current field-effects object')
  }
  map.fieldEffects = cloneFieldEffects(payload.current as MapFieldEffects)
  return null
}

const cellMatches = (left: Pick<GridAnchor, 'x' | 'y' | 'z'>, right: Pick<GridAnchor, 'x' | 'y' | 'z'>): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const applyTerrainPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload) || !isGridAnchor(payload.cell)) {
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
  delete map.moveUsage
  const nextMetadata = clearCombatLogMetadata(map.metadata)
  if (nextMetadata) map.metadata = nextMetadata
  else delete map.metadata
  return null
}

const applyMetadataPatch = (map: TabletopMap, payload: unknown): LivePlayPatchesRejected | null => {
  if (!isRecord(payload)) return failed('invalid-patch', 'map.metadata patches require an object payload')
  if (isRecord(payload.current)) map.metadata = deepCloneJson(payload.current)
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
    case LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE:
    case LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION:
      return applyMoveUsagePatch(map, patch.payload)
    case LIVE_PLAY_PATCH_TYPES.TOKEN_HP:
    case LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS:
    case LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES:
    case LIVE_PLAY_PATCH_TYPES.TOKEN_EXPERIENCE:
    case LIVE_PLAY_PATCH_TYPES.SHEET_FIELD:
      return null
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
