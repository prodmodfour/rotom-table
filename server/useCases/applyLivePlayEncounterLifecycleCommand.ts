import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type DismissEncounterEffectPayload,
  type EncounterDurationLifecyclePatch,
  type EncounterDurationLifecyclePatchPayload,
  type EndEncounterPayload,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayEncounterLifecycleCommand,
  type LivePlayMapScope,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  createSqliteSheetRepository,
  SheetRevisionConflictError,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  createSqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
} from '../storage/pendingMoveResolutionRepository'
import {
  createSqliteItemOperationRepository,
  type ItemOperationRepository,
} from '../storage/itemOperationRepository'
import { encounterLifecyclePatchPayload } from '../domain/moveAutomation/lifecyclePatch'
import { planEncounterLifecycle, type EncounterLifecyclePlan } from '../domain/moveAutomation/planInitiativeLifecycle'
import {
  createEncounterEndLifecycleEvent,
  createExplicitEffectDismissalLifecycleEvent,
} from '../domain/moveAutomation/durationLifecycle'
import { resolveEncounterEffectCommandRef } from '../domain/moveAutomation/encounterEffectCommandRef'
import type { EncounterLifecycleTriggerHandler } from '../domain/moveAutomation/reduceLifecycle'
import { logicalMapResourcePath, logicalSheetResourcePath } from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'

export type LivePlayEncounterLifecycleCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER
  | typeof LIVE_PLAY_COMMAND_TYPES.DISMISS_ENCOUNTER_EFFECT

export class LivePlayEncounterLifecycleCommandUseCaseError
  extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ExecuteLivePlayEncounterLifecycleCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly expectedType?: LivePlayEncounterLifecycleCommandType
}

export interface LivePlayEncounterLifecycleSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly path: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlayEncounterLifecycleCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly sheetUpdates?: readonly LivePlayEncounterLifecycleSheetUpdate[]
}

type LifecycleSheetRepository = Pick<
  SheetRepository<Record<string, unknown>>,
  'get' | 'getByRef' | 'assertRevisions' | 'applyLivePlayUpdate'
>

export interface LivePlayEncounterLifecycleCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: LifecycleSheetRepository
  readonly pendingResolutionRepository?: Pick<PendingMoveResolutionRepository, 'listByMap'>
  readonly itemOperationRepository?: Pick<ItemOperationRepository, 'hasPendingForMap'>
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
  readonly lifecycleHandlers?: readonly EncounterLifecycleTriggerHandler[]
}

interface EncounterLifecycleContext {
  readonly path: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly lifecycle?: EncounterLifecyclePlan
  readonly sheetUpdates?: readonly LivePlayEncounterLifecycleSheetUpdate[]
}

type UnknownRecord = Record<string, unknown>
const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)
const hasOwn = (value: UnknownRecord, key: string): boolean => Object.hasOwn(value, key)
const exact = (value: unknown, fields: readonly string[], label: string): UnknownRecord => {
  if (!isRecord(value)) rejectLivePlayCommand('invalid', `${label} must be an object`)
  const row = value as UnknownRecord
  const expected = new Set(fields)
  if (fields.some(field => !hasOwn(row, field)) || Object.keys(row).some(field => !expected.has(field))) {
    rejectLivePlayCommand('invalid', `${label} must contain exactly: ${fields.join(', ')}`)
  }
  return row
}

const dependenciesFor = (input: LivePlayEncounterLifecycleCommandDependencies) => {
  const database = input.database ?? getRotomDatabase()
  return {
    commandExecutor: input.commandExecutor ?? createSqliteAuthoritativeLivePlayCommandExecutor({ database }),
    database,
    mapRepository: input.mapRepository ?? createSqliteMapRepository<TabletopMap>(database),
    sheetRepository: input.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database),
    pendingResolutionRepository: input.pendingResolutionRepository
      ?? createSqlitePendingMoveResolutionRepository(database),
    itemOperationRepository: input.itemOperationRepository
      ?? createSqliteItemOperationRepository({ database }),
    now: input.now ?? Date.now,
    relativePath: input.relativePath ?? ((path: string) => path),
    lifecycleHandlers: input.lifecycleHandlers ?? [],
  }
}
type Dependencies = ReturnType<typeof dependenciesFor>

