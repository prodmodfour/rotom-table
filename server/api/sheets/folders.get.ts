import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { requireNonProduction } from '../../utils/http'
import { listSheetFolders } from '../../utils/sheetStorage'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  if (role === 'player') return { folders: [] }

  requireNonProduction()
  return { folders: listSheetFolders() }
})
