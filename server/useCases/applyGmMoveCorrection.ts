import type { AuthRole } from '#shared/auth'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
  type LivePlayCommandEnvelope,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayScope,
} from '#shared/livePlayCommands'
import {
  GM_MOVE_CORRECTION_COMMAND_TYPE,
  MOVE_CORRECTION_PATCH_SCHEMA_VERSION,
  parseLivePlayMoveCorrectionPatchPayload,
  type GmMoveCorrectionCommand,
  type LivePlayMoveCorrectionPatchPayload,
} from '#shared/moveAutomation/correctionCommands'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { SheetKind, TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'
import {
  AcceptedMoveCorrectionPlanError,
  planAcceptedMoveCorrection,
  type AcceptedMoveCorrectionPlan,
  type AcceptedMoveCorrectionSheetSnapshot,
} from '../domain/moveAutomation/planAcceptedMoveCorrection'
import { acceptedCommandRealtimeAppendInput } from '../livePlay/acceptedCommandRealtime'
import { withAcceptedEncounterPresentation } from '../domain/encounterPresentation/acceptedAdapters'
import { createCanonicalCommandHash } from '../livePlay/commandIdempotency'
import {
  parseMoveCorrectionCommand,
  parseMoveCorrectionCommandSyntax,
  type ParsedMoveCorrectionCommand,
} from '../livePlay/moveCorrectionCommandParser'
import type { LivePlayCommandHash } from '../livePlay/opResult'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
} from '../realtime/persistedBatchPublication'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
} from '../storage/mapInteractionModeRepository'
import {
  createSqliteMapRepository,
  type MapRepository,
} from '../storage/mapRepository'
import {
  createSqliteLivePlayOpRepository,
  type LivePlayOpRepository,
  type SqliteLivePlayOpRecord,
} from '../storage/opRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { logicalMapResourcePath, logicalSheetResourcePath } from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'
import { sheetPayloadForPersistence } from './applyResolveMoveCommand'

export class GmMoveCorrectionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ApplyGmMoveCorrectionInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
}

export interface GmMoveCorrectionSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly path: string
  readonly sheet: Record<string, unknown>
}

export interface GmMoveCorrectionResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly sheetUpdates?: readonly GmMoveCorrectionSheetUpdate[]
}

export interface ApplyGmMoveCorrectionDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly modeRepository?: Pick<MapInteractionModeRepository, 'get'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'>
  readonly opRepository?: Pick<
    LivePlayOpRepository,
    'getStoredOpRecord' | 'saveCommandResult'
  >
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly now?: () => number
}

type Dependencies = ReturnType<typeof dependenciesWithDefaults>

const dependenciesWithDefaults = (input: ApplyGmMoveCorrectionDependencies) => {
  const database = input.database ?? getRotomDatabase()
  return {
    database,
    mapRepository: input.mapRepository ?? createSqliteMapRepository<TabletopMap>(database),
    modeRepository: input.modeRepository ?? createSqliteMapInteractionModeRepository(database),
    sheetRepository: input.sheetRepository
      ?? createSqliteSheetRepository<Record<string, unknown>>(database),
    opRepository: input.opRepository ?? createSqliteLivePlayOpRepository({ database }),
    realtimeEventRepository: input.realtimeEventRepository
      ?? createSqliteRealtimeEventRepository({ database }),
    publishPersistedRealtimeEvent: input.publishPersistedRealtimeEvent
      ?? defaultPersistedRealtimeEventPublisher,
    now: input.now ?? Date.now,
  }
}

export const gmMoveCorrectionCommandHash = (
  command: GmMoveCorrectionCommand,
): LivePlayCommandHash => createCanonicalCommandHash<LivePlayCommandHash, GmMoveCorrectionCommand>({
  command,
  normalize: value => value,
  path: 'gmMoveCorrectionCommand',
  errorPrefix: 'GM move correction command could not be hashed',
})

const sheetKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

