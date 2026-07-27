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
import pokedexData from '~~/data/reference/pokedex.json'
import { computeFullMaxHp, computeMaxHp, resolveCapabilities, resolveSkills, resolveStats, type ResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { computeTrainerFullMaxHp, computeTrainerMaxHp, resolveTrainerCapabilities, resolveTrainerSkills, resolveTrainerStats, type TrainerCapabilityRow } from '~/utils/sheets/trainerDerived'
import { pokemonCatalog, pokemonCatalogBySpecies } from '~~/data/pokemonCatalog'
import { trainerCatalog } from '~~/data/trainerCatalog'
import { COMBAT_STAT_STAGE_KEYS, normalizeCombatStages } from '~/utils/combatStages'
import { scaleTrainerSpriteToSheetHeight } from '~/utils/trainerSpriteScaling'
import { normalizeConditionNames } from '~/utils/statusConditions'
import {
  pokemonSheetConditionNames,
  trainerSheetConditionNames,
} from '~/utils/sheetConditions'
import { clampHpValue, normalizeInjuryCount } from '~/utils/ptuHp'
import { parseSkillDiceRankValue } from '~/utils/skillRanks'
import {
  pokemonEvasionModifiers,
  trainerEvasionModifiers,
} from '~/utils/sheetEvasionBonuses'
import {
  normalizePokemonTrainingFeatureName,
  pokemonTrainingFeatureAccuracyRollBonus,
} from '~/utils/sheets/pokemonTrainingFeatures'
import { adjustedSheetMovementCapabilityValue } from '~/utils/sheets/movementCapabilityAdjustments'
import { normalizePokemonLoyalty } from '~/utils/sheets/pokemonLoyalty'
import { movementCapabilityKeyFromLabel, normalizeMovementCapabilitySpeed } from '~/utils/movementCapabilities'
import type { CharacterSheet, CharacterSheetSkills } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  MovementCapabilitySpeeds,
  MovementCapabilityTraits,
  MovementJumpCapability,
} from '~/types/movement'
import type { PokedexRecord, PokemonCatalogEntry } from '~/types/pokemon'
import type { TrainerSheet, TrainerSkillKey } from '~/types/trainerSheet'

const trainerCatalogBySpriteUrl = new Map(
  trainerCatalog.map((entry) => [entry.spriteUrl, entry]),
)

const pokedexBySpecies = new Map<string, PokedexRecord>(
  (pokedexData as PokedexRecord[]).map((entry) => [entry.species, entry]),
)

const getPokedexEntryForSpawnSnapshot = (species: string): PokedexRecord | null =>
  pokedexBySpecies.get(species) ?? null

const trainerCatalogByLowerName = new Map(
  trainerCatalog.map((entry) => [entry.species.toLowerCase(), entry]),
)

type DefenderCapabilities = { sky?: number; levitate?: number }
type CapabilityNumberRow = Pick<ResolvedCapability | TrainerCapabilityRow, 'label' | 'value'>

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

const movementCapabilitiesFromRows = (
  rows: readonly CapabilityNumberRow[],
  conditions: readonly string[] | null | undefined,
  trainingFeature: unknown,
  speedCombatStage: unknown,
  otherCapabilities: readonly string[],
): MovementCapabilitySpeeds => {
  const capabilities: MovementCapabilitySpeeds = {}

  for (const row of rows) {
    const key = movementCapabilityKeyFromLabel(row.label)
    if (!key) continue
    const adjustedValue = adjustedSheetMovementCapabilityValue(
      row.label,
      row.value,
      conditions,
      trainingFeature,
      speedCombatStage,
    )
    const speed = normalizeMovementCapabilitySpeed(adjustedValue)
    if (speed != null) capabilities[key] = speed
  }

  const normalizedOther = otherCapabilities.map(capability => capability.trim().replace(/\s+/g, ' '))
  const wallclimber = normalizedOther.some(capability => capability.toLowerCase() === 'wallclimber')
  if (wallclimber && capabilities.overland !== undefined) {
    capabilities.climb = Math.floor(capabilities.overland / 2)
  }
  const teleporter = normalizedOther.flatMap(capability => {
    const match = /^Teleporter\s+(\d+)$/i.exec(capability)
    return match?.[1] ? [Number.parseInt(match[1], 10)] : []
  })[0]
  if (teleporter !== undefined) capabilities.teleporter = teleporter
  return capabilities
}

const nonNegativeInteger = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0
)

const movementJumpFromRows = (
  rows: readonly CapabilityNumberRow[],
): MovementJumpCapability => {
  const combined = rows.find(row => row.label === 'Jump')?.value
  if (typeof combined === 'string') {
    const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(combined)
    if (match) {
      return {
        long: Number.parseInt(match[1] ?? '0', 10),
        high: Number.parseInt(match[2] ?? '0', 10),
      }
    }
  }
  return {
    long: nonNegativeInteger(rows.find(row => row.label === 'Long Jump')?.value),
    high: nonNegativeInteger(rows.find(row => row.label === 'High Jump')?.value),
  }
}

