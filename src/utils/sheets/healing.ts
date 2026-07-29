import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetMoveUsageState } from '~/types/moveUsage'
import type { TrainerApPool, TrainerSheet } from '~/types/trainerSheet'
import { clampHpValue, computeInjuryAdjustedMaxHp, normalizeInjuryCount } from '~/utils/ptuHp'
import { computeFullMaxHp, pokemonHasResolvedCapability, resolveStats } from '~/utils/sheets/pokemonDerived'
import { computeTrainerFullMaxHp, computeTrainerMaxAp, computeTrainerMaxHp } from '~/utils/sheets/trainerDerived'
import { resolvedStatTotal } from '~/utils/sheets/resolvedStatRows'

export const MAX_INJURIES_HEALED_PER_DAY = 3

export interface SheetHealingVitals {
  currentHp: number
  maxHp: number
  fullMaxHp: number
  injuries: number
  injuriesHealedToday: number
  injuryHealsRemainingToday: number
  maxInjuriesHealedPerDay: number
  dailyMoveUses: number
  dailyMoveCount: number
  naturalRestHp: number
}

export interface SheetHealingMutationSummary {
  hitPointsRestored: number
  injuriesHealed: number
  dailyMoveUsesCleared: number
  dailyMoveEntriesCleared: number
  conditionsCleared: number
  trainerApRestored: number
}

export const emptyHealingMutationSummary = (): SheetHealingMutationSummary => ({
  hitPointsRestored: 0,
  injuriesHealed: 0,
  dailyMoveUsesCleared: 0,
  dailyMoveEntriesCleared: 0,
  conditionsCleared: 0,
  trainerApRestored: 0,
})

export const addHealingMutationSummary = (
  target: SheetHealingMutationSummary,
  source: SheetHealingMutationSummary,
): SheetHealingMutationSummary => {
  target.hitPointsRestored += source.hitPointsRestored
  target.injuriesHealed += source.injuriesHealed
  target.dailyMoveUsesCleared += source.dailyMoveUsesCleared
  target.dailyMoveEntriesCleared += source.dailyMoveEntriesCleared
  target.conditionsCleared += source.conditionsCleared
  target.trainerApRestored += source.trainerApRestored
  return target
}

const asWholeNumber = (value: unknown): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.floor(n)
}

const nonNegativeWhole = (value: unknown): number => Math.max(0, asWholeNumber(value))

const dailyInjuryHealCount = (value: unknown): number => Math.min(MAX_INJURIES_HEALED_PER_DAY, nonNegativeWhole(value))

const dailyInjuryHealsRemaining = (value: unknown): number =>
  Math.max(0, MAX_INJURIES_HEALED_PER_DAY - dailyInjuryHealCount(value))

const positiveHealingAmount = (value: unknown): number => Math.max(0, asWholeNumber(value))

interface InjuryRemovalOptions {
  /** True for explicit GM overrides that should not consume or obey the normal daily cap. */
  ignoreDailyLimit?: boolean
  /** Set false for rule exceptions that heal Injuries but explicitly do not count against the daily cap. */
  countAgainstDailyLimit?: boolean
}

const shouldApplyDailyInjuryLimit = (options: InjuryRemovalOptions = {}): boolean =>
  !options.ignoreDailyLimit && options.countAgainstDailyLimit !== false

export const healingFractionAmount = (fullMaxHp: number, denominator: number): number => {
  const maxHp = nonNegativeWhole(fullMaxHp)
  const divisor = Math.max(1, nonNegativeWhole(denominator))
  if (maxHp <= 0) return 0
  return Math.max(1, Math.floor(maxHp / divisor))
}

export const countSheetDailyMoveUsage = (usage: SheetMoveUsageState | undefined): { uses: number; entries: number } => {
  const daily = usage?.daily ?? {}
  let uses = 0
  let entries = 0
  for (const entry of Object.values(daily)) {
    if (!entry) continue
    entries += 1
    uses += nonNegativeWhole(entry.uses)
  }
  return { uses, entries }
}

