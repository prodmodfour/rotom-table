import type { AuthRole } from '#shared/auth'
import {
  createLivePlayAcceptedResult,
  type LivePlayCommandAccepted,
} from '#shared/livePlayCommands'
import {
  MOVE_RESPONSE_COMMAND_TYPES,
  type GmCancelMoveResolutionCommand,
} from '#shared/moveAutomation/responseCommands'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  DeclarationCompensationError,
  planPendingResolutionTermination,
  type PendingResolutionTerminationStatus,
} from '../domain/moveAutomation/declarationCompensation'
import type { ParsedMoveResponseCommand } from '../livePlay/moveResponseCommandParser'
import { acceptedCommandRealtimeAppendInput } from '../livePlay/acceptedCommandRealtime'
import { withAcceptedEncounterPresentation } from '../domain/encounterPresentation/acceptedAdapters'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import type { PendingMoveResponseAuthorizationGrant } from '../policies/pendingMoveResponsePolicy'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
} from '../realtime/persistedBatchPublication'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteLivePlayOpRepository, type LivePlayOpRepository } from '../storage/opRepository'
import {
  createSqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
} from '../storage/pendingMoveResolutionRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  createSqliteSheetRepository,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  logicalMapResourcePath,
  logicalSheetResourcePath,
} from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  sheetPayloadForPersistence,
  type LivePlayResolveMoveCommandResponse,
  type LivePlayResolveMoveCommandSheetUpdate,
} from './applyResolveMoveCommand'
import { toPersistedMap } from './saveMap'
import {
  moveResponseCommandHash,
} from './resumePendingMoveResolution'

export class TerminatePendingMoveResolutionUseCaseError
  extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface TerminatePendingMoveResolutionInput extends ParsedMoveResponseCommand {
  readonly role: AuthRole
  readonly authorization: PendingMoveResponseAuthorizationGrant
  readonly clientId?: string
}

export interface TerminatePendingMoveResolutionDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<
    SheetRepository<Record<string, unknown>>,
    'getByRef' | 'applyLivePlayUpdate'
  >
  readonly pendingResolutionRepository?: Pick<PendingMoveResolutionRepository, 'getById' | 'update'>
  readonly opRepository?: Pick<LivePlayOpRepository, 'saveCommandResult'>
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly now?: () => number
}

type Dependencies = ReturnType<typeof dependenciesWithDefaults>

const dependenciesWithDefaults = (input: TerminatePendingMoveResolutionDependencies) => {
  const database = input.database ?? getRotomDatabase()
  return {
    database,
    mapRepository: input.mapRepository ?? createSqliteMapRepository<TabletopMap>(database),
    sheetRepository: input.sheetRepository
      ?? createSqliteSheetRepository<Record<string, unknown>>(database),
    pendingResolutionRepository: input.pendingResolutionRepository
      ?? createSqlitePendingMoveResolutionRepository(database),
    opRepository: input.opRepository ?? createSqliteLivePlayOpRepository({ database }),
    realtimeEventRepository: input.realtimeEventRepository
      ?? createSqliteRealtimeEventRepository({ database }),
    publishPersistedRealtimeEvent: input.publishPersistedRealtimeEvent
      ?? defaultPersistedRealtimeEventPublisher,
    now: input.now ?? Date.now,
  }
}

const loadCompensationSheets = (
  input: TerminatePendingMoveResolutionInput,
  dependencies: Dependencies,
): {
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
} => {
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  const declarationPlan = input.storedResolution.declarationPlan
  if (!declarationPlan) return { pokemonSheets, trainerSheets }

  for (const group of declarationPlan.groups.sheets) {
    const stored = dependencies.sheetRepository.getByRef(
      group.scope.sheetKind,
      group.scope.sheetSlug,
    )
    if (!stored) {
      throw new TerminatePendingMoveResolutionUseCaseError(
        404,
        `${group.scope.sheetKind} sheet ${group.scope.sheetSlug} was not found for declaration compensation.`,
      )
    }
    const sheet = {
      ...stored.sheet,
      slug: stored.slug,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
    }
    if (stored.kind === 'pokemon') {
      pokemonSheets.set(stored.slug, sheet as unknown as CharacterSheet)
    }
    else {
      trainerSheets.set(stored.slug, sheet as unknown as TrainerSheet)
    }
  }
  return { pokemonSheets, trainerSheets }
}

