import { defineEventHandler, getRouterParam } from 'h3'
import { requireGm } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { getSessionPreparationUseCase } from '../../../useCases/manageSessionPreparation'

export default defineEventHandler((event) => {
  requireGm(event)
  try { return getSessionPreparationUseCase(getRouterParam(event, 'preparationId') ?? '') }
  catch (error) { throwUseCaseHttpError(error) }
})
