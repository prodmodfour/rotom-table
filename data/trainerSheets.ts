import type { TrainerSheet } from '~/types/trainerSheet'
import { folderFromGlobKey } from '~/utils/sheetFolders'

// ---------------------------------------------------------------------------
// Auto-discover trainer sheet JSONs under ``data/trainers`` (recursively).
// Subdirectories become folders on the index, e.g.
// ``data/trainers/party-1/foo.json`` is grouped under ``"party-1"``. A sheet
// may set ``folder`` explicitly to override the auto-derived label.
// ---------------------------------------------------------------------------

const trainerModules = import.meta.glob<{ default: TrainerSheet }>(
  './trainers/**/*.json',
  { eager: true },
)

export const trainerSheets: TrainerSheet[] = Object.entries(trainerModules)
  .map(([key, mod]) => {
    const sheet = mod.default
    return {
      ...sheet,
      folder: sheet.folder ?? folderFromGlobKey(key, 'trainers'),
    }
  })
  .sort((a, b) => {
    const folderCmp = (a.folder ?? '').localeCompare(b.folder ?? '')
    if (folderCmp !== 0) return folderCmp
    return a.name.localeCompare(b.name)
  })

export const trainerSheetsBySlug = new Map(
  trainerSheets.map((sheet) => [sheet.slug, sheet]),
)