const movementTraitsFromRows = (
  rows: readonly CapabilityNumberRow[],
  otherCapabilities: readonly string[],
): MovementCapabilityTraits => ({
  phasing: otherCapabilities.some(
    capability => capability.trim().replace(/\s+/g, ' ').toLowerCase() === 'phasing',
  ),
  jump: movementJumpFromRows(rows),
})

type ResolvedPokemonSkills = ReturnType<typeof resolveSkills>

type ResolvedTrainerSkills = ReturnType<typeof resolveTrainerSkills>

const pokemonSkillRankValue = (
  skills: ResolvedPokemonSkills,
  key: keyof CharacterSheetSkills,
): number | undefined => {
  const skill = skills.find((row) => row.key === key)?.value
  return parseSkillDiceRankValue(skill) ?? undefined
}

const trainerSkillRankValue = (skills: ResolvedTrainerSkills, key: TrainerSkillKey): number | undefined =>
  skills.find((skill) => skill.key === key)?.rankValue

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
const rawCatalogEntryForTrainerSheet = (sheet: TrainerSheet): PokemonCatalogEntry | null => {
  if (sheet.portraitUrl) {
    const byUrl = trainerCatalogBySpriteUrl.get(sheet.portraitUrl)
    if (byUrl) return byUrl
  }
  const byName = trainerCatalogByLowerName.get(sheet.name.toLowerCase())
  if (byName) return byName
  return trainerCatalog[0] ?? null
}

export const catalogEntryForTrainerSheet = (
  sheet: TrainerSheet,
): PokemonCatalogEntry | null => {
  const catalogEntry = rawCatalogEntryForTrainerSheet(sheet)
  return catalogEntry ? scaleTrainerSpriteToSheetHeight(catalogEntry, sheet.height) : null
}

/** Pokémon HP + offence/defence + type/airborne-capability snapshot. Max HP is derived and injury-adjusted. */
export interface SheetSnapshotConditionOptions {
  /** Effective-condition override; omission reads only the persistent sheet layer. */
  readonly conditions?: readonly unknown[]
}

export const pokemonHpSnapshot = (
  sheet: CharacterSheet,
  options: SheetSnapshotConditionOptions = {},
): {
  currentHp: number
  maxHp: number
  fullMaxHp: number
  injuries: number
  atk: number
  satk: number
  def: number
  sdef: number
  spd: number
  evasion: ReturnType<typeof pokemonEvasionModifiers>
  defenderTypes: string[]
  movementCapabilities: MovementCapabilitySpeeds
  movementTraits: MovementCapabilityTraits
  defenderCapabilities?: DefenderCapabilities
  combatSkillRankValue?: number
  focusSkillRankValue?: number
  combatStages: CombatStageMap
  conditions: string[]
  loyalty?: number
  activeTrainingFeature?: string
  accuracyRollBonus?: number
} => {
  const stats = resolveStats(sheet)
  const hpTotal = stats.find((row) => row.key === 'hp')?.total ?? 0
  const fullMaxHp = computeFullMaxHp(sheet, hpTotal)
  const injuries = normalizeInjuryCount(sheet.combat?.injuries)
  const maxHp = computeMaxHp(sheet, hpTotal)
  const currentHp = clampHpValue(sheet.combat?.currentHp ?? maxHp, maxHp)
  const atk = stats.find((row) => row.key === 'atk')?.total ?? 0
  const satk = stats.find((row) => row.key === 'satk')?.total ?? 0
  const def = stats.find((row) => row.key === 'def')?.total ?? 0
  const sdef = stats.find((row) => row.key === 'sdef')?.total ?? 0
  const spd = stats.find((row) => row.key === 'spd')?.total ?? 0
  const evasion = pokemonEvasionModifiers(sheet)
  const species = getPokedexEntryForSpawnSnapshot(sheet.species)
  const defenderTypes = sheet.types ?? species?.types ?? []
  const resolvedCapabilities = resolveCapabilities(sheet)
  const capabilityRows = resolvedCapabilities.rows
  const defenderCapabilities = defenderCapabilitiesFromRows(capabilityRows)
  const combatStages = normalizeCombatStages({
    atk: sheet.stats?.atk?.stage,
    def: sheet.stats?.def?.stage,
    satk: sheet.stats?.satk?.stage,
    sdef: sheet.stats?.sdef?.stage,
    spd: sheet.stats?.spd?.stage,
    acc: sheet.combatStages?.acc,
  })
  const conditions = options.conditions === undefined
    ? pokemonSheetConditionNames(sheet)
    : normalizeConditionNames(options.conditions)
  const skillRows = resolveSkills(sheet)
  const activeTrainingFeature = normalizePokemonTrainingFeatureName(sheet.activeTrainingFeature) ?? undefined
  const accuracyRollBonus = pokemonTrainingFeatureAccuracyRollBonus(activeTrainingFeature)
  const movementCapabilities = movementCapabilitiesFromRows(
    capabilityRows,
    conditions,
    activeTrainingFeature,
    combatStages.spd,
    resolvedCapabilities.other,
  )
  const movementTraits = movementTraitsFromRows(
    capabilityRows,
    resolvedCapabilities.other,
  )
  const loyalty = normalizePokemonLoyalty(sheet.loyalty)
  return {
    currentHp,
    maxHp,
    fullMaxHp,
    injuries,
    atk,
    satk,
    def,
    sdef,
    spd,
    evasion,
    defenderTypes,
    movementCapabilities,
    movementTraits,
    defenderCapabilities,
    combatSkillRankValue: pokemonSkillRankValue(skillRows, 'combat'),
    focusSkillRankValue: pokemonSkillRankValue(skillRows, 'focus'),
    combatStages,
    conditions,
    ...(loyalty != null ? { loyalty } : {}),
    ...(activeTrainingFeature ? { activeTrainingFeature } : {}),
    ...(accuracyRollBonus ? { accuracyRollBonus } : {}),
  }
}

