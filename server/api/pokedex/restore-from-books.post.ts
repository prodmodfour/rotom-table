import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { expectSlug, readObjectBody } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { restorePokedexEntryFromBooksUseCase } from '../../useCases/restorePokedexEntryFromBooks'

interface RestorePokedexEntryFromBooksBody {
  slug?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)

  const body = await readObjectBody<RestorePokedexEntryFromBooksBody>(event)
  const slug = expectSlug(body.slug)

  try {
    return await restorePokedexEntryFromBooksUseCase({ slug })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
