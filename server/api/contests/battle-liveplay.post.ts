import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { executeBattleContestLiveplayCommandUseCase } from '../../useCases/battleContestLiveplay'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  try {
    const forcePublic = body.view === 'public'
    const playerProfile = role === 'player' && !forcePublic ? resolvePlayerProfileForPolicy(body.profileId) : null
    const { profileId: _profileId, view: _view, ...command } = body
    return executeBattleContestLiveplayCommandUseCase(command, { role: forcePublic ? 'player' : role, playerProfile })
  } catch (error) { throwUseCaseHttpError(error) }
})
