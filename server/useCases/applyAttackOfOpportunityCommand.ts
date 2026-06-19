import { join } from 'node:path'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayMapScope,
  type LivePlayPatch,
  type UpdateAttackOfOpportunityLivePlayCommand,
} from '#shared/livePlayCommands'
import type { RealtimeEvent } from '#shared/realtime'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  applyAttackOfOpportunityStateUpdate,
  attackOfOpportunityStatesEqual,
  normalizeAttackOfOpportunityStateUpdatePayload,
  readAttackOfOpportunityState,
  writeAttackOfOpportunityState,
  type AttackOfOpportunityPromptRecord,
  type AttackOfOpportunityStateUpdatePayload,
} from '#shared/attackOfOpportunityState'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
  type ServerTokenControlLinkedTrainerSheet,
} from '../policies/playerProfileTokenControlPolicy'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { campaignPathLabel } from '../utils/campaignPaths'
import { MAPS_ROOT } from '../utils/mapPaths'
import { livePlayCommandAcceptedRealtimeEvent } from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { readSheetFile } from '../utils/sheetStorage'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'

export class AttackOfOpportunityCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type AttackOfOpportunityLivePlayCommandType = typeof LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY

export interface AttackOfOpportunityLivePlayActor {
  readonly role: AuthRole
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
}

export interface ExecuteAttackOfOpportunityLivePlayCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
  readonly expectedType?: AttackOfOpportunityLivePlayCommandType
}

export interface AttackOfOpportunityLivePlayCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
}

interface SheetFileRecord {
  sheet: Record<string, unknown>
}

export interface AttackOfOpportunityCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
  readonly readSheet?: (kind: SheetKind, slug: string) => SheetFileRecord | null
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
}

interface ResolvedAttackOfOpportunityContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly payload: AttackOfOpportunityStateUpdatePayload
}

type AttackOfOpportunityDependencySet = ReturnType<typeof actionDependencies>

const livePlayAttackOfOpportunityCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const readDefaultSheet = (kind: SheetKind, slug: string): SheetFileRecord | null =>
  readSheetFile<Record<string, unknown>>(kind, slug)

const actionDependencies = (dependencies: AttackOfOpportunityCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlayAttackOfOpportunityCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
  readSheet: dependencies.readSheet ?? readDefaultSheet,
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? campaignPathLabel,
})

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => (
  map.folder ? join(MAPS_ROOT, map.folder, `${map.slug}.json`) : join(MAPS_ROOT, `${map.slug}.json`)
)

const currentRoundForMap = (map: TabletopMap): number | null => map.initiative?.round ?? null

const tokenControlTrainerSheet = (
  slug: string,
  sheet: Record<string, unknown>,
): ServerTokenControlLinkedTrainerSheet => ({
  slug,
  ...(Array.isArray(sheet.currentTeam) ? { currentTeam: sheet.currentTeam } : {}),
  ...(Array.isArray(sheet.boxedPokemon) ? { boxedPokemon: sheet.boxedPokemon } : {}),
})

const linkedTrainerSheetsForActor = (
  actor: AttackOfOpportunityLivePlayActor,
  dependencies: AttackOfOpportunityDependencySet,
) => playerProfileLinkedTrainerSheetsForTokenControl(
  actor.playerProfile,
  (slug) => {
    const record = dependencies.readSheet('trainer', slug)
    return record ? tokenControlTrainerSheet(slug, record.sheet) : null
  },
)

const controlDeniedMessage = (role: AuthRole, profile: PlayerProfile | null | undefined): string => (
  role === 'player' && !profile
    ? 'Select a player profile to control linked map tokens'
    : 'Token is not linked to selected player profile'
)

const metadataScopeMatches = (scopes: readonly LivePlayMapScope[]): boolean => scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'metadata'
))

const assertAttackOfOpportunityCommandType = (
  command: UpdateAttackOfOpportunityLivePlayCommand,
  expectedType: AttackOfOpportunityLivePlayCommandType | undefined,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY) {
    rejectLivePlayCommand('invalid', 'Attack of Opportunity live-play route supports updateAttackOfOpportunity commands only')
  }
  if (!metadataScopeMatches(command.scopes)) {
    rejectLivePlayCommand('invalid', 'updateAttackOfOpportunity scopes must include the map metadata scope')
  }
}

const expectAttackOfOpportunityPayload = (
  payload: unknown,
): AttackOfOpportunityStateUpdatePayload => {
  const normalized = normalizeAttackOfOpportunityStateUpdatePayload(payload)
  if (normalized !== null) return normalized
  throw new AttackOfOpportunityCommandUseCaseError(400, 'updateAttackOfOpportunity payload is invalid')
}

