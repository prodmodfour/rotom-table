import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { validateSlug } from '#shared/paths'
import { isRevision } from '#shared/sessionRevisions'
import type { GroupInventoryDocument, GroupInventorySectionKey } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  InventoryTransferError,
  isGroupInventorySectionKey,
  transferInventoryItem,
  type InventoryTransferInventory,
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
import { authorizeGroupInventoryTrainerTransfer } from '../policies/groupInventoryTransferPolicy'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class TransferGroupInventoryToTrainerUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface TransferGroupInventoryToTrainerInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly groupSlug: unknown
  readonly groupRevision: unknown
  readonly trainerSlug: unknown
  readonly trainerRevision: unknown
  readonly section: unknown
  readonly itemId: unknown
  readonly quantity: unknown
}

type TransferGroupInventoryRepository = Pick<GroupInventoryRepository, 'get' | 'applyLivePlayUpdate'> & {
  readonly database?: RotomDatabase
}

type TransferTrainerSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'> & {
  readonly database?: RotomDatabase
}

export interface TransferGroupInventoryToTrainerDependencies {
  readonly database?: RotomDatabase
  readonly groupInventoryRepository?: TransferGroupInventoryRepository
  readonly sheetRepository?: TransferTrainerSheetRepository
  readonly now?: () => number
}

export interface TransferGroupInventoryToTrainerResult {
  readonly ok: true
  readonly groupInventory: GroupInventoryDocument
  readonly trainerSheet: {
    readonly kind: 'trainer'
    readonly slug: string
    readonly sheet: Record<string, unknown>
  }
}

const databaseFromDependencies = (dependencies: TransferGroupInventoryToTrainerDependencies): RotomDatabase => {
  const groupInventoryDatabase = dependencies.groupInventoryRepository?.database
  const sheetDatabase = dependencies.sheetRepository?.database
  const database = dependencies.database ?? groupInventoryDatabase ?? sheetDatabase ?? getRotomDatabase()

  if (groupInventoryDatabase && groupInventoryDatabase !== database) {
    throw new Error('Group inventory transfer repository must use the same RotomDatabase as the transfer transaction')
  }
  if (sheetDatabase && sheetDatabase !== database) {
    throw new Error('Trainer sheet transfer repository must use the same RotomDatabase as the transfer transaction')
  }

  return database
}

const normalizeTransferSlug = (value: unknown, label: string): string => {
  try {
    return validateSlug(value, label)
  } catch (error) {
    throw new TransferGroupInventoryToTrainerUseCaseError(400, (error as Error).message)
  }
}

const normalizeTransferRevision = (value: unknown, label: string): number => {
  if (!isRevision(value)) {
    throw new TransferGroupInventoryToTrainerUseCaseError(400, `${label} must be a safe non-negative integer`)
  }
  return value
}

const normalizeTransferSection = (value: unknown): GroupInventorySectionKey => {
  if (!isGroupInventorySectionKey(value)) {
    throw new TransferGroupInventoryToTrainerUseCaseError(400, 'section must be a recognized inventory section')
  }
  return value
}

const normalizeTransferItemId = (value: unknown): string => {
  const itemId = typeof value === 'string' ? value.trim() : ''
  if (!itemId) {
    throw new TransferGroupInventoryToTrainerUseCaseError(400, 'itemId is required')
  }
  return itemId
}

const trainerInventoryFromSheet = (trainer: PersistedSheet): InventoryTransferInventory | undefined => {
  const inventory = (trainer.sheet as unknown as TrainerSheet).inventory
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return undefined
  return inventory as InventoryTransferInventory
}

const mapTransferError = (error: InventoryTransferError): TransferGroupInventoryToTrainerUseCaseError => {
  const statusCode = error.code === 'missing-row' ? 404 : 400
  return new TransferGroupInventoryToTrainerUseCaseError(statusCode, error.message)
}

const assertCurrentRevision = (
  actualRevision: number,
  expectedRevision: number,
  label: string,
): void => {
  if (actualRevision !== expectedRevision) {
    throw new TransferGroupInventoryToTrainerUseCaseError(
      409,
      `${label} changed before the transfer could be persisted; reload before transferring.`,
    )
  }
}

