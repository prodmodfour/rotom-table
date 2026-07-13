import type { AuthRole } from '#shared/auth'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
  type LivePlayCommandAccepted,
  type LivePlayCommandRejected,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import type { LivePlayResolvedMoveResult } from '#shared/livePlayMoveResolution'
import {
  parsePendingMoveResolution,
  type PendingMoveResolution,
  type PendingMoveResponseOwner,
} from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import type { PlayerProfile } from '#shared/playerProfiles'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  isAuthoritativeMoveStatePlanningError,
  isAuthoritativePendingMoveStatePlan,
  type AuthoritativeMoveStatePlan,
  type AuthoritativePendingMoveStatePlan,
} from '../domain/planAuthoritativeMoveState'
import {
  isAbilityFollowUpPendingResolution,
  planAbilityFollowUpResponse,
  type AbilityFollowUpResponsePlan,
} from '../domain/moveAutomation/abilityFollowUps'
import {
  isAttackOfOpportunityPendingResolution,
  planAttackOfOpportunityResponse,
  type AttackOfOpportunityResponsePlan,
} from '../domain/moveAutomation/attackOfOpportunity'
import { createMoveStateChangePlan } from '../domain/moveAutomation/plan'
import { appendPendingDeclarationResourcePlan } from '../domain/moveAutomation/declarationCompensation'
import { createAcceptedMoveCompensationResult } from '../domain/moveAutomation/planAcceptedMoveCompensation'
import { planResumedMoveState } from '../domain/moveAutomation/planResumedMoveState'
import type { AuthoritativeMoveRandomSource } from '../domain/moveAutomation/random'
import { ResumeMoveSpecError, resumeMoveSpec } from '../domain/moveAutomation/resumeSpec'
import type { MoveAutomationRuntimeRegistry } from '../domain/moveAutomation/registry'
import { acceptedCommandRealtimeAppendInput } from '../livePlay/acceptedCommandRealtime'
import { createCanonicalCommandHash } from '../livePlay/commandIdempotency'
import type { LivePlayCommandHash } from '../livePlay/opResult'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import type { PendingMoveResponseAuthorizationGrant } from '../policies/pendingMoveResponsePolicy'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
} from '../realtime/persistedBatchPublication'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteMapRepository,
  type MapRepository,
} from '../storage/mapRepository'
import {
  createSqliteLivePlayOpRepository,
  type LivePlayOpRepository,
} from '../storage/opRepository'
import {
  createSqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
  type StoredPendingMoveResolution,
} from '../storage/pendingMoveResolutionRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  createSqliteSheetRepository,
  SheetRevisionConflictError,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  logicalMapResourcePath,
  logicalSheetResourcePath,
} from '../utils/runtimeResourcePaths'
import { redactSheetUpdatesForPlayer } from '../utils/sheetPrivacy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'
import {
  moveResultFromPlan,
  moveStatePatch,
  sheetPayloadForPersistence,
  type LivePlayResolveMoveCommandResponse,
  type LivePlayResolveMoveCommandSheetUpdate,
} from './applyResolveMoveCommand'
import { actualResolveMoveWriteScopes } from './resolveMoveCommandScopes'
import type { ParsedMoveResponseCommand } from '../livePlay/moveResponseCommandParser'

export class ResumePendingMoveResolutionUseCaseError
  extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ResumePendingMoveResolutionInput extends ParsedMoveResponseCommand {
  readonly role: AuthRole
  readonly playerProfile: PlayerProfile | null
  readonly authorization: PendingMoveResponseAuthorizationGrant
  readonly clientId?: string
}

export interface ResumePendingMoveResolutionDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<
    SheetRepository<Record<string, unknown>>,
    'getByRef' | 'assertRevisions' | 'applyLivePlayUpdate'
  >
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'get'>
  readonly pendingResolutionRepository?: Pick<PendingMoveResolutionRepository, 'getById' | 'update'>
    & Partial<Pick<PendingMoveResolutionRepository, 'create'>>
  readonly opRepository?: Pick<LivePlayOpRepository, 'getStoredOpRecord' | 'saveCommandResult'>
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
  readonly random?: AuthoritativeMoveRandomSource
  readonly now?: () => number
  readonly maxMoveLogEntries?: number
  readonly beforeCommit?: () => void
}

