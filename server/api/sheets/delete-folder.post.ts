import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { deleteSheetFolderUseCase } from '../../useCases/deleteSheetFolder'

interface DeleteFolderBody {
  folder?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<DeleteFolderBody>(event)

  try {
    return deleteSheetFolderUseCase({ folder: body.folder })
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
