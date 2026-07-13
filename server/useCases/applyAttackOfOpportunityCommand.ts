import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayMapScope,
  type LivePlayPatch,
  type UpdateAttackOfOpportunityLivePlayCommand,
} from '#shared/livePlayCommands'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  normalizeAttackOfOpportunityTriggerPayload,
  type AttackOfOpportunityTriggerPayload,
} from '#shared/attackOfOpportunityState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import {
  attackOfOpportunityPersistenceIdentity,
  materializeAttackOfOpportunity,
} from '../domain/moveAutomation/attackOfOpportunity'
import { createMoveStateChangePlan } from '../domain/moveAutomation/plan'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
  type ServerTokenControlLinkedTrainerSheet,
} from '../policies/playerProfileTokenControlPolicy'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  createSqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
} from '../storage/pendingMoveResolutionRepository'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { readRuntimeSheet } from '../utils/sqliteSheetRuntimeHelpers'
import { listPlayerProfiles } from '../utils/playerProfileStorage'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { commitLivePlayMapUpdate } from './livePlayMapPersistence'
import { toPersistedMap } from './saveMap'
import { playerCharacterSheetKeysForProfiles } from '~/utils/playerCharacterTokens'

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
  readonly pendingResolutionRepository?: Pick<PendingMoveResolutionRepository, 'create'>
  readonly database?: RotomDatabase
  readonly readSheet?: (kind: SheetKind, slug: string) => SheetFileRecord | null
  readonly listProfiles?: () => readonly PlayerProfile[]
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
}

interface AttackOfOpportunityResponseContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
}

interface ResolvedAttackOfOpportunityContext extends AttackOfOpportunityResponseContext {
  readonly payload: AttackOfOpportunityTriggerPayload
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly playerProfiles: readonly PlayerProfile[]
  readonly pendingResolution?: PendingMoveResolution
}

type AttackOfOpportunityDependencySet = ReturnType<typeof actionDependencies>

const livePlayAttackOfOpportunityCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const readDefaultSheet = (kind: SheetKind, slug: string): SheetFileRecord | null =>
  readRuntimeSheet<Record<string, unknown>>(kind, slug)

const actionDependencies = (dependencies: AttackOfOpportunityCommandDependencies) => {
  const database = dependencies.database ?? getRotomDatabase()
  return {
    commandExecutor: dependencies.commandExecutor ?? livePlayAttackOfOpportunityCommandExecutor,
    mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
    pendingResolutionRepository: dependencies.pendingResolutionRepository
      ?? createSqlitePendingMoveResolutionRepository(database),
    database,
    readSheet: dependencies.readSheet ?? readDefaultSheet,
    listProfiles: dependencies.listProfiles ?? listPlayerProfiles,
    now: dependencies.now ?? Date.now,
    relativePath: dependencies.relativePath ?? ((path: string) => path),
  }
}

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

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

const metadataScopeMatches = (scopes: readonly LivePlayMapScope[]): boolean => scopes.some(scope => (
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
    rejectLivePlayCommand('invalid', 'Attack of Opportunity route supports trigger commands only')
  }
  if (!metadataScopeMatches(command.scopes)) {
    rejectLivePlayCommand('invalid', 'Attack of Opportunity scopes must include the map metadata scope')
  }
}

const expectTriggerPayload = (payload: unknown): AttackOfOpportunityTriggerPayload => {
  const normalized = normalizeAttackOfOpportunityTriggerPayload(payload)
  if (normalized) return normalized
  throw new AttackOfOpportunityCommandUseCaseError(400, 'Attack of Opportunity trigger payload is invalid')
}

const placementById = (map: TabletopMap, placementId: string): SheetPlacement | null => (
  map.placements.find(placement => placement.id === placementId) ?? null
)

const requirePlacement = (map: TabletopMap, placementId: string): SheetPlacement => {
  const placement = placementById(map, placementId)
  if (!placement) throw new AttackOfOpportunityCommandUseCaseError(404, `Placement ${placementId} not found`)
  return placement
}

