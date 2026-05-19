import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

export interface PokedexEntryMutationResponse {
  ok: true
  path: string
  entry: PokedexEntryDetail
}