export const clearSheetDailyMoveUsage = <TSheet extends { moveUsage?: SheetMoveUsageState }>(sheet: TSheet): {
  uses: number
  entries: number
} => {
  const count = countSheetDailyMoveUsage(sheet.moveUsage)
  if (sheet.moveUsage !== undefined) delete sheet.moveUsage
  return count
}

const pokemonHpTotal = (sheet: CharacterSheet): number => {
  const stats = resolveStats(sheet)
  return resolvedStatTotal(stats, 'hp')
}

export const computePokemonHealingVitals = (sheet: CharacterSheet): SheetHealingVitals => {
  const hpTotal = pokemonHpTotal(sheet)
  const fullMaxHp = computeFullMaxHp(sheet, hpTotal)
  const injuries = normalizeInjuryCount(sheet.combat?.injuries)
  const injuriesHealedToday = dailyInjuryHealCount(sheet.combat?.injuriesHealedToday)
  const maxHp = computeInjuryAdjustedMaxHp(fullMaxHp, injuries)
  const daily = countSheetDailyMoveUsage(sheet.moveUsage)
  return {
    fullMaxHp,
    maxHp,
    injuries,
    injuriesHealedToday,
    injuryHealsRemainingToday: dailyInjuryHealsRemaining(injuriesHealedToday),
    maxInjuriesHealedPerDay: MAX_INJURIES_HEALED_PER_DAY,
    currentHp: clampHpValue(sheet.combat?.currentHp ?? maxHp, maxHp),
    dailyMoveUses: daily.uses,
    dailyMoveCount: daily.entries,
    naturalRestHp: healingFractionAmount(fullMaxHp, 16),
  }
}

export const computeTrainerHealingVitals = (sheet: TrainerSheet): SheetHealingVitals => {
  const fullMaxHp = computeTrainerFullMaxHp(sheet)
  const injuries = normalizeInjuryCount(sheet.currentInjuries)
  const injuriesHealedToday = dailyInjuryHealCount(sheet.injuriesHealedToday)
  const maxHp = computeTrainerMaxHp(sheet)
  const daily = countSheetDailyMoveUsage(sheet.moveUsage)
  return {
    fullMaxHp,
    maxHp,
    injuries,
    injuriesHealedToday,
    injuryHealsRemainingToday: dailyInjuryHealsRemaining(injuriesHealedToday),
    maxInjuriesHealedPerDay: MAX_INJURIES_HEALED_PER_DAY,
    currentHp: clampHpValue(sheet.currentHp ?? maxHp, maxHp),
    dailyMoveUses: daily.uses,
    dailyMoveCount: daily.entries,
    naturalRestHp: healingFractionAmount(fullMaxHp, 16),
  }
}

const ensurePokemonCombat = (sheet: CharacterSheet): NonNullable<CharacterSheet['combat']> => {
  if (!sheet.combat || typeof sheet.combat !== 'object') sheet.combat = {}
  return sheet.combat
}

const ensureTrainerAp = (sheet: TrainerSheet): TrainerApPool => {
  if (!sheet.ap || typeof sheet.ap !== 'object') sheet.ap = {}
  return sheet.ap
}

const consumePokemonDailyInjuryHeals = (sheet: CharacterSheet, amount: number): number => {
  const healing = positiveHealingAmount(amount)
  if (healing <= 0) return dailyInjuryHealCount(sheet.combat?.injuriesHealedToday)
  const combat = ensurePokemonCombat(sheet)
  const next = dailyInjuryHealCount(dailyInjuryHealCount(combat.injuriesHealedToday) + healing)
  combat.injuriesHealedToday = next
  return next
}

const consumeTrainerDailyInjuryHeals = (sheet: TrainerSheet, amount: number): number => {
  const healing = positiveHealingAmount(amount)
  if (healing <= 0) return dailyInjuryHealCount(sheet.injuriesHealedToday)
  const next = dailyInjuryHealCount(dailyInjuryHealCount(sheet.injuriesHealedToday) + healing)
  sheet.injuriesHealedToday = next
  return next
}

export const resetPokemonDailyInjuryHeals = (sheet: CharacterSheet): void => {
  if (sheet.combat?.injuriesHealedToday !== undefined) delete sheet.combat.injuriesHealedToday
}

