import type { AuthRole } from '#shared/auth'
import { validateSlug } from '#shared/paths'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import {
  sqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadGroupInventoryUseCaseError extends UseCaseHttpError<400> {}

export interface LoadGroupInventoryInput {
  readonly role: AuthRole
  readonly slug?: unknown
}

export interface LoadGroupInventoryDependencies {
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'getOrCreate'>
}

export const normalizeLoadGroupInventorySlug = (value: unknown): string => {
  if (value === undefined || value === null) return GROUP_INVENTORY_MAIN_SLUG

  try {
    return validateSlug(value, 'group inventory slug')
  } catch {
    throw new LoadGroupInventoryUseCaseError(
      400,
      'group inventory slug must match /^[a-z0-9-]+$/',
    )
  }
}

export const loadGroupInventoryUseCase = (
  input: LoadGroupInventoryInput,
  dependencies: LoadGroupInventoryDependencies = {},
): GroupInventoryDocument => {
  const groupInventoryRepository = dependencies.groupInventoryRepository ?? sqliteGroupInventoryRepository
  const slug = normalizeLoadGroupInventorySlug(input.slug)

  return groupInventoryRepository.getOrCreate({ slug }).document
}
