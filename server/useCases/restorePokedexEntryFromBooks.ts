import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  findPokedexEntryDetail,
  PokedexEntryConflictError,
  replacePokedexEntryBySlug,
} from '../utils/pokedexRepository'
import { restorePokedexRecordFromMarkdown } from '../utils/pokedexMarkdownBooks'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'
import type { PokedexRecord } from '~/types/pokemon'

export class RestorePokedexEntryFromBooksUseCaseError extends UseCaseHttpError<404 | 409> {}

export interface RestorePokedexEntryFromBooksInput {
  slug: string
}

export interface RestorePokedexEntryFromBooksResult {
  ok: true
  path: string
  entry: PokedexEntryDetail
}

export const restorePokedexEntryFromBooksUseCase = async (
  input: RestorePokedexEntryFromBooksInput,
): Promise<RestorePokedexEntryFromBooksResult> => {
  const currentEntry = findPokedexEntryDetail(input.slug)
  if (!currentEntry) {
    throw new RestorePokedexEntryFromBooksUseCaseError(404, `Pokédex entry not found: ${input.slug}`)
  }

  const restoredEntry = await restorePokedexRecordFromMarkdown(currentEntry as PokedexRecord)
  if (!restoredEntry) {
    throw new RestorePokedexEntryFromBooksUseCaseError(
      404,
      `PTU markdown book entry not found for ${currentEntry.species}`,
    )
  }

  try {
    const result = replacePokedexEntryBySlug(input.slug, restoredEntry)
    if (!result) {
      throw new RestorePokedexEntryFromBooksUseCaseError(404, `Pokédex entry not found: ${input.slug}`)
    }
    return { ok: true, path: result.path, entry: result.entry }
  } catch (error) {
    if (error instanceof RestorePokedexEntryFromBooksUseCaseError) throw error
    if (error instanceof PokedexEntryConflictError) {
      throw new RestorePokedexEntryFromBooksUseCaseError(409, error.message)
    }
    throw error
  }
}
