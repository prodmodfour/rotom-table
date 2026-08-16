import type { AuthRole } from '#shared/auth'
import type { InventoryActionProjectionV1 } from '#shared/itemAutomation/inventoryActions'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import type { PlayerProfile } from '#shared/playerProfiles'
import { GROUP_INVENTORY_MAIN_SLUG } from '~/types/groupInventory'
import {
  projectTrainerInventoryActionAuthority,
  type TrainerInventoryActionAuthorityV1,
} from '../domain/itemAutomation/inventoryActionOffers'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteItemOperationRepository,
  type ItemOperationRepository,
} from '../storage/itemOperationRepository'
import { loadTrainerSheetItemActionAuthority } from './loadSheetItemActions'

export interface LoadTrainerInventoryActionsInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: string
}

export interface LoadTrainerInventoryActionsDependencies {
  readonly database?: RotomDatabase
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'getOrCreate'> & { readonly database?: RotomDatabase }
  readonly itemOperationRepository?: Pick<ItemOperationRepository, 'reservedQuantity'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
}

export const loadTrainerInventoryActionAuthority = (
  input: LoadTrainerInventoryActionsInput,
  dependencies: LoadTrainerInventoryActionsDependencies = {},
): TrainerInventoryActionAuthorityV1 => {
  const database = dependencies.database
    ?? dependencies.groupInventoryRepository?.database
    ?? dependencies.itemOperationRepository?.database
    ?? getRotomDatabase()
  if ((dependencies.groupInventoryRepository?.database && dependencies.groupInventoryRepository.database !== database)
    || (dependencies.itemOperationRepository?.database && dependencies.itemOperationRepository.database !== database)) {
    throw new Error('Inventory action repositories must use one RotomDatabase.')
  }
  const groupRepository = dependencies.groupInventoryRepository ?? createSqliteGroupInventoryRepository(database)
  const itemOperationRepository = dependencies.itemOperationRepository
    ?? createSqliteItemOperationRepository({ database })
  const authority = loadTrainerSheetItemActionAuthority(input, { database, now: dependencies.now })
  return projectTrainerInventoryActionAuthority({
    authority,
    groupInventory: groupRepository.getOrCreate({ slug: GROUP_INVENTORY_MAIN_SLUG }).document,
    reservedQuantity: source => itemOperationRepository.reservedQuantity(itemInventoryInstanceId(source)),
    generatedAt: (dependencies.now ?? Date.now)(),
  })
}

export const loadTrainerInventoryActionsUseCase = (
  input: LoadTrainerInventoryActionsInput,
  dependencies: LoadTrainerInventoryActionsDependencies = {},
): InventoryActionProjectionV1 => loadTrainerInventoryActionAuthority(input, dependencies).projection
