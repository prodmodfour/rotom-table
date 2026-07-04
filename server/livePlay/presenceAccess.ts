import type { AuthRole } from '#shared/auth'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  parseLivePlayPresenceUpdate,
  type LivePlayPresenceEntry,
  type LivePlayPresenceGridCell,
  type LivePlayPresenceSnapshot,
  type LivePlayPresenceUpdate,
  type LivePlayPresenceValidationIssue,
} from '#shared/livePlayPresence'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import type { PlayerSessionAccessGrant } from '../utils/sessionPlayerAccess'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { loadMapUseCase } from '../useCases/loadMap'
import type { MapRepository } from '../storage/mapRepository'
import {
  livePlayPresenceRegistry,
  LivePlayPresenceRegistryError,
  type LivePlayPresenceRegistry,
  type LivePlayPresenceRegistryPrincipalContext,
} from './presenceRegistry'

export class LivePlayPresenceAccessError extends UseCaseHttpError<400 | 403 | 404> {}

export interface LivePlayPresenceViewerContext {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly sessionAccess?: PlayerSessionAccessGrant | null
}

export interface ResolveLivePlayPresenceMapAccessInput {
  readonly slug?: unknown
  readonly viewer: LivePlayPresenceViewerContext
}

export interface LivePlayPresenceMapAccessGrant extends LivePlayPresenceViewerContext {
  readonly mapSlug: string
}

export interface ReadLivePlayPresenceSnapshotInput extends ResolveLivePlayPresenceMapAccessInput {
  readonly now?: number
}

export interface PublishLivePlayPresenceHeartbeatInput extends ResolveLivePlayPresenceMapAccessInput {
  readonly update: unknown
  readonly clientId: string
  readonly sessionContextKey?: string | null
  readonly now?: number
}

export interface LivePlayPresenceAccessDependencies {
  readonly mapRepository?: Pick<MapRepository, 'getBySlug'> | Pick<MapRepository, 'get'>
  readonly presenceRegistry?: Pick<LivePlayPresenceRegistry, 'list'>
  readonly now?: () => number
}

export interface LivePlayPresenceHeartbeatDependencies extends Omit<LivePlayPresenceAccessDependencies, 'presenceRegistry'> {
  readonly presenceRegistry?: Pick<LivePlayPresenceRegistry, 'list' | 'update'>
}

interface LoadedLivePlayPresenceMapAccessGrant extends LivePlayPresenceMapAccessGrant {
  readonly map: TabletopMap
}

const defaultPresenceRegistry = (
  registry: Pick<LivePlayPresenceRegistry, 'list'> | undefined,
): Pick<LivePlayPresenceRegistry, 'list'> => registry ?? livePlayPresenceRegistry

const defaultHeartbeatPresenceRegistry = (
  registry: Pick<LivePlayPresenceRegistry, 'list' | 'update'> | undefined,
): Pick<LivePlayPresenceRegistry, 'list' | 'update'> => registry ?? livePlayPresenceRegistry

const serverTime = (
  inputNow: number | undefined,
  clock: (() => number) | undefined,
): number => inputNow ?? (clock ?? Date.now)()

const cloneEntries = (entries: readonly LivePlayPresenceEntry[]): readonly LivePlayPresenceEntry[] => (
  entries.map((entry) => ({
    ...entry,
    intent: { ...entry.intent },
    ping: entry.ping === null
      ? null
      : {
          ...entry.ping,
          cell: { ...entry.ping.cell },
        },
    participant: { ...entry.participant },
  }))
)

const buildSnapshot = (input: {
  readonly mapSlug: string
  readonly now: number
  readonly entries: readonly LivePlayPresenceEntry[]
}): LivePlayPresenceSnapshot => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  mapSlug: input.mapSlug,
  serverTime: input.now,
  entries: cloneEntries(input.entries),
})

const resolveLoadedLivePlayPresenceMapAccess = (
  input: ResolveLivePlayPresenceMapAccessInput,
  dependencies: Pick<LivePlayPresenceAccessDependencies, 'mapRepository'> = {},
): LoadedLivePlayPresenceMapAccessGrant => {
  const { map } = loadMapUseCase(
    { role: input.viewer.role, slug: input.slug },
    { mapRepository: dependencies.mapRepository },
  )

  return {
    map,
    mapSlug: map.slug,
    role: input.viewer.role,
    playerProfile: input.viewer.playerProfile ?? null,
    sessionAccess: input.viewer.sessionAccess ?? null,
  }
}

const firstPresenceIssueMessage = (issues: readonly LivePlayPresenceValidationIssue[]): string => {
  const firstIssue = issues[0]
  return firstIssue ? firstIssue.message : 'Presence update failed shared live-play presence validation.'
}