type Dependencies = ReturnType<typeof dependenciesWithDefaults>

const dependenciesWithDefaults = (input: ResumePendingMoveResolutionDependencies) => {
  const database = input.database ?? getRotomDatabase()
  return {
    database,
    mapRepository: input.mapRepository ?? createSqliteMapRepository<TabletopMap>(database),
    sheetRepository: input.sheetRepository
      ?? createSqliteSheetRepository<Record<string, unknown>>(database),
    groupInventoryRepository: input.groupInventoryRepository
      ?? createSqliteGroupInventoryRepository(database),
    pendingResolutionRepository: input.pendingResolutionRepository
      ?? createSqlitePendingMoveResolutionRepository(database),
    opRepository: input.opRepository ?? createSqliteLivePlayOpRepository({ database }),
    realtimeEventRepository: input.realtimeEventRepository
      ?? createSqliteRealtimeEventRepository({ database }),
    publishPersistedRealtimeEvent: input.publishPersistedRealtimeEvent
      ?? defaultPersistedRealtimeEventPublisher,
    runtimeRegistry: input.runtimeRegistry,
    random: input.random,
    now: input.now ?? Date.now,
    maxMoveLogEntries: input.maxMoveLogEntries,
    beforeCommit: input.beforeCommit,
  }
}

export const moveResponseCommandHash = (command: MoveResponseCommand): LivePlayCommandHash => (
  createCanonicalCommandHash<LivePlayCommandHash, MoveResponseCommand>({
    command,
    normalize: value => value,
    path: 'moveResponseCommand',
    errorPrefix: 'Move response command could not be hashed',
  })
)

const responseOptionId = (command: MoveResponseCommand): string | null => (
  'optionId' in command.payload ? command.payload.optionId : null
)

const responseWindowId = (command: MoveResponseCommand): string => {
  if (!('windowId' in command.payload)) {
    throw new ResumePendingMoveResolutionUseCaseError(
      400,
      'This command does not answer a resumable response window.',
    )
  }
  return command.payload.windowId
}