const encounterScope = (): LivePlayMapScope => ({ kind: 'map', lane: 'encounter' })
const expectEncounterScope = (command: LivePlayEncounterLifecycleCommand): void => {
  if (command.scopes.length !== 1
    || command.scopes[0]?.kind !== 'map'
    || command.scopes[0].lane !== 'encounter') {
    rejectLivePlayCommand('invalid', 'Encounter lifecycle commands require exactly the map encounter scope')
  }
}

const parseEndPayload = (value: unknown): EndEncounterPayload => {
  const row = exact(value, ['reason'], 'endEncounter payload')
  if (row.reason !== 'completed' && row.reason !== 'cancelled' && row.reason !== 'gm-ended') {
    rejectLivePlayCommand('invalid', 'endEncounter payload.reason must be completed, cancelled, or gm-ended')
  }
  return { reason: row.reason as EndEncounterPayload['reason'] }
}

const parseDismissPayload = (value: unknown): DismissEncounterEffectPayload => {
  const row = exact(value, ['effectId'], 'dismissEncounterEffect payload')
  if (typeof row.effectId !== 'string' || row.effectId.length < 1 || row.effectId.length > 160
    || row.effectId.trim() !== row.effectId) {
    rejectLivePlayCommand('invalid', 'dismissEncounterEffect payload.effectId must be a bounded effect identity')
  }
  return { effectId: row.effectId as string }
}

const assertCommand = (
  command: LivePlayEncounterLifecycleCommand,
  expectedType?: LivePlayEncounterLifecycleCommandType,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER
    && command.type !== LIVE_PLAY_COMMAND_TYPES.DISMISS_ENCOUNTER_EFFECT) {
    rejectLivePlayCommand('invalid', 'Encounter lifecycle route accepts endEncounter or dismissEncounterEffect only')
  }
  expectEncounterScope(command)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER) parseEndPayload(command.payload)
  else parseDismissPayload(command.payload)
}

const loadSheets = (map: TabletopMap, repository: LifecycleSheetRepository) => {
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  for (const placement of map.placements) {
    const destination = placement.sheetKind === 'pokemon' ? pokemonSheets : trainerSheets
    if (destination.has(placement.sheetSlug)) continue
    const stored = repository.get(placement.sheetKind, placement.sheetSlug)
    if (!stored) continue
    const sheet = {
      ...stored.document,
      slug: stored.slug,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
    }
    if (placement.sheetKind === 'pokemon') pokemonSheets.set(placement.sheetSlug, sheet as unknown as CharacterSheet)
    else trainerSheets.set(placement.sheetSlug, sheet as unknown as TrainerSheet)
  }
  return { pokemonSheets, trainerSheets }
}

const assertNoPendingResolution = (
  command: LivePlayEncounterLifecycleCommand,
  context: EncounterLifecycleContext,
  deps: Dependencies,
): void => {
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER) return
  const pendingMoves = deps.pendingResolutionRepository.listByMap(context.map.slug)
    .filter(candidate => candidate.status === 'pending')
  const hasPendingItem = deps.itemOperationRepository.hasPendingForMap(context.map.slug)
  const encounterState = parseEncounterState(
    context.map.encounterState ?? createEmptyEncounterState(),
  )
  const publicPending = encounterState.pendingResolutionSummaries
    .filter(candidate => candidate.status === 'pending' || candidate.status === 'resuming')
  const hasPendingExploration = (encounterState.itemExploration?.repelPositioning.length ?? 0) > 0
  if (pendingMoves.length > 0 || hasPendingItem || publicPending.length > 0 || hasPendingExploration) {
    rejectLivePlayCommand(
      'conflict',
      'Encounter end is unavailable while an item or move resolution is pending.',
      { currentRevision: normalizeRevision(context.map.revision) },
    )
  }
}

