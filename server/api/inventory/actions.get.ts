import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadGroupInventoryActionsUseCase } from '../../useCases/loadGroupInventoryActions'
import { loadTrainerInventoryActionsUseCase } from '../../useCases/loadTrainerInventoryActions'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, expectSlug } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    const allowed = new Set(['trainerSlug', 'groupSlug', 'profileId'])
    if (Object.keys(query).some(key => !allowed.has(key))) {
      badRequest('Inventory action projection accepts only trainerSlug or groupSlug plus profileId.')
    }
    const playerProfile = role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null
    const hasTrainer = query.trainerSlug !== undefined
    const hasGroup = query.groupSlug !== undefined
    if (hasTrainer === hasGroup) {
      badRequest('Inventory actions require exactly one trainerSlug or groupSlug scope.')
    }
    return hasTrainer
      ? loadTrainerInventoryActionsUseCase({
          role,
          playerProfile,
          trainerSlug: expectSlug(query.trainerSlug, 'trainerSlug'),
        })
      : loadGroupInventoryActionsUseCase({
          role,
          playerProfile,
          groupSlug: expectSlug(query.groupSlug, 'groupSlug'),
        })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