export const transferGroupInventoryToTrainerUseCase = (
  input: TransferGroupInventoryToTrainerInput,
  dependencies: TransferGroupInventoryToTrainerDependencies = {},
): TransferGroupInventoryToTrainerResult => {
  const groupSlug = normalizeTransferSlug(input.groupSlug, 'group inventory slug')
  const groupRevision = normalizeTransferRevision(input.groupRevision, 'groupRevision')
  const trainerSlug = normalizeTransferSlug(input.trainerSlug, 'trainer slug')
  const trainerRevision = normalizeTransferRevision(input.trainerRevision, 'trainerRevision')
  const section = normalizeTransferSection(input.section)
  const itemId = normalizeTransferItemId(input.itemId)
  const authorization = authorizeGroupInventoryTrainerTransfer({
    role: input.role,
    playerProfile: input.playerProfile,
    trainerSlug,
  })
  if (!authorization.ok) {
    throw new TransferGroupInventoryToTrainerUseCaseError(authorization.statusCode, authorization.message)
  }

  const database = databaseFromDependencies(dependencies)
  const groupInventoryRepository = dependencies.groupInventoryRepository
    ?? createSqliteGroupInventoryRepository(database)
  const sheetRepository = dependencies.sheetRepository
    ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const now = dependencies.now ?? Date.now

  return database.withTransaction(() => {
    const groupInventory = groupInventoryRepository.get(groupSlug)?.document ?? null
    if (!groupInventory) {
      throw new TransferGroupInventoryToTrainerUseCaseError(404, `Group inventory ${groupSlug} not found`)
    }
    assertCurrentRevision(groupInventory.revision, groupRevision, `Group inventory ${groupSlug}`)

    const trainer = sheetRepository.getByRef('trainer', trainerSlug)
    if (!trainer) {
      throw new TransferGroupInventoryToTrainerUseCaseError(404, `Trainer sheet ${trainerSlug}.json not found`)
    }
    assertCurrentRevision(trainer.revision, trainerRevision, `Trainer sheet ${trainerSlug}`)

    let transferResult: ReturnType<typeof transferInventoryItem>
    try {
      transferResult = transferInventoryItem({
        sourceInventory: groupInventory.inventory,
        targetInventory: trainerInventoryFromSheet(trainer),
        section,
        sourceRowId: itemId,
        quantity: input.quantity,
      })
    } catch (error) {
      if (error instanceof InventoryTransferError) throw mapTransferError(error)
      throw error
    }

    const timestamp = now()
    const groupUpdate = groupInventoryRepository.applyLivePlayUpdate({
      slug: groupSlug,
      expectedRevision: groupRevision,
      now: timestamp,
      nextDocument: {
        ...groupInventory,
        inventory: transferResult.sourceInventory as GroupInventoryDocument['inventory'],
        updatedAt: timestamp,
      },
    })
    if (groupUpdate.status === 'stale') {
      throw new TransferGroupInventoryToTrainerUseCaseError(
        409,
        `Group inventory ${groupSlug} changed before the transfer could be persisted; reload before transferring.`,
      )
    }

    const sheetUpdate = sheetRepository.applyLivePlayUpdate({
      kind: 'trainer',
      slug: trainerSlug,
      expectedRevision: trainerRevision,
      nextSheet: {
        ...trainer.sheet,
        inventory: transferResult.targetInventory as NonNullable<TrainerSheet['inventory']>,
        updatedAt: timestamp,
      },
    })
    if (sheetUpdate === 'stale') {
      throw new TransferGroupInventoryToTrainerUseCaseError(
        409,
        `Trainer sheet ${trainerSlug} changed before the transfer could be persisted; reload before transferring.`,
      )
    }

    const authoritativeGroupInventory = groupInventoryRepository.get(groupSlug)?.document ?? null
    if (!authoritativeGroupInventory) {
      throw new TransferGroupInventoryToTrainerUseCaseError(404, `Group inventory ${groupSlug} not found after transfer`)
    }
    const authoritativeTrainer = sheetRepository.getByRef('trainer', trainerSlug)
    if (!authoritativeTrainer) {
      throw new TransferGroupInventoryToTrainerUseCaseError(404, `Trainer sheet ${trainerSlug}.json not found after transfer`)
    }

    return {
      ok: true,
      groupInventory: authoritativeGroupInventory,
      trainerSheet: {
        kind: 'trainer',
        slug: authoritativeTrainer.slug,
        sheet: authoritativeTrainer.sheet,
      },
    }
  })
}