const loadAffectedSheets = (
  parsed: ParsedMoveCorrectionCommand,
  dependencies: Dependencies,
): ReadonlyMap<string, AcceptedMoveCorrectionSheetSnapshot> => {
  const sheets = new Map<string, AcceptedMoveCorrectionSheetSnapshot>()
  for (const operation of parsed.operations) {
    const resource = operation.resource
    if (resource.kind !== 'sheet') continue
    const key = sheetKey(resource.sheetKind, resource.sheetSlug)
    if (sheets.has(key)) continue
    const stored = dependencies.sheetRepository.getByRef(
      resource.sheetKind,
      resource.sheetSlug,
    )
    if (!stored) {
      throw new AcceptedMoveCorrectionPlanError(
        'missing-resource',
        `Affected ${resource.sheetKind} sheet ${resource.sheetSlug} is unavailable.`,
      )
    }
    sheets.set(key, {
      kind: stored.kind,
      slug: stored.slug,
      revision: stored.revision,
      sheet: deepCloneJson(stored.sheet),
    })
  }
  return sheets
}

const scopeKey = (scope: LivePlayScope): string => JSON.stringify(scope)

const correctionScopes = (
  plan: AcceptedMoveCorrectionPlan,
  parsed: ParsedMoveCorrectionCommand,
): readonly LivePlayScope[] => {
  const scopes: LivePlayScope[] = [{ kind: 'map', lane: 'metadata' }]
  const seen = new Set(scopes.map(scopeKey))
  const push = (scope: LivePlayScope): void => {
    const key = scopeKey(scope)
    if (seen.has(key)) return
    seen.add(key)
    scopes.push(scope)
  }

  for (const operation of parsed.operations) {
    const inverse = operation.inverse
    if (inverse.kind === 'restore-map-hazards') push({ kind: 'map', lane: 'hazards' })
    else if (inverse.kind === 'restore-map-field-effects') push({ kind: 'map', lane: 'fieldEffects' })
    else if (inverse.kind === 'restore-placement-state') push({ kind: 'map', lane: 'placements' })
    else if (inverse.kind === 'restore-map-temporary-hit-points') {
      const ids = new Set([
        ...Object.keys(plan.previousMap.temporaryHitPoints?.byPlacementId ?? {}),
        ...Object.keys(plan.nextMap.temporaryHitPoints?.byPlacementId ?? {}),
      ])
      for (const placementId of ids) push({ kind: 'token', placementId, field: 'hp' })
    }
    else if (inverse.kind === 'restore-map-move-usage') {
      const ids = new Set([
        ...Object.keys(plan.previousMap.moveUsage?.byPlacementId ?? {}),
        ...Object.keys(plan.nextMap.moveUsage?.byPlacementId ?? {}),
      ])
      for (const placementId of ids) push({ kind: 'token', placementId, field: 'moveUsage' })
    }
  }

  for (const sheet of plan.sheetRefs) {
    for (const field of sheet.changedFields) {
      push({
        kind: 'sheet',
        sheetKind: sheet.kind,
        sheetSlug: sheet.slug,
        field,
      })
      if (
        field === 'moveUsage'
        || field === 'hp'
        || field === 'combatStages'
        || field === 'conditions'
      ) {
        for (const placementId of sheet.placementIds) {
          push({ kind: 'token', placementId, field })
        }
      }
    }
  }
  return scopes
}

const correctionPatch = (input: {
  readonly command: GmMoveCorrectionCommand
  readonly plan: AcceptedMoveCorrectionPlan
  readonly scopes: readonly LivePlayScope[]
}): LivePlayPatch<
  typeof LIVE_PLAY_PATCH_TYPES.MOVE_CORRECTION,
  LivePlayMoveCorrectionPatchPayload
