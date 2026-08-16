import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { ItemOperationResultV1 } from '#shared/itemAutomation/operations'
import {
  parseItemOperationRecoveryCommand,
  type ItemOperationRecoveryCommandV1,
  type ItemOperationRecoveryResultV1,
} from '#shared/itemAutomation/recovery'
import type { PlayerProfile } from '#shared/playerProfiles'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { toPersistableSheetPayload } from '~/utils/sheetMutations'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import {
  ItemCorrectionPlanError,
  planItemOperationCorrection,
  type ItemCorrectionSheetSnapshot,
} from '../domain/itemAutomation/correction'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import {
  itemOperationMapUpdatedRealtimeAppendInputs,
  itemOperationPresentationInvalidatedRealtimeAppendInput,
  itemOperationSheetUpdatedRealtimeAppendInputs,
} from '../realtime/itemOperationRealtime'
import { groupInventoryUpdatedRealtimeAppendInputs } from '../realtime/groupInventoryRealtime'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteGroupInventoryRepository } from '../storage/groupInventoryRepository'
import {
  createSqliteItemOperationRepository,
  itemOperationRecoveryCommandSha256,
  type StoredItemOperationRecord,
} from '../storage/itemOperationRepository'
import { createSqliteMapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../storage/realtimeEventRepository'
import { createSqliteSheetRepository, type PersistedSheet } from '../storage/sheetRepository'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { toPersistedMap } from './saveMap'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { authorizeGroupInventoryItemUseActor } from '../policies/groupInventoryItemUsePolicy'

export class RecoverItemOperationUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface RecoverItemOperationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  readonly clientId?: string
}

export interface RecoverItemOperationResponse {
  readonly result: ItemOperationRecoveryResultV1
  readonly map?: TabletopMap
  readonly sheets: readonly PersistedSheet[]
  readonly groupInventory?: GroupInventoryDocument
}

export interface RecoverItemOperationDependencies {
  readonly database?: RotomDatabase
  readonly now?: () => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly failAfterWrite?: (boundary: 'map' | 'sheet' | 'group-inventory' | 'operation' | 'realtime') => void
}

const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new RecoverItemOperationUseCaseError(statusCode, message)
}

const exactReplay = (result: ItemOperationRecoveryResultV1): ItemOperationRecoveryResultV1 => Object.freeze({
  ...result,
  exactReplay: true,
})

const persistedRecoveryResult = (
  record: StoredItemOperationRecord,
  origin?: StoredItemOperationRecord,
): ItemOperationRecoveryResultV1 => {
  const recoveryCommand: ItemOperationRecoveryCommandV1 = record.recoveryCommand
    ?? fail(409, 'Item recovery evidence is incomplete.')
  const operationResult: ItemOperationResultV1 = record.result
    ?? fail(409, 'Item recovery evidence is incomplete.')
  if (record.status === 'abandoned') {
    return Object.freeze({
      schemaVersion: 1,
      operationId: record.operationId,
      action: 'abandon',
      status: 'abandoned',
      inventoryDisposition: record.pendingDecision?.reservation ? 'reservation-released' : 'unchanged',
      correctionOperationId: null,
      correctedReceiptId: null,
      exactReplay: false,
      message: record.pendingDecision?.reservation
        ? 'The pending item operation was abandoned and its reserved inventory is available again.'
        : 'The pending item operation was abandoned without changing inventory.',
    })
  }
  if (record.status === 'corrected' && recoveryCommand.action === 'correct') {
    const inventoryConsumed = Boolean(origin?.plan?.operations.some(operation => (
      operation.kind === 'inventory' && operation.payload.action === 'consume'
    )))
    return Object.freeze({
      schemaVersion: 1,
      operationId: recoveryCommand.operationId,
      action: 'correct',
      status: 'corrected',
      inventoryDisposition: inventoryConsumed ? 'restored' : 'unchanged',
      correctionOperationId: record.operationId,
      correctedReceiptId: operationResult.status === 'accepted' ? operationResult.receiptId : null,
      exactReplay: false,
      message: inventoryConsumed
        ? 'The accepted item operation was corrected and its consumed inventory was restored.'
        : 'The accepted reusable item operation was corrected; its source inventory remained unchanged.',
    })
  }
  return fail(409, 'Item recovery evidence has an unsupported terminal status.')
}

