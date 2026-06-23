import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { validateSlug } from '#shared/paths'
import { CAMPAIGN_ASSETS_ROOT, campaignPathLabel } from './campaignPaths'
import { PROJECT_ROOT, joinSafeUnderRoot } from './fsPaths'

const POKEMON_PROFILE_IMAGE_FILE_EXTENSION = '.png'

export const CAMPAIGN_POKEMON_PROFILE_IMAGES_ROOT = join(
  CAMPAIGN_ASSETS_ROOT,
  'profile-sprites',
  'pokemon',
)

export const APP_POKEMON_PROFILE_IMAGES_ROOT = join(
  PROJECT_ROOT,
  'public',
  'profile-sprites',
  'pokemon',
)

export interface PokemonProfileImageFile {
  path: string
  source: 'campaign' | 'app'
}

const pokemonProfileImageFileName = (slug: string): string => `${validateSlug(slug)}${POKEMON_PROFILE_IMAGE_FILE_EXTENSION}`

export const pokemonProfileImageOverridePath = (slug: string): string => (
  joinSafeUnderRoot(CAMPAIGN_POKEMON_PROFILE_IMAGES_ROOT, '', pokemonProfileImageFileName(slug))
)

export const appPokemonProfileImagePath = (slug: string): string => (
  joinSafeUnderRoot(APP_POKEMON_PROFILE_IMAGES_ROOT, '', pokemonProfileImageFileName(slug))
)

export const findPokemonProfileImageFile = (slug: string): PokemonProfileImageFile | null => {
  const campaignPath = pokemonProfileImageOverridePath(slug)
  if (existsSync(campaignPath)) return { path: campaignPath, source: 'campaign' }

  const appPath = appPokemonProfileImagePath(slug)
  return existsSync(appPath) ? { path: appPath, source: 'app' } : null
}

export const readPokemonProfileImage = (slug: string): Buffer | null => {
  const file = findPokemonProfileImageFile(slug)
  return file ? readFileSync(file.path) : null
}

export const writePokemonProfileImageOverride = (
  slug: string,
  png: Buffer,
): { path: string; pathLabel: string } => {
  const path = pokemonProfileImageOverridePath(slug)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, png)
  return { path, pathLabel: campaignPathLabel(path) }
}