> => {
  const candidate: LivePlayMoveCorrectionPatchPayload = {
    schemaVersion: MOVE_CORRECTION_PATCH_SCHEMA_VERSION,
    command: GM_MOVE_CORRECTION_COMMAND_TYPE,
    originOperationId: input.command.payload.originOperationId,
    correctionOperationId: input.command.opId,
    operationIds: [...input.plan.operationIds],
    updatedAt: input.plan.nextMap.updatedAt ?? 0,
    resources: deepCloneJson(input.plan.resourceChanges),
    sheets: deepCloneJson(input.plan.sheetRefs),
    changes: deepCloneJson(input.plan.mapChanges),
  }
  const parsed = parseLivePlayMoveCorrectionPatchPayload(candidate)
  if (!parsed.valid) {
    throw new GmMoveCorrectionUseCaseError(
      409,
      `Correction patch failed invariant validation: ${parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`,
    )
  }
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: LIVE_PLAY_PATCH_TYPES.MOVE_CORRECTION,
    mapSlug: input.command.mapSlug,
    revision: input.plan.revision,
    scopes: deepCloneJson(input.scopes),
    payload: parsed.payload,
  }
}

const wireCorrectionCommand = (
  command: GmMoveCorrectionCommand,
  scopes: readonly LivePlayScope[],
): LivePlayCommandEnvelope => ({
  ...command,
  scopes: deepCloneJson(scopes),
} as unknown as LivePlayCommandEnvelope)

const sheetUpdate = (sheet: PersistedSheet): GmMoveCorrectionSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  path: logicalSheetResourcePath(sheet.kind, sheet.sheet),
  sheet: deepCloneJson(sheet.sheet),
})

const applyMapWrite = (
  plan: AcceptedMoveCorrectionPlan,
  dependencies: Dependencies,
): TabletopMap => {
  const persisted = toPersistedMap(
    plan.nextMap,
    plan.nextMap.folder ?? '',
    plan.nextMap.updatedAt ?? dependencies.now(),
    { revision: plan.revision },
  )
  const result = dependencies.mapRepository.applyLivePlayUpdate({
    slug: plan.nextMap.slug,
    expectedRevision: plan.previousRevision,
    nextMap: persisted,
  })
  if (result === 'stale') {
    throw new AcceptedMoveCorrectionPlanError(
      'resource-revision-conflict',
      `Map ${plan.nextMap.slug} changed before the correction could commit.`,
    )
  }
  const current = dependencies.mapRepository.getBySlug(plan.nextMap.slug)
  if (!current || normalizeRevision(current.revision) !== plan.revision) {
    throw new GmMoveCorrectionUseCaseError(409, 'Corrected map did not match its planned revision.')
  }
  return current
}

const applySheetWrites = (
  plan: AcceptedMoveCorrectionPlan,
  dependencies: Dependencies,
): readonly GmMoveCorrectionSheetUpdate[] => {
  for (const write of plan.sheetWrites) {
    const result = dependencies.sheetRepository.applyLivePlayUpdate({
      kind: write.kind,
      slug: write.slug,
      expectedRevision: write.expectedRevision,
      nextSheet: sheetPayloadForPersistence(
        write.nextSheet as Record<string, unknown>,
        write.slug,
        plan.nextMap.updatedAt ?? dependencies.now(),
      ),
    })
    if (result === 'stale') {
      throw new AcceptedMoveCorrectionPlanError(
        'resource-revision-conflict',
        `${write.kind} sheet ${write.slug} changed before the correction could commit.`,
      )
    }
  }
  return plan.sheetWrites.map((write) => {
    const stored = dependencies.sheetRepository.getByRef(write.kind, write.slug)
    if (!stored || stored.revision !== write.revision) {
      throw new GmMoveCorrectionUseCaseError(
        409,
        `${write.kind} sheet ${write.slug} did not match its correction plan.`,
      )
    }
    return sheetUpdate(stored)
  })
}

