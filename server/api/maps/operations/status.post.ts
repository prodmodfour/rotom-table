import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { expectRecord, readObjectBody } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { getLivePlayOperationStatusUseCase } from '../../../useCases/getLivePlayOperationStatus'

type OperationStatusBody = Record<string, unknown>

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<OperationStatusBody>(event)
  const command = expectRecord(body.command, 'command')

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(command.profileId)
      : null

    return await getLivePlayOperationStatusUseCase({
      role,
      command,
      playerProfile,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
