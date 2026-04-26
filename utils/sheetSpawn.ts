/**
 * Helpers for spawning a sheet (Pokémon or trainer) onto the tabletop grid.
 *
 * A spawned token bundles three things:
 *   1. The *catalog entry* (sprite URL + footprint dimensions). Pokémon are
 *      keyed by species; trainers by sprite-URL match against `portraitUrl`,
 *      with a name fallback so freshly-authored sheets still spawn.
 *   2. The originating *sheet* (kind + slug). Stored on the token so the UI
 *      can route back to the sheet detail page or compute live values.
 *   3. A *HP snapshot* at spawn time. PTU formulas are layered through
 *      `resolveStats` / `computeMaxHp` (Pokémon) and the trainer equivalents.
 */
import { computeMaxHp, resolveStats } from '~/data/characterSheets'
import { computeTrainerMaxHp } from '~/data/trainerSheets'
import { pokemonCatalog, pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import { trainerCatalog } from '~/data/trainerCatalog'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PokemonCatalogEntry } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const trainerCatalogBySpriteUrl = new Map(
  trainerCatalog.map((entry) => [entry.spriteUrl, entry]),
)

const trainerCatalogByLowerName = new Map(
  trainerCatalog.map((entry) => [entry.species.toLowerCase(), entry]),
)

/** Resolve the catalog entry whose footprint a Pokémon sheet should use. */
export const catalogEntryForPokemonSheet = (
  sheet: CharacterSheet,
): PokemonCatalogEntry | null => pokemonCatalogBySpecies.get(sheet.species) ?? null

/**
 * Resolve the catalog entry that supplies a trainer sheet's sprite +
 * footprint. The picker stores the chosen sprite as `portraitUrl`, so a
 * URL match is the most reliable lookup; we fall back to a case-insensitive
 * name match (handy for freshly-authored sheets that haven't picked a
 * portrait yet) and finally to the first catalog entry as a last resort.
 */
export const catalogEntryForTrainerSheet = (
  sheet: TrainerSheet,
): PokemonCatalogEntry | null => {
  if (sheet.portraitUrl) {
    const byUrl = trainerCatalogBySpriteUrl.get(sheet.portraitUrl)
    if (byUrl) return byUrl
  }
  const byName = trainerCatalogByLowerName.get(sheet.name.toLowerCase())
  if (byName) return byName
  return trainerCatalog[0] ?? null
}

/** Pokémon current HP — sheet override > computed max HP. */
export const pokemonHpSnapshot = (
  sheet: CharacterSheet,
): { currentHp: number; maxHp: number } => {
  const stats = resolveStats(sheet)
  const hpTotal = stats.find((row) => row.key === 'hp')?.total ?? 0
  const maxHp = computeMaxHp(sheet, hpTotal)
  const currentHp = sheet.combat?.currentHp ?? maxHp
  return { currentHp, maxHp }
}

/** Trainer current HP — sheet override > computed max HP. */
export const trainerHpSnapshot = (
  sheet: TrainerSheet,
): { currentHp: number; maxHp: number } => {
  const maxHp = computeTrainerMaxHp(sheet)
  const currentHp = sheet.currentHp ?? maxHp
  return { currentHp, maxHp }
}

// Re-export so callers don't have to import the catalog directly.
export { pokemonCatalog, trainerCatalog }
