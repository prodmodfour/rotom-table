import { defineEventHandler } from 'h3'
import { publishCampaignAttentionInvalidation } from '../../realtime/campaignAttentionRealtime'
import { timeoutExpiredSkillChecksUseCase } from '../../useCases/manageSubjectSkillChecks'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  if (Object.keys(body).length !== 0) {
    badRequest('Expired Skill Check settlement accepts no client authority.')
  }
  try { return timeoutExpiredSkillChecksUseCase({ publishAttention: publishCampaignAttentionInvalidation }) }
  catch (error) { throwUseCaseHttpError(error) }
})
