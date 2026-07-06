import {
  initiativeOrderIds,
  normalizeInitiativeValue,
  type InitiativeOrderEntry,
} from '#shared/initiativeOrder'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
import {
  conditionAdjustedCombatStage,
  conditionAdjustedInitiative,
} from '~/utils/sheetConditionEffects'
import { sheetAbilityNames } from '~/utils/sheetAbilities'
import { sheetItemsInitiativeBonus } from '~/utils/sheetHeldItemEffects'
import { pokemonHeldItemNames, trainerEquippedItemNames } from '~/utils/sheetItemNames'
import { pokemonTrainingFeatureInitiativeBonus } from '~/utils/sheets/pokemonTrainingFeatures'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerStats } from '~/utils/sheets/trainerDerived'
import { deriveTrainerAutomaticAbilities } from '~/utils/sheets/trainerCombatDerivations'
import { mergeLegacyConditions } from '~/utils/statusConditions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface InitiativeSheetReadResult {
  readonly path?: string
  readonly sheet: Record<string, unknown>
}

export type InitiativeSheetReader = (
  kind: SheetKind,
  slug: string,
) => InitiativeSheetReadResult | null

const nonEmptyString = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

const rawString = (value: unknown): string | null => (
  typeof value === 'string' ? value : null
)

const speedTotal = (
  rows: ReadonlyArray<{ readonly key: string; readonly total: number }>,
): number => rows.find((row) => row.key === 'spd')?.total ?? 0

const fallbackPlacementDisplayName = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): string => `${placement.sheetKind}:${placement.sheetSlug}`

export const fallbackInitiativeOrderEntry = (
  placement: SheetPlacement,
): InitiativeOrderEntry => {
  const initiative = normalizeInitiativeValue(placement.initiative)
  return {
    id: placement.id,
    displayName: fallbackPlacementDisplayName(placement),
    hasExplicitInitiative: initiative !== null,
    initiativeScore: initiative ?? 0,
  }
}

const pokemonAbilityNames = (sheet: CharacterSheet): string[] => sheetAbilityNames(sheet.abilities)

const trainerAbilityNames = (sheet: TrainerSheet): string[] => sheetAbilityNames([
  ...deriveTrainerAutomaticAbilities(sheet).map((ability) => ability.entry),
  ...(sheet.abilities ?? []),
])

const pokemonConditions = (sheet: CharacterSheet): string[] =>
  mergeLegacyConditions(sheet.combat?.conditions, sheet.combat?.statusAfflictions)

const trainerConditions = (sheet: TrainerSheet): string[] =>
  mergeLegacyConditions(sheet.conditions, sheet.statusAfflictions)

const pokemonDisplayName = (
  sheet: CharacterSheet,
  placement: Pick<SheetPlacement, 'sheetSlug'>,
): string => rawString(sheet.nickname)
  ?? nonEmptyString(sheet.species)
  ?? placement.sheetSlug

const trainerDisplayName = (
  sheet: TrainerSheet,
  placement: Pick<SheetPlacement, 'sheetSlug'>,
): string => rawString(sheet.name) ?? placement.sheetSlug

export const pokemonInitiativeOrderEntry = (
  placement: SheetPlacement,
  sheet: CharacterSheet,
): InitiativeOrderEntry => {
  const conditions = pokemonConditions(sheet)
  const abilities = pokemonAbilityNames(sheet)
  const baseSpeed = speedTotal(resolveStats(sheet))
  const speedCombatStage = conditionAdjustedCombatStage(
    sheet.stats?.spd?.stage,
    conditions,
    'spd',
    { abilities },
  )
  const speed = applyCombatStageToStat(baseSpeed, speedCombatStage)
  const initiativeItemBonus = sheetItemsInitiativeBonus(pokemonHeldItemNames(sheet))
  const initiativeTrainingBonus = pokemonTrainingFeatureInitiativeBonus(sheet.activeTrainingFeature)
  const baseInitiative = speed + initiativeItemBonus + initiativeTrainingBonus
  const initiative = normalizeInitiativeValue(placement.initiative)

  return {
    id: placement.id,
    displayName: pokemonDisplayName(sheet, placement),
    hasExplicitInitiative: initiative !== null,
    initiativeScore: conditionAdjustedInitiative(
      initiative ?? baseInitiative,
      conditions,
      { abilities },
    ),
  }
}

export const trainerInitiativeOrderEntry = (
  placement: SheetPlacement,
  sheet: TrainerSheet,
): InitiativeOrderEntry => {
  const conditions = trainerConditions(sheet)
  const abilities = trainerAbilityNames(sheet)
  const baseSpeed = speedTotal(resolveTrainerStats(sheet))
  const speedCombatStage = conditionAdjustedCombatStage(
    sheet.stats?.spd?.stage ?? sheet.combatStages?.spd,
    conditions,
    'spd',
    { abilities },
  )
  const speed = applyCombatStageToStat(baseSpeed, speedCombatStage)
  const initiativeItemBonus = sheetItemsInitiativeBonus(trainerEquippedItemNames(sheet))
  const initiative = normalizeInitiativeValue(placement.initiative)

  return {
    id: placement.id,
    displayName: trainerDisplayName(sheet, placement),
    hasExplicitInitiative: initiative !== null,
    initiativeScore: conditionAdjustedInitiative(
      initiative ?? (speed + initiativeItemBonus),
      conditions,
      { abilities },
    ),
  }
}

export const initiativeOrderEntryForPlacement = (
  placement: SheetPlacement,
  readSheet: InitiativeSheetReader,
): InitiativeOrderEntry => {
  try {
    const result = readSheet(placement.sheetKind, placement.sheetSlug)
    if (!result) return fallbackInitiativeOrderEntry(placement)
    return placement.sheetKind === 'pokemon'
      ? pokemonInitiativeOrderEntry(placement, result.sheet as unknown as CharacterSheet)
      : trainerInitiativeOrderEntry(placement, result.sheet as unknown as TrainerSheet)
  } catch {
    return fallbackInitiativeOrderEntry(placement)
  }
}

export const initiativeOrderEntriesForPlacements = (
  placements: readonly SheetPlacement[],
  readSheet: InitiativeSheetReader,
): InitiativeOrderEntry[] => placements.map((placement) => initiativeOrderEntryForPlacement(placement, readSheet))

export const initiativeOrderIdsForPlacements = (
  placements: readonly SheetPlacement[],
  readSheet: InitiativeSheetReader,
  manualOrderIds?: readonly string[] | null,
): string[] => initiativeOrderIds(
  initiativeOrderEntriesForPlacements(placements, readSheet),
  manualOrderIds,
)
