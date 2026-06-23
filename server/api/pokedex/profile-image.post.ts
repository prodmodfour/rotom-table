import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { expectSlug, expectString, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { updatePokedexProfileImageUseCase } from '../../useCases/updatePokedexProfileImage'

interface UpdatePokedexProfileImageBody {
  slug?: unknown
  imageDataUrl?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<UpdatePokedexProfileImageBody>(event)
  const slug = expectSlug(body.slug)
  const imageDataUrl = expectString(body.imageDataUrl, 'imageDataUrl', { maxLength: 700_000 })

  try {
    return updatePokedexProfileImageUseCase({ slug, imageDataUrl })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
