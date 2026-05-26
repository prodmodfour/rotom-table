import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import { isRecord } from '#shared/sessionCommandValidation'
import type { SessionServerMessage } from '#shared/sessionMessages'
import { isMapRevision, isSessionRevision, type MapRevision, type SessionRevision } from '#shared/sessionRevisions'
import type { AuthoritativeSessionState } from '#shared/sessionState'
import type {
  GridAnchor,
  InitiativeTrackerState,
  MapFieldEffects,
  MapHazardV2,
  MapVoxelV2,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type { MapTrackedMoveFrequency } from '~/types/moveUsage'
import { deepCloneJson } from '~/utils/serialization'
import { isTokenFacingDirection, tokenFacingStoresLegacyTurned } from '~/utils/tokenFacing'

interface BooleanRef {
  readonly value: boolean
}

type MaybeRef<TValue> = TValue | Ref<TValue>

export type SessionMapEditorStateSource = 'none' | 'local-seed' | 'snapshot' | 'patch'

export interface SessionMapEditorSocket {
  addMessageHandler?: (handler: (message: SessionServerMessage, raw?: string) => void) => () => void
}

export interface UseSessionMapEditorStateOptions {
  readonly enabled: BooleanRef
  readonly localMap: Ref<TabletopMap | null>
  readonly mapSlug: MaybeRef<string>
  readonly socket?: SessionMapEditorSocket
}

export interface AppliedSessionMapPatchSummary {
  readonly eventType: string
  readonly revision: SessionRevision
  readonly mapSlug: string
}

export interface UseSessionMapEditorStateReturn {
  /**
   * The map document the map editor UI should read from. Local mode returns the
   * editable autosaved map; session mode returns a separate server-owned clone
   * that is updated only from session snapshots/patches plus explicit optimistic
   * command overlays in narrower command composables.
   */
  readonly map: Ref<TabletopMap | null>
  readonly localEditableMap: Ref<TabletopMap | null>
  readonly sessionMap: Ref<TabletopMap | null>
  readonly enabled: ComputedRef<boolean>
  readonly source: Ref<SessionMapEditorStateSource>
  readonly sessionRevision: Ref<SessionRevision | null>
  readonly mapRevision: Ref<MapRevision | null>
  readonly lastAppliedPatch: Ref<AppliedSessionMapPatchSummary | null>
  readonly lastIgnoredMessage: Ref<string | null>
  readonly hasAuthoritativeSessionState: ComputedRef<boolean>
  resetSessionMapFromLocal(): boolean
  applySessionSnapshot(message: Extract<SessionServerMessage, { readonly type: 'snapshot' }>): boolean
  applySessionPatch(message: Extract<SessionServerMessage, { readonly type: 'patch' }>): boolean
  handleServerMessage(message: SessionServerMessage): void
}

const readMaybeRef = <TValue>(value: MaybeRef<TValue>): TValue => {
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return (value as Ref<TValue>).value
  }
  return value as TValue
}

const cloneMap = (map: TabletopMap): TabletopMap => deepCloneJson(map)
const clonePosition = (position: GridAnchor): GridAnchor => ({ x: position.x, y: position.y, z: position.z })
const clonePlacement = (placement: SheetPlacement): SheetPlacement => deepCloneJson(placement)
const cloneHazard = (hazard: MapHazardV2): MapHazardV2 => deepCloneJson(hazard)
const cloneVoxel = (voxel: MapVoxelV2): MapVoxelV2 => deepCloneJson(voxel)
const cloneFieldEffects = (fieldEffects: MapFieldEffects): MapFieldEffects => deepCloneJson(fieldEffects)
const cloneInitiative = (initiative: InitiativeTrackerState): InitiativeTrackerState => deepCloneJson(initiative)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

const isGridAnchor = (value: unknown): value is GridAnchor => (
  isRecord(value) &&
  isSafeInteger(value.x) &&
  isSafeInteger(value.y) &&
  isSafeInteger(value.z)
)