const parseHeartbeatUpdate = (value: unknown): LivePlayPresenceUpdate => {
  const parsed = parseLivePlayPresenceUpdate(value)
  if (!parsed.valid) {
    throw new LivePlayPresenceAccessError(400, firstPresenceIssueMessage(parsed.issues))
  }
  return parsed.payload
}

const placementIdsForMap = (map: TabletopMap): ReadonlySet<string> => (
  new Set(map.placements.map((placement) => placement.id))
)

const assertTokenReferenceExists = (
  tokenId: string | null,
  field: 'selectedTokenId' | 'hoveredTokenId',
  placementIds: ReadonlySet<string>,
): void => {
  if (tokenId === null || placementIds.has(tokenId)) return
  throw new LivePlayPresenceAccessError(400, `${field} must reference a token on the requested map.`)
}

const cellIsInsideMap = (cell: LivePlayPresenceGridCell, map: TabletopMap): boolean => (
  cell.x >= 0
  && cell.x < map.dimensions.x
  && cell.y >= 0
  && cell.y < map.dimensions.y
  && cell.z >= 0
  && cell.z < map.dimensions.z
)

const assertPingCellIsInsideMap = (update: LivePlayPresenceUpdate, map: TabletopMap): void => {
  if (update.ping === null || cellIsInsideMap(update.ping.cell, map)) return
  throw new LivePlayPresenceAccessError(400, 'ping.cell must be inside the requested map dimensions.')
}

const assertPresenceUpdateReferencesMap = (update: LivePlayPresenceUpdate, map: TabletopMap): void => {
  const placementIds = placementIdsForMap(map)
  assertTokenReferenceExists(update.selectedTokenId, 'selectedTokenId', placementIds)
  assertTokenReferenceExists(update.hoveredTokenId, 'hoveredTokenId', placementIds)
  assertPingCellIsInsideMap(update, map)
}

const presencePrincipalForAccess = (
  access: LivePlayPresenceMapAccessGrant,
  input: Pick<PublishLivePlayPresenceHeartbeatInput, 'clientId' | 'sessionContextKey'>,
): LivePlayPresenceRegistryPrincipalContext => {
  const profileContextKey = access.role === 'player'
    ? access.playerProfile?.id ?? input.sessionContextKey ?? null
    : input.sessionContextKey ?? null

  return {
    role: access.role,
    clientId: input.clientId,
    profileContextKey,
    profileDisplayName: access.role === 'player' ? access.playerProfile?.displayName : undefined,
    accentSeed: `${access.role}:${profileContextKey ?? input.clientId}`,
  }
}

const toPresenceAccessError = (error: LivePlayPresenceRegistryError): LivePlayPresenceAccessError => {
  const message = error.issues.length > 0 ? firstPresenceIssueMessage(error.issues) : error.message
  return new LivePlayPresenceAccessError(400, message)
}

export const resolveLivePlayPresenceMapAccess = (
  input: ResolveLivePlayPresenceMapAccessInput,
  dependencies: Pick<LivePlayPresenceAccessDependencies, 'mapRepository'> = {},
): LivePlayPresenceMapAccessGrant => {
  const access = resolveLoadedLivePlayPresenceMapAccess(input, dependencies)
  return {
    mapSlug: access.mapSlug,
    role: access.role,
    playerProfile: access.playerProfile,
    sessionAccess: access.sessionAccess,
  }
}

export const readLivePlayPresenceSnapshot = (
  input: ReadLivePlayPresenceSnapshotInput,
  dependencies: LivePlayPresenceAccessDependencies = {},
): LivePlayPresenceSnapshot => {
  const access = resolveLivePlayPresenceMapAccess(input, dependencies)
  const now = serverTime(input.now, dependencies.now)
  const entries = defaultPresenceRegistry(dependencies.presenceRegistry).list({
    mapSlug: access.mapSlug,
    now,
  })

  return buildSnapshot({ mapSlug: access.mapSlug, now, entries })
}

export const publishLivePlayPresenceHeartbeat = (
  input: PublishLivePlayPresenceHeartbeatInput,
  dependencies: LivePlayPresenceHeartbeatDependencies = {},
): LivePlayPresenceSnapshot => {
  const access = resolveLoadedLivePlayPresenceMapAccess(input, dependencies)
  const update = parseHeartbeatUpdate(input.update)
  assertPresenceUpdateReferencesMap(update, access.map)

  const now = serverTime(input.now, dependencies.now)
  const registry = defaultHeartbeatPresenceRegistry(dependencies.presenceRegistry)
  try {
    registry.update({
      mapSlug: access.mapSlug,
      principal: presencePrincipalForAccess(access, input),
      update,
      now,
    })
  } catch (error) {
    if (error instanceof LivePlayPresenceRegistryError) throw toPresenceAccessError(error)
    throw error
  }

  const entries = registry.list({ mapSlug: access.mapSlug, now })
  return buildSnapshot({ mapSlug: access.mapSlug, now, entries })
}
