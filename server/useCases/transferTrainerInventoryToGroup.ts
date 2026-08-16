import type { AuthRole } from '#shared/auth'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import { parseItemExplorationState } from '#shared/itemAutomation/exploration'
import type { PlayerProfile } from '#shared/playerProfiles'
import { validateSlug } from '#shared/paths'
import { isRevision } from '#shared/sessionRevisions'
import {
  createGroupInventoryRowId,
  type GroupInventoryDocument,
  type GroupInventorySectionKey,
} from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  InventoryTransferError,
  isGroupInventorySectionKey,
  transferInventoryItem,
  type InventoryTransferInventory,
  type InventoryTransferTargetRowIdGenerator,
} from '~/utils/groupInventoryTransfers'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { createSqliteItemOperationRepository, type ItemOperationRepository } from '../storage/itemOperationRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
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
import { authorizeGroupInventoryTrainerTransfer } from '../policies/groupInventoryTransferPolicy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { projectGroupInventoryForPlayer } from '../utils/groupInventoryPrivacy'
import {
  projectSheetEquipmentContributions,
  redactSheetRecordForPlayer,
} from '../utils/sheetPrivacy'

export class TransferTrainerInventoryToGroupUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface TransferTrainerInventoryToGroupInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: unknown
  readonly trainerRevision: unknown
  readonly groupSlug: unknown
  readonly groupRevision: unknown
  readonly section: unknown
  readonly trainerItemId?: unknown
  readonly trainerRowIndex?: unknown
  readonly quantity: unknown
  readonly clientId?: unknown
}

type TransferTrainerSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'> & {
  readonly database?: RotomDatabase
}

type TransferGroupInventoryRepository = Pick<GroupInventoryRepository, 'get' | 'applyLivePlayUpdate'> & {
  readonly database?: RotomDatabase
}

type TransferTrainerInventoryRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface TransferTrainerInventoryToGroupDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: TransferTrainerSheetRepository
  readonly groupInventoryRepository?: TransferGroupInventoryRepository
  readonly realtimeEventRepository?: TransferTrainerInventoryRealtimeEventRepository
  readonly itemOperationRepository?: Pick<ItemOperationRepository, 'reservedQuantity'> & { readonly database?: RotomDatabase }
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly createTargetGroupRowId?: InventoryTransferTargetRowIdGenerator
  /** Optional atomic adapter receipt; invoked with raw authoritative resources before commit. */
  readonly onAcceptedInTransaction?: (result: TransferTrainerInventoryToGroupResult) => void
  readonly now?: () => number
}

export interface TransferTrainerInventoryToGroupResult {
  readonly ok: true
  readonly trainerSheet: {
    readonly kind: 'trainer'
    readonly slug: string
    readonly sheet: Record<string, unknown>
  }
  readonly groupInventory: GroupInventoryDocument
}

type TrainerRowSelector =
  | { readonly sourceRowId: string; readonly sourceRowIndex?: never }
  | { readonly sourceRowId?: never; readonly sourceRowIndex: number }

const databaseFromDependencies = (dependencies: TransferTrainerInventoryToGroupDependencies): RotomDatabase => {
  const sheetDatabase = dependencies.sheetRepository?.database
  const groupInventoryDatabase = dependencies.groupInventoryRepository?.database
  const realtimeDatabase = dependencies.realtimeEventRepository?.database
  const itemOperationDatabase = dependencies.itemOperationRepository?.database
  const database = dependencies.database ?? sheetDatabase ?? groupInventoryDatabase ?? realtimeDatabase ?? itemOperationDatabase ?? getRotomDatabase()

  if (sheetDatabase && sheetDatabase !== database) {
    throw new Error('Trainer sheet transfer repository must use the same RotomDatabase as the transfer transaction')
  }
  if (groupInventoryDatabase && groupInventoryDatabase !== database) {
    throw new Error('Group inventory transfer repository must use the same RotomDatabase as the transfer transaction')
  }
  if (realtimeDatabase && realtimeDatabase !== database) {
    throw new Error('Group inventory transfer realtime event repository must use the same RotomDatabase as the transfer transaction')
  }
  if (itemOperationDatabase && itemOperationDatabase !== database) {
    throw new Error('Group inventory transfer item-operation repository must use the same RotomDatabase as the transfer transaction')
  }

  return database
}

const normalizeTransferSlug = (value: unknown, label: string): string => {
  try {
    return validateSlug(value, label)
  } catch (error) {
    throw new TransferTrainerInventoryToGroupUseCaseError(400, (error as Error).message)
  }
}

const normalizeTransferRevision = (value: unknown, label: string): number => {
  if (!isRevision(value)) {
    throw new TransferTrainerInventoryToGroupUseCaseError(400, `${label} must be a safe non-negative integer`)
  }
  return value
}

const normalizeTransferSection = (value: unknown): GroupInventorySectionKey => {
  if (!isGroupInventorySectionKey(value)) {
    throw new TransferTrainerInventoryToGroupUseCaseError(400, 'section must be a recognized inventory section')
  }
  return value
}

