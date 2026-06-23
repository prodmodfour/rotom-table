import spriteManifest from '~~/data/pokemonSpriteManifest.json'
import type { SpriteManifestRecord } from '~/types/pokemon'
import { pokemonProfileSpriteUrl } from '~/utils/profileSprites'
import { findPokedexEntryDetail } from '../utils/pokedexRepository'
import { writePokemonProfileImageOverride } from '../utils/pokedexProfileImageStorage'
import { UseCaseHttpError } from '../utils/useCaseErrors'

const MAX_PROFILE_IMAGE_BYTES = 512 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/

const spriteManifestBySpecies = new Map(
  (spriteManifest as SpriteManifestRecord[]).map((entry) => [entry.species, entry]),
)

export class UpdatePokedexProfileImageUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface UpdatePokedexProfileImageInput {
  slug: string
  imageDataUrl: string
}

export interface UpdatePokedexProfileImageResult {
  ok: true
  path: string
  species: string
  profileImageSlug: string
  profileSpriteUrl: string
}

const decodePngDataUrl = (imageDataUrl: string): Buffer => {
  const match = PNG_DATA_URL_RE.exec(imageDataUrl)
  if (!match) {
    throw new UpdatePokedexProfileImageUseCaseError(400, 'imageDataUrl must be a PNG data URL')
  }

  const png = Buffer.from(match[1] ?? '', 'base64')
  if (png.length <= PNG_SIGNATURE.length || png.length > MAX_PROFILE_IMAGE_BYTES) {
    throw new UpdatePokedexProfileImageUseCaseError(400, 'profile image PNG must be between 9 bytes and 512KB')
  }

  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new UpdatePokedexProfileImageUseCaseError(400, 'imageDataUrl must contain PNG data')
  }

  return png
}

export const updatePokedexProfileImageUseCase = (
  input: UpdatePokedexProfileImageInput,
): UpdatePokedexProfileImageResult => {
  const entry = findPokedexEntryDetail(input.slug)
  if (!entry) throw new UpdatePokedexProfileImageUseCaseError(404, `Pokédex entry not found: ${input.slug}`)

  const manifestEntry = spriteManifestBySpecies.get(entry.species)
  if (!manifestEntry) {
    throw new UpdatePokedexProfileImageUseCaseError(404, `Profile image source not found for ${entry.species}`)
  }

  const png = decodePngDataUrl(input.imageDataUrl)
  const result = writePokemonProfileImageOverride(manifestEntry.slug, png)

  return {
    ok: true,
    path: result.pathLabel,
    species: entry.species,
    profileImageSlug: manifestEntry.slug,
    profileSpriteUrl: pokemonProfileSpriteUrl(manifestEntry.slug),
  }
}
