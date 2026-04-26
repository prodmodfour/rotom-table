/**
 * GET /api/grids/folders
 *
 * Lists every subdirectory under ``data/grids/``. Used to surface
 * empty folders on the grid browser, mirroring `/api/sheets/folders`.
 */
import { defineEventHandler } from 'h3'
import { listGridFolders } from '../../utils/gridStorage'

export default defineEventHandler(() => ({ folders: listGridFolders() }))
