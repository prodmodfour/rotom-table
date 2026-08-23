import { defineEventHandler } from 'h3'
import { publishCampaignAttentionInvalidation } from '../../realtime/campaignAttentionRealtime'
import { manageGmSkillCheckUseCase } from '../../useCases/manageGmSkillChecks'
import { requireGm } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'command')) {
    badRequest('GM Skill Check mutation must contain only command.')
  }
  try {
    return manageGmSkillCheckUseCase(
      { principalId: 'session', command: body.command },
      { publishAttention: publishCampaignAttentionInvalidation },
    )
  }
  catch (error) { throwUseCaseHttpError(error) }
})
