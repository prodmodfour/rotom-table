import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../utils/auth'
import {
  expectRecord,
  expectRevision,
  expectSlug,
  readObjectBody,
  requireWritableCampaignMode,
} from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { saveGroupInventoryUseCase } from '../../useCases/saveGroupInventory'

interface SaveGroupInventoryBody {
  readonly slug?: unknown
  readonly expectedRevision?: unknown
  readonly document?: unknown
  readonly clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<SaveGroupInventoryBody>(event)
  const slug = expectSlug(body.slug, 'group inventory slug')
  const expectedRevision = expectRevision(body.expectedRevision, 'expectedRevision')
  const document = expectRecord(body.document, 'document')

  try {
    const result = saveGroupInventoryUseCase({
      role,
      slug,
      expectedRevision,
      document,
      clientId: normalizeRealtimeClientId(body.clientId),
    })

    return {
      ok: true as const,
      changed: result.changed,
      document: result.document,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
