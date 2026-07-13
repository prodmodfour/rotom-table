import type { AuthRole } from '#shared/auth'
import {
  activePendingMoveResponseWindows,
  type PendingMoveResolution,
  type PendingMoveResponseWindow,
} from '#shared/moveAutomation/pendingResolution'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION,
  type PendingMoveResponseWindowList,
  type PendingMoveResponseWindowView,
} from '#shared/moveAutomation/responseViews'
import { pendingMoveResponseAuthorizationGrant } from '../policies/pendingMoveResponsePolicy'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
} from '../storage/pendingMoveResolutionRepository'
import {
  resolvePendingMoveResponseAccessContext,
  type PendingMoveResponseAccessDependencies,
} from './pendingMoveResponseAccess'

export interface ListPendingMoveResponsesDependencies
  extends PendingMoveResponseAccessDependencies {
  readonly pendingResolutionRepository?: Pick<PendingMoveResolutionRepository, 'listByMap'>
}

const safeWindowView = (input: {
  readonly resolution: PendingMoveResolution
  readonly window: PendingMoveResponseWindow
}): PendingMoveResponseWindowView => {
  const common = {
    windowId: input.window.windowId,
    phase: input.window.phase,
    reasonCode: input.window.reasonCode,
    promptKey: input.window.promptKey,
    options: Object.freeze(input.window.options.map(option => Object.freeze({ ...option }))),
  }
  const window = input.window.kind === 'reaction'
    ? Object.freeze({
        ...common,
        kind: 'reaction' as const,
        allowPass: true as const,
        timing: input.window.timing,
        priority: input.window.priority,
        depth: input.window.depth,
      })
    : Object.freeze({
        ...common,
        kind: 'choice' as const,
        allowPass: input.window.allowPass,
        priority: null,
      })
  return Object.freeze({
    schemaVersion: PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION,
    resolution: input.resolution.publicSummary,
    window,
  })
}

/**
 * Return only windows the current principal may answer. The projection has no
 * ownership IDs, target identities, operation IDs, read set, rolls, or trace.
 */
export const listPendingMoveResponsesUseCase = (input: {
  readonly role: AuthRole
  readonly mapSlug: unknown
  readonly playerProfile?: PlayerProfile | null
}, dependencies: ListPendingMoveResponsesDependencies = {}): PendingMoveResponseWindowList => {
  const database: RotomDatabase = dependencies.database ?? getRotomDatabase()
  const context = resolvePendingMoveResponseAccessContext(input, {
    database,
    mapRepository: dependencies.mapRepository,
    sheetRepository: dependencies.sheetRepository,
  })
  const repository = dependencies.pendingResolutionRepository
    ?? createSqlitePendingMoveResolutionRepository(database)
  const windows: PendingMoveResponseWindowView[] = []

  for (const stored of repository.listByMap(context.map.slug)) {
    if (
      stored.originMapSlug !== context.map.slug
      || stored.resolution.originMapSlug !== context.map.slug
      || stored.status !== 'pending'
      || stored.resolution.status !== 'pending'
    ) continue

    for (const window of activePendingMoveResponseWindows(stored.resolution)) {
      if (!pendingMoveResponseAuthorizationGrant({
        resolution: stored.resolution,
        window,
        map: context.map,
        viewer: context.viewer,
      })) continue
      windows.push(safeWindowView({ resolution: stored.resolution, window }))
    }
  }

  return Object.freeze({
    schemaVersion: PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION,
    mapSlug: context.map.slug,
    windows: Object.freeze(windows),
  })
}
