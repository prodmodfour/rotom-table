import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireGm } from '../../utils/auth'
import {
  expectRecord,
  expectRevision,
  expectSlug,
  readObjectBody,
  requireWritableCampaignMode,
} from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { saveShopTableUseCase } from '../../useCases/shopTableMutations'

interface SaveShopBody {
  readonly slug?: unknown
  readonly expectedRevision?: unknown
  readonly document?: unknown
  readonly clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<SaveShopBody>(event)
  const slug = expectSlug(body.slug, 'shop slug')
  const expectedRevision = expectRevision(body.expectedRevision, 'expectedRevision')
  const document = expectRecord(body.document, 'document')

  try {
    const result = saveShopTableUseCase({
      role,
      slug,
      expectedRevision,
      document,
      clientId: normalizeRealtimeClientId(body.clientId),
    })

    return {
      ok: result.ok,
      changed: result.changed,
      shop: result.shop,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
