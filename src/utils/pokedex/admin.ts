import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

export interface PokedexEntryMutationResponse {
  ok: true
  path: string
  entry: PokedexEntryDetail
}

export interface PokedexProfileImageUpdateResponse {
  ok: true
  path: string
  species: string
  profileImageSlug: string
  profileSpriteUrl: string
}
