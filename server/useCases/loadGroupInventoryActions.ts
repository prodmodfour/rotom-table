import type { AuthRole } from '#shared/auth'
import type { InventoryActionProjectionV1 } from '#shared/itemAutomation/inventoryActions'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import type { PlayerProfile } from '#shared/playerProfiles'
import { validateSlug } from '#shared/paths'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  projectGroupInventoryTransferActionAuthority,
  type GroupInventoryTransferActionAuthorityV1,
} from '../domain/itemAutomation/groupInventoryActionOffers'
import { authorizeGroupInventoryTrainerTransfer } from '../policies/groupInventoryTransferPolicy'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteSheetRepository,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  createSqliteItemOperationRepository,
  type ItemOperationRepository,
} from '../storage/itemOperationRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadGroupInventoryActionsUseCaseError extends UseCaseHttpError<400 | 403> {}

export interface LoadGroupInventoryActionsInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly groupSlug: unknown
}

export interface LoadGroupInventoryActionsDependencies {
  readonly database?: RotomDatabase
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'getOrCreate'> & { readonly database?: RotomDatabase }
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'list'> & { readonly database?: RotomDatabase }
  readonly itemOperationRepository?: Pick<ItemOperationRepository, 'reservedQuantity'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
}

const normalizeSlug = (value: unknown): string => {
  try { return validateSlug(value, 'group inventory slug') }
  catch (error) { throw new LoadGroupInventoryActionsUseCaseError(400, (error as Error).message) }
}

export const loadGroupInventoryActionAuthority = (
  input: LoadGroupInventoryActionsInput,
  dependencies: LoadGroupInventoryActionsDependencies = {},
): GroupInventoryTransferActionAuthorityV1 => {
  if (input.role === 'player' && !input.playerProfile) {
    throw new LoadGroupInventoryActionsUseCaseError(403, 'Choose a player profile before transferring inventory for linked trainer sheets.')
  }
  const repositoryDatabase = dependencies.groupInventoryRepository?.database
    ?? dependencies.sheetRepository?.database
    ?? dependencies.itemOperationRepository?.database
  const database = dependencies.database ?? repositoryDatabase ?? getRotomDatabase()
  if ((dependencies.groupInventoryRepository?.database && dependencies.groupInventoryRepository.database !== database)
    || (dependencies.sheetRepository?.database && dependencies.sheetRepository.database !== database)
    || (dependencies.itemOperationRepository?.database && dependencies.itemOperationRepository.database !== database)) {
    throw new Error('Group inventory action repositories must use one RotomDatabase.')
  }
  const groupRepository = dependencies.groupInventoryRepository ?? createSqliteGroupInventoryRepository(database)
  const sheetRepository = dependencies.sheetRepository
    ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const itemOperationRepository = dependencies.itemOperationRepository
    ?? createSqliteItemOperationRepository({ database })
  const groupInventory = groupRepository.getOrCreate({ slug: normalizeSlug(input.groupSlug) }).document
  const trainerSheets = sheetRepository.list('trainer').flatMap((stored) => {
    const authorization = authorizeGroupInventoryTrainerTransfer({
      role: input.role,
      playerProfile: input.playerProfile,
      trainerSlug: stored.slug,
    })
    if (!authorization.ok) return []
    return [{
      ...(stored.document as unknown as TrainerSheet),
      slug: stored.slug,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
    }]
  })
  return projectGroupInventoryTransferActionAuthority({
    groupInventory,
    trainerSheets,
    canManageGroupStacks: input.role === 'gm',
    reservedQuantity: source => itemOperationRepository.reservedQuantity(itemInventoryInstanceId(source)),
    generatedAt: (dependencies.now ?? Date.now)(),
  })
}

export const loadGroupInventoryActionsUseCase = (
  input: LoadGroupInventoryActionsInput,
  dependencies: LoadGroupInventoryActionsDependencies = {},
): InventoryActionProjectionV1 => loadGroupInventoryActionAuthority(input, dependencies).projection
