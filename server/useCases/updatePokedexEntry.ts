import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  findPokedexEntryDetail,
  PokedexEntryConflictError,
  replacePokedexEntryBySlug,
} from '../utils/pokedexRepository'
import { toEditablePokedexRecord } from '~/utils/pokedex/persistence'
import { toPokedexSlug } from '~/utils/pokedex/searchText'
import type { PokedexRecord } from '~/types/pokemon'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

export class UpdatePokedexEntryUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface UpdatePokedexEntryInput {
  slug: string
  entry: Record<string, unknown>
}

export interface UpdatePokedexEntryResult {
  ok: true
  path: string
  entry: PokedexEntryDetail
}

const toValidPokedexRecord = (entry: Record<string, unknown>): PokedexRecord => {
  const persisted = toEditablePokedexRecord(entry)
  if (!persisted) throw new UpdatePokedexEntryUseCaseError(400, 'entry must be an object')

  const species = persisted.species
  if (typeof species !== 'string' || species.trim().length === 0) {
    throw new UpdatePokedexEntryUseCaseError(400, 'entry.species is required')
  }

  persisted.species = species.trim()
  return persisted
}

export const updatePokedexEntryUseCase = (
  input: UpdatePokedexEntryInput,
): UpdatePokedexEntryResult => {
  if (!findPokedexEntryDetail(input.slug)) {
    throw new UpdatePokedexEntryUseCaseError(404, `Pokédex entry not found: ${input.slug}`)
  }

  const entry = toValidPokedexRecord(input.entry)
  if (!toPokedexSlug(entry.species)) {
    throw new UpdatePokedexEntryUseCaseError(400, 'entry.species must contain letters or numbers')
  }

  try {
    const result = replacePokedexEntryBySlug(input.slug, entry)
    if (!result) throw new UpdatePokedexEntryUseCaseError(404, `Pokédex entry not found: ${input.slug}`)
    return { ok: true, path: result.path, entry: result.entry }
  } catch (error) {
    if (error instanceof UpdatePokedexEntryUseCaseError) throw error
    if (error instanceof PokedexEntryConflictError) {
      throw new UpdatePokedexEntryUseCaseError(409, error.message)
    }
    throw error
  }
}
