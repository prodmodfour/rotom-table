import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { listPlayerProfilesUseCase } from '../../useCases/listPlayerProfiles'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    return listPlayerProfilesUseCase({ role })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