export const resetTrainerDailyInjuryHeals = (sheet: TrainerSheet): void => {
  if (sheet.injuriesHealedToday !== undefined) delete sheet.injuriesHealedToday
}

const pokemonDailyInjuryHealsRemaining = (sheet: CharacterSheet): number =>
  dailyInjuryHealsRemaining(sheet.combat?.injuriesHealedToday)

const trainerDailyInjuryHealsRemaining = (sheet: TrainerSheet): number =>
  dailyInjuryHealsRemaining(sheet.injuriesHealedToday)

const conditionTextPresent = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0

export const setPokemonCurrentHp = (sheet: CharacterSheet, value: unknown, maxHp?: number): number => {
  const cap = maxHp ?? computePokemonHealingVitals(sheet).maxHp
  const currentHp = clampHpValue(value, cap)
  ensurePokemonCombat(sheet).currentHp = currentHp
  return currentHp
}

export const setTrainerCurrentHp = (sheet: TrainerSheet, value: unknown, maxHp?: number): number => {
  const cap = maxHp ?? computeTrainerHealingVitals(sheet).maxHp
  const currentHp = clampHpValue(value, cap)
  sheet.currentHp = currentHp
  return currentHp
}

const assignPokemonInjuries = (sheet: CharacterSheet, value: unknown): number => {
  const injuries = nonNegativeWhole(value)
  const combat = ensurePokemonCombat(sheet)
  combat.injuries = injuries
  const nextMaxHp = computePokemonHealingVitals(sheet).maxHp
  if (combat.currentHp != null) combat.currentHp = clampHpValue(combat.currentHp, nextMaxHp)
  return injuries
}

const assignTrainerInjuries = (sheet: TrainerSheet, value: unknown): number => {
  const injuries = nonNegativeWhole(value)
  sheet.currentInjuries = injuries
  const nextMaxHp = computeTrainerHealingVitals(sheet).maxHp
  if (sheet.currentHp != null) sheet.currentHp = clampHpValue(sheet.currentHp, nextMaxHp)
  return injuries
}

export const setPokemonInjuries = (
  sheet: CharacterSheet,
  value: unknown,
  options: InjuryRemovalOptions = {},
): number => {
  const before = normalizeInjuryCount(sheet.combat?.injuries)
  if (pokemonHasResolvedCapability(sheet, 'Soulless')) {
    assignPokemonInjuries(sheet, 0)
    return 0
  }
  const requested = nonNegativeWhole(value)
  if (requested >= before) return assignPokemonInjuries(sheet, requested)

  const requestedHealing = before - requested
  const healing = shouldApplyDailyInjuryLimit(options)
    ? Math.min(requestedHealing, pokemonDailyInjuryHealsRemaining(sheet))
    : requestedHealing
  const next = before - healing
  assignPokemonInjuries(sheet, next)
  if (shouldApplyDailyInjuryLimit(options)) consumePokemonDailyInjuryHeals(sheet, healing)
  return next
}

export const setTrainerInjuries = (
  sheet: TrainerSheet,
  value: unknown,
  options: InjuryRemovalOptions = {},
): number => {
  const before = normalizeInjuryCount(sheet.currentInjuries)
  const requested = nonNegativeWhole(value)
  if (requested >= before) return assignTrainerInjuries(sheet, requested)

  const requestedHealing = before - requested
  const healing = shouldApplyDailyInjuryLimit(options)
    ? Math.min(requestedHealing, trainerDailyInjuryHealsRemaining(sheet))
    : requestedHealing
  const next = before - healing
  assignTrainerInjuries(sheet, next)
  if (shouldApplyDailyInjuryLimit(options)) consumeTrainerDailyInjuryHeals(sheet, healing)
  return next
}

export const healPokemonHp = (sheet: CharacterSheet, amount: unknown): number => {
  const vitals = computePokemonHealingVitals(sheet)
  return setPokemonCurrentHp(sheet, vitals.currentHp + positiveHealingAmount(amount), vitals.maxHp)
}

export const healTrainerHp = (sheet: TrainerSheet, amount: unknown): number => {
  const vitals = computeTrainerHealingVitals(sheet)
  return setTrainerCurrentHp(sheet, vitals.currentHp + positiveHealingAmount(amount), vitals.maxHp)
}

