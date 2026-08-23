import { defineEventHandler, getQuery } from 'h3'
import { SKILL_CHECK_STATES, type SkillCheckState } from '#shared/skillChecks/contract'
import { loadGmSkillChecksUseCase } from '../../useCases/manageGmSkillChecks'
import { requireGm } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  requireGm(event)
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'states' && key !== 'limit')) {
    badRequest('GM Skill Check query accepts only states and limit.')
  }
  const rawStates = Array.isArray(query.states) ? query.states.join(',') : query.states
  const states = rawStates === undefined || rawStates === ''
    ? undefined
    : String(rawStates).split(',').map(value => value.trim()).filter(Boolean)
  if (states?.some(state => !SKILL_CHECK_STATES.includes(state as SkillCheckState))) {
    badRequest('GM Skill Check states are invalid.')
  }
  const limit = query.limit === undefined ? undefined : Number(query.limit)
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)) {
    badRequest('GM Skill Check limit must be an integer from 1 through 500.')
  }
  try {
    return loadGmSkillChecksUseCase({ states: states as SkillCheckState[] | undefined, limit })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
