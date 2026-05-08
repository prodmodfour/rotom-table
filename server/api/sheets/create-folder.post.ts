import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { expectFolderPath, readObjectBody, requireNonProduction } from '../../utils/http'
import { createSheetFolder } from '../../utils/sheetStorage'

interface CreateFolderBody {
  folder?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<CreateFolderBody>(event)
  const folder = expectFolderPath(body.folder ?? '')
  const result = createSheetFolder(folder, 'pokemon')

  return {
    ok: true as const,
    created: result.created,
    path: result.path,
  }
})
