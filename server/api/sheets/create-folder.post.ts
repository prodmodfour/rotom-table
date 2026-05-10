import { createError, defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { CreateSheetFolderUseCaseError, createSheetFolderUseCase } from '../../useCases/createSheetFolder'

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
    if (err instanceof CreateSheetFolderUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
