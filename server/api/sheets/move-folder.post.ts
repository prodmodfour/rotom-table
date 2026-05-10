import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { moveSheetFolderUseCase } from '../../useCases/moveSheetFolder'

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
    throwUseCaseHttpError(err)
  }
})