const placementById = (map: TabletopMap, placementId: string): SheetPlacement | null => (
  map.placements.find((placement) => placement.id === placementId) ?? null
)

const requirePlacement = (map: TabletopMap, placementId: string): SheetPlacement => {
  const placement = placementById(map, placementId)
  if (!placement) throw new AttackOfOpportunityCommandUseCaseError(404, `Placement ${placementId} not found`)
  return placement
}

const actorCanControlPlacementId = (
  actor: AttackOfOpportunityLivePlayActor,
  map: TabletopMap,
  placementId: string,
  dependencies: AttackOfOpportunityDependencySet,
): boolean => actorCanControlMapPlacement({
  role: actor.role,
  profile: actor.playerProfile,
  placement: requirePlacement(map, placementId),
  linkedTrainerSheets: linkedTrainerSheetsForActor(actor, dependencies),
})

const promptRecordsReferenceExistingPlacements = (
  records: readonly AttackOfOpportunityPromptRecord[],
  map: TabletopMap,
): boolean => records.every((record) => (
  placementById(map, record.attackerId) !== null && placementById(map, record.provokerId) !== null
))

const authorizeQueue = (
  actor: AttackOfOpportunityLivePlayActor,
  map: TabletopMap,
  records: readonly AttackOfOpportunityPromptRecord[],
  dependencies: AttackOfOpportunityDependencySet,
): void => {
  if (!promptRecordsReferenceExistingPlacements(records, map)) {
    rejectLivePlayCommand('not-found', 'Queued Attack of Opportunity prompts must reference existing map placements')
  }
  if (actor.role === 'gm') return
  const provokerIds = new Set(records.map((record) => record.provokerId))
  for (const provokerId of provokerIds) {
    if (!actorCanControlPlacementId(actor, map, provokerId, dependencies)) {
      throw new AttackOfOpportunityCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
    }
  }
}

const authorizeClearPrompt = (
  actor: AttackOfOpportunityLivePlayActor,
  map: TabletopMap,
  promptId: string,
  dependencies: AttackOfOpportunityDependencySet,
): void => {
  const prompt = readAttackOfOpportunityState(map.metadata).prompts.find((candidate) => candidate.id === promptId)
  if (!prompt) return
  if (actor.role === 'gm') return
  if (!actorCanControlPlacementId(actor, map, prompt.attackerId, dependencies)) {
    throw new AttackOfOpportunityCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
  }
}

const authorizeClearAll = (
  actor: AttackOfOpportunityLivePlayActor,
  map: TabletopMap,
  actorId: string | undefined,
  dependencies: AttackOfOpportunityDependencySet,
): void => {
  if (actor.role === 'gm') return
  if (!actorId || !actorCanControlPlacementId(actor, map, actorId, dependencies)) {
    throw new AttackOfOpportunityCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
  }
}

const authorizeMarkAttackerUsed = (
  actor: AttackOfOpportunityLivePlayActor,
  map: TabletopMap,
  attackerId: string,
  dependencies: AttackOfOpportunityDependencySet,
): void => {
  if (actor.role === 'gm') return
  if (!actorCanControlPlacementId(actor, map, attackerId, dependencies)) {
    throw new AttackOfOpportunityCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
  }
}

const authorizePayload = (
  actor: AttackOfOpportunityLivePlayActor,
  map: TabletopMap,
  payload: AttackOfOpportunityStateUpdatePayload,
  dependencies: AttackOfOpportunityDependencySet,
): void => {
  if (payload.action === 'queue') {
    authorizeQueue(actor, map, payload.records, dependencies)
    return
  }
  if (payload.action === 'clear-prompt') {
    authorizeClearPrompt(actor, map, payload.promptId, dependencies)
    return
  }
  if (payload.action === 'clear-all') {
    authorizeClearAll(actor, map, payload.actorId, dependencies)
    return
  }
  authorizeMarkAttackerUsed(actor, map, payload.attackerId, dependencies)
}

const payloadWithAuthoritativeRound = (
  payload: AttackOfOpportunityStateUpdatePayload,
  map: TabletopMap,
): AttackOfOpportunityStateUpdatePayload => {
  const round = currentRoundForMap(map)
  if (payload.action === 'queue') {
    return {
      action: 'queue',
      records: payload.records.map((record) => ({ ...record, round })),
    }
  }
  if (payload.action === 'mark-attacker-used') {
    return {
      action: 'mark-attacker-used',
      attackerId: payload.attackerId,
      round,
    }
  }
  return payload
}

