/**
 * GET /api/maps/folders
 *
 * Lists every logical SQLite map folder. Used to surface empty folders
 * on the map browser, mirroring `/api/sheets/folders`.
 */
import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { listMapFoldersUseCase } from '../../useCases/listMapLibrary'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  return listMapFoldersUseCase({ role })
})
