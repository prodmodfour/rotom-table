import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { launchEncounterBuilderUseCase } from '../../useCases/launchEncounterBuilder'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  try {
    return await launchEncounterBuilderUseCase(await readBody<unknown>(event))
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
