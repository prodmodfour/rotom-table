import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { readObjectBody } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { createPlayerProfileUseCase } from '../../useCases/createPlayerProfile'

interface CreateBody {
  displayName?: unknown
  linkedCharacters?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<CreateBody>(event)

  try {
    return createPlayerProfileUseCase({ ...body, role })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