const uniquePlacementSheetRefs = (map: TabletopMap): readonly {
  readonly kind: SheetKind
  readonly slug: string
}[] => {
  const result: Array<{ kind: SheetKind; slug: string }> = []
  const seen = new Set<string>()
  for (const placement of map.placements) {
    const key = `${placement.sheetKind}:${placement.sheetSlug}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ kind: placement.sheetKind, slug: placement.sheetSlug })
  }
  return result
}

const persistedSheetRecord = (sheet: PersistedSheet): Record<string, unknown> => ({
  ...sheet.sheet,
  slug: sheet.slug,
  revision: sheet.revision,
  updatedAt: sheet.updatedAt,
})

const loadSheets = (
  map: TabletopMap,
  dependencies: Dependencies,
): {
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
} => {
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  for (const ref of uniquePlacementSheetRefs(map)) {
    const stored = dependencies.sheetRepository.getByRef(ref.kind, ref.slug)
    if (!stored) continue
    if (ref.kind === 'pokemon') {
      pokemonSheets.set(ref.slug, persistedSheetRecord(stored) as unknown as CharacterSheet)
    }
    else {
      trainerSheets.set(ref.slug, persistedSheetRecord(stored) as unknown as TrainerSheet)
    }
  }
  return { pokemonSheets, trainerSheets }
}

const pendingMapRevision = (resolution: PendingMoveResolution): number => (
  resolution.readSet.find(read => read.kind === 'map')?.revision
  ?? (() => { throw new Error('Pending resolution has no map read.') })()
)

const pendingSheetReads = (resolution: PendingMoveResolution) => resolution.readSet.flatMap(
  read => read.kind === 'sheet'
    ? [{ kind: read.sheetKind, slug: read.slug, revision: read.revision }]
    : [],
)

const hasCurrentReadSet = (
  input: ResumePendingMoveResolutionInput,
  map: TabletopMap,
  dependencies: Dependencies,
): boolean => {
  const expectedMapRevision = pendingMapRevision(input.storedResolution.resolution)
  if (
    normalizeRevision(map.revision) !== expectedMapRevision
    || input.command.baseRevision !== expectedMapRevision
  ) return false
  try {
    dependencies.sheetRepository.assertRevisions(
      pendingSheetReads(input.storedResolution.resolution),
    )
    for (const read of input.storedResolution.resolution.readSet) {
      if (read.kind !== 'group-inventory') continue
      const inventory = dependencies.groupInventoryRepository.get(read.slug)
      if (!inventory || inventory.revision !== read.revision) return false
    }
    return true
  }
  catch (error) {
    if (error instanceof SheetRevisionConflictError) return false
    throw error
  }
}

const summaryRemovedMap = (
  map: TabletopMap,
  resolutionId: string,
  now: number,
): TabletopMap => {
  const state = map.encounterState
  if (!state) return {
    ...deepCloneJson(map),
    revision: nextRevision(normalizeRevision(map.revision)),
    updatedAt: now,
  }
  return {
    ...deepCloneJson(map),
    encounterState: {
      ...deepCloneJson(state),
      pendingResolutionSummaries: state.pendingResolutionSummaries.filter(
        summary => summary.resolutionId !== resolutionId,
      ),
    },
    revision: nextRevision(normalizeRevision(map.revision)),
    updatedAt: now,
  }
}

const terminalPhase = (
  resolution: PendingMoveResolution,
  trace: PendingMoveResolution['trace'],
) => {
  const transition = [...trace.events]
    .reverse()
    .find((event): event is Extract<
      PendingMoveResolution['trace']['events'][number],
      { readonly kind: 'phase-transition' }
    > => event.kind === 'phase-transition')
  return transition?.to ?? resolution.phase
}

const terminalResolution = (input: {
  readonly source: PendingMoveResolution
  readonly status: 'committed' | 'conflicted'
  readonly updatedAt: number
  readonly responseOpId?: string
  readonly responseWindowId?: string
  readonly responseOptionId?: string | null
  readonly chosenBy?: PendingMoveResponseOwner
  readonly trace?: PendingMoveResolution['trace']
  readonly rollLedger?: PendingMoveResolution['rollLedger']
}): PendingMoveResolution => {
  const trace = input.trace ?? input.source.trace
  const chosenOptions = input.responseOpId && input.responseWindowId && input.chosenBy
    ? [
        ...input.source.chosenOptions,
        {
          windowId: input.responseWindowId,
          responseOpId: input.responseOpId,
          optionId: input.responseOptionId ?? null,
          chosenBy: input.chosenBy,
          chosenAt: input.updatedAt,
        },
      ]
    : input.source.chosenOptions
  const phase = terminalPhase(input.source, trace)
  return parsePendingMoveResolution({
    ...input.source,
    phase,
    trace,
    rollLedger: input.rollLedger ?? input.source.rollLedger,
    outstandingWindows: [],
    chosenOptions,
    status: input.status,
    updatedAt: input.updatedAt,
    publicSummary: {
      ...input.source.publicSummary,
      phase,
      status: input.status,
      outstandingWindowCount: 0,
      updatedAt: input.updatedAt,
    },
  })
}

const applyMap = (
  previous: TabletopMap,
  next: TabletopMap,
  dependencies: Dependencies,
): void => {
  const persisted = toPersistedMap(
    next,
    next.folder ?? '',
    next.updatedAt ?? dependencies.now(),
    { revision: normalizeRevision(next.revision) },
  )
  const result = dependencies.mapRepository.applyLivePlayUpdate({
    slug: next.slug,
    expectedRevision: normalizeRevision(previous.revision),
    nextMap: persisted,
  })
  if (result === 'stale') {
    throw new ResumePendingMoveResolutionUseCaseError(
      409,
      `Map ${next.slug} changed before the move response could commit.`,
    )
  }
}

const applySheets = (
  plan: Pick<
    AuthoritativeMoveStatePlan | AbilityFollowUpResponsePlan | AttackOfOpportunityResponsePlan,
    'sheetWrites' | 'nextMap'
  >,
  dependencies: Dependencies,
): readonly LivePlayResolveMoveCommandSheetUpdate[] => {
  for (const write of plan.sheetWrites) {
    const result = dependencies.sheetRepository.applyLivePlayUpdate({
      kind: write.kind,
      slug: write.slug,
      expectedRevision: write.expectedRevision,
      nextSheet: sheetPayloadForPersistence(
        write.nextSheet as unknown as Record<string, unknown>,
        write.slug,
        plan.nextMap.updatedAt ?? dependencies.now(),
      ),
    })
    if (result === 'stale') {
      throw new ResumePendingMoveResolutionUseCaseError(
        409,
        `${write.kind} sheet ${write.slug} changed before the move response could commit.`,
      )
    }
  }
  return plan.sheetWrites.map((write) => {
    const stored = dependencies.sheetRepository.getByRef(write.kind, write.slug)
    if (!stored || stored.revision !== write.revision) {
      throw new ResumePendingMoveResolutionUseCaseError(
        409,
        `${write.kind} sheet ${write.slug} did not match the resumed move plan.`,
      )
    }
    return {
      kind: stored.kind,
      slug: stored.slug,
      path: logicalSheetResourcePath(stored.kind, stored.sheet),
      sheet: stored.sheet,
    }
  })
}

const wireCommand = (
  command: MoveResponseCommand,
  plan: AuthoritativeMoveStatePlan,
): ResolveMoveLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: command.opId,
  mapSlug: command.mapSlug,
  baseRevision: command.baseRevision,
  type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  scopes: [...actualResolveMoveWriteScopes(plan)],
  payload: {
    schemaVersion: 1,
    placementId: plan.resolution.actorPlacementId,
    moveName: plan.resolution.canonicalMoveName,
    selection: { kind: 'self' },
  },
})

const responseFromState = (input: {
  readonly role: AuthRole
  readonly result: LivePlayCommandResult
  readonly map: TabletopMap
  readonly sheetUpdates?: readonly LivePlayResolveMoveCommandSheetUpdate[]
  readonly move?: LivePlayResolvedMoveResult
}): LivePlayResolveMoveCommandResponse => ({
  result: input.result,
  path: logicalMapResourcePath(input.map),
  map: input.map,
  ...(input.sheetUpdates?.length
    ? {
        sheetUpdates: input.role === 'player'
          ? (redactSheetUpdatesForPlayer([...input.sheetUpdates]) ?? [])
          : [...input.sheetUpdates],
      }
    : {}),
  ...(input.move ? { move: input.move } : {}),
})

const responseMetadataPatch = (
  plan: Pick<AbilityFollowUpResponsePlan | AttackOfOpportunityResponsePlan, 'previousMap' | 'nextMap' | 'revision'>,
  command: 'resolveAbilityFollowUp' | 'resolveAttackOfOpportunity',
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_METADATA> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  mapSlug: plan.nextMap.slug,
  revision: plan.revision,
  scopes: [{ kind: 'map', lane: 'metadata' }],
  payload: {
    command,
    previous: deepCloneJson(plan.previousMap.metadata ?? {}),
    current: deepCloneJson(plan.nextMap.metadata ?? {}),
  },
})

const existingResponse = (
  input: ResumePendingMoveResolutionInput,
  dependencies: Dependencies,
  commandHash: LivePlayCommandHash,
): LivePlayResolveMoveCommandResponse | null => {
  const existing = dependencies.opRepository.getStoredOpRecord(
    input.command.mapSlug,
    input.command.opId,
  )
  if (!existing) return null
  if (existing.commandHash !== commandHash) {
    throw new ResumePendingMoveResolutionUseCaseError(
      409,
      `Operation ID ${input.command.mapSlug}:${input.command.opId} was already used by another command.`,
    )
  }
  const map = dependencies.mapRepository.getBySlug(input.command.mapSlug)
  if (!map) throw new ResumePendingMoveResolutionUseCaseError(404, 'Map not found.')
  if (!canAccessMapForRole(input.role, map)) {
    throw new ResumePendingMoveResolutionUseCaseError(403, 'Map is not player visible.')
  }
  return responseFromState({ role: input.role, result: existing.result, map })
}

const persistResourceCostRejection = (input: {
  readonly request: ResumePendingMoveResolutionInput
  readonly map: TabletopMap
  readonly commandHash: LivePlayCommandHash
  readonly dependencies: Dependencies
  readonly error: unknown
}): LivePlayResolveMoveCommandResponse | null => {
  if (
    !isAuthoritativeMoveStatePlanningError(input.error)
    || input.error.code !== 'move-resource-unavailable'
  ) return null
  const result = createLivePlayRejectedResult({
    opId: input.request.command.opId,
    mapSlug: input.request.command.mapSlug,
    reason: 'conflict',
    message: input.error.message,
    currentRevision: normalizeRevision(input.map.revision),
  })
  input.dependencies.opRepository.saveCommandResult({
    mapSlug: input.request.command.mapSlug,
    opId: input.request.command.opId,
    commandHash: input.commandHash,
    command: input.request.command,
    result,
  })
  return responseFromState({ role: input.request.role, result, map: input.map })
}

const persistConflict = (input: {
  readonly request: ResumePendingMoveResolutionInput
  readonly stored: StoredPendingMoveResolution
  readonly map: TabletopMap
  readonly now: number
  readonly commandHash: LivePlayCommandHash
  readonly dependencies: Dependencies
  readonly message: string
}): LivePlayResolveMoveCommandResponse => {
  const nextMap = summaryRemovedMap(
    input.map,
    input.stored.resolutionId,
    input.now,
  )
  const result = createLivePlayRejectedResult({
    opId: input.request.command.opId,
    mapSlug: input.request.command.mapSlug,
    reason: 'conflict',
    message: input.message,
    currentRevision: normalizeRevision(nextMap.revision),
  })
  applyMap(input.map, nextMap, input.dependencies)
  input.dependencies.opRepository.saveCommandResult({
    mapSlug: input.request.command.mapSlug,
    opId: input.request.command.opId,
    commandHash: input.commandHash,
    command: input.request.command,
    result,
  })
  input.dependencies.pendingResolutionRepository.update({
    resolution: terminalResolution({
      source: input.stored.resolution,
      status: 'conflicted',
      updatedAt: input.now,
    }),
    expectedRevision: input.stored.revision,
    terminalOpId: input.request.command.opId,
  })
  return responseFromState({ role: input.request.role, result, map: nextMap })
}

const currentStoredResolution = (
  input: ResumePendingMoveResolutionInput,
  dependencies: Dependencies,
): StoredPendingMoveResolution => {
  const stored = dependencies.pendingResolutionRepository.getById(
    input.command.payload.resolutionId,
  )
  if (
    !stored
    || stored.revision !== input.storedResolution.revision
    || stored.status !== 'pending'
  ) {
    throw new ResumePendingMoveResolutionUseCaseError(
      409,
      'The pending move resolution changed before this response could be applied.',
    )
  }
  return stored
}

/** Apply exactly one authorized durable response and continue the move saga. */
export const resumePendingMoveResolutionUseCase = (
  input: ResumePendingMoveResolutionInput,
  dependencyInput: ResumePendingMoveResolutionDependencies = {},
): LivePlayResolveMoveCommandResponse => {
  if (input.command.type === MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL) {
    throw new ResumePendingMoveResolutionUseCaseError(
      400,
      'Cancellation must use pending-resolution termination orchestration.',
    )
  }
  const dependencies = dependenciesWithDefaults(dependencyInput)
  const commandHash = moveResponseCommandHash(input.command)
  const replay = existingResponse(input, dependencies, commandHash)
  if (replay) return replay

  let persistedEvents: ReturnType<Dependencies['realtimeEventRepository']['appendMany']> = []
  const response = dependencies.database.withTransaction(() => {
    const stored = currentStoredResolution(input, dependencies)
    const map = dependencies.mapRepository.getBySlug(input.command.mapSlug)
    if (!map) throw new ResumePendingMoveResolutionUseCaseError(404, 'Map not found.')
    if (!canAccessMapForRole(input.role, map)) {
      throw new ResumePendingMoveResolutionUseCaseError(403, 'Map is not player visible.')
    }
    const now = dependencies.now()
    if (!hasCurrentReadSet(input, map, dependencies)) {
      return persistConflict({
        request: input,
        stored,
        map,
        now,
        commandHash,
        dependencies,
        message: 'Authoritative state consulted by this move changed before the response.',
      })
    }
    const sheets = loadSheets(map, dependencies)
    if (isAttackOfOpportunityPendingResolution(stored.resolution)) {
      let plan: AttackOfOpportunityResponsePlan
      try {
        plan = planAttackOfOpportunityResponse({
          pendingResolution: stored.resolution,
          responseOpId: input.command.opId,
          responseWindowId: responseWindowId(input.command),
          responseOptionId: responseOptionId(input.command),
          chosenBy: input.authorization.chosenBy,
          map,
          ...sheets,
          plannedAt: now,
          random: dependencies.random,
          maxMoveLogEntries: dependencies.maxMoveLogEntries,
        })
      }
      catch (error) {
        const rejection = persistResourceCostRejection({
          request: input,
          map,
          commandHash,
          dependencies,
          error,
        })
        if (rejection) return rejection
        throw error
      }
      dependencies.beforeCommit?.()
      dependencies.sheetRepository.assertRevisions(plan.sheetReads)
      applyMap(map, plan.nextMap, dependencies)
      const sheetUpdates = applySheets(plan, dependencies)
      const childPlan = plan.childMovePlan
      const move = childPlan ? moveResultFromPlan(childPlan) : undefined
      const internalCommand = childPlan
        ? wireCommand(input.command, childPlan)
        : input.command as unknown as ResolveMoveLivePlayCommand
      const patches = childPlan
        ? [moveStatePatch(internalCommand, childPlan, move!, internalCommand.scopes)]
        : [responseMetadataPatch(plan, 'resolveAttackOfOpportunity')]
      const result = createLivePlayAcceptedResult({
        opId: input.command.opId,
        mapSlug: input.command.mapSlug,
        previousRevision: plan.previousRevision,
        revision: plan.revision,
        patches,
      })
      dependencies.opRepository.saveCommandResult({
        mapSlug: input.command.mapSlug,
        opId: input.command.opId,
        commandHash,
        command: input.command,
        result,
        ...(childPlan ? {
          moveCompensation: createAcceptedMoveCompensationResult({
            mapSlug: input.command.mapSlug,
            originOperationId: input.command.opId,
            plan: childPlan.stateChanges,
          }),
        } : {}),
      })
      dependencies.pendingResolutionRepository.update({
        resolution: plan.pendingResolution,
        expectedRevision: stored.revision,
        ...(plan.pendingResolution.status === 'pending'
          ? {}
          : { terminalOpId: input.command.opId }),
      })
      if (childPlan?.followUpResolution) {
        if (!dependencies.pendingResolutionRepository.create) {
          throw new ResumePendingMoveResolutionUseCaseError(
            409,
            'Pending repository cannot persist opportunity-attack child follow-ups.',
          )
        }
        dependencies.pendingResolutionRepository.create({
          resolution: childPlan.followUpResolution,
          declarationPlan: createMoveStateChangePlan([]),
        })
      }
      persistedEvents = dependencies.realtimeEventRepository.appendMany([
        ...livePlaySheetUpdateRealtimeAppendInputs({
          command: internalCommand,
          updates: sheetUpdates,
          clientId: input.clientId,
        }),
        acceptedCommandRealtimeAppendInput({
          command: internalCommand,
          result,
          clientId: input.clientId,
        }),
      ])
      return responseFromState({
        role: input.role,
        result,
        map: plan.nextMap,
        sheetUpdates,
        ...(move ? { move } : {}),
      })
    }
    if (isAbilityFollowUpPendingResolution(stored.resolution)) {
      const plan = planAbilityFollowUpResponse({
        pendingResolution: stored.resolution,
        responseOpId: input.command.opId,
        responseWindowId: responseWindowId(input.command),
        responseOptionId: responseOptionId(input.command),
        chosenBy: input.authorization.chosenBy,
        map,
        ...sheets,
        plannedAt: now,
        maxMoveLogEntries: dependencies.maxMoveLogEntries,
      })
      dependencies.beforeCommit?.()
      dependencies.sheetRepository.assertRevisions(plan.sheetReads)
      applyMap(map, plan.nextMap, dependencies)
      const sheetUpdates = applySheets(plan, dependencies)
      const patch = responseMetadataPatch(plan, 'resolveAbilityFollowUp')
      const result = createLivePlayAcceptedResult({
        opId: input.command.opId,
        mapSlug: input.command.mapSlug,
        previousRevision: plan.previousRevision,
        revision: plan.revision,
        patches: [patch],
      })
      dependencies.opRepository.saveCommandResult({
        mapSlug: input.command.mapSlug,
        opId: input.command.opId,
        commandHash,
        command: input.command,
        result,
        moveCompensation: createAcceptedMoveCompensationResult({
          mapSlug: input.command.mapSlug,
          originOperationId: input.command.opId,
          plan: plan.stateChanges,
        }),
      })
      dependencies.pendingResolutionRepository.update({
        resolution: plan.pendingResolution,
        expectedRevision: stored.revision,
        ...(plan.pendingResolution.status === 'pending'
          ? {}
          : { terminalOpId: input.command.opId }),
      })
      persistedEvents = dependencies.realtimeEventRepository.appendMany([
        ...livePlaySheetUpdateRealtimeAppendInputs({
          command: input.command as unknown as ResolveMoveLivePlayCommand,
          updates: sheetUpdates,
          clientId: input.clientId,
        }),
        acceptedCommandRealtimeAppendInput({
          command: input.command as unknown as ResolveMoveLivePlayCommand,
          result,
          clientId: input.clientId,
        }),
      ])
      return responseFromState({
        role: input.role,
        result,
        map: plan.nextMap,
        sheetUpdates,
      })
    }

    let execution
    try {
      execution = resumeMoveSpec({
        pendingResolution: stored.resolution,
        map,
        ...sheets,
        response: {
          requestId: responseWindowId(input.command),
          optionId: responseOptionId(input.command),
          ...(input.command.type === MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE
            ? { forcePass: true }
            : {}),
        },
        now,
        random: dependencies.random,
        runtimeRegistry: dependencies.runtimeRegistry,
      })
    }
    catch (error) {
      if (!(error instanceof ResumeMoveSpecError)) throw error
      return persistConflict({
        request: input,
        stored,
        map,
        now,
        commandHash,
        dependencies,
        message: error.message,
      })
    }
    let plan: AuthoritativeMoveStatePlan | AuthoritativePendingMoveStatePlan
    try {
      plan = planResumedMoveState({
        pendingResolution: stored.resolution,
        declarationPlan: stored.declarationPlan ?? null,
        responseOpId: input.command.opId,
        responseWindowId: responseWindowId(input.command),
        responseOptionId: responseOptionId(input.command),
        chosenBy: input.authorization.chosenBy,
        map,
        ...sheets,
        execution,
        plannedAt: now,
        runtimeRegistry: dependencies.runtimeRegistry,
        maxMoveLogEntries: dependencies.maxMoveLogEntries,
      })
    }
    catch (error) {
      const rejection = persistResourceCostRejection({
        request: input,
        map,
        commandHash,
        dependencies,
        error,
      })
      if (rejection) return rejection
      throw error
    }
    dependencies.beforeCommit?.()
    dependencies.sheetRepository.assertRevisions(plan.sheetReads)
    applyMap(map, plan.nextMap, dependencies)

    if (isAuthoritativePendingMoveStatePlan(plan)) {
      const result = createLivePlayAcceptedResult({
        opId: input.command.opId,
        mapSlug: input.command.mapSlug,
        previousRevision: plan.previousRevision,
        revision: plan.revision,
        patches: [],
      })
      dependencies.pendingResolutionRepository.update({
        resolution: plan.suspension.pendingResolution,
        expectedRevision: stored.revision,
        declarationPlan: appendPendingDeclarationResourcePlan({
          existing: stored.declarationPlan,
          additional: plan.suspension.preWindowPlan,
          resolutionId: stored.resolutionId,
        }),
      })
      dependencies.opRepository.saveCommandResult({
        mapSlug: input.command.mapSlug,
        opId: input.command.opId,
        commandHash,
        command: input.command,
        result,
      })
      persistedEvents = dependencies.realtimeEventRepository.appendMany([
        acceptedCommandRealtimeAppendInput({
          command: input.command as unknown as ResolveMoveLivePlayCommand,
          result,
          clientId: input.clientId,
        }),
      ])
      return responseFromState({ role: input.role, result, map: plan.nextMap })
    }

    const sheetUpdates = applySheets(plan, dependencies)
    const move = moveResultFromPlan(plan)
    const internalCommand = wireCommand(input.command, plan)
    const patch = moveStatePatch(
      internalCommand,
      plan,
      move,
      internalCommand.scopes,
    )
    const result: LivePlayCommandAccepted = createLivePlayAcceptedResult({
      opId: input.command.opId,
      mapSlug: input.command.mapSlug,
      previousRevision: plan.previousRevision,
      revision: plan.revision,
      patches: [patch],
    })
    dependencies.opRepository.saveCommandResult({
      mapSlug: input.command.mapSlug,
      opId: input.command.opId,
      commandHash,
      command: input.command,
      result,
      moveCompensation: createAcceptedMoveCompensationResult({
        mapSlug: input.command.mapSlug,
        originOperationId: input.command.opId,
        plan: plan.stateChanges,
      }),
    })
    dependencies.pendingResolutionRepository.update({
      resolution: terminalResolution({
        source: stored.resolution,
        status: 'committed',
        updatedAt: now,
        responseOpId: input.command.opId,
        responseWindowId: responseWindowId(input.command),
        responseOptionId: responseOptionId(input.command),
        chosenBy: input.authorization.chosenBy,
        trace: plan.resolution.auditTrace,
        rollLedger: plan.resolution.rollLedger,
      }),
      expectedRevision: stored.revision,
      terminalOpId: input.command.opId,
    })
    if (plan.followUpResolution) {
      if (!dependencies.pendingResolutionRepository.create) {
        throw new ResumePendingMoveResolutionUseCaseError(
          409,
          'Pending repository cannot persist accepted-move ability follow-ups.',
        )
      }
      dependencies.pendingResolutionRepository.create({
        resolution: plan.followUpResolution,
        declarationPlan: createMoveStateChangePlan([]),
      })
    }
    persistedEvents = dependencies.realtimeEventRepository.appendMany([
      ...livePlaySheetUpdateRealtimeAppendInputs({
        command: internalCommand,
        updates: sheetUpdates,
        clientId: input.clientId,
      }),
      acceptedCommandRealtimeAppendInput({
        command: internalCommand,
        result,
        clientId: input.clientId,
      }),
    ])
    return responseFromState({
      role: input.role,
      result,
      map: plan.nextMap,
      sheetUpdates,
      move,
    })
  })

  publishPersistedRealtimeEventsAfterCommit({
    events: persistedEvents,
    operation: 'resume pending move resolution',
    publish: dependencies.publishPersistedRealtimeEvent,
    reportFailure: defaultPersistedRealtimePublicationFailureReporter,
  })
  return response
}

export const replayMoveResponseCommandUseCase = (input: {
  readonly role: AuthRole
  readonly command: MoveResponseCommand
}, dependencyInput: ResumePendingMoveResolutionDependencies = {}): LivePlayResolveMoveCommandResponse | null => {
  const dependencies = dependenciesWithDefaults(dependencyInput)
  const existing = dependencies.opRepository.getStoredOpRecord(
    input.command.mapSlug,
    input.command.opId,
  )
  if (!existing) return null
  const hash = moveResponseCommandHash(input.command)
  if (existing.commandHash !== hash) {
    throw new ResumePendingMoveResolutionUseCaseError(
      409,
      `Operation ID ${input.command.mapSlug}:${input.command.opId} was already used by another command.`,
    )
  }
  const map = dependencies.mapRepository.getBySlug(input.command.mapSlug)
  if (!map) throw new ResumePendingMoveResolutionUseCaseError(404, 'Map not found.')
  if (!canAccessMapForRole(input.role, map)) {
    throw new ResumePendingMoveResolutionUseCaseError(403, 'Map is not player visible.')
  }
  return responseFromState({ role: input.role, result: existing.result, map })
}
