export const POKEMON_PROFILE_SPRITE_API_BASE = '/api/profile-sprites/pokemon' as const

export const pokemonProfileSpriteUrl = (slug: string): string => `${POKEMON_PROFILE_SPRITE_API_BASE}/${slug}`