const authorizeTrigger = (
  actor: AttackOfOpportunityLivePlayActor,
  map: TabletopMap,
  payload: AttackOfOpportunityTriggerPayload,
  dependencies: AttackOfOpportunityDependencySet,
): void => {
  const provoker = requirePlacement(map, payload.provokerId)
  if (actor.role === 'gm') return
  if (!actorCanControlMapPlacement({
    role: actor.role,
    profile: actor.playerProfile,
    placement: provoker,
    linkedTrainerSheets: linkedTrainerSheetsForActor(actor, dependencies),
  })) {
    throw new AttackOfOpportunityCommandUseCaseError(
      403,
      controlDeniedMessage(actor.role, actor.playerProfile),
    )
  }
}

const loadSheets = (
  map: TabletopMap,
  dependencies: AttackOfOpportunityDependencySet,
): {
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
} => {
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  const seen = new Set<string>()
  for (const placement of map.placements) {
    const key = `${placement.sheetKind}:${placement.sheetSlug}`
    if (seen.has(key)) continue
    seen.add(key)
    const stored = dependencies.readSheet(placement.sheetKind, placement.sheetSlug)
    if (!stored) continue
    const sheet = {
      ...stored.sheet,
      slug: placement.sheetSlug,
      revision: normalizeRevision(stored.sheet.revision),
    }
    if (placement.sheetKind === 'pokemon') {
      pokemonSheets.set(placement.sheetSlug, sheet as unknown as CharacterSheet)
    }
    else {
      trainerSheets.set(placement.sheetSlug, sheet as unknown as TrainerSheet)
    }
  }
  return { pokemonSheets, trainerSheets }
}

const resolveContext = async (
  command: UpdateAttackOfOpportunityLivePlayCommand,
  role: AuthRole,
  dependencies: AttackOfOpportunityDependencySet,
): Promise<ResolvedAttackOfOpportunityContext> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new AttackOfOpportunityCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)
  if (!canAccessMapForRole(role, map)) {
    throw new AttackOfOpportunityCommandUseCaseError(403, 'You do not have access to this map')
  }
  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    payload: expectTriggerPayload(command.payload),
    ...loadSheets(map, dependencies),
    playerProfiles: dependencies.listProfiles(),
  }
}

const applyAttackOfOpportunityTrigger = (
  command: UpdateAttackOfOpportunityLivePlayCommand,
  context: ResolvedAttackOfOpportunityContext,
  now: number,
): ResolvedAttackOfOpportunityContext | null => {
  const previousRevision = normalizeRevision(context.map.revision)
  const revision = nextRevision(previousRevision)
  const identity = attackOfOpportunityPersistenceIdentity({
    mapSlug: context.map.slug,
    causalOpId: command.opId,
  })
  const pendingResolution = materializeAttackOfOpportunity({
    ...identity,
    originMapSlug: context.map.slug,
    continuationMapRevision: revision,
    createdAt: now,
    map: context.map,
    trigger: context.payload,
    pokemonSheets: context.pokemonSheets,
    trainerSheets: context.trainerSheets,
    playerCharacterSheetKeys: playerCharacterSheetKeysForProfiles(context.playerProfiles),
  })
  if (!pendingResolution) return null
  const encounter = parseEncounterState(
    context.map.encounterState ?? createEmptyEncounterState(),
  )
  if (encounter.pendingResolutionSummaries.some(summary => (
    summary.resolutionId === pendingResolution.resolutionId
  ))) {
    throw new AttackOfOpportunityCommandUseCaseError(409, 'Attack of Opportunity trigger is already pending')
  }
  const nextEncounter = parseEncounterState({
    ...encounter,
    pendingResolutionSummaries: [
      ...encounter.pendingResolutionSummaries,
      pendingResolution.publicSummary,
    ],
  })
  return {
    ...context,
    pendingResolution,
    map: {
      ...context.map,
      encounterState: nextEncounter,
      revision,
      updatedAt: now,
    },
  }
}

