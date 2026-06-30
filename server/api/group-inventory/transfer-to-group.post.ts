import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import {
  expectRevision,
  expectSlug,
  expectString,
  readObjectBody,
  requireWritableCampaignMode,
} from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { transferTrainerInventoryToGroupUseCase } from '../../useCases/transferTrainerInventoryToGroup'

interface TransferTrainerInventoryToGroupBody {
  readonly trainerSlug?: unknown
  readonly trainerRevision?: unknown
  readonly groupSlug?: unknown
  readonly groupRevision?: unknown
  readonly section?: unknown
  readonly trainerItemId?: unknown
  readonly itemId?: unknown
  readonly trainerRowIndex?: unknown
  readonly quantity?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<TransferTrainerInventoryToGroupBody>(event)
  const trainerSlug = expectSlug(body.trainerSlug, 'trainer slug')
  const trainerRevision = expectRevision(body.trainerRevision, 'trainerRevision')
  const groupSlug = expectSlug(body.groupSlug, 'group inventory slug')
  const groupRevision = expectRevision(body.groupRevision, 'groupRevision')
  const section = expectString(body.section, 'section')

  try {
    return transferTrainerInventoryToGroupUseCase({
      role,
      trainerSlug,
      trainerRevision,
      groupSlug,
      groupRevision,
      section,
      trainerItemId: body.trainerItemId ?? body.itemId,
      trainerRowIndex: body.trainerRowIndex,
      quantity: body.quantity,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
