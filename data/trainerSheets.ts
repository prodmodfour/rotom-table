import type { TrainerSheet } from '~/types/trainerSheet'

// Campaign trainer sheets are runtime SQLite documents. Do not eager-load
// ``data/trainers`` JSON into the client bundle as a fallback authority.
// These legacy exports remain empty for old imports; sheet UIs hydrate through
// SQLite-backed APIs instead.
export const trainerSheets: TrainerSheet[] = []

export const trainerSheetsBySlug = new Map<string, TrainerSheet>()