const resolveContext = async (
  command: UpdateAttackOfOpportunityLivePlayCommand,
  role: AuthRole,
  dependencies: AttackOfOpportunityDependencySet,
): Promise<ResolvedAttackOfOpportunityContext> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new AttackOfOpportunityCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)
  if (!canAccessMapForRole(role, map)) throw new AttackOfOpportunityCommandUseCaseError(403, 'You do not have access to this map')

  const payload = expectAttackOfOpportunityPayload(command.payload)
  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    payload,
  }
}

const applyAttackOfOpportunityCommand = (
  context: ResolvedAttackOfOpportunityContext,
): ResolvedAttackOfOpportunityContext | null => {
  const previous = readAttackOfOpportunityState(context.map.metadata)
  const payload = payloadWithAuthoritativeRound(context.payload, context.map)
  const next = applyAttackOfOpportunityStateUpdate(previous, payload)
  if (attackOfOpportunityStatesEqual(previous, next)) return null

  return {
    ...context,
    payload,
    map: {
      ...context.map,
      metadata: writeAttackOfOpportunityState(context.map.metadata, next),
    },
  }
}

const metadataPatch = (
  command: UpdateAttackOfOpportunityLivePlayCommand,
  revision: number,
  previousContext: ResolvedAttackOfOpportunityContext,
  nextContext: ResolvedAttackOfOpportunityContext,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_METADATA> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: {
    action: nextContext.payload.action,
    previous: previousContext.map.metadata ?? {},
    current: nextContext.map.metadata ?? {},
  },
})

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedAttackOfOpportunityContext | null,
): AttackOfOpportunityLivePlayCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
  } : {}),
})

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  dependencies: AttackOfOpportunityDependencySet,
): Promise<ResolvedAttackOfOpportunityContext | null> => {
  try {
    const map = await dependencies.mapRepository.getBySlug(result.mapSlug)
    if (!map || !canAccessMapForRole(role, map)) return null
    const mapPath = mapPathForDocument(map)
    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
      payload: { action: 'clear-all' },
    }
  } catch {
    return null
  }
}

export const executeAttackOfOpportunityLivePlayCommandUseCase = async (
  input: ExecuteAttackOfOpportunityLivePlayCommandInput,
  dependencies: AttackOfOpportunityCommandDependencies = {},
): Promise<AttackOfOpportunityLivePlayCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedAttackOfOpportunityContext | null = null

  const result = await deps.commandExecutor.execute<UpdateAttackOfOpportunityLivePlayCommand, ResolvedAttackOfOpportunityContext, AttackOfOpportunityLivePlayActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command }) => resolveContext(command, input.role, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor, map }) => {
      assertAttackOfOpportunityCommandType(command, input.expectedType)
      authorizePayload(actor, map.map, map.payload, deps)
    },
    apply: ({ command, map, currentRevision }) => {
      const nextContext = applyAttackOfOpportunityCommand(map)
      if (!nextContext) {
        return {
          status: 'rejected',
          reason: 'no-op',
          message: `${command.type} did not change Attack of Opportunity state`,
          currentRevision,
          currentState: readAttackOfOpportunityState(map.map.metadata),
        }
      }

      const revision = nextRevision(currentRevision)
      const updatedAt = deps.now()
      const nextMapContext = {
        ...nextContext,
        map: {
          ...nextContext.map,
          revision,
          updatedAt,
        },
      }
      return {
        status: 'accepted',
        nextMap: nextMapContext,
        previousRevision: currentRevision,
        revision,
        patches: [metadataPatch(command, revision, map, nextMapContext)],
      }
    },
    persist: async ({ actor, command, currentRevision, nextMap, result }) => {
      const persisted = toPersistedMap(nextMap.map, nextMap.mapPath, nextMap.map.updatedAt ?? deps.now(), { revision: result.revision })
      const updateResult = await deps.mapRepository.applyLivePlayUpdate({
        slug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
      })
      if (updateResult === 'stale') {
        throw new AttackOfOpportunityCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play command could be persisted`)
      }
      const authoritativeMap = await deps.mapRepository.getBySlug(result.mapSlug)
      if (!authoritativeMap) throw new AttackOfOpportunityCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play command`)
      persistedContext = {
        ...nextMap,
        map: authoritativeMap,
      }
      void actor
      void command
    },
    publish: ({ actor, result }) => {
      if (!persistedContext) return
      deps.publishRealtimeEvent(livePlayCommandAcceptedRealtimeEvent(result, actor.clientId))
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? await currentContextForAcceptedResult(result, input.role, deps) : null)
  return responseFromContext(result, responseContext)
}
