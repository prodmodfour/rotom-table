import { createError, defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { DeleteSheetFolderUseCaseError, deleteSheetFolderUseCase } from '../../useCases/deleteSheetFolder'

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
    if (err instanceof DeleteSheetFolderUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
