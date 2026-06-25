import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { expectRecord, readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { abandonLivePlayOperationUseCase } from '../../../useCases/abandonLivePlayOperation'

type OperationAbandonBody = Record<string, unknown>

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<OperationAbandonBody>(event)
  const command = expectRecord(body.command, 'command')

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(command.profileId)
      : null

    return await abandonLivePlayOperationUseCase({
      role,
      command,
      playerProfile,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
