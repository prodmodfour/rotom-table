import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
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
import { transferGroupInventoryToTrainerUseCase } from '../../useCases/transferGroupInventoryToTrainer'

interface TransferGroupInventoryToTrainerBody {
  readonly groupSlug?: unknown
  readonly groupRevision?: unknown
  readonly trainerSlug?: unknown
  readonly trainerRevision?: unknown
  readonly section?: unknown
  readonly itemId?: unknown
  readonly quantity?: unknown
  readonly profileId?: unknown
  readonly clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<TransferGroupInventoryToTrainerBody>(event)
  const groupSlug = expectSlug(body.groupSlug, 'group inventory slug')
  const groupRevision = expectRevision(body.groupRevision, 'groupRevision')
  const trainerSlug = expectSlug(body.trainerSlug, 'trainer slug')
  const trainerRevision = expectRevision(body.trainerRevision, 'trainerRevision')
  const section = expectString(body.section, 'section')
  const itemId = expectString(body.itemId, 'itemId')

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null

    return transferGroupInventoryToTrainerUseCase({
      role,
      playerProfile,
      groupSlug,
      groupRevision,
      trainerSlug,
      trainerRevision,
      section,
      itemId,
      quantity: body.quantity,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