const parseStoredCorrectionPatch = (
  record: SqliteLivePlayOpRecord,
): LivePlayMoveCorrectionPatchPayload | null => {
  if (!record.result.ok) return null
  const patches = record.result.patches.filter(
    patch => patch.type === LIVE_PLAY_PATCH_TYPES.MOVE_CORRECTION,
  )
  if (patches.length !== 1 || !patches[0]) {
    throw new GmMoveCorrectionUseCaseError(409, 'Stored correction result has no canonical correction patch.')
  }
  const parsed = parseLivePlayMoveCorrectionPatchPayload(patches[0].payload)
  if (!parsed.valid) {
    throw new GmMoveCorrectionUseCaseError(409, 'Stored correction patch is invalid.')
  }
  return parsed.payload
}

const responseForRecord = (
  record: SqliteLivePlayOpRecord,
  dependencies: Dependencies,
): GmMoveCorrectionResponse => {
  const map = dependencies.mapRepository.getBySlug(record.mapSlug)
  if (!map) throw new GmMoveCorrectionUseCaseError(404, `Map ${record.mapSlug} was not found.`)
  const patch = parseStoredCorrectionPatch(record)
  const sheetUpdates = patch?.sheets.map((ref) => {
    const stored = dependencies.sheetRepository.getByRef(ref.kind, ref.slug)
    if (!stored) {
      throw new GmMoveCorrectionUseCaseError(
        404,
        `Corrected ${ref.kind} sheet ${ref.slug} was not found.`,
      )
    }
    return sheetUpdate(stored)
  }) ?? []
  return {
    result: deepCloneJson(record.result),
    path: logicalMapResourcePath(map),
    map,
    ...(sheetUpdates.length > 0 ? { sheetUpdates } : {}),
  }
}

const existingCorrection = (
  command: GmMoveCorrectionCommand,
  commandHash: LivePlayCommandHash,
  dependencies: Dependencies,
): GmMoveCorrectionResponse | null => {
  const record = dependencies.opRepository.getStoredOpRecord(command.mapSlug, command.opId)
  if (!record) return null
  if (
    record.commandHash !== commandHash
    || record.correctionOriginOperationId !== command.payload.originOperationId
  ) {
    throw new GmMoveCorrectionUseCaseError(
      409,
      `Operation ID ${command.mapSlug}:${command.opId} was already used by another command.`,
    )
  }
  return responseForRecord(record, dependencies)
}

const saveRejectedCorrection = (input: {
  readonly parsed: ParsedMoveCorrectionCommand
  readonly commandHash: LivePlayCommandHash
  readonly result: Extract<LivePlayCommandResult, { readonly ok: false }>
  readonly dependencies: Dependencies
}): SqliteLivePlayOpRecord => input.dependencies.opRepository.saveCommandResult({
  mapSlug: input.parsed.command.mapSlug,
  opId: input.parsed.command.opId,
  commandHash: input.commandHash,
  command: input.parsed.command,
  result: input.result,
  correctionOriginOperationId: input.parsed.command.payload.originOperationId,
})

const conflictResult = (
  parsed: ParsedMoveCorrectionCommand,
  currentRevision: number,
  reason: 'stale-revision' | 'conflict' | 'invalid',
  message: string,
) => createLivePlayRejectedResult({
  opId: parsed.command.opId,
  mapSlug: parsed.command.mapSlug,
  reason,
  message,
  currentRevision,
})

