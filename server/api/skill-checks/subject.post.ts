import { defineEventHandler } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { publishCampaignAttentionInvalidation } from '../../realtime/campaignAttentionRealtime'
import { respondSubjectSkillCheckUseCase, type SubjectSkillCheckAuthority } from '../../useCases/manageSubjectSkillChecks'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  const expectedFields = role === 'player' ? ['command', 'profileId'] : ['command']
  if (Object.keys(body).length !== expectedFields.length
    || expectedFields.some(field => !Object.hasOwn(body, field))) {
    badRequest(role === 'player'
      ? 'Player Skill Check response must contain only command and profileId.'
      : 'GM Skill Check response must contain only command.')
  }
  let authority: SubjectSkillCheckAuthority
  if (role === 'player') {
    const profile = resolvePlayerProfileForPolicy(body.profileId)
      ?? badRequest('profileId is required for player Skill Check responses.')
    authority = { kind: 'profile', profile }
  }
  else authority = { kind: 'gm', principalId: 'session' }
  try {
    return respondSubjectSkillCheckUseCase(
      { authority, command: body.command },
      { publishAttention: publishCampaignAttentionInvalidation },
    )
  }
  catch (error) { throwUseCaseHttpError(error) }
})