const isTabletopMap = (value: unknown): value is TabletopMap => (
  isRecord(value) &&
  value.schemaVersion === 2 &&
  isNonEmptyString(value.slug) &&
  isNonEmptyString(value.name) &&
  isRecord(value.dimensions) &&
  isSafeInteger(value.dimensions.x) &&
  isSafeInteger(value.dimensions.y) &&
  isSafeInteger(value.dimensions.z) &&
  Array.isArray(value.voxels) &&
  Array.isArray(value.placements)
)

const isSheetPlacement = (value: unknown): value is SheetPlacement => (
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  (value.sheetKind === 'pokemon' || value.sheetKind === 'trainer') &&
  isNonEmptyString(value.sheetSlug) &&
  isGridAnchor(value.position)
)

const isHazard = (value: unknown): value is MapHazardV2 => (
  isRecord(value) &&
  isNonEmptyString(value.kind) &&
  isSafeInteger(value.x) &&
  isSafeInteger(value.y) &&
  isSafeInteger(value.z)
)

const isVoxel = (value: unknown): value is MapVoxelV2 => (
  isRecord(value) &&
  isSafeInteger(value.x) &&
  isSafeInteger(value.y) &&
  isSafeInteger(value.z) &&
  isNonEmptyString(value.materialId)
)

const isMapFieldEffects = (value: unknown): value is MapFieldEffects => isRecord(value)

const isInitiativeLaneState = (value: unknown): value is {
  readonly activeId: string | null
  readonly round: number
  readonly entries: readonly { readonly tokenId: string; readonly initiative: number | null }[]
} => (
  isRecord(value) &&
  (value.activeId === null || isNonEmptyString(value.activeId)) &&
  isSafeInteger(value.round) &&
  value.round >= 1 &&
  Array.isArray(value.entries) &&
  value.entries.every((entry) => (
    isRecord(entry) &&
    isNonEmptyString(entry.tokenId) &&
    (entry.initiative === null || isSafeInteger(entry.initiative))
  ))
)

