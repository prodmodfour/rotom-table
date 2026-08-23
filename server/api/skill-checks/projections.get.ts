import { defineEventHandler, getQuery } from 'h3'
import { SKILL_CHECK_STATES, type SkillCheckState } from '#shared/skillChecks/contract'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadSkillCheckProjectionsUseCase, type SkillCheckProjectionAuthority } from '../../useCases/loadSkillCheckProjections'
import { requireAuthRole } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'profileId' && key !== 'states' && key !== 'limit')) {
    badRequest('Skill Check projection query accepts only profileId, states, and limit.')
  }
  const rawStates = Array.isArray(query.states) ? query.states.join(',') : query.states
  const states = rawStates === undefined || rawStates === ''
    ? undefined
    : String(rawStates).split(',').map(value => value.trim()).filter(Boolean)
  if (states?.some(state => !SKILL_CHECK_STATES.includes(state as SkillCheckState))) {
    badRequest('Skill Check projection states are invalid.')
  }
  const limit = query.limit === undefined ? undefined : Number(query.limit)
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)) {
    badRequest('Skill Check projection limit must be an integer from 1 through 500.')
  }
  let authority: SkillCheckProjectionAuthority
  if (role === 'gm') {
    if (query.profileId !== undefined) badRequest('GM projections do not accept profileId.')
    authority = { kind: 'gm' }
  }
  else if (query.profileId === undefined || query.profileId === '') authority = { kind: 'spectator' }
  else {
    const profile = resolvePlayerProfileForPolicy(query.profileId)
      ?? badRequest('The selected Skill Check profile is unavailable.')
    authority = { kind: 'subject', profile }
  }
  try {
    return loadSkillCheckProjectionsUseCase({
      authority,
      states: states as SkillCheckState[] | undefined,
      limit,
    })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
