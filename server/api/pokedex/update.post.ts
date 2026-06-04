import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { expectRecord, expectSlug, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { updatePokedexEntryUseCase } from '../../useCases/updatePokedexEntry'

interface UpdatePokedexEntryBody {
  slug?: unknown
  entry?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<UpdatePokedexEntryBody>(event)
  const slug = expectSlug(body.slug)
  const entry = expectRecord(body.entry, 'entry')

  try {
    return updatePokedexEntryUseCase({ slug, entry })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