const triggerPatch = (
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
    action: 'provoke',
    previous: previousContext.map.metadata ?? {},
    current: nextContext.map.metadata ?? {},
  },
})

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const responseFromContext = (
  result: LivePlayCommandResult,
  context: AttackOfOpportunityResponseContext | null,
): AttackOfOpportunityLivePlayCommandResponse => ({
  result,
  ...(context ? { path: context.relativePath, map: context.map } : {}),
})

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  dependencies: AttackOfOpportunityDependencySet,
): Promise<AttackOfOpportunityResponseContext | null> => {
  try {
    const map = await dependencies.mapRepository.getBySlug(result.mapSlug)
    if (!map || !canAccessMapForRole(role, map)) return null
    const mapPath = mapPathForDocument(map)
    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
    }
  }
  catch {
    return null
  }
}

export const executeAttackOfOpportunityLivePlayCommandUseCase = async (
  input: ExecuteAttackOfOpportunityLivePlayCommandInput,
  dependencies: AttackOfOpportunityCommandDependencies = {},
): Promise<AttackOfOpportunityLivePlayCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedAttackOfOpportunityContext | null = null

  const result = await deps.commandExecutor.execute<
    UpdateAttackOfOpportunityLivePlayCommand,
    ResolvedAttackOfOpportunityContext,
    AttackOfOpportunityLivePlayActor
  >({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command }) => resolveContext(command, input.role, deps),
    getMapRevision: context => normalizeRevision(context.map.revision),
    authorize: ({ command, actor, map }) => {
      assertAttackOfOpportunityCommandType(command, input.expectedType)
      authorizeTrigger(actor, map.map, map.payload, deps)
    },
    apply: ({ command, map, currentRevision }) => {
      const nextContext = applyAttackOfOpportunityTrigger(command, map, deps.now())
      if (!nextContext) {
        return {
          status: 'rejected',
          reason: 'no-op',
          message: 'No eligible defender can currently make an Attack of Opportunity',
          currentRevision,
        }
      }
      return {
        status: 'accepted',
        nextMap: nextContext,
        previousRevision: currentRevision,
        revision: normalizeRevision(nextContext.map.revision),
        patches: [triggerPatch(command, normalizeRevision(nextContext.map.revision), map, nextContext)],
      }
    },
    persist: () => {
      throw new Error('Attack of Opportunity commands must persist through the accepted-result commit hook')
    },
    commit: ({ currentRevision, nextMap, result, saveOpResult }) => {
      const pending = nextMap.pendingResolution
      if (!pending) {
        throw new AttackOfOpportunityCommandUseCaseError(409, 'Accepted opportunity trigger has no pending resolution')
      }
      const persisted = toPersistedMap(
        nextMap.map,
        nextMap.map.folder ?? '',
        nextMap.map.updatedAt ?? deps.now(),
        { revision: result.revision },
      )
      const authoritativeMap = commitLivePlayMapUpdate({
        database: deps.database,
        mapRepository: deps.mapRepository,
        mapSlug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
        staleError: () => new AttackOfOpportunityCommandUseCaseError(
          409,
          `Map ${result.mapSlug} changed before the opportunity trigger could persist`,
        ),
        missingMapError: () => new AttackOfOpportunityCommandUseCaseError(
          404,
          `Map ${result.mapSlug}.json not found after opportunity trigger`,
        ),
        saveOpResult: () => {
          const stored = deps.pendingResolutionRepository.create({
            resolution: pending,
            declarationPlan: createMoveStateChangePlan([]),
          })
          if (stored.resolutionId !== pending.resolutionId || stored.status !== 'pending') {
            throw new AttackOfOpportunityCommandUseCaseError(
              409,
              'Opportunity response did not persist its canonical pending identity',
            )
          }
          saveOpResult()
        },
      })
      persistedContext = { ...nextMap, map: authoritativeMap }
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? await currentContextForAcceptedResult(result, input.role, deps) : null)
  return responseFromContext(result, responseContext)
}
