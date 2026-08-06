import type { PokemonEggLifecycleProjectionV1 } from '#shared/breeding/eggLifecycle'
import { projectPokemonEggLifecycleV1 } from '../domain/breeding/eggLifecyclePolicy'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import {
  queryPokemonEggIncubation,
  type QueryPokemonEggIncubationInputV1,
  type QueryPokemonEggIncubationOptions,
} from './managePokemonEggIncubation'

export type QueryPokemonEggLifecycleInputV1 = QueryPokemonEggIncubationInputV1
export type QueryPokemonEggLifecycleOptions = QueryPokemonEggIncubationOptions

/**
 * Authorize through the current owner/GM incubation visibility boundary, then
 * project lifecycle-only eligibility from that exact Egg revision.
 */
export const queryPokemonEggLifecycle = (
  input: QueryPokemonEggLifecycleInputV1,
  options: QueryPokemonEggLifecycleOptions = {},
): PokemonEggLifecycleProjectionV1 => {
  const incubation = queryPokemonEggIncubation(input, options)
  const database = options.database ?? getRotomDatabase()
  const egg = createSqlitePokemonEggRepository(database).get(incubation.eggId)
  const clock = createSqliteCampaignClockRepository(database).get()
  if (!egg || egg.revision !== incubation.revision
    || clock.campaignMinute !== incubation.generatedAtCampaignMinute) {
    throw new Error('Egg lifecycle query became stale before projection.')
  }
  return projectPokemonEggLifecycleV1({
    egg,
    audience: input.audience,
    generatedAtCampaignMinute: clock.campaignMinute,
  })
}