const plan = (
  command: LivePlayEncounterLifecycleCommand,
  context: EncounterLifecycleContext,
  deps: Dependencies,
): EncounterLifecyclePlan => {
  assertNoPendingResolution(command, context, deps)
  const state = parseEncounterState(context.map.encounterState ?? createEmptyEncounterState())
  const event = command.type === LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER
    ? createEncounterEndLifecycleEvent({
        mapSlug: command.mapSlug,
        operationId: command.opId,
        reason: parseEndPayload(command.payload).reason,
      })
    : (() => {
        const payload = parseDismissPayload(command.payload)
        let effect: EncounterEffect | null = null
        try {
          effect = resolveEncounterEffectCommandRef(state.effects, payload.effectId)
        }
        catch {
          rejectLivePlayCommand('conflict', 'Encounter effect dismissal authority is ambiguous')
        }
        const activeEffect = effect
          ?? (() => rejectLivePlayCommand('no-op', 'The projected encounter effect is not active'))()
        if (activeEffect.duration.kind !== 'explicit-dismissal') {
          rejectLivePlayCommand('conflict', 'The projected encounter effect is not explicitly dismissible')
        }
        return createExplicitEffectDismissalLifecycleEvent({
          effectId: activeEffect.id,
          operationId: command.opId,
        })
      })()
  return planEncounterLifecycle({
    map: context.map,
    events: [event],
    time: deps.now(),
    loadSheets: () => loadSheets(context.map, deps.sheetRepository),
    handlers: deps.lifecycleHandlers,
  })
}

const patchFor = (
  command: LivePlayEncounterLifecycleCommand,
  revision: number,
  lifecycle: EncounterLifecyclePlan,
): EncounterDurationLifecyclePatch => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_ENCOUNTER_LIFECYCLE,
  mapSlug: command.mapSlug,
  revision,
  scopes: [encounterScope()],
  payload: {
    command: command.type,
    reason: command.type === LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER
      ? parseEndPayload(command.payload).reason
      : 'explicit-dismissal',
    effectId: command.type === LIVE_PLAY_COMMAND_TYPES.DISMISS_ENCOUNTER_EFFECT
      ? parseDismissPayload(command.payload).effectId
      : null,
    lifecycle: encounterLifecyclePatchPayload({
      events: lifecycle.events,
      reductions: lifecycle.reductions,
      previousEncounterState: lifecycle.previousEncounterState,
      currentEncounterState: lifecycle.currentEncounterState,
      previousTemporaryHitPoints: lifecycle.previousTemporaryHitPoints,
      currentTemporaryHitPoints: lifecycle.currentTemporaryHitPoints,
      previousFieldEffects: lifecycle.previousFieldEffects,
      currentFieldEffects: lifecycle.currentFieldEffects,
      sheetWrites: lifecycle.sheetWrites,
      rollLedger: lifecycle.rollLedger,
    }),
  } satisfies EncounterDurationLifecyclePatchPayload,
})

const sheetUpdate = (
  sheet: PersistedSheet,
  deps: Dependencies,
): LivePlayEncounterLifecycleSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  path: deps.relativePath(logicalSheetResourcePath(sheet.kind, sheet.sheet)),
  sheet: deepCloneJson(sheet.sheet),
})

const accepted = (result: LivePlayCommandResult): LivePlayCommandAccepted | null => {
  if (!result.ok) return null
  return 'duplicate' in result ? (result.original.ok ? result.original : null) : result
}

