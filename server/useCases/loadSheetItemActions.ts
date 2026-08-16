import type { AuthRole } from '#shared/auth'
import { SLUG_RE } from '#shared/paths'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import { SHEET_ITEM_ACTION_LIMITS, type SheetItemActionProjectionV1 } from '#shared/itemAutomation/sheetActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { projectTrainerSheetItemActions } from '../domain/itemAutomation/sheetActionOffers'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class LoadSheetItemActionsUseCaseError extends UseCaseHttpError<403 | 404 | 409> {}

export interface LoadSheetItemActionsInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: string
}

export interface LoadSheetItemActionsDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
}

export interface TrainerSheetItemActionAuthority {
  readonly projection: SheetItemActionProjectionV1
  readonly trainerSheet: TrainerSheet
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly targetLimitExceeded: boolean
}

const fail = (statusCode: 403 | 404 | 409, message: string): never => {
  throw new LoadSheetItemActionsUseCaseError(statusCode, message)
}

export const itemActionSheetDocument = <TSheet extends CharacterSheet | TrainerSheet>(stored: PersistedSheet): TSheet => ({
  ...stored.sheet,
  slug: stored.slug,
  revision: stored.revision,
} as unknown as TSheet)

export const linkedItemActionPokemonSlugs = (trainer: TrainerSheet): readonly string[] => {
  const values = [...(trainer.currentTeam ?? []), ...(trainer.boxedPokemon ?? [])]
  const slugs: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const slug = value.trim()
    if (!SLUG_RE.test(slug) || seen.has(slug)) continue
    seen.add(slug)
    slugs.push(slug)
  }
  return Object.freeze(slugs)
}

/** Load only the source Trainer and its explicitly linked roster as sheet-use targets. */
export const loadTrainerSheetItemActionAuthority = (
  input: LoadSheetItemActionsInput,
  dependencies: LoadSheetItemActionsDependencies = {},
): TrainerSheetItemActionAuthority => {
  const database = dependencies.database ?? dependencies.sheetRepository?.database ?? getRotomDatabase()
  if (dependencies.sheetRepository?.database && dependencies.sheetRepository.database !== database) {
    throw new Error('Sheet item action authority must use one RotomDatabase.')
  }
  const repository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const sourceStored = repository.getByRef('trainer', input.trainerSlug)
    ?? fail(404, `Trainer sheet ${input.trainerSlug} was not found.`)
  const trainerSheet = itemActionSheetDocument<TrainerSheet>(sourceStored)
  if (input.role === 'player' && !playerProfileCanControlTokenSheet(
    input.playerProfile,
    'trainer',
    input.trainerSlug,
  )) fail(403, 'The selected player profile does not control this Trainer inventory.')

  const pokemonSheets = linkedItemActionPokemonSlugs(trainerSheet).flatMap((slug) => {
    const stored = repository.getByRef('pokemon', slug)
    return stored ? [itemActionSheetDocument<CharacterSheet>(stored)] : []
  })
  const targetLimitExceeded = pokemonSheets.length + 1 > SHEET_ITEM_ACTION_LIMITS.targetsPerOffer
  const generatedAt = (dependencies.now ?? Date.now)()
  const trainerSheets = Object.freeze([trainerSheet])
  let projection: SheetItemActionProjectionV1
  try {
    projection = projectTrainerSheetItemActions({
      trainerSheet,
      pokemonSheets,
      trainerSheets,
      generatedAt,
      campaignMinute: createSqliteCampaignClockRepository(database).get().campaignMinute,
      targetLimitExceeded,
      gmAuthority: input.role === 'gm',
    })
  }
  catch (error) {
    return fail(409, error instanceof Error ? error.message : 'Sheet item actions could not be projected safely.')
  }
  return Object.freeze({
    projection,
    trainerSheet,
    pokemonSheets: Object.freeze(pokemonSheets),
    trainerSheets,
    targetLimitExceeded,
  })
}

export const loadSheetItemActionsUseCase = (
  input: LoadSheetItemActionsInput,
  dependencies: LoadSheetItemActionsDependencies = {},
): SheetItemActionProjectionV1 => loadTrainerSheetItemActionAuthority(input, dependencies).projection
