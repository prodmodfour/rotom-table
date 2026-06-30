import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import {
  expectRevision,
  expectSlug,
  expectString,
  readObjectBody,
  requireWritableCampaignMode,
} from '../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
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
  readonly profileId?: unknown
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
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null

    return transferTrainerInventoryToGroupUseCase({
      role,
      playerProfile,
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
