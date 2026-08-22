import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { executeContestCommandUseCase } from '../../useCases/contests'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  try {
    const playerProfile = role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null
    const { profileId: _profileId, ...command } = body
    return { ok: true, ...executeContestCommandUseCase(command, { role, playerProfile }) }
  } catch (error) { throwUseCaseHttpError(error) }
})