/** Trainer HP + offence/defence + airborne-capability snapshot. Max HP is derived and injury-adjusted; trainers have no defending types. */
export const trainerHpSnapshot = (
  sheet: TrainerSheet,
  options: SheetSnapshotConditionOptions = {},
): {
  currentHp: number
  maxHp: number
  fullMaxHp: number
  injuries: number
  atk: number
  satk: number
  def: number
  sdef: number
  spd: number
  evasion: ReturnType<typeof trainerEvasionModifiers>
  defenderTypes: string[]
  movementCapabilities: MovementCapabilitySpeeds
  movementTraits: MovementCapabilityTraits
  defenderCapabilities?: DefenderCapabilities
  combatSkillRankValue?: number
  focusSkillRankValue?: number
  combatStages: CombatStageMap
  conditions: string[]
} => {
  const fullMaxHp = computeTrainerFullMaxHp(sheet)
  const injuries = normalizeInjuryCount(sheet.currentInjuries)
  const maxHp = computeTrainerMaxHp(sheet)
  const currentHp = clampHpValue(sheet.currentHp ?? maxHp, maxHp)
  const stats = resolveTrainerStats(sheet)
  const atk = stats.find((row) => row.key === 'atk')?.total ?? 0
  const satk = stats.find((row) => row.key === 'satk')?.total ?? 0
  const def = stats.find((row) => row.key === 'def')?.total ?? 0
  const sdef = stats.find((row) => row.key === 'sdef')?.total ?? 0
  const spd = stats.find((row) => row.key === 'spd')?.total ?? 0
  const evasion = trainerEvasionModifiers(sheet)
  const resolvedCapabilities = resolveTrainerCapabilities(sheet)
  const capabilityRows = resolvedCapabilities.rows
  const defenderCapabilities = defenderCapabilitiesFromRows(capabilityRows)
  const stageSource = Object.fromEntries(
    COMBAT_STAT_STAGE_KEYS.map((key) => [key, sheet.stats?.[key]?.stage ?? sheet.combatStages?.[key]]),
  )
  const combatStages = normalizeCombatStages({ ...stageSource, acc: sheet.combatStages?.acc })
  const conditions = options.conditions === undefined
    ? trainerSheetConditionNames(sheet)
    : normalizeConditionNames(options.conditions)
  const skillRows = resolveTrainerSkills(sheet)
  const movementCapabilities = movementCapabilitiesFromRows(
    capabilityRows,
    conditions,
    undefined,
    combatStages.spd,
    resolvedCapabilities.other,
  )
  const movementTraits = movementTraitsFromRows(
    capabilityRows,
    resolvedCapabilities.other,
  )
  return {
    currentHp,
    maxHp,
    fullMaxHp,
    injuries,
    atk,
    satk,
    def,
    sdef,
    spd,
    evasion,
    defenderTypes: [],
    movementCapabilities,
    movementTraits,
    defenderCapabilities,
    combatSkillRankValue: trainerSkillRankValue(skillRows, 'combat'),
    focusSkillRankValue: trainerSkillRankValue(skillRows, 'focus'),
    combatStages,
    conditions,
  }
}

// Re-export so callers don't have to import the catalog directly.
export { pokemonCatalog, trainerCatalog }
