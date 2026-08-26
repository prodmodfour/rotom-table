import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { listSessionPreparationsUseCase } from '../../../useCases/manageSessionPreparation'

export default defineEventHandler((event) => {
  requireGm(event)
  return listSessionPreparationsUseCase()
})
