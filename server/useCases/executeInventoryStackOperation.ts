import type { AuthRole } from '#shared/auth'
import { parseItemExplorationState } from '#shared/itemAutomation/exploration'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  applyInventoryStackOperation,
  parseInventoryActionStackOperationCommand,
  type AppliedInventoryStackOperation,
  type InventoryActionStackOperationCommandV1,
} from '../domain/itemAutomation/inventoryStackOperations'
import { authorizeGroupInventoryTrainerTransfer } from '../policies/groupInventoryTransferPolicy'
import {
  groupInventoryAffectedSheetUpdatedRealtimeAppendInputs,
  groupInventoryUpdatedRealtimeAppendInputs,
} from '../realtime/groupInventoryRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteItemOperationRepository,
  type ItemOperationRepository,
} from '../storage/itemOperationRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ExecuteInventoryStackOperationUseCaseError extends UseCaseHttpError<403 | 404 | 409> {}

export interface ExecuteInventoryStackOperationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: InventoryActionStackOperationCommandV1
  readonly clientId?: unknown
}

export interface ExecuteInventoryStackOperationResult {
  readonly sheets: readonly PersistedSheet[]
  readonly groupInventories: readonly GroupInventoryDocument[]
  readonly applied: AppliedInventoryStackOperation
}

type StackSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'> & {
  readonly database?: RotomDatabase
}
type StackGroupRepository = Pick<GroupInventoryRepository, 'get' | 'applyLivePlayUpdate'> & {
  readonly database?: RotomDatabase
}
type StackRealtimeRepository = Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }

export interface ExecuteInventoryStackOperationDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: StackSheetRepository
  readonly groupInventoryRepository?: StackGroupRepository
  readonly itemOperationRepository?: Pick<ItemOperationRepository, 'reservedQuantity'> & { readonly database?: RotomDatabase }
  readonly realtimeEventRepository?: StackRealtimeRepository
  readonly onAcceptedInTransaction?: (result: ExecuteInventoryStackOperationResult) => void
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly now?: () => number
}

const fail = (statusCode: 403 | 404 | 409, message: string): never => {
  throw new ExecuteInventoryStackOperationUseCaseError(statusCode, message)
}
const assertSameDatabase = (database: RotomDatabase, candidate: RotomDatabase | undefined, label: string): void => {
  if (candidate && candidate !== database) throw new Error(`${label} must use the inventory stack transaction database.`)
}
const sourceLockedByExploration = (sheet: TrainerSheet, sourceInstanceId: string): boolean => {
  try {
    return parseItemExplorationState(sheet.serverPrivate?.itemExploration).routeLures.some(activity => (
      activity.reusable
      && (activity.status === 'active' || activity.status === 'awaiting-encounter')
      && activity.sourceInstanceId === sourceInstanceId
    ))
  }
  catch {
    return fail(409, 'Exploration activity authority is malformed.')
  }
}

