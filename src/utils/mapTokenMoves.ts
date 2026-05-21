import { getPokedexEntry } from '~~/data/characterSheets'
import { explicitScriptForMove } from '~/utils/moveAutomation'
import { resolvePokemonOtherCapabilities } from '~/utils/sheets/pokemonCapabilities'
import { resolveMoveGrantedCapabilities } from '~/utils/sheets/pokemonMoveGrantedCapabilities'
import { makeAutomaticStruggleMoves } from '~/utils/struggleMoves'
import { makeMoveLookupRows, type MoveLookupRow } from '~/utils/sheetMoveLookup'
import { isPokemonLoyaltyDamageBaseMove } from '~/utils/sheets/pokemonLoyalty'
import { moveConditionUseBlock, type MoveConditionUseBlock } from '~/utils/moveConditionRestrictions'
import {
  eotMoveUsageState,
  getMapMoveUsageEntry,
  getSheetDailyMoveUsageEntry,
  limitedMoveUsageState,
  moveUsageKey,
  parseMoveFrequency,
  type MoveFrequencyKind,
} from '~/utils/moveUsage'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { MapMoveUsageState, SheetMoveUsageState } from '~/types/moveUsage'
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

export interface TokenMoveUsageMenuState {
  tracking: 'map' | 'sheet'
  frequencyKind: Extract<MoveFrequencyKind, 'eot' | 'scene' | 'daily'>
  label: string
  title: string
  available: boolean
  tone: 'available' | 'limited' | 'blocked'
  uses: number
  maxUses?: number
  remainingUses?: number
  lastUsedRound?: number | null
  nextAvailableRound?: number | null
}

export interface TokenMoveUsageContext {
  mapMoveUsage?: MapMoveUsageState
  sheetMoveUsage?: SheetMoveUsageState
  currentRound?: number | null
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
  conditionUseBlock: MoveConditionUseBlock | null
  disabledByCondition: boolean
  usage: TokenMoveUsageMenuState | null
  disabledByUsage: boolean
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

const moveHasAutomationScript = (row: MoveLookupRow<TokenSheetMove>): boolean => {
  const moveName = row.reference?.name ?? row.move.name
  if (isPokemonLoyaltyDamageBaseMove(moveName) && row.damageBase == null) return false
  return Boolean(explicitScriptForMove(moveName) ?? explicitScriptForMove(row.move.name))
}

const usageLimitTitle = (
  moveName: string,
  scope: 'Scene' | 'Daily',
  uses: number,
  maxUses: number,
  remainingUses: number,
): string => remainingUses > 0
  ? `${moveName}: ${remainingUses} of ${maxUses} ${scope} uses remaining.`
  : `${moveName}: no ${scope} uses remaining.`

export const buildTokenMoveUsageState = (
  tokenId: string,
  moveName: string,
  frequency: string | null | undefined,
  context: TokenMoveUsageContext = {},
): TokenMoveUsageMenuState | null => {
  const parsed = parseMoveFrequency(frequency)
  const moveKey = moveUsageKey(moveName)
  if (!moveKey) return null

  if (parsed.kind === 'eot') {
    const state = eotMoveUsageState(
      getMapMoveUsageEntry(context.mapMoveUsage, tokenId, moveKey),
      context.currentRound,
    )
    return {
      tracking: 'map',
      frequencyKind: 'eot',
      label: state.available ? 'EOT ready' : `EOT Round ${state.nextAvailableRound ?? '?'}`,
      title: state.available
        ? `${moveName}: EOT is available.`
        : `${moveName}: EOT is unavailable until round ${state.nextAvailableRound ?? '?'}.`,
      available: state.available,
      tone: state.available ? 'available' : 'blocked',
      uses: state.uses,
      lastUsedRound: state.lastUsedRound,
      nextAvailableRound: state.nextAvailableRound,
    }
  }

  if (parsed.kind === 'scene') {
    const maxUses = Math.max(1, parsed.usesPerPeriod ?? 1)
    const state = limitedMoveUsageState(
      getMapMoveUsageEntry(context.mapMoveUsage, tokenId, moveKey),
      maxUses,
    )
    return {
      tracking: 'map',
      frequencyKind: 'scene',
      label: `Scene ${state.remainingUses}/${state.maxUses}`,
      title: usageLimitTitle(moveName, 'Scene', state.uses, state.maxUses, state.remainingUses),
      available: state.available,
      tone: state.available ? 'limited' : 'blocked',
      uses: state.uses,
      maxUses: state.maxUses,
      remainingUses: state.remainingUses,
    }
  }

  if (parsed.kind === 'daily') {
    const maxUses = Math.max(1, parsed.usesPerPeriod ?? 1)
    const state = limitedMoveUsageState(
      getSheetDailyMoveUsageEntry(context.sheetMoveUsage, moveKey),
      maxUses,
    )
    return {
      tracking: 'sheet',
      frequencyKind: 'daily',
      label: `Daily ${state.remainingUses}/${state.maxUses}`,
      title: usageLimitTitle(moveName, 'Daily', state.uses, state.maxUses, state.remainingUses),
      available: state.available,
      tone: state.available ? 'limited' : 'blocked',
      uses: state.uses,
      maxUses: state.maxUses,
      remainingUses: state.remainingUses,
    }
  }

  return null
}

const optionForMoveRow = (
  row: MoveLookupRow<TokenSheetMove>,
  automatic: boolean,
  token: SpawnedPokemon,
  hasAutomationScript: boolean,
  usageContext: TokenMoveUsageContext = {},
): TokenMoveMenuOption => {
  const name = row.reference?.name ?? row.move.name
  const damageClass = fallback(row.reference?.damage_class, row.move.category)
  const frequency = fallback(row.reference?.frequency, row.move.frequency)
  const usage = buildTokenMoveUsageState(token.id, name, frequency, usageContext)
  const conditionUseBlock = moveConditionUseBlock({
    name,
    aliases: [row.move.name],
    damageClass,
  }, token.conditions)

  return {
    name,
    type: fallback(row.reference?.type, row.move.type),
    damageClass,
    frequency,
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
    conditionUseBlock,
    disabledByCondition: conditionUseBlock != null,
    usage,
    disabledByUsage: usage?.available === false,
  }
}

export const buildTokenMoveMenuOptions = (
  token: SpawnedPokemon,
  entries: readonly TokenSheetMoveEntry[],
  usageContext: TokenMoveUsageContext = {},
): TokenMoveMenuOption[] => {
  const rows = makeMoveLookupRows(entries.map((entry) => entry.move), {
    stabTypes: token.sheetKind === 'pokemon' ? token.defenderTypes : [],
    physicalAttack: token.atk,
    specialAttack: token.satk,
    physicalAttackStage: token.combatStages.atk,
    specialAttackStage: token.combatStages.satk,
    abilities: token.abilityNames,
    combatSkillRankValue: token.combatSkillRankValue,
    loyalty: token.sheetKind === 'pokemon' ? token.loyalty : undefined,
  })
  return rows
    .map((row, index) => ({ row, automatic: entries[index]?.automatic ?? false }))
    .map(({ row, automatic }) => optionForMoveRow(row, automatic, token, moveHasAutomationScript(row), usageContext))
}
