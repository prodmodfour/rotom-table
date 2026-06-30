import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { createShopTableUseCase } from '../../useCases/shopTableMutations'

interface CreateShopBody {
  readonly slug?: unknown
  readonly baseSlug?: unknown
  readonly name?: unknown
  readonly document?: unknown
  readonly clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<CreateShopBody>(event)

  try {
    const result = createShopTableUseCase({
      role,
      slug: body.slug,
      baseSlug: body.baseSlug,
      name: body.name,
      document: body.document,
      clientId: normalizeRealtimeClientId(body.clientId),
    })

    return {
      ok: result.ok,
      shop: result.shop,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