export const removePokemonInjuries = (
  sheet: CharacterSheet,
  amount: unknown,
  options: InjuryRemovalOptions = {},
): number => {
  const before = computePokemonHealingVitals(sheet).injuries
  const requestedNext = Math.max(0, before - positiveHealingAmount(amount))
  const next = setPokemonInjuries(sheet, requestedNext, options)
  return before - next
}

export const removeTrainerInjuries = (
  sheet: TrainerSheet,
  amount: unknown,
  options: InjuryRemovalOptions = {},
): number => {
  const before = computeTrainerHealingVitals(sheet).injuries
  const requestedNext = Math.max(0, before - positiveHealingAmount(amount))
  const next = setTrainerInjuries(sheet, requestedNext, options)
  return before - next
}

export const clearPokemonConditions = (sheet: CharacterSheet): number => {
  const combat = ensurePokemonCombat(sheet)
  const conditions = Array.isArray(combat.conditions) ? combat.conditions : []
  const freeformPresent = conditionTextPresent(combat.statusAfflictions)
  const cleared = conditions.length + (freeformPresent ? 1 : 0)
  combat.conditions = []
  if (freeformPresent) combat.statusAfflictions = ''
  return cleared
}

export const clearTrainerConditions = (sheet: TrainerSheet): number => {
  const conditions = Array.isArray(sheet.conditions) ? sheet.conditions : []
  const freeformPresent = conditionTextPresent(sheet.statusAfflictions)
  const cleared = conditions.length + (freeformPresent ? 1 : 0)
  sheet.conditions = []
  if (freeformPresent) sheet.statusAfflictions = ''
  return cleared
}

export const restoreTrainerAp = (sheet: TrainerSheet, maxAp = computeTrainerMaxAp(sheet)): number => {
  const ap = ensureTrainerAp(sheet)
  const beforeLeft = nonNegativeWhole(ap.left ?? maxAp)
  const bound = nonNegativeWhole(ap.bound)
  const nextLeft = Math.max(0, nonNegativeWhole(maxAp) - bound)
  ap.spent = 0
  ap.drained = 0
  ap.left = nextLeft
  return Math.max(0, nextLeft - beforeLeft)
}

export const applyPokemonExtendedRest = (sheet: CharacterSheet): SheetHealingMutationSummary => {
  const summary = emptyHealingMutationSummary()
  const before = computePokemonHealingVitals(sheet)

  const daily = clearSheetDailyMoveUsage(sheet)
  summary.dailyMoveUsesCleared += daily.uses
  summary.dailyMoveEntriesCleared += daily.entries
  summary.conditionsCleared += clearPokemonConditions(sheet)

  if (before.injuries < 5) {
    setPokemonCurrentHp(sheet, before.maxHp, before.maxHp)
    summary.hitPointsRestored += Math.max(0, before.maxHp - before.currentHp)
  }

  return summary
}

export const applyTrainerExtendedRest = (sheet: TrainerSheet): SheetHealingMutationSummary => {
  const summary = emptyHealingMutationSummary()
  const before = computeTrainerHealingVitals(sheet)

  const daily = clearSheetDailyMoveUsage(sheet)
  summary.dailyMoveUsesCleared += daily.uses
  summary.dailyMoveEntriesCleared += daily.entries
  summary.conditionsCleared += clearTrainerConditions(sheet)
  summary.trainerApRestored += restoreTrainerAp(sheet)

  if (before.injuries < 5) {
    setTrainerCurrentHp(sheet, before.maxHp, before.maxHp)
    summary.hitPointsRestored += Math.max(0, before.maxHp - before.currentHp)
  }

  return summary
}

