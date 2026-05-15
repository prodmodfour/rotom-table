import { getPokedexEntry } from '~~/data/characterSheets'
import { makeAutomaticStruggleMoves } from '~/utils/struggleMoves'
import { makeMoveLookupRows, type MoveLookupRow } from '~/utils/sheetMoveLookup'
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
}

const pokemonStruggleCapabilities = (sheet: CharacterSheet): string[] => {
  const species = getPokedexEntry(sheet.species)
  return [
    ...(species?.capabilities?.other ?? []),
    ...(sheet.capabilities?.other ?? []),
  ]
}

const trainerStruggleCapabilities = (sheet: TrainerSheet): string[] => [
  ...(sheet.capabilities?.other ?? []),
]

export const pokemonMoveEntriesForSheet = (sheet: CharacterSheet): TokenSheetMoveEntry[] => [
  ...(sheet.movelist ?? []).map((move) => ({ move, automatic: false })),
  ...makeAutomaticStruggleMoves(pokemonStruggleCapabilities(sheet), sheet.movelist)
    .map((move) => ({ move, automatic: true })),
]

export const trainerMoveEntriesForSheet = (sheet: TrainerSheet): TokenSheetMoveEntry[] => [
  ...(sheet.movelist ?? []).map((move) => ({ move, automatic: false })),
  ...makeAutomaticStruggleMoves<TrainerMove>(trainerStruggleCapabilities(sheet), sheet.movelist)
    .map((move) => ({ move, automatic: true })),
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

const optionForMoveRow = (
  row: MoveLookupRow<TokenSheetMove>,
  automatic: boolean,
): TokenMoveMenuOption => ({
  name: row.reference?.name ?? row.move.name,
  type: fallback(row.reference?.type, row.move.type),
  damageClass: fallback(row.reference?.damage_class, row.move.category),
  frequency: fallback(row.reference?.frequency, row.move.frequency),
  ac: fallback(row.reference?.ac, row.move.ac),
  range: fallback(row.reference?.range, row.move.range),
  effect: fallback(row.reference?.effect, row.move.effect),
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
  })
  return rows.map((row, index) => optionForMoveRow(row, entries[index]?.automatic ?? false))
}
