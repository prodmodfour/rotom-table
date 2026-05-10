import { createError, defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { MoveSheetFolderUseCaseError, moveSheetFolderUseCase } from '../../useCases/moveSheetFolder'

interface MoveFolderBody {
  from?: unknown
  to?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<MoveFolderBody>(event)

  try {
    return moveSheetFolderUseCase({ from: body.from, to: body.to })
  } catch (err) {
    if (err instanceof MoveSheetFolderUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