const sameCell = (
  left: Pick<MapVoxelV2, 'x' | 'y' | 'z'>,
  right: Pick<MapVoxelV2, 'x' | 'y' | 'z'>,
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const replacePlacement = (map: TabletopMap, placement: SheetPlacement): void => {
  const nextPlacement = clonePlacement(placement)
  const index = map.placements.findIndex((candidate) => candidate.id === nextPlacement.id)
  if (index >= 0) map.placements.splice(index, 1, nextPlacement)
  else map.placements.push(nextPlacement)
}

const removePlacement = (map: TabletopMap, tokenId: string): void => {
  map.placements = map.placements.filter((placement) => placement.id !== tokenId)
  if (map.initiative?.activeId === tokenId) {
    map.initiative = { ...map.initiative, activeId: null }
  }
}

const setPlacementPosition = (map: TabletopMap, tokenId: string, position: GridAnchor): boolean => {
  const placement = map.placements.find((candidate) => candidate.id === tokenId)
  if (!placement) return false
  placement.position = clonePosition(position)
  return true
}

const setPlacementFacing = (map: TabletopMap, tokenId: string, facing: unknown, turned: unknown): boolean => {
  const placement = map.placements.find((candidate) => candidate.id === tokenId)
  if (!placement || !isTokenFacingDirection(facing)) return false
  placement.facing = facing
  placement.turned = typeof turned === 'boolean'
    ? turned
    : tokenFacingStoresLegacyTurned(facing)
  return true
}

const applyHazardCellPatch = (map: TabletopMap, payload: Record<string, unknown>): boolean => {
  if (!isRecord(payload.cell) || !isSafeInteger(payload.cell.x) || !isSafeInteger(payload.cell.y) || !isSafeInteger(payload.cell.z)) {
    return false
  }
  if (!Array.isArray(payload.current) || !payload.current.every(isHazard)) return false

  const cell = { x: payload.cell.x, y: payload.cell.y, z: payload.cell.z }
  const current = payload.current.map(cloneHazard)
  map.hazards = [
    ...(map.hazards ?? []).filter((hazard) => !sameCell(hazard, cell)),
    ...current,
  ]
  return true
}

const applyTerrainCellPatch = (map: TabletopMap, payload: Record<string, unknown>): boolean => {
  if (!isRecord(payload.cell) || !isSafeInteger(payload.cell.x) || !isSafeInteger(payload.cell.y) || !isSafeInteger(payload.cell.z)) {
    return false
  }
  if (payload.current !== null && !isVoxel(payload.current)) return false

  const cell = { x: payload.cell.x, y: payload.cell.y, z: payload.cell.z }
  const withoutCell = map.voxels.filter((voxel) => !sameCell(voxel, cell))
  map.voxels = payload.current === null
    ? withoutCell
    : [...withoutCell, cloneVoxel(payload.current)]
  return true
}

const applyFieldEffectsPatch = (map: TabletopMap, payload: Record<string, unknown>): boolean => {
  if (!isMapFieldEffects(payload.current)) return false
  map.fieldEffects = cloneFieldEffects(payload.current)
  return true
}

const applyInitiativePatch = (map: TabletopMap, payload: Record<string, unknown>): boolean => {
  if (!isInitiativeLaneState(payload.current)) return false
  map.initiative = cloneInitiative({
    activeId: payload.current.activeId,
    round: payload.current.round,
  })
  const initiativesByTokenId = new Map(payload.current.entries.map((entry) => [entry.tokenId, entry.initiative]))
  map.placements = map.placements.map((placement) => {
    if (!initiativesByTokenId.has(placement.id)) return placement
    const initiative = initiativesByTokenId.get(placement.id) ?? null
    const next = { ...placement }
    if (initiative === null) delete next.initiative
    else next.initiative = initiative
    return next
  })
  return true
}

const mapTrackedFrequency = (value: unknown): MapTrackedMoveFrequency | null => (
  value === 'eot' || value === 'scene' ? value : null
)

const applyMoveUsagePatch = (map: TabletopMap, payload: Record<string, unknown>): boolean => {
  if (payload.tracking !== 'map') return true
  if (!isNonEmptyString(payload.tokenId) || !isNonEmptyString(payload.moveKey) || !isRecord(payload.usage)) return false
  const frequency = mapTrackedFrequency(payload.usage.frequencyKind ?? payload.frequencyKind)
  if (frequency === null) return false
  const uses = payload.usage.uses
  if (!isSafeInteger(uses)) return false

  const moveName = isNonEmptyString(payload.usage.moveName) ? payload.usage.moveName : String(payload.moveName ?? payload.moveKey)
  const previousUsage = map.moveUsage?.byPlacementId ?? {}
  const previousTokenUsage = previousUsage[payload.tokenId] ?? {}
  map.moveUsage = {
    byPlacementId: {
      ...previousUsage,
      [payload.tokenId]: {
        ...previousTokenUsage,
        [payload.moveKey]: {
          moveName,
          frequency,
          uses,
          ...(payload.usage.lastUsedRound === undefined
            ? {}
            : { lastUsedRound: payload.usage.lastUsedRound as number | null }),
        },
      },
    },
  }
  return true
}

const appendSessionLogLines = (
  map: TabletopMap,
  key: 'maneuverLog' | 'abilityLog' | 'orderLog',
  payload: Record<string, unknown>,
): boolean => {
  if (!Array.isArray(payload.logLines) || !payload.logLines.every((line) => typeof line === 'string')) return false
  const actionName = String(payload.maneuverName ?? payload.abilityName ?? payload.orderName ?? 'Session action')
  const previousMetadata = map.metadata ?? {}
  const previousLog = Array.isArray(previousMetadata[key]) ? previousMetadata[key] : []
  map.metadata = {
    ...previousMetadata,
    [key]: [
      ...previousLog,
      {
        at: Date.now(),
        userId: payload.tokenId,
        userName: payload.sheetSlug ?? payload.tokenId,
        actionName,
        lines: [...payload.logLines],
      },
    ],
  }
  return true
}

const applyKnownPatchPayload = (map: TabletopMap, eventType: string, payload: Record<string, unknown>): boolean => {
  switch (eventType) {
    case 'tokenMoved':
      return isNonEmptyString(payload.tokenId) && isGridAnchor(payload.to)
        ? setPlacementPosition(map, payload.tokenId, payload.to)
        : false
    case 'tokenTurned':
      return isNonEmptyString(payload.tokenId)
        ? setPlacementFacing(map, payload.tokenId, payload.to, payload.turned)
        : false
    case 'tokenSpawned':
    case 'pokemonSentOut':
      return isSheetPlacement(payload.placement)
        ? (replacePlacement(map, payload.placement), true)
        : false
    case 'tokenDeleted':
      return isNonEmptyString(payload.tokenId)
        ? (removePlacement(map, payload.tokenId), true)
        : false
    case 'hazardsUpdated':
      return applyHazardCellPatch(map, payload)
    case 'terrainVoxelsUpdated':
      return applyTerrainCellPatch(map, payload)
    case 'fieldEffectsUpdated':
      return applyFieldEffectsPatch(map, payload)
    case 'initiativeUpdated':
      return applyInitiativePatch(map, payload)
    case 'moveUsed':
      return applyMoveUsagePatch(map, payload)
    case 'maneuverUsed':
      return appendSessionLogLines(map, 'maneuverLog', payload)
    case 'abilityUsed':
      return appendSessionLogLines(map, 'abilityLog', payload)
    case 'orderUsed':
      return appendSessionLogLines(map, 'orderLog', payload)
    default:
      return false
  }
}

const snapshotMapStateFor = (
  snapshot: unknown,
  mapSlug: string,
): { readonly document: TabletopMap; readonly sessionRevision: SessionRevision; readonly mapRevision: MapRevision | null } | null => {
  if (!isRecord(snapshot) || !isSessionRevision(snapshot.revision) || !Array.isArray(snapshot.maps)) return null
  const mapState = snapshot.maps.find((candidate) => (
    isRecord(candidate) && candidate.mapSlug === mapSlug
  ))
  if (!isRecord(mapState) || !isTabletopMap(mapState.document)) return null

  return {
    document: mapState.document,
    sessionRevision: snapshot.revision,
    mapRevision: isMapRevision(mapState.revision) ? mapState.revision : null,
  }
}

export const useSessionMapEditorState = (
  options: UseSessionMapEditorStateOptions,
): UseSessionMapEditorStateReturn => {
  const enabled = computed(() => options.enabled.value)
  const sessionMap = ref<TabletopMap | null>(null)
  const source = ref<SessionMapEditorStateSource>('none')
  const sessionRevision = ref<SessionRevision | null>(null)
  const mapRevision = ref<MapRevision | null>(null)
  const lastAppliedPatch = ref<AppliedSessionMapPatchSummary | null>(null)
  const lastIgnoredMessage = ref<string | null>(null)

  const activeMap = computed<TabletopMap | null>({
    get: () => enabled.value ? sessionMap.value : options.localMap.value,
    set: (next) => {
      if (enabled.value) sessionMap.value = next
      else options.localMap.value = next
    },
  })
  const hasAuthoritativeSessionState = computed(() => source.value === 'snapshot' || source.value === 'patch')

  const resetSessionMapFromLocal = (): boolean => {
    const local = options.localMap.value
    if (!local) return false
    const mapSlug = readMaybeRef(options.mapSlug)
    if (local.slug !== mapSlug) return false
    sessionMap.value = cloneMap(local)
    source.value = 'local-seed'
    sessionRevision.value = null
    mapRevision.value = null
    lastIgnoredMessage.value = null
    return true
  }

  const ensureSeededSessionMap = (): boolean => {
    if (sessionMap.value?.slug === readMaybeRef(options.mapSlug)) return true
    return resetSessionMapFromLocal()
  }

  watch(
    () => [enabled.value, options.localMap.value, readMaybeRef(options.mapSlug), source.value] as const,
    () => {
      if (!enabled.value) return
      const local = options.localMap.value
      const mapSlug = readMaybeRef(options.mapSlug)
      if (!local || local.slug !== mapSlug) return
      if (sessionMap.value === null || sessionMap.value.slug !== mapSlug || source.value === 'none') {
        resetSessionMapFromLocal()
      }
    },
    { immediate: true },
  )

  const applySessionSnapshot = (
    message: Extract<SessionServerMessage, { readonly type: 'snapshot' }>,
  ): boolean => {
    if (!enabled.value) return false
    const mapSlug = readMaybeRef(options.mapSlug)
    const mapState = snapshotMapStateFor(
      (message as Extract<SessionServerMessage<AuthoritativeSessionState<TabletopMap>>, { readonly type: 'snapshot' }>).snapshot,
      mapSlug,
    )
    if (mapState === null) {
      const ignoredMessage = `Session snapshot did not include visible map "${mapSlug}".`
      if (!resetSessionMapFromLocal()) {
        sessionMap.value = null
        source.value = 'none'
        sessionRevision.value = null
        mapRevision.value = null
      }
      lastIgnoredMessage.value = ignoredMessage
      return false
    }

    sessionMap.value = cloneMap(mapState.document)
    source.value = 'snapshot'
    sessionRevision.value = mapState.sessionRevision
    mapRevision.value = mapState.mapRevision
    lastIgnoredMessage.value = null
    return true
  }

  const applySessionPatch = (
    message: Extract<SessionServerMessage, { readonly type: 'patch' }>,
  ): boolean => {
    if (!enabled.value) return false
    const event = message.event
    if (!isSessionRevision(event.revision) || !isRecord(event.payload)) return false
    const payloadMapSlug = event.payload.mapSlug
    const mapSlug = readMaybeRef(options.mapSlug)
    if (payloadMapSlug !== mapSlug) {
      lastIgnoredMessage.value = `Ignored ${event.eventType} patch for map "${String(payloadMapSlug)}" while viewing "${mapSlug}".`
      return false
    }
    if (!ensureSeededSessionMap() || sessionMap.value === null) return false

    const applied = applyKnownPatchPayload(sessionMap.value, event.eventType, event.payload)
    if (!applied) {
      lastIgnoredMessage.value = `Ignored unsupported or malformed ${event.eventType} session patch.`
      return false
    }

    source.value = 'patch'
    sessionRevision.value = event.revision
    lastAppliedPatch.value = {
      eventType: event.eventType,
      revision: event.revision,
      mapSlug,
    }
    lastIgnoredMessage.value = null
    return true
  }

  const handleServerMessage = (message: SessionServerMessage): void => {
    if (message.type === 'snapshot') {
      applySessionSnapshot(message)
      return
    }
    if (message.type === 'patch') applySessionPatch(message)
  }

  const removeSocketHandler = options.socket?.addMessageHandler?.(handleServerMessage)
  if (getCurrentScope() !== undefined && removeSocketHandler !== undefined) {
    onScopeDispose(removeSocketHandler)
  }

  return {
    map: activeMap,
    localEditableMap: options.localMap,
    sessionMap,
    enabled,
    source,
    sessionRevision,
    mapRevision,
    lastAppliedPatch,
    lastIgnoredMessage,
    hasAuthoritativeSessionState,
    resetSessionMapFromLocal,
    applySessionSnapshot,
    applySessionPatch,
    handleServerMessage,
  }
}
