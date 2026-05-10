import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { createSheetFolderUseCase } from '../../useCases/createSheetFolder'

interface CreateFolderBody {
  folder?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<CreateFolderBody>(event)

  try {
    return createSheetFolderUseCase({ folder: body.folder })
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