const normalizeOptionalTrainerItemId = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  const itemId = typeof value === 'string' ? value.trim() : ''
  if (!itemId) {
    throw new TransferTrainerInventoryToGroupUseCaseError(400, 'trainerItemId must not be blank')
  }
  return itemId
}

const normalizeOptionalTrainerRowIndex = (value: unknown): number | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TransferTrainerInventoryToGroupUseCaseError(400, 'trainerRowIndex must be a safe non-negative integer')
  }
  return value
}

const normalizeTrainerRowSelector = (input: TransferTrainerInventoryToGroupInput): TrainerRowSelector => {
  const sourceRowId = normalizeOptionalTrainerItemId(input.trainerItemId)
  const sourceRowIndex = normalizeOptionalTrainerRowIndex(input.trainerRowIndex)

  if (sourceRowId && sourceRowIndex !== null) {
    throw new TransferTrainerInventoryToGroupUseCaseError(400, 'Provide either trainerItemId or trainerRowIndex, not both')
  }
  if (sourceRowId) return { sourceRowId }
  if (sourceRowIndex !== null) return { sourceRowIndex }

  throw new TransferTrainerInventoryToGroupUseCaseError(400, 'trainerRowIndex or trainerItemId is required')
}

const trainerInventoryFromSheet = (trainer: PersistedSheet): InventoryTransferInventory | undefined => {
  const inventory = (trainer.sheet as unknown as TrainerSheet).inventory
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return undefined
  return inventory as InventoryTransferInventory
}

const mapTransferError = (error: InventoryTransferError): TransferTrainerInventoryToGroupUseCaseError => {
  const statusCode = error.code === 'missing-row' ? 404 : 400
  return new TransferTrainerInventoryToGroupUseCaseError(statusCode, error.message)
}

const assertCurrentRevision = (
  actualRevision: number,
  expectedRevision: number,
  label: string,
): void => {
  if (actualRevision !== expectedRevision) {
    throw new TransferTrainerInventoryToGroupUseCaseError(
      409,
      `${label} changed before the transfer could be persisted; reload before transferring.`,
    )
  }
}

