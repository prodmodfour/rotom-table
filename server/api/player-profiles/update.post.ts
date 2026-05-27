import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { updatePlayerProfileUseCase } from '../../useCases/updatePlayerProfile'

interface UpdateBody {
  profileId?: unknown
  displayName?: unknown
  linkedCharacters?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  const body = await readObjectBody<UpdateBody>(event)

  try {
    return updatePlayerProfileUseCase({ ...body, role })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
