import { defineEventHandler } from 'h3'
import { finishEncounter } from '../../../useCases/finishEncounter'
import { requireGm } from '../../../utils/auth'
import { badRequest, expectRecord, readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'command')) {
    badRequest('Finish Encounter commit accepts exactly one command field.')
  }
  try {
    return finishEncounter({
      role,
      principalKey: 'role:gm',
      command: expectRecord(body.command, 'command'),
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