const assertCurrentPending = (
  input: TerminatePendingMoveResolutionInput,
  dependencies: Dependencies,
) => {
  const stored = dependencies.pendingResolutionRepository.getById(
    input.command.payload.resolutionId,
  )
  if (
    !stored
    || stored.revision !== input.storedResolution.revision
    || stored.status !== 'pending'
  ) {
    throw new TerminatePendingMoveResolutionUseCaseError(
      409,
      'The pending move resolution changed before termination could commit.',
    )
  }
  return stored
}

const applyMap = (
  previous: TabletopMap,
  next: TabletopMap,
  dependencies: Dependencies,
): void => {
  const result = dependencies.mapRepository.applyLivePlayUpdate({
    slug: next.slug,
    expectedRevision: normalizeRevision(previous.revision),
    nextMap: toPersistedMap(
      next,
      next.folder ?? '',
      next.updatedAt ?? dependencies.now(),
      { revision: normalizeRevision(next.revision) },
    ),
  })
  if (result === 'stale') {
    throw new TerminatePendingMoveResolutionUseCaseError(
      409,
      `Map ${next.slug} changed before pending-resolution termination could commit.`,
    )
  }
}

const resultResponse = (
  result: LivePlayCommandAccepted,
  map: TabletopMap,
  sheetUpdates: readonly LivePlayResolveMoveCommandSheetUpdate[],
): LivePlayResolveMoveCommandResponse => ({
  result,
  path: logicalMapResourcePath(map),
  map,
  ...(sheetUpdates.length ? { sheetUpdates: [...sheetUpdates] } : {}),
})