/** Apply selected server-authored inverses once in one SQLite transaction. */
export const applyGmMoveCorrectionUseCase = (
  input: ApplyGmMoveCorrectionInput,
  dependencyInput: ApplyGmMoveCorrectionDependencies = {},
): GmMoveCorrectionResponse => {
  if (input.role !== 'gm') {
    throw new GmMoveCorrectionUseCaseError(403, 'GM authorization is required for move corrections.')
  }
  const dependencies = dependenciesWithDefaults(dependencyInput)
  const command = parseMoveCorrectionCommandSyntax(input.command)
  const commandHash = gmMoveCorrectionCommandHash(command)
  const replay = existingCorrection(command, commandHash, dependencies)
  if (replay) return replay

  let persistedEvents: ReturnType<Dependencies['realtimeEventRepository']['appendMany']> = []
  const response = dependencies.database.withTransaction((): GmMoveCorrectionResponse => {
    const duplicate = existingCorrection(command, commandHash, dependencies)
    if (duplicate) return duplicate
    const currentParsed = parseMoveCorrectionCommand(command, {
      opRepository: dependencies.opRepository,
    })
    const map = dependencies.mapRepository.getBySlug(currentParsed.command.mapSlug)
    if (!map) {
      throw new GmMoveCorrectionUseCaseError(
        404,
        `Map ${currentParsed.command.mapSlug} was not found.`,
      )
    }
    const currentRevision = normalizeRevision(map.revision)
    if (
      dependencies.modeRepository.get(currentParsed.command.mapSlug).interactionMode
      !== MAP_INTERACTION_MODES.LIVE_PLAY
    ) {
      throw new GmMoveCorrectionUseCaseError(
        409,
        'GM move corrections are available only while the map is in Run Live Play.',
      )
    }
    if (currentParsed.command.baseRevision !== currentRevision) {
      const result = conflictResult(
        currentParsed,
        currentRevision,
        'stale-revision',
        `Correction baseRevision ${currentParsed.command.baseRevision} does not match current map revision ${currentRevision}.`,
      )
      return responseForRecord(saveRejectedCorrection({
        parsed: currentParsed,
        commandHash,
        result,
        dependencies,
      }), dependencies)
    }

    let plan: AcceptedMoveCorrectionPlan
    try {
      plan = planAcceptedMoveCorrection({
        map,
        sheets: loadAffectedSheets(currentParsed, dependencies),
        operations: currentParsed.operations,
        updatedAt: dependencies.now(),
      })
    }
    catch (error) {
      if (!(error instanceof AcceptedMoveCorrectionPlanError)) throw error
      const reason = error.code === 'invalid-operation' || error.code === 'duplicate-target'
        ? 'invalid'
        : 'conflict'
      const result = conflictResult(currentParsed, currentRevision, reason, error.message)
      return responseForRecord(saveRejectedCorrection({
        parsed: currentParsed,
        commandHash,
        result,
        dependencies,
      }), dependencies)
    }

    const scopes = correctionScopes(plan, currentParsed)
    const patch = correctionPatch({ command: currentParsed.command, plan, scopes })
    const wireCommand = wireCorrectionCommand(currentParsed.command, scopes)
    const result = withAcceptedEncounterPresentation({
      command: wireCommand,
      result: createLivePlayAcceptedResult({
        opId: currentParsed.command.opId,
        mapSlug: currentParsed.command.mapSlug,
        previousRevision: plan.previousRevision,
        revision: plan.revision,
        patches: [patch],
      }),
      occurredAt: plan.nextMap.updatedAt ?? plan.revision,
    })
    const authoritativeMap = applyMapWrite(plan, dependencies)
    const sheetUpdates = applySheetWrites(plan, dependencies)
    dependencies.opRepository.saveCommandResult({
      mapSlug: currentParsed.command.mapSlug,
      opId: currentParsed.command.opId,
      commandHash,
      command: currentParsed.command,
      result,
      correctionOriginOperationId: currentParsed.command.payload.originOperationId,
    })
    persistedEvents = dependencies.realtimeEventRepository.appendMany([
      ...livePlaySheetUpdateRealtimeAppendInputs({
        command: wireCommand,
        updates: sheetUpdates,
        clientId: input.clientId,
      }),
      acceptedCommandRealtimeAppendInput({
        command: wireCommand,
        result,
        clientId: input.clientId,
      }),
    ])
    return {
      result,
      path: logicalMapResourcePath(authoritativeMap),
      map: authoritativeMap,
      ...(sheetUpdates.length > 0 ? { sheetUpdates } : {}),
    }
  })

  publishPersistedRealtimeEventsAfterCommit({
    events: persistedEvents,
    operation: 'apply GM move correction',
    publish: dependencies.publishPersistedRealtimeEvent,
    reportFailure: defaultPersistedRealtimePublicationFailureReporter,
  })
  return response
}
