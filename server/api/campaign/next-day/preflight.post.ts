import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { badRequest, readObjectBody } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { prepareCampaignDayUseCase } from '../../../useCases/prepareCampaignDay'

interface CampaignDayPreflightBody {
  readonly schemaVersion?: unknown
  readonly operationId?: unknown
  readonly kind?: unknown
  readonly days?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readObjectBody<CampaignDayPreflightBody>(event)
  const fields = ['schemaVersion', 'operationId', 'kind', 'days'] as const
  if (Object.keys(body).length !== fields.length || fields.some(field => !Object.hasOwn(body, field))) {
    badRequest('Campaign day preflight requires exactly one v1 one-day command.')
  }
  try {
    return prepareCampaignDayUseCase({ command: body })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