const terminate = (
  input: TerminatePendingMoveResolutionInput,
  dependencyInput: TerminatePendingMoveResolutionDependencies,
  options: {
    readonly status: PendingResolutionTerminationStatus
    readonly reasonCode: string
    readonly compensateDeclarationCosts: boolean
  },
): LivePlayResolveMoveCommandResponse => {
  if (
    input.role !== 'gm'
    || input.command.type !== MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL
    || input.authorization.source !== 'gm-authority'
    || input.authorization.chosenBy.kind !== 'gm'
  ) {
    throw new TerminatePendingMoveResolutionUseCaseError(
      403,
      'Only an authorized GM cancellation can terminate this pending resolution.',
    )
  }
  const command = input.command as GmCancelMoveResolutionCommand
  const dependencies = dependenciesWithDefaults(dependencyInput)
  const commandHash = moveResponseCommandHash(command)
  let persistedEvents: ReturnType<Dependencies['realtimeEventRepository']['appendMany']> = []

  const response = dependencies.database.withTransaction(() => {
    const stored = assertCurrentPending(input, dependencies)
    const map = dependencies.mapRepository.getBySlug(command.mapSlug)
    if (!map) throw new TerminatePendingMoveResolutionUseCaseError(404, 'Map not found.')
    const currentRevision = normalizeRevision(map.revision)
    if (command.baseRevision !== currentRevision) {
      throw new TerminatePendingMoveResolutionUseCaseError(
        409,
        `Map ${command.mapSlug} changed before pending-resolution termination.`,
      )
    }
    const terminatedAt = Math.max(dependencies.now(), stored.updatedAt)
    let plan
    try {
      plan = planPendingResolutionTermination({
        pendingResolution: stored.resolution,
        declarationPlan: stored.declarationPlan ?? null,
        map,
        ...loadCompensationSheets(input, dependencies),
        status: options.status,
        reasonCode: options.reasonCode,
        sourceOperationId: command.opId,
        terminatedAt,
        compensateDeclarationCosts: options.compensateDeclarationCosts,
      })
    }
    catch (error) {
      if (error instanceof DeclarationCompensationError) {
        throw new TerminatePendingMoveResolutionUseCaseError(409, error.message)
      }
      throw error
    }

    const revision = nextRevision(currentRevision)
    const nextMap = deepCloneJson({
      ...plan.nextMap,
      revision,
      updatedAt: terminatedAt,
    })
    applyMap(map, nextMap, dependencies)
    for (const write of plan.sheetWrites) {
      const result = dependencies.sheetRepository.applyLivePlayUpdate({
        kind: write.kind,
        slug: write.slug,
        expectedRevision: write.expectedRevision,
        nextSheet: sheetPayloadForPersistence(
          write.nextSheet as unknown as Record<string, unknown>,
          write.slug,
          terminatedAt,
        ),
      })
      if (result === 'stale') {
        throw new TerminatePendingMoveResolutionUseCaseError(
          409,
          `${write.kind} sheet ${write.slug} changed before declaration compensation could commit.`,
        )
      }
    }

    const sheetUpdates = plan.sheetWrites.map((write): LivePlayResolveMoveCommandSheetUpdate => {
      const storedSheet = dependencies.sheetRepository.getByRef(write.kind, write.slug)
      if (!storedSheet || storedSheet.revision !== write.revision) {
        throw new TerminatePendingMoveResolutionUseCaseError(
          409,
          `${write.kind} sheet ${write.slug} did not match its declaration compensation plan.`,
        )
      }
      return {
        kind: storedSheet.kind,
        slug: storedSheet.slug,
        path: logicalSheetResourcePath(storedSheet.kind, storedSheet.sheet),
        sheet: storedSheet.sheet,
      }
    })
    const result = withAcceptedEncounterPresentation({
      command: command as never,
      result: createLivePlayAcceptedResult({
        opId: command.opId,
        mapSlug: command.mapSlug,
        previousRevision: currentRevision,
        revision,
        patches: [],
      }),
      occurredAt: terminatedAt,
    })
    dependencies.opRepository.saveCommandResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      command,
      result,
    })
    dependencies.pendingResolutionRepository.update({
      resolution: plan.pendingResolution,
      expectedRevision: stored.revision,
      terminalOpId: command.opId,
    })
    persistedEvents = dependencies.realtimeEventRepository.appendMany([
      ...livePlaySheetUpdateRealtimeAppendInputs({
        command: command as never,
        updates: sheetUpdates,
        clientId: input.clientId,
      }),
      acceptedCommandRealtimeAppendInput({
        command: command as never,
        result,
        clientId: input.clientId,
      }),
    ])
    return resultResponse(result, nextMap, sheetUpdates)
  })

  publishPersistedRealtimeEventsAfterCommit({
    events: persistedEvents,
    operation: options.status === 'abandoned'
      ? 'abandon pending move resolution'
      : 'cancel pending move resolution',
    publish: dependencies.publishPersistedRealtimeEvent,
    reportFailure: defaultPersistedRealtimePublicationFailureReporter,
  })
  return response
}

/** Cancel and safely compensate every typed declaration-time cost. */
export const cancelPendingMoveResolutionUseCase = (
  input: TerminatePendingMoveResolutionInput,
  dependencies: TerminatePendingMoveResolutionDependencies = {},
): LivePlayResolveMoveCommandResponse => terminate(input, dependencies, {
  status: 'cancelled',
  reasonCode: 'pending-resolution.gm-cancelled',
  compensateDeclarationCosts: true,
})

/**
 * Explicit recovery escape hatch. It terminates without restoring declaration
 * costs and therefore cannot overwrite state whose safe inverse is unknown.
 */
export const abandonPendingMoveResolutionUseCase = (
  input: TerminatePendingMoveResolutionInput,
  dependencies: TerminatePendingMoveResolutionDependencies = {},
): LivePlayResolveMoveCommandResponse => terminate(input, dependencies, {
  status: 'abandoned',
  reasonCode: 'pending-resolution.gm-abandoned',
  compensateDeclarationCosts: false,
})