export const applyPokemonFullRecovery = (sheet: CharacterSheet): SheetHealingMutationSummary => {
  const summary = emptyHealingMutationSummary()
  const before = computePokemonHealingVitals(sheet)
  summary.injuriesHealed += removePokemonInjuries(sheet, before.injuries)
  const afterInjuries = computePokemonHealingVitals(sheet)
  setPokemonCurrentHp(sheet, afterInjuries.maxHp, afterInjuries.maxHp)
  summary.hitPointsRestored += Math.max(0, afterInjuries.maxHp - before.currentHp)
  const daily = clearSheetDailyMoveUsage(sheet)
  summary.dailyMoveUsesCleared += daily.uses
  summary.dailyMoveEntriesCleared += daily.entries
  summary.conditionsCleared += clearPokemonConditions(sheet)
  return summary
}

export const applyPokemonCenterRecovery = (sheet: CharacterSheet): SheetHealingMutationSummary => {
  const summary = emptyHealingMutationSummary()
  const before = computePokemonHealingVitals(sheet)
  summary.injuriesHealed += removePokemonInjuries(sheet, 3)
  const afterInjuries = computePokemonHealingVitals(sheet)
  setPokemonCurrentHp(sheet, afterInjuries.maxHp, afterInjuries.maxHp)
  summary.hitPointsRestored += Math.max(0, afterInjuries.maxHp - before.currentHp)
  const daily = clearSheetDailyMoveUsage(sheet)
  summary.dailyMoveUsesCleared += daily.uses
  summary.dailyMoveEntriesCleared += daily.entries
  summary.conditionsCleared += clearPokemonConditions(sheet)
  return summary
}

export const applyTrainerFullRecovery = (sheet: TrainerSheet): SheetHealingMutationSummary => {
  const summary = emptyHealingMutationSummary()
  const before = computeTrainerHealingVitals(sheet)
  summary.injuriesHealed += removeTrainerInjuries(sheet, before.injuries)
  const afterInjuries = computeTrainerHealingVitals(sheet)
  setTrainerCurrentHp(sheet, afterInjuries.maxHp, afterInjuries.maxHp)
  summary.hitPointsRestored += Math.max(0, afterInjuries.maxHp - before.currentHp)
  const daily = clearSheetDailyMoveUsage(sheet)
  summary.dailyMoveUsesCleared += daily.uses
  summary.dailyMoveEntriesCleared += daily.entries
  summary.conditionsCleared += clearTrainerConditions(sheet)
  summary.trainerApRestored += restoreTrainerAp(sheet)
  return summary
}

export const applyPokemonNextDay = (sheet: CharacterSheet): SheetHealingMutationSummary => {
  const summary = emptyHealingMutationSummary()
  const before = computePokemonHealingVitals(sheet)

  resetPokemonDailyInjuryHeals(sheet)
  const daily = clearSheetDailyMoveUsage(sheet)
  summary.dailyMoveUsesCleared += daily.uses
  summary.dailyMoveEntriesCleared += daily.entries
  summary.conditionsCleared += clearPokemonConditions(sheet)
  summary.injuriesHealed += removePokemonInjuries(sheet, 1)

  const afterInjuries = computePokemonHealingVitals(sheet)
  if (afterInjuries.injuries < 5) {
    setPokemonCurrentHp(sheet, afterInjuries.maxHp, afterInjuries.maxHp)
    summary.hitPointsRestored += Math.max(0, afterInjuries.maxHp - before.currentHp)
  }
  return summary
}

export const applyTrainerNextDay = (sheet: TrainerSheet): SheetHealingMutationSummary => {
  const summary = emptyHealingMutationSummary()
  const before = computeTrainerHealingVitals(sheet)

  resetTrainerDailyInjuryHeals(sheet)
  const daily = clearSheetDailyMoveUsage(sheet)
  summary.dailyMoveUsesCleared += daily.uses
  summary.dailyMoveEntriesCleared += daily.entries
  summary.conditionsCleared += clearTrainerConditions(sheet)
  summary.injuriesHealed += removeTrainerInjuries(sheet, 1)
  summary.trainerApRestored += restoreTrainerAp(sheet)

  const afterInjuries = computeTrainerHealingVitals(sheet)
  if (afterInjuries.injuries < 5) {
    setTrainerCurrentHp(sheet, afterInjuries.maxHp, afterInjuries.maxHp)
    summary.hitPointsRestored += Math.max(0, afterInjuries.maxHp - before.currentHp)
  }
  return summary
}
