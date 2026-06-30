import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireGm } from '../../utils/auth'
import {
  expectRevision,
  expectSlug,
  readObjectBody,
  requireWritableCampaignMode,
} from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { deleteShopTableUseCase } from '../../useCases/shopTableMutations'

interface DeleteShopBody {
  readonly slug?: unknown
  readonly expectedRevision?: unknown
  readonly clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<DeleteShopBody>(event)
  const slug = expectSlug(body.slug, 'shop slug')
  const expectedRevision = body.expectedRevision === undefined
    ? undefined
    : expectRevision(body.expectedRevision, 'expectedRevision')

  try {
    const result = deleteShopTableUseCase({
      role,
      slug,
      expectedRevision,
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
