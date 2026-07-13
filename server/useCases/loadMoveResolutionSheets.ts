import type { PendingMoveResolutionResourceRead } from '#shared/moveAutomation/pendingResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PersistedSheet } from '../storage/sheetRepository'
import { AUTHORITATIVE_SWITCH_CHOICE_LIMITS } from '../domain/moveAutomation/switchChoices'

export interface MoveResolutionSheetReader {
  getByRef(kind: SheetKind, slug: string): PersistedSheet | null
}

export interface LoadedMoveResolutionSheets {
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}

const persistedSheetRecord = (sheet: PersistedSheet): Record<string, unknown> => ({
  ...sheet.sheet,
  slug: sheet.slug,
  revision: sheet.revision,
  updatedAt: sheet.updatedAt,
})

const refKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

/**
 * Load placement sheets plus bounded on-map trainer teams. Pending continuations
 * additionally reload their exact durable sheet read set. This keeps off-map
 * replacement sheets server-owned without broad catalog or client reads.
 */
export const loadMoveResolutionSheets = (input: {
  readonly map: TabletopMap
  readonly sheetRepository: MoveResolutionSheetReader
  readonly durableReads?: readonly PendingMoveResolutionResourceRead[]
}): LoadedMoveResolutionSheets => {
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  const attempted = new Set<string>()

  const load = (kind: SheetKind, slug: string): void => {
    const key = refKey(kind, slug)
    if (attempted.has(key)) return
    attempted.add(key)
    const stored = input.sheetRepository.getByRef(kind, slug)
    if (!stored) return
    const sheet = persistedSheetRecord(stored)
    if (kind === 'pokemon') pokemonSheets.set(slug, sheet as unknown as CharacterSheet)
    else trainerSheets.set(slug, sheet as unknown as TrainerSheet)
  }

  for (const placement of input.map.placements) {
    load(placement.sheetKind, placement.sheetSlug)
  }
  for (const read of input.durableReads ?? []) {
    if (read.kind === 'sheet') load(read.sheetKind, read.slug)
  }

  const onMapTrainerSlugs = new Set(input.map.placements.flatMap(placement => (
    placement.sheetKind === 'trainer' ? [placement.sheetSlug] : []
  )))
  for (const trainerSlug of onMapTrainerSlugs) {
    const trainer = trainerSheets.get(trainerSlug)
    if (!trainer || !Array.isArray(trainer.currentTeam)) continue
    for (const slug of trainer.currentTeam.slice(
      0,
      AUTHORITATIVE_SWITCH_CHOICE_LIMITS.rosterEntries + 1,
    )) {
      if (typeof slug === 'string' && slug.trim()) load('pokemon', slug.trim())
    }
  }

  return { pokemonSheets, trainerSheets }
}
