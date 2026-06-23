import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  profileLinkedPokemonPokedexSlugs,
  type PokedexProfilePriorityResponse,
} from '~/utils/pokedex/profilePriority'
import { listSheetsUseCase, type ListSheetsInput, type ListSheetsResult } from './listSheets'

export interface ListProfilePokedexPriorityInput {
  readonly role: AuthRole
  readonly profile: PlayerProfile
}

export interface ListProfilePokedexPriorityDependencies {
  readonly listSheets?: (input: ListSheetsInput) => ListSheetsResult
}

const pokemonSheetsBySlug = (
  pokemonSheets: readonly CharacterSheet[],
): ReadonlyMap<string, CharacterSheet> => new Map(pokemonSheets.map((sheet) => [sheet.slug, sheet]))

export const listProfilePokedexPriorityUseCase = (
  input: ListProfilePokedexPriorityInput,
  dependencies: ListProfilePokedexPriorityDependencies = {},
): PokedexProfilePriorityResponse => {
  const listSheets = dependencies.listSheets ?? listSheetsUseCase
  const { pokemonSheets, trainerSheets } = listSheets({
    role: input.role,
    playerProfile: input.profile,
  })

  return {
    slugs: [...profileLinkedPokemonPokedexSlugs({
      profile: input.profile,
      linkedTrainerSheets: trainerSheets as readonly TrainerSheet[],
      pokemonBySlug: pokemonSheetsBySlug(pokemonSheets),
    })],
  }
}
