import { getPokedexEntry } from '~~/data/characterSheets'
import { explicitScriptForMove } from '~/utils/moveAutomation'
import { resolvePokemonOtherCapabilities } from '~/utils/sheets/pokemonCapabilities'
import { resolveMoveGrantedCapabilities } from '~/utils/sheets/pokemonMoveGrantedCapabilities'
import { makeAutomaticStruggleMoves } from '~/utils/struggleMoves'
import { makeMoveLookupRows, type MoveLookupRow } from '~/utils/sheetMoveLookup'
import { isMoveDisabledByConditions } from '~/utils/statusConditions'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerMove, TrainerSheet } from '~/types/trainerSheet'

export type TokenSheetMove = CharacterSheetMove | TrainerMove

export interface TokenSheetMoveEntry {
  move: TokenSheetMove
  automatic: boolean
}

export interface MapTokenSheetLookup {
  pokemon?: Map<string, CharacterSheet>
  trainer?: Map<string, TrainerSheet>
}

export interface TokenMoveMenuOption {
  name: string
  type: string | null
  damageClass: string | null
  frequency: string | null
  ac: number | string | null
  range: string | null
  effect: string | null
  special: string | null
  damageBase: number | null
  hasStab: boolean
  damageFormula: string | null
  attackStat: number | null
  baseAttackStat: number | null
  attackStage: number | null
  attackStatKey: 'atk' | 'satk' | null
  attackStatLabel: string | null
  attackStatAbility: string | null
  additionalAttackStat: number | null
  additionalBaseAttackStat: number | null
  additionalAttackStage: number | null
  additionalAttackStatKey: 'atk' | 'satk' | null
  additionalAttackStatLabel: string | null
  automatic: boolean
  hasAutomationScript: boolean
  disabledByCondition: boolean
}

const pokemonStruggleCapabilities = (sheet: CharacterSheet): string[] => {
  const species = getPokedexEntry(sheet.species)
  const moveGrantedCapabilities = resolveMoveGrantedCapabilities(sheet.movelist)
  return resolvePokemonOtherCapabilities(species, sheet.capabilities, {
    other: moveGrantedCapabilities.other,
    valuedBonuses: moveGrantedCapabilities.valuedOtherBonuses,
  })
}

const trainerStruggleCapabilities = (sheet: TrainerSheet): string[] => [
  ...(sheet.capabilities?.other ?? []),
]

export const pokemonMoveEntriesForSheet = (sheet: CharacterSheet): TokenSheetMoveEntry[] => [
  ...makeAutomaticStruggleMoves(pokemonStruggleCapabilities(sheet), sheet.movelist)
    .map((move) => ({ move, automatic: true })),
  ...(sheet.movelist ?? []).map((move) => ({ move, automatic: false })),
]

export const trainerMoveEntriesForSheet = (sheet: TrainerSheet): TokenSheetMoveEntry[] => [
  ...makeAutomaticStruggleMoves<TrainerMove>(trainerStruggleCapabilities(sheet), sheet.movelist)
    .map((move) => ({ move, automatic: true })),
  ...(sheet.movelist ?? []).map((move) => ({ move, automatic: false })),
]

export const moveEntriesForPlacement = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'> | null | undefined,
  sheets: MapTokenSheetLookup,
): TokenSheetMoveEntry[] => {
  if (!placement) return []
  if (placement.sheetKind === 'pokemon') {
    const sheet = sheets.pokemon?.get(placement.sheetSlug)
    return sheet ? pokemonMoveEntriesForSheet(sheet) : []
  }
  const sheet = sheets.trainer?.get(placement.sheetSlug)
  return sheet ? trainerMoveEntriesForSheet(sheet) : []
}

const fallback = <T>(...values: T[]): NonNullable<T> | null => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value as NonNullable<T>
  }
  return null
}

const moveHasAutomationScript = (row: MoveLookupRow<TokenSheetMove>): boolean =>
  Boolean(explicitScriptForMove(row.reference?.name ?? row.move.name) ?? explicitScriptForMove(row.move.name))

const optionForMoveRow = (
  row: MoveLookupRow<TokenSheetMove>,
  automatic: boolean,
  token: SpawnedPokemon,
  hasAutomationScript: boolean,
): TokenMoveMenuOption => ({
  name: row.reference?.name ?? row.move.name,
  type: fallback(row.reference?.type, row.move.type),
  damageClass: fallback(row.reference?.damage_class, row.move.category),
  frequency: fallback(row.reference?.frequency, row.move.frequency),
  ac: fallback(row.ac, row.reference?.ac, row.move.ac),
  range: fallback(row.reference?.range, row.move.range),
  effect: fallback(row.reference?.effect, row.move.effect),
  special: fallback(row.reference?.special, row.move.special),
  damageBase: row.damageBase,
  hasStab: row.hasStab,
  damageFormula: row.damageFormula,
  attackStat: row.attackStat,
  baseAttackStat: row.baseAttackStat,
  attackStage: row.attackStage,
  attackStatKey: row.attackStatKey,
  attackStatLabel: row.attackStatLabel,
  attackStatAbility: row.attackStatAbility,
  additionalAttackStat: row.additionalAttackStat,
  additionalBaseAttackStat: row.additionalBaseAttackStat,
  additionalAttackStage: row.additionalAttackStage,
  additionalAttackStatKey: row.additionalAttackStatKey,
  additionalAttackStatLabel: row.additionalAttackStatLabel,
  automatic,
  hasAutomationScript,
  disabledByCondition: isMoveDisabledByConditions(row.reference?.name ?? row.move.name, token.conditions)
    || isMoveDisabledByConditions(row.move.name, token.conditions),
})

export const buildTokenMoveMenuOptions = (
  token: SpawnedPokemon,
  entries: readonly TokenSheetMoveEntry[],
): TokenMoveMenuOption[] => {
  const rows = makeMoveLookupRows(entries.map((entry) => entry.move), {
    stabTypes: token.sheetKind === 'pokemon' ? token.defenderTypes : [],
    physicalAttack: token.atk,
    specialAttack: token.satk,
    physicalAttackStage: token.combatStages.atk,
    specialAttackStage: token.combatStages.satk,
    abilities: token.abilityNames,
    combatSkillRankValue: token.combatSkillRankValue,
  })
  return rows
    .map((row, index) => ({ row, automatic: entries[index]?.automatic ?? false }))
    .map(({ row, automatic }) => optionForMoveRow(row, automatic, token, moveHasAutomationScript(row)))
}
