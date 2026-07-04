import type { AuthRole } from '#shared/auth'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  type LivePlayPresenceSnapshot,
} from '#shared/livePlayPresence'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { PlayerSessionAccessGrant } from '../utils/sessionPlayerAccess'
import { loadMapUseCase } from '../useCases/loadMap'
import type { MapRepository } from '../storage/mapRepository'
import {
  livePlayPresenceRegistry,
  type LivePlayPresenceRegistry,
} from './presenceRegistry'

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

export interface LivePlayPresenceAccessDependencies {
  readonly mapRepository?: Pick<MapRepository, 'getBySlug'> | Pick<MapRepository, 'get'>
  readonly presenceRegistry?: Pick<LivePlayPresenceRegistry, 'list'>
  readonly now?: () => number
}

const defaultPresenceRegistry = (
  registry: Pick<LivePlayPresenceRegistry, 'list'> | undefined,
): Pick<LivePlayPresenceRegistry, 'list'> => registry ?? livePlayPresenceRegistry

const serverTime = (
  inputNow: number | undefined,
  clock: (() => number) | undefined,
): number => inputNow ?? (clock ?? Date.now)()

export const resolveLivePlayPresenceMapAccess = (
  input: ResolveLivePlayPresenceMapAccessInput,
  dependencies: Pick<LivePlayPresenceAccessDependencies, 'mapRepository'> = {},
): LivePlayPresenceMapAccessGrant => {
  const { map } = loadMapUseCase(
    { role: input.viewer.role, slug: input.slug },
    { mapRepository: dependencies.mapRepository },
  )

  return {
    mapSlug: map.slug,
    role: input.viewer.role,
    playerProfile: input.viewer.playerProfile ?? null,
    sessionAccess: input.viewer.sessionAccess ?? null,
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

  return {
    schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
    authority: LIVE_PLAY_PRESENCE_AUTHORITY,
    mapSlug: access.mapSlug,
    serverTime: now,
    entries,
  }
}