export const executeLivePlayEncounterLifecycleCommandUseCase = async (
  input: ExecuteLivePlayEncounterLifecycleCommandInput,
  dependencies: LivePlayEncounterLifecycleCommandDependencies = {},
): Promise<LivePlayEncounterLifecycleCommandResponse> => {
  const deps = dependenciesFor(dependencies)
  let persisted: EncounterLifecycleContext | null = null
  const result = await deps.commandExecutor.execute<
    LivePlayEncounterLifecycleCommand,
    EncounterLifecycleContext,
    { readonly role: AuthRole, readonly clientId?: string }
  >({
    command: input.command,
    actor: { role: input.role, ...(input.clientId ? { clientId: input.clientId } : {}) },
    readMap: async ({ command }) => {
      const map = await deps.mapRepository.getBySlug(command.mapSlug)
      if (!map) throw new LivePlayEncounterLifecycleCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)
      const path = logicalMapResourcePath(map)
      return { path, relativePath: deps.relativePath(path), map }
    },
    getMapRevision: context => normalizeRevision(context.map.revision),
    authorize: ({ command, actor }) => {
      assertCommand(command, input.expectedType)
      if (actor.role !== 'gm') rejectLivePlayCommand('unauthorized', 'Only GMs can end encounters or dismiss encounter effects')
    },
    apply: ({ command, map, currentRevision }) => {
      const lifecycle = plan(command, map, deps)
      const revision = nextRevision(currentRevision)
      const nextMap = {
        ...map,
        map: { ...lifecycle.nextMap, revision },
        lifecycle,
      }
      return {
        status: 'accepted',
        nextMap,
        previousRevision: currentRevision,
        revision,
        patches: [patchFor(command, revision, lifecycle)],
      }
    },
    persist: () => { throw new Error('Encounter lifecycle commands persist through their accepted-result commit hook.') },
    commit: ({ actor, command, currentRevision, nextMap, result: acceptedResult, recordRealtimeEvents, saveOpResult }) => {
      deps.database.withTransaction(() => {
        const lifecycle = nextMap.lifecycle!
        try {
          if (lifecycle.sheetReads.length > 0) deps.sheetRepository.assertRevisions(lifecycle.sheetReads)
        }
        catch (error) {
          if (error instanceof SheetRevisionConflictError) {
            rejectLivePlayCommand('conflict', 'A lifecycle sheet changed before encounter cleanup committed.', { currentRevision })
          }
          throw error
        }
        const persistedMap = toPersistedMap(
          nextMap.map,
          nextMap.map.folder ?? '',
          nextMap.map.updatedAt ?? deps.now(),
          { revision: acceptedResult.revision },
        )
        if (deps.mapRepository.applyLivePlayUpdate({
          slug: acceptedResult.mapSlug,
          expectedRevision: currentRevision,
          nextMap: persistedMap,
        }) === 'stale') {
          rejectLivePlayCommand('conflict', `Map ${acceptedResult.mapSlug} changed before encounter cleanup committed.`, { currentRevision })
        }
        for (const write of lifecycle.sheetWrites) {
          const nextSheet = {
            ...toPersistableSheetPayload(write.nextSheet as unknown as Record<string, unknown>),
            slug: write.slug,
            updatedAt: nextMap.map.updatedAt ?? deps.now(),
          }
          if (deps.sheetRepository.applyLivePlayUpdate({
            kind: write.kind,
            slug: write.slug,
            expectedRevision: write.expectedRevision,
            nextSheet,
          }) === 'stale') {
            rejectLivePlayCommand('conflict', `${write.kind} sheet ${write.slug} changed before encounter cleanup committed.`, { currentRevision })
          }
        }
        const updates = lifecycle.sheetWrites.map(write => {
          const current = deps.sheetRepository.getByRef(write.kind, write.slug)
          if (!current || normalizeRevision(current.revision) !== write.revision) {
            throw new LivePlayEncounterLifecycleCommandUseCaseError(409, `${write.kind} sheet ${write.slug} was not readable after encounter cleanup`)
          }
          return sheetUpdate(current, deps)
        })
        recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs({
          command,
          updates,
          clientId: actor.clientId,
        }))
        saveOpResult()
        const map = deps.mapRepository.getBySlug(acceptedResult.mapSlug)
        if (!map) throw new LivePlayEncounterLifecycleCommandUseCaseError(404, `Map ${acceptedResult.mapSlug}.json not found after encounter cleanup`)
        persisted = {
          path: nextMap.path,
          relativePath: nextMap.relativePath,
          map,
          lifecycle,
          ...(updates.length > 0 ? { sheetUpdates: updates } : {}),
        }
      })
    },
  })

  if (!persisted && accepted(result)) {
    const map = await deps.mapRepository.getBySlug(accepted(result)!.mapSlug)
    if (map) {
      const path = logicalMapResourcePath(map)
      persisted = { path, relativePath: deps.relativePath(path), map }
    }
  }
  return {
    result,
    ...(persisted ? {
      path: persisted.relativePath,
      map: persisted.map,
      ...(persisted.sheetUpdates ? { sheetUpdates: persisted.sheetUpdates } : {}),
    } : {}),
  }
}
