/**
 * GET /api/maps/folders
 *
 * Lists every subdirectory under ``data/maps/``. Used to surface
 * empty folders on the map browser, mirroring `/api/sheets/folders`.
 */
import { defineEventHandler } from 'h3'
import { listMapFolders } from '../../utils/mapStorage'

export default defineEventHandler(() => ({ folders: listMapFolders() }))