const matchingRecoveryReplay = (
  record: StoredItemOperationRecord,
  command: ItemOperationRecoveryCommandV1,
  origin?: StoredItemOperationRecord,
): ItemOperationRecoveryResultV1 | null => {
  if (!record.recoveryCommand) return null
  if (record.recoveryCommandSha256 !== itemOperationRecoveryCommandSha256(command)
    || stableJsonStringify(record.recoveryCommand) !== stableJsonStringify(command)) {
    fail(409, 'This item operation already has different recovery evidence.')
  }
  return exactReplay(persistedRecoveryResult(record, origin))
}

const authorize = (input: RecoverItemOperationInput, command: ItemOperationRecoveryCommandV1): void => {
  if (command.action === 'correct' && input.role !== 'gm') {
    fail(403, 'GM authorization is required to correct accepted item operations.')
  }
}

const authorizeAbandonmentOwner = (
  input: RecoverItemOperationInput,
  record: StoredItemOperationRecord,
): void => {
  if (input.role === 'gm') return
  if (record.command.source.kind === 'group') {
    if (record.command.actorSheet.kind !== 'trainer' || !authorizeGroupInventoryItemUseActor({
      role: input.role,
      playerProfile: input.playerProfile,
      trainerSlug: record.command.actorSheet.slug,
    }).ok) fail(403, 'Current shared-inventory actor delegation is required to abandon this item use.')
    return
  }
  if (!playerProfileCanControlTokenSheet(
    input.playerProfile,
    record.command.actorSheet.kind,
    record.command.actorSheet.slug,
  )) fail(403, 'The selected player profile does not control the pending item actor.')
}

const alreadyTerminal = (
  record: StoredItemOperationRecord,
  command: ItemOperationRecoveryCommandV1,
): ItemOperationRecoveryResultV1 => Object.freeze({
  schemaVersion: 1,
  operationId: record.operationId,
  action: command.action,
  status: 'already-terminal',
  inventoryDisposition: 'unchanged',
  correctionOperationId: command.action === 'correct' ? command.correctionOperationId : null,
  correctedReceiptId: record.result?.status === 'accepted' ? record.result.receiptId : null,
  exactReplay: false,
  message: `The item operation is already ${record.status}; no inventory or mechanics changed.`,
})

/**
 * Abandon an unresolved reservation or apply one exact GM compensation for an accepted item receipt.
 * Recovery never accepts client mechanics or restore values.
 */
