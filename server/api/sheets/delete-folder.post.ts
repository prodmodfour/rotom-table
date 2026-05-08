import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { expectFolderPath, notFound, readObjectBody, requireNonProduction } from '../../utils/http'
import { deleteSheetFolder } from '../../utils/sheetStorage'

interface DeleteFolderBody {
  folder?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<DeleteFolderBody>(event)
  const folder = expectFolderPath(body.folder ?? '')
  const result = deleteSheetFolder(folder) ?? notFound(`Folder "${folder}" not found`)

  return { ok: true as const, count: result.count, removed: result.removed }
})
