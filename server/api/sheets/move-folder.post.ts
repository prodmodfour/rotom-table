import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import {
  badRequest,
  conflict,
  expectFolderPath,
  notFound,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { moveSheetFolder } from '../../utils/sheetStorage'

interface MoveFolderBody {
  from?: unknown
  to?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<MoveFolderBody>(event)
  const from = expectFolderPath(body.from ?? '', { label: 'from' })
  const to = expectFolderPath(body.to ?? '', { label: 'to' })

  let result: ReturnType<typeof moveSheetFolder> = null
  try {
    result = moveSheetFolder(from, to)
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('Destination already exists')) conflict(message)
    badRequest(message)
  }

  const moved = result ?? notFound(`Folder "${from}" not found`)
  return { ok: true as const, moved: moved.moved, count: moved.count }
})
