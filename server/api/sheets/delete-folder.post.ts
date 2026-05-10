import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { deleteSheetFolderUseCase } from '../../useCases/deleteSheetFolder'

interface DeleteFolderBody {
  folder?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<DeleteFolderBody>(event)

  try {
    return deleteSheetFolderUseCase({ folder: body.folder })
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