export const executeInventoryStackOperationUseCase = (
  input: ExecuteInventoryStackOperationInput,
  dependencies: ExecuteInventoryStackOperationDependencies = {},
): ExecuteInventoryStackOperationResult => {
  let command: InventoryActionStackOperationCommandV1
  try { command = parseInventoryActionStackOperationCommand(input.command) }
  catch (error) { return fail(409, error instanceof Error ? error.message : 'Stored inventory stack command is malformed.') }

  const database = dependencies.database
    ?? dependencies.sheetRepository?.database
    ?? dependencies.groupInventoryRepository?.database
    ?? dependencies.itemOperationRepository?.database
    ?? dependencies.realtimeEventRepository?.database
    ?? getRotomDatabase()
  assertSameDatabase(database, dependencies.sheetRepository?.database, 'Inventory stack sheet repository')
  assertSameDatabase(database, dependencies.groupInventoryRepository?.database, 'Inventory stack group repository')
  assertSameDatabase(database, dependencies.itemOperationRepository?.database, 'Inventory stack item-operation repository')
  assertSameDatabase(database, dependencies.realtimeEventRepository?.database, 'Inventory stack realtime repository')
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const groupRepository = dependencies.groupInventoryRepository ?? createSqliteGroupInventoryRepository(database)
  const itemOperationRepository = dependencies.itemOperationRepository ?? createSqliteItemOperationRepository({ database })
  const realtimeRepository = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now

  const transactionResult = database.withTransaction(() => {
    const sourceInstanceId = itemInventoryInstanceId({
      containerKind: command.containerKind,
      containerSlug: command.containerSlug,
      section: command.section,
      rowId: command.sourceRowId,
    })
    const reservedSourceQuantity = itemOperationRepository.reservedQuantity(sourceInstanceId)
    const timestamp = now()

    if (command.containerKind === 'trainer') {
      const authorization = authorizeGroupInventoryTrainerTransfer({
        role: input.role,
        playerProfile: input.playerProfile,
        trainerSlug: command.containerSlug,
      })
      if (!authorization.ok) fail(authorization.statusCode, authorization.message)
      const stored = sheetRepository.getByRef('trainer', command.containerSlug)
        ?? fail(404, `Trainer sheet ${command.containerSlug} was not found.`)
      if (stored.revision !== command.expectedRevision) {
        fail(409, 'Trainer inventory changed after stack action declaration. Refresh before retrying.')
      }
      const trainer = stored.sheet as unknown as TrainerSheet
      if (sourceLockedByExploration(trainer, sourceInstanceId)) {
        fail(409, 'This Fishing Lure cannot change stack custody while its route activity remains unresolved.')
      }
      const applied: AppliedInventoryStackOperation = (() => {
        try {
          return applyInventoryStackOperation({
            inventory: trainer.inventory,
            command,
            reservedSourceQuantity,
          })
        }
        catch (error) {
          return fail(409, error instanceof Error ? error.message : 'Inventory stack authority changed before commit.')
        }
      })()
      const update = sheetRepository.applyLivePlayUpdate({
        kind: 'trainer',
        slug: command.containerSlug,
        expectedRevision: command.expectedRevision,
        nextSheet: {
          ...stored.sheet,
          inventory: applied.inventory as NonNullable<TrainerSheet['inventory']>,
          updatedAt: timestamp,
        },
      })
      if (update === 'stale') fail(409, 'Trainer inventory changed before stack operation commit.')
      const authoritative = sheetRepository.getByRef('trainer', command.containerSlug)
        ?? fail(404, `Trainer sheet ${command.containerSlug} was not found after stack operation.`)
      const realtimeEvents = realtimeRepository.appendMany(groupInventoryAffectedSheetUpdatedRealtimeAppendInputs({
        update: { kind: 'trainer', slug: authoritative.slug, sheet: authoritative.sheet },
        clientId: input.clientId,
        operation: 'inventory-stack',
      }))
      const result = Object.freeze({
        sheets: Object.freeze([authoritative]),
        groupInventories: Object.freeze([]),
        applied,
      })
      dependencies.onAcceptedInTransaction?.(result)
      return { result, realtimeEvents }
    }

    if (input.role !== 'gm') fail(403, 'Only a GM can reorganize or discard shared inventory stacks.')
    const stored = groupRepository.get(command.containerSlug)?.document
      ?? fail(404, `Group inventory ${command.containerSlug} was not found.`)
    if (stored.revision !== command.expectedRevision) {
      fail(409, 'Group inventory changed after stack action declaration. Refresh before retrying.')
    }
    const applied: AppliedInventoryStackOperation = (() => {
      try {
        return applyInventoryStackOperation({
          inventory: stored.inventory,
          command,
          reservedSourceQuantity,
        })
      }
      catch (error) {
        return fail(409, error instanceof Error ? error.message : 'Inventory stack authority changed before commit.')
      }
    })()
    const update = groupRepository.applyLivePlayUpdate({
      slug: command.containerSlug,
      expectedRevision: command.expectedRevision,
      now: timestamp,
      nextDocument: {
        ...stored,
        inventory: applied.inventory as GroupInventoryDocument['inventory'],
        updatedAt: timestamp,
      },
    })
    if (update.status === 'stale') fail(409, 'Group inventory changed before stack operation commit.')
    const authoritative = groupRepository.get(command.containerSlug)?.document
      ?? fail(404, `Group inventory ${command.containerSlug} was not found after stack operation.`)
    const realtimeEvents = realtimeRepository.appendMany(groupInventoryUpdatedRealtimeAppendInputs(
      authoritative,
      input.clientId,
      'inventory-stack',
    ))
    const result = Object.freeze({
      sheets: Object.freeze([]),
      groupInventories: Object.freeze([authoritative]),
      applied,
    })
    dependencies.onAcceptedInTransaction?.(result)
    return { result, realtimeEvents }
  })

  publishPersistedRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    operation: 'inventory-stack-operation',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return transactionResult.result
}
