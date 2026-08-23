import { defineEventHandler, getQuery } from 'h3'
import { SKILL_CHECK_STATES, type SkillCheckState } from '#shared/skillChecks/contract'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadSubjectSkillChecksUseCase, type SubjectSkillCheckAuthority } from '../../useCases/manageSubjectSkillChecks'
import { requireAuthRole } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'profileId' && key !== 'states' && key !== 'limit')) {
    badRequest('Subject Skill Check query accepts only profileId, states, and limit.')
  }
  let authority: SubjectSkillCheckAuthority
  if (role === 'player') {
    const profile = resolvePlayerProfileForPolicy(query.profileId)
      ?? badRequest('profileId is required for player Skill Check requests.')
    authority = { kind: 'profile', profile }
  }
  else {
    if (query.profileId !== undefined) badRequest('GM subject queries do not accept profileId.')
    authority = { kind: 'gm', principalId: 'session' }
  }
  const rawStates = Array.isArray(query.states) ? query.states.join(',') : query.states
  const states = rawStates === undefined || rawStates === ''
    ? undefined
    : String(rawStates).split(',').map(value => value.trim()).filter(Boolean)
  if (states?.some(state => !SKILL_CHECK_STATES.includes(state as SkillCheckState))) {
    badRequest('Subject Skill Check states are invalid.')
  }
  const limit = query.limit === undefined ? undefined : Number(query.limit)
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)) {
    badRequest('Subject Skill Check limit must be an integer from 1 through 500.')
  }
  try {
    return loadSubjectSkillChecksUseCase({
      authority,
      states: states as SkillCheckState[] | undefined,
      limit,
    })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