export const transferTrainerInventoryToGroupUseCase = (
  input: TransferTrainerInventoryToGroupInput,
  dependencies: TransferTrainerInventoryToGroupDependencies = {},
): TransferTrainerInventoryToGroupResult => {
  const trainerSlug = normalizeTransferSlug(input.trainerSlug, 'trainer slug')
  const trainerRevision = normalizeTransferRevision(input.trainerRevision, 'trainerRevision')
  const groupSlug = normalizeTransferSlug(input.groupSlug, 'group inventory slug')
  const groupRevision = normalizeTransferRevision(input.groupRevision, 'groupRevision')
  const section = normalizeTransferSection(input.section)
  const trainerRowSelector = normalizeTrainerRowSelector(input)
  const authorization = authorizeGroupInventoryTrainerTransfer({
    role: input.role,
    playerProfile: input.playerProfile,
    trainerSlug,
  })
  if (!authorization.ok) {
    throw new TransferTrainerInventoryToGroupUseCaseError(authorization.statusCode, authorization.message)
  }

  const database = databaseFromDependencies(dependencies)
  const sheetRepository = dependencies.sheetRepository
    ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const groupInventoryRepository = dependencies.groupInventoryRepository
    ?? createSqliteGroupInventoryRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const itemOperationRepository = dependencies.itemOperationRepository
    ?? createSqliteItemOperationRepository({ database })
  const createTargetGroupRowId = dependencies.createTargetGroupRowId ?? createGroupInventoryRowId
  const now = dependencies.now ?? Date.now

  const transactionResult = database.withTransaction(() => {
    const trainer = sheetRepository.getByRef('trainer', trainerSlug)
    if (!trainer) {
      throw new TransferTrainerInventoryToGroupUseCaseError(404, `Trainer sheet ${trainerSlug}.json not found`)
    }
    assertCurrentRevision(trainer.revision, trainerRevision, `Trainer sheet ${trainerSlug}`)

    const trainerDocument = trainer.sheet as unknown as TrainerSheet
    const trainerRows = trainerDocument.inventory?.[section] ?? []
    const sourceRow = 'sourceRowId' in trainerRowSelector
      ? trainerRows.find(row => row.id === trainerRowSelector.sourceRowId)
      : trainerRows[trainerRowSelector.sourceRowIndex]
    if (sourceRow?.id) {
      const sourceInstanceId = itemInventoryInstanceId({
        containerKind: 'trainer', containerSlug: trainerSlug, section, rowId: sourceRow.id,
      })
      let sourceLocked = false
      try {
        sourceLocked = parseItemExplorationState(trainerDocument.serverPrivate?.itemExploration)
          .routeLures.some(activity => activity.reusable
            && (activity.status === 'active' || activity.status === 'awaiting-encounter')
            && activity.sourceInstanceId === sourceInstanceId)
      }
      catch {
        throw new TransferTrainerInventoryToGroupUseCaseError(409, 'Exploration activity authority is malformed.')
      }
      if (sourceLocked) {
        throw new TransferTrainerInventoryToGroupUseCaseError(
          409,
          'This Fishing Lure cannot move while its route activity remains unresolved.',
        )
      }
      const serialized = sourceRow.serializedEquipment !== undefined
      const sourceQuantity = serialized || section === 'equipment' ? 1 : (sourceRow.qty ?? 1)
      const reserved = itemOperationRepository.reservedQuantity(sourceInstanceId)
      if (Number.isSafeInteger(input.quantity) && Number(input.quantity) > sourceQuantity - reserved) {
        throw new TransferTrainerInventoryToGroupUseCaseError(
          409,
          'The transfer source does not have enough unreserved quantity.',
        )
      }
    }

    const groupInventory = groupInventoryRepository.get(groupSlug)?.document ?? null
    if (!groupInventory) {
      throw new TransferTrainerInventoryToGroupUseCaseError(404, `Group inventory ${groupSlug} not found`)
    }
    assertCurrentRevision(groupInventory.revision, groupRevision, `Group inventory ${groupSlug}`)

    let transferResult: ReturnType<typeof transferInventoryItem>
    try {
      transferResult = transferInventoryItem({
        sourceInventory: trainerInventoryFromSheet(trainer),
        targetInventory: groupInventory.inventory,
        section,
        ...trainerRowSelector,
        quantity: input.quantity,
        createTargetRowId: createTargetGroupRowId,
      })
    } catch (error) {
      if (error instanceof InventoryTransferError) throw mapTransferError(error)
      throw error
    }

    const timestamp = now()
    const sheetUpdate = sheetRepository.applyLivePlayUpdate({
      kind: 'trainer',
      slug: trainerSlug,
      expectedRevision: trainerRevision,
      nextSheet: {
        ...trainer.sheet,
        inventory: transferResult.sourceInventory as NonNullable<TrainerSheet['inventory']>,
        updatedAt: timestamp,
      },
    })
    if (sheetUpdate === 'stale') {
      throw new TransferTrainerInventoryToGroupUseCaseError(
        409,
        `Trainer sheet ${trainerSlug} changed before the transfer could be persisted; reload before transferring.`,
      )
    }

    const groupUpdate = groupInventoryRepository.applyLivePlayUpdate({
      slug: groupSlug,
      expectedRevision: groupRevision,
      now: timestamp,
      nextDocument: {
        ...groupInventory,
        inventory: transferResult.targetInventory as GroupInventoryDocument['inventory'],
        updatedAt: timestamp,
      },
    })
    if (groupUpdate.status === 'stale') {
      throw new TransferTrainerInventoryToGroupUseCaseError(
        409,
        `Group inventory ${groupSlug} changed before the transfer could be persisted; reload before transferring.`,
      )
    }

    const authoritativeTrainer = sheetRepository.getByRef('trainer', trainerSlug)
    if (!authoritativeTrainer) {
      throw new TransferTrainerInventoryToGroupUseCaseError(404, `Trainer sheet ${trainerSlug}.json not found after transfer`)
    }
    const authoritativeGroupInventory = groupInventoryRepository.get(groupSlug)?.document ?? null
    if (!authoritativeGroupInventory) {
      throw new TransferTrainerInventoryToGroupUseCaseError(404, `Group inventory ${groupSlug} not found after transfer`)
    }

    const trainerSheet = {
      kind: 'trainer' as const,
      slug: authoritativeTrainer.slug,
      sheet: authoritativeTrainer.sheet,
    }
    const realtimeEvents = realtimeEventRepository.appendMany([
      ...groupInventoryAffectedSheetUpdatedRealtimeAppendInputs({
        update: trainerSheet,
        clientId: input.clientId,
        operation: 'transfer-to-group',
      }),
      ...groupInventoryUpdatedRealtimeAppendInputs(
        authoritativeGroupInventory,
        input.clientId,
        'transfer-to-group',
      ),
    ])
    dependencies.onAcceptedInTransaction?.({
      ok: true,
      trainerSheet,
      groupInventory: authoritativeGroupInventory,
    })

    return {
      ok: true as const,
      trainerSheet,
      groupInventory: authoritativeGroupInventory,
      realtimeEvents,
    }
  })

  publishPersistedRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    operation: 'group-inventory-transfer-to-group',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })

  if (input.role === 'player') {
    return {
      ok: true,
      trainerSheet: {
        ...transactionResult.trainerSheet,
        sheet: redactSheetRecordForPlayer('trainer', transactionResult.trainerSheet.sheet),
      },
      groupInventory: projectGroupInventoryForPlayer(transactionResult.groupInventory),
    }
  }
  return {
    ok: true,
    trainerSheet: {
      ...transactionResult.trainerSheet,
      sheet: projectSheetEquipmentContributions('trainer', transactionResult.trainerSheet.sheet),
    },
    groupInventory: transactionResult.groupInventory,
  }
}