export const recoverItemOperationUseCase = (
  input: RecoverItemOperationInput,
  dependencies: RecoverItemOperationDependencies = {},
): RecoverItemOperationResponse => {
  let command: ItemOperationRecoveryCommandV1
  try { command = parseItemOperationRecoveryCommand(input.command) }
  catch { return fail(400, 'Invalid item recovery command.') }
  authorize(input, command)
  const database = dependencies.database ?? getRotomDatabase()
  const operations = createSqliteItemOperationRepository({ database })
  const origin = operations.get(command.operationId) ?? fail(404, 'The item operation was not found.')
  const recoveryRecord = command.action === 'correct'
    ? operations.findCorrectionOf(command.operationId)
    : origin
  const replay = matchingRecoveryReplay(recoveryRecord ?? origin, command, origin)
  if (replay) return { result: replay, sheets: [] }

  if (command.action === 'abandon') {
    authorizeAbandonmentOwner(input, origin)
    if (origin.status !== 'pending') return { result: alreadyTerminal(origin, command), sheets: [] }
    const mapRef = origin.command.readSet.find(ref => ref.kind === 'map')
    const events: PersistedRealtimeEvent[] = []
    const result = database.withTransaction((): ItemOperationRecoveryResultV1 => {
      const current = operations.get(origin.operationId) ?? fail(404, 'The item operation disappeared before abandonment.')
      const concurrentReplay = matchingRecoveryReplay(current, command, current)
      if (concurrentReplay) return concurrentReplay
      if (current.status !== 'pending') return alreadyTerminal(current, command)
      const terminalResult = {
        schemaVersion: 1 as const,
        operationId: current.operationId,
        status: 'rejected' as const,
        canonicalItemId: current.canonicalItemId,
        reasonId: 'item.operation.abandoned',
        message: 'The pending item operation was abandoned before execution.',
        exactReplay: false,
      }
      const recovered = operations.recover({
        operationId: current.operationId,
        command,
        status: 'abandoned',
        result: terminalResult,
        updatedAt: (dependencies.now ?? Date.now)(),
      })
      dependencies.failAfterWrite?.('operation')
      if (mapRef) {
        const map = createSqliteMapRepository<TabletopMap>(database).get(mapRef.id)
        if (map) events.push(...createSqliteRealtimeEventRepository({ database }).appendMany([
          itemOperationPresentationInvalidatedRealtimeAppendInput({
            operationId: current.operationId,
            mapSlug: map.slug,
            mapRevision: map.revision,
            clientId: input.clientId,
          }),
        ]))
      }
      dependencies.failAfterWrite?.('realtime')
      return persistedRecoveryResult(recovered, current)
    })
    publishPersistedRealtimeEventsAfterCommit({
      events,
      operation: `abandon-item-operation:${command.operationId}`,
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })
    return { result, sheets: [] }
  }

  if (origin.status !== 'accepted' || origin.result?.status !== 'accepted' || !origin.plan) {
    if (origin.status === 'pending') fail(409, 'Pending item operations must be abandoned or completed before correction.')
    return { result: alreadyTerminal(origin, command), sheets: [] }
  }
  if (!origin.compensation) fail(409, 'This accepted item receipt predates safe correction evidence and cannot be auto-corrected.')
  if (operations.get(command.correctionOperationId)) {
    fail(409, 'The correction operation ID is already used by another item operation.')
  }

  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const groups = createSqliteGroupInventoryRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database })
  const mapRef = origin.command.readSet.find(ref => ref.kind === 'map')
  const map = mapRef ? maps.get(mapRef.id)?.document ?? null : null
  const sheetSnapshots = new Map<string, ItemCorrectionSheetSnapshot>()
  for (const ref of origin.command.readSet) {
    if (ref.kind !== 'sheet') continue
    const stored = sheets.getByRef(ref.sheetKind, ref.id)
      ?? fail(404, `Item correction sheet ${ref.sheetKind}/${ref.id} was not found.`)
    sheetSnapshots.set(`${ref.sheetKind}:${ref.id}`, {
      kind: ref.sheetKind,
      slug: ref.id,
      revision: stored.revision,
      sheet: stored.sheet as unknown as CharacterSheet | TrainerSheet,
    })
  }
  const groupRef = origin.command.readSet.find(ref => ref.kind === 'group-inventory')
  const group = groupRef ? groups.get(groupRef.id)?.document ?? null : null
  const now = dependencies.now ?? Date.now
  const plannedAt = now()
  const compensation = origin.compensation
    ?? fail(409, 'This accepted item receipt predates safe correction evidence and cannot be auto-corrected.')
  let plan
  try {
    plan = planItemOperationCorrection({
      plan: origin.plan,
      compensation,
      snapshot: { map, sheets: sheetSnapshots, groupInventory: group },
      updatedAt: plannedAt,
    })
  }
  catch (error) {
    if (error instanceof ItemCorrectionPlanError) return fail(409, error.message)
    throw error
  }

  const events: PersistedRealtimeEvent[] = []
  const acceptedSheets: PersistedSheet[] = []
  let acceptedMap: TabletopMap | undefined
  let acceptedGroup: GroupInventoryDocument | undefined
  const result = database.withTransaction((): ItemOperationRecoveryResultV1 => {
    const current = operations.get(origin.operationId) ?? fail(404, 'The item operation disappeared before correction.')
    const concurrentCorrection = operations.findCorrectionOf(origin.operationId)
    const concurrentReplay = matchingRecoveryReplay(concurrentCorrection ?? current, command, current)
    if (concurrentReplay) return concurrentReplay
    if (current.status !== 'accepted' || current.result?.status !== 'accepted') {
      return alreadyTerminal(current, command)
    }
    if (operations.get(command.correctionOperationId)) {
      fail(409, 'The correction operation ID was committed concurrently.')
    }
    for (const snapshot of sheetSnapshots.values()) {
      if (sheets.getByRef(snapshot.kind, snapshot.slug)?.revision !== snapshot.revision) {
        fail(409, `${snapshot.kind} sheet ${snapshot.slug} changed before item correction commit.`)
      }
    }
    if (map && maps.get(map.slug)?.revision !== map.revision) fail(409, 'The encounter map changed before item correction commit.')
    if (group && groups.get(group.slug)?.revision !== group.revision) fail(409, 'The group inventory changed before item correction commit.')

    if (plan.mapChanged && plan.map && map) {
      const nextMap = toPersistedMap(plan.map, plan.map.folder ?? '', plannedAt, { revision: nextRevision(normalizeRevision(map.revision)) })
      if (maps.applyLivePlayUpdate({ slug: map.slug, expectedRevision: normalizeRevision(map.revision), nextMap }) === 'stale') {
        fail(409, 'The encounter map changed during item correction.')
      }
      acceptedMap = maps.get(map.slug)?.document ?? fail(404, 'The corrected map disappeared.')
      dependencies.failAfterWrite?.('map')
    }
    for (const key of plan.changedSheetKeys) {
      const [kind, slug] = key.split(':') as ['pokemon' | 'trainer', string]
      const before = sheetSnapshots.get(key) ?? fail(404, `Item correction sheet ${key} disappeared.`)
      const nextSheet = plan.sheets.get(key) ?? fail(409, `Item correction omitted sheet ${key}.`)
      if (sheets.applyLivePlayUpdate({
        kind,
        slug,
        expectedRevision: before.revision,
        nextSheet: toPersistableSheetPayload({ ...nextSheet, updatedAt: plannedAt }),
        sourceOperationId: command.correctionOperationId,
      }) === 'stale') fail(409, `Item correction sheet ${key} changed during commit.`)
      acceptedSheets.push(sheets.getByRef(kind, slug)!)
      dependencies.failAfterWrite?.('sheet')
    }
    if (plan.groupInventoryChanged && plan.groupInventory && group) {
      const update = groups.applyLivePlayUpdate({
        slug: group.slug,
        expectedRevision: group.revision,
        nextDocument: { ...plan.groupInventory, updatedAt: plannedAt },
        now: plannedAt,
      })
      if (update.status === 'applied') acceptedGroup = update.document
      else fail(409, 'The group inventory changed during item correction.')
      dependencies.failAfterWrite?.('group-inventory')
    }

    const correctionAggregateRefs = current.result.aggregateRefs.map(ref => {
      if ((ref.kind === 'map' || ref.kind === 'encounter') && acceptedMap) return { ...ref, revision: normalizeRevision(acceptedMap.revision) }
      if (ref.kind === 'sheet') {
        const sheet = acceptedSheets.find(value => value.kind === ref.sheetKind && value.slug === ref.id)
        return sheet ? { ...ref, revision: sheet.revision } : ref
      }
      if (ref.kind === 'group-inventory' && acceptedGroup) return { ...ref, revision: acceptedGroup.revision }
      return ref
    })
    const correctionReceipt: Extract<ItemOperationResultV1, { readonly status: 'accepted' }> = {
      schemaVersion: 1 as const,
      operationId: command.correctionOperationId,
      status: 'accepted' as const,
      canonicalItemId: current.result.canonicalItemId,
      aggregateRefs: correctionAggregateRefs,
      receiptId: `item-correction-receipt:${command.correctionOperationId}`,
      exactReplay: false,
    }
    const corrected = operations.recover({
      operationId: current.operationId,
      command,
      status: 'corrected',
      correctionOfOperationId: command.correctionOperationId,
      result: correctionReceipt,
      updatedAt: plannedAt,
    })
    dependencies.failAfterWrite?.('operation')
    events.push(...realtime.appendMany([
      ...(acceptedMap ? itemOperationMapUpdatedRealtimeAppendInputs({
        operationId: command.correctionOperationId,
        map: acceptedMap,
        clientId: input.clientId,
      }) : []),
      ...acceptedSheets.flatMap(sheet => itemOperationSheetUpdatedRealtimeAppendInputs({
        operationId: command.correctionOperationId,
        sheet,
        clientId: input.clientId,
      })),
      ...(acceptedGroup ? groupInventoryUpdatedRealtimeAppendInputs(acceptedGroup, input.clientId, 'item-correction') : []),
      ...(!acceptedMap && map ? [itemOperationPresentationInvalidatedRealtimeAppendInput({
        operationId: command.correctionOperationId,
        mapSlug: map.slug,
        mapRevision: normalizeRevision(map.revision),
        clientId: input.clientId,
      })] : []),
    ]))
    dependencies.failAfterWrite?.('realtime')
    return persistedRecoveryResult(corrected, current)
  })
  publishPersistedRealtimeEventsAfterCommit({
    events,
    operation: `correct-item-operation:${command.operationId}`,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return {
    result,
    ...(acceptedMap ? { map: acceptedMap } : {}),
    sheets: acceptedSheets,
    ...(acceptedGroup ? { groupInventory: acceptedGroup } : {}),
  }
}
