import {
  initiativeOrderIds,
  normalizeInitiativeValue,
  type InitiativeOrderDirection,
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
  /** Authoritative revision when the reader can provide one. */
  readonly revision?: number
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

export interface InitiativeOrderEntryOptions {
  /** Server-owned Magic Room query result for this placement's relevant item scope. */
  readonly itemEffectsSuppressed?: boolean
  /** Exact authoritative static multiplier; defaults to one for presentation-only callers. */
  readonly initiativeMultiplier?: 1 | 2
}

export const pokemonInitiativeOrderEntry = (
  placement: SheetPlacement,
  sheet: CharacterSheet,
  options: InitiativeOrderEntryOptions = {},
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
  const initiativeItemBonus = options.itemEffectsSuppressed
    ? 0
    : sheetItemsInitiativeBonus(pokemonHeldItemNames(sheet))
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
    ) * (options.initiativeMultiplier ?? 1),
  }
}

export const trainerInitiativeOrderEntry = (
  placement: SheetPlacement,
  sheet: TrainerSheet,
  options: InitiativeOrderEntryOptions = {},
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
  const initiativeItemBonus = sheetItemsInitiativeBonus(trainerEquippedItemNames(
    sheet,
    { includeAccessory: !options.itemEffectsSuppressed },
  ))
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
  options: InitiativeOrderEntryOptions = {},
): InitiativeOrderEntry => {
  try {
    const result = readSheet(placement.sheetKind, placement.sheetSlug)
    if (!result) return fallbackInitiativeOrderEntry(placement)
    return placement.sheetKind === 'pokemon'
      ? pokemonInitiativeOrderEntry(placement, result.sheet as unknown as CharacterSheet, options)
      : trainerInitiativeOrderEntry(placement, result.sheet as unknown as TrainerSheet, options)
  } catch {
    return fallbackInitiativeOrderEntry(placement)
  }
}

export const initiativeOrderEntriesForPlacements = (
  placements: readonly SheetPlacement[],
  readSheet: InitiativeSheetReader,
  optionsForPlacement?: (placement: SheetPlacement) => InitiativeOrderEntryOptions,
): InitiativeOrderEntry[] => placements.map((placement) => initiativeOrderEntryForPlacement(
  placement,
  readSheet,
  optionsForPlacement?.(placement),
))

export const initiativeOrderIdsForPlacements = (
  placements: readonly SheetPlacement[],
  readSheet: InitiativeSheetReader,
  manualOrderIds?: readonly string[] | null,
  direction: InitiativeOrderDirection = 'highest-first',
  optionsForPlacement?: (placement: SheetPlacement) => InitiativeOrderEntryOptions,
): string[] => initiativeOrderIds(
  initiativeOrderEntriesForPlacements(placements, readSheet, optionsForPlacement),
  manualOrderIds,
  direction,
)
