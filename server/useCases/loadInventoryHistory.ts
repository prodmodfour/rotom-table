import type { AuthRole } from '#shared/auth'
import {
  INVENTORY_HISTORY_LIMITS,
  type InventoryHistoryProjectionV1,
} from '#shared/itemAutomation/inventoryHistory'
import { validateSlug } from '#shared/paths'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  projectInventoryHistory,
  type InventoryHistorySettlementAwardSource,
} from '../domain/itemAutomation/inventoryHistory'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteGroupInventoryRepository,
  type GroupInventoryRepository,
} from '../storage/groupInventoryRepository'
import {
  createSqliteInventoryHistorySourceRepository,
  type InventoryHistorySourceRepository,
  type InventoryHistorySourceScope,
} from '../storage/inventoryHistorySourceRepository'
import {
  createSqliteSheetRepository,
  type SheetRepository,
} from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadInventoryHistoryUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface LoadInventoryHistoryInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug?: unknown
  readonly groupSlug?: unknown
  readonly limit?: unknown
}

export interface LoadInventoryHistoryDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'> & { readonly database?: RotomDatabase }
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'get'> & { readonly database?: RotomDatabase }
  readonly sourceRepository?: InventoryHistorySourceRepository
  readonly settlementAwards?: (scope: InventoryHistorySourceScope) => readonly InventoryHistorySettlementAwardSource[]
  readonly now?: () => number
}

const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new LoadInventoryHistoryUseCaseError(statusCode, message)
}
const slug = (value: unknown, label: string): string => {
  try { return validateSlug(value, label) }
  catch { return fail(400, `${label} must be a valid campaign slug.`) }
}
export const normalizeInventoryHistoryLimit = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 20
  const parsed = typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1 || Number(parsed) > INVENTORY_HISTORY_LIMITS.facts) {
    return fail(400, `Inventory history limit must be from 1 through ${INVENTORY_HISTORY_LIMITS.facts}.`)
  }
  return Number(parsed)
}
const linkedPokemonSlugs = (sheet: TrainerSheet): readonly string[] => Object.freeze(
  [...new Set([...(sheet.currentTeam ?? []), ...(sheet.boxedPokemon ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean))],
)
const sameDatabase = (database: RotomDatabase, candidate: RotomDatabase | undefined, label: string): void => {
  if (candidate && candidate !== database) throw new Error(`${label} must use the inventory history database.`)
}

export const loadInventoryHistoryUseCase = (
  input: LoadInventoryHistoryInput,
  dependencies: LoadInventoryHistoryDependencies = {},
): InventoryHistoryProjectionV1 => {
  const hasTrainer = input.trainerSlug !== undefined
  const hasGroup = input.groupSlug !== undefined
  if (hasTrainer === hasGroup) {
    return fail(400, 'Inventory history requires exactly one trainerSlug or groupSlug scope.')
  }
  const database = dependencies.database
    ?? dependencies.sourceRepository?.database
    ?? dependencies.sheetRepository?.database
    ?? dependencies.groupInventoryRepository?.database
    ?? getRotomDatabase()
  sameDatabase(database, dependencies.sourceRepository?.database, 'Inventory history source repository')
  sameDatabase(database, dependencies.sheetRepository?.database, 'Inventory history sheet repository')
  sameDatabase(database, dependencies.groupInventoryRepository?.database, 'Inventory history group repository')
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const groups = dependencies.groupInventoryRepository ?? createSqliteGroupInventoryRepository(database)
  const sources = dependencies.sourceRepository ?? createSqliteInventoryHistorySourceRepository(database)
  const limit = normalizeInventoryHistoryLimit(input.limit)

  let sourceScope: InventoryHistorySourceScope
  let projectionScope: { readonly kind: 'trainer' | 'group', readonly label: string }
  if (hasTrainer) {
    const trainerSlug = slug(input.trainerSlug, 'trainerSlug')
    const stored = sheets.getByRef('trainer', trainerSlug)
      ?? fail(404, 'The Trainer inventory for this history view was not found.')
    if (input.role === 'player' && !playerProfileCanControlTokenSheet(input.playerProfile, 'trainer', trainerSlug)) {
      return fail(403, 'The selected player profile does not control this Trainer inventory history.')
    }
    const trainer = stored.sheet as unknown as TrainerSheet
    sourceScope = Object.freeze({
      kind: 'trainer',
      slug: trainerSlug,
      linkedPokemonSlugs: linkedPokemonSlugs(trainer),
    })
    projectionScope = Object.freeze({
      kind: 'trainer',
      label: trainer.name?.trim() ? `${trainer.name.trim()} inventory` : 'Trainer inventory',
    })
  }
  else {
    const groupSlug = slug(input.groupSlug, 'groupSlug')
    if (!groups.get(groupSlug)) return fail(404, 'The shared inventory for this history view was not found.')
    sourceScope = Object.freeze({ kind: 'group', slug: groupSlug })
    projectionScope = Object.freeze({ kind: 'group', label: 'Shared inventory' })
  }

  try {
    return projectInventoryHistory({
      role: input.role,
      playerProfile: input.playerProfile,
      scope: projectionScope,
      sources: sources.listRecent(sourceScope, limit),
      settlementAwards: dependencies.settlementAwards?.(sourceScope) ?? [],
      generatedAt: (dependencies.now ?? Date.now)(),
      limit,
    })
  }
  catch (error) {
    if (error instanceof LoadInventoryHistoryUseCaseError) throw error
    return fail(409, 'Inventory history receipts could not be projected safely from current accepted records.')
  }
}
