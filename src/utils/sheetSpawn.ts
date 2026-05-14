/**
 * Helpers for spawning a sheet (Pokémon or trainer) onto a tabletop map.
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
import { getPokedexEntry } from '~~/data/characterSheets'
import { computeMaxHp, resolveCapabilities, resolveStats } from '~/utils/sheets/pokemonDerived'
import { computeTrainerMaxHp, resolveTrainerCapabilities, resolveTrainerStats } from '~/utils/sheets/trainerDerived'
import { pokemonCatalog, pokemonCatalogBySpecies } from '~~/data/pokemonCatalog'
import { trainerCatalog } from '~~/data/trainerCatalog'
import { COMBAT_STAT_STAGE_KEYS, normalizeCombatStages } from '~/utils/combatStages'
import { mergeLegacyConditions } from '~/utils/statusConditions'
import { clampHpValue } from '~/utils/ptuHp'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { PokemonCatalogEntry } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const trainerCatalogBySpriteUrl = new Map(
  trainerCatalog.map((entry) => [entry.spriteUrl, entry]),
)

const trainerCatalogByLowerName = new Map(
  trainerCatalog.map((entry) => [entry.species.toLowerCase(), entry]),
)

type DefenderCapabilities = { sky?: number; levitate?: number }
type CapabilityNumberRow = { label: string; value: number | string }

const resolvedCapabilityNumber = (
  rows: readonly CapabilityNumberRow[],
  label: string,
): number | undefined => {
  const value = rows.find((row) => row.label === label)?.value
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined
  if (typeof value !== 'string') return undefined

  const parsed = Number.parseFloat(value.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const defenderCapabilitiesFromRows = (rows: readonly CapabilityNumberRow[]): DefenderCapabilities | undefined => {
  const sky = resolvedCapabilityNumber(rows, 'Sky')
  const levitate = resolvedCapabilityNumber(rows, 'Levitate')
  const capabilities: DefenderCapabilities = {}
  if (sky != null) capabilities.sky = sky
  if (levitate != null) capabilities.levitate = levitate

  return sky || levitate ? capabilities : undefined
}

const pokemonDefenderCapabilities = (sheet: CharacterSheet): DefenderCapabilities | undefined =>
  defenderCapabilitiesFromRows(resolveCapabilities(sheet).rows)

const trainerDefenderCapabilities = (sheet: TrainerSheet): DefenderCapabilities | undefined =>
  defenderCapabilitiesFromRows(resolveTrainerCapabilities(sheet).rows)

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

/** Pokémon HP + offence/defence + type/capability snapshot. Max HP is derived and injury-adjusted. */
export const pokemonHpSnapshot = (
  sheet: CharacterSheet,
): {
  currentHp: number
  maxHp: number
  atk: number
  satk: number
  def: number
  sdef: number
  defenderTypes: string[]
  defenderCapabilities?: DefenderCapabilities
  combatStages: CombatStageMap
  conditions: string[]
} => {
  const stats = resolveStats(sheet)
  const hpTotal = stats.find((row) => row.key === 'hp')?.total ?? 0
  const maxHp = computeMaxHp(sheet, hpTotal)
  const currentHp = clampHpValue(sheet.combat?.currentHp ?? maxHp, maxHp)
  const atk = stats.find((row) => row.key === 'atk')?.total ?? 0
  const satk = stats.find((row) => row.key === 'satk')?.total ?? 0
  const def = stats.find((row) => row.key === 'def')?.total ?? 0
  const sdef = stats.find((row) => row.key === 'sdef')?.total ?? 0
  const species = getPokedexEntry(sheet.species)
  const defenderTypes = sheet.types ?? species?.types ?? []
  const defenderCapabilities = pokemonDefenderCapabilities(sheet)
  const combatStages = normalizeCombatStages({
    atk: sheet.stats?.atk?.stage,
    def: sheet.stats?.def?.stage,
    satk: sheet.stats?.satk?.stage,
    sdef: sheet.stats?.sdef?.stage,
    spd: sheet.stats?.spd?.stage,
    acc: sheet.combatStages?.acc,
  })
  const conditions = mergeLegacyConditions(sheet.combat?.conditions, sheet.combat?.statusAfflictions)
  return { currentHp, maxHp, atk, satk, def, sdef, defenderTypes, defenderCapabilities, combatStages, conditions }
}

/** Trainer HP + offence/defence + capability snapshot. Max HP is derived and injury-adjusted; trainers have no defending types. */
export const trainerHpSnapshot = (
  sheet: TrainerSheet,
): {
  currentHp: number
  maxHp: number
  atk: number
  satk: number
  def: number
  sdef: number
  defenderTypes: string[]
  defenderCapabilities?: DefenderCapabilities
  combatStages: CombatStageMap
  conditions: string[]
} => {
  const maxHp = computeTrainerMaxHp(sheet)
  const currentHp = clampHpValue(sheet.currentHp ?? maxHp, maxHp)
  const stats = resolveTrainerStats(sheet)
  const atk = stats.find((row) => row.key === 'atk')?.total ?? 0
  const satk = stats.find((row) => row.key === 'satk')?.total ?? 0
  const def = stats.find((row) => row.key === 'def')?.total ?? 0
  const sdef = stats.find((row) => row.key === 'sdef')?.total ?? 0
  const defenderCapabilities = trainerDefenderCapabilities(sheet)
  const stageSource = Object.fromEntries(
    COMBAT_STAT_STAGE_KEYS.map((key) => [key, sheet.stats?.[key]?.stage ?? sheet.combatStages?.[key]]),
  )
  const combatStages = normalizeCombatStages({ ...stageSource, acc: sheet.combatStages?.acc })
  const conditions = mergeLegacyConditions(sheet.conditions, sheet.statusAfflictions)
  return { currentHp, maxHp, atk, satk, def, sdef, defenderTypes: [], defenderCapabilities, combatStages, conditions }
}

// Re-export so callers don't have to import the catalog directly.
export { pokemonCatalog, trainerCatalog }
