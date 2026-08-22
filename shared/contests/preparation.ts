import { contestCatalog, contestStatById } from './catalog'
import { emptyContestStatRecord, isContestStatId, type ContestStatId } from './ids'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import type { CharacterSheet } from '~/types/characterSheet'

export interface PokemonContestPoffinEntryV1 {
  readonly entryId: string
  readonly statId: ContestStatId
  readonly sourceItemId: 'Poffin'
  readonly sourceInventoryInstanceId: string
  readonly sourceOperationId: string
  readonly consumedAt: number
}

export interface PokemonContestGroomingV1 {
  readonly campaignDay: number
  readonly sourceTrainerSlug: string
  readonly sourceOperationId: string
  readonly groomedAt: number
}

export interface PokemonContestPoffinReallocationV1 {
  readonly reallocationId: string
  readonly fromStatId: ContestStatId
  readonly toStatId: ContestStatId
  readonly dice: 1 | 2
  readonly campaignDay: number
  readonly sourceTrainerSlug: string
  readonly sourceFeatureId: 'Flexible Preparations'
  readonly sourceOperationId: string
}

export interface PokemonContestStatsStateV1 {
  readonly schemaVersion: 1
  readonly legacyDescription: string
  readonly poffins: readonly PokemonContestPoffinEntryV1[]
  readonly grooming: PokemonContestGroomingV1 | null
  readonly reallocations: readonly PokemonContestPoffinReallocationV1[]
}

export type ContestContributionKind = 'combat-stat' | 'poffin' | 'feature-poffin-equivalent' | 'temporary-reallocation' | 'introduction' | 'ability'

export interface ContestStatContribution {
  readonly id: string
  readonly kind: ContestContributionKind
  readonly statId: ContestStatId
  readonly dice: number
  readonly active: boolean
  readonly label: string
  readonly sourceId: string
  readonly explanation: string
}

export interface DerivedContestStatRow {
  readonly statId: ContestStatId
  readonly label: string
  readonly combatStatId: string
  readonly combatStatValue: number
  readonly combatDice: number
  readonly poffinDiceStored: number
  readonly poffinDiceActive: number
  readonly featureDice: number
  readonly totalDice: number
  readonly contributions: readonly ContestStatContribution[]
}

export interface PokemonContestPreparationProjectionV1 {
  readonly schemaVersion: 1
  readonly level: number
  readonly poffinAllowance: number
  readonly poffinsConsumed: number
  readonly poffinsActive: number
  readonly poffinsSuppressed: number
  readonly graceActive: boolean
  readonly groomedToday: boolean
  readonly rows: Readonly<Record<ContestStatId, DerivedContestStatRow>>
  readonly legacyDescription: string
}

const safeInteger = (value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${label} must be a safe integer from ${minimum} through ${maximum}`)
  return Number(value)
}
const text = (value: unknown, label: string, maximum = 240): string => {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label} must be bounded control-free text`)
  return value
}
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}
const knownKeys = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label}.${key} is not recognized`)
}

export const emptyPokemonContestStatsState = (legacyDescription = ''): PokemonContestStatsStateV1 => Object.freeze({
  schemaVersion: 1,
  legacyDescription: text(legacyDescription, 'legacyDescription', 2_000),
  poffins: Object.freeze([]),
  grooming: null,
  reallocations: Object.freeze([]),
})

export const parsePokemonContestStatsState = (value: unknown): PokemonContestStatsStateV1 => {
  if (value === undefined || value === null) return emptyPokemonContestStatsState()
  // Historical free-form authority is preserved only as non-mechanical copy.
  if (typeof value === 'string') return emptyPokemonContestStatsState(value)
  const root = record(value, 'contestStats')
  knownKeys(root, ['schemaVersion', 'legacyDescription', 'poffins', 'grooming', 'reallocations'], 'contestStats')
  if (root.schemaVersion !== 1) throw new Error('contestStats.schemaVersion must be 1')
  const rawPoffins = Array.isArray(root.poffins) ? root.poffins : (() => { throw new Error('contestStats.poffins must be an array') })()
  if (rawPoffins.length > contestCatalog.preparation.poffins.standardMaximum + contestCatalog.preparation.poffins.graceAdditionalMaximum) throw new Error('contestStats.poffins exceeds the reviewed lifetime maximum')
  const poffins = rawPoffins.map((raw, index): PokemonContestPoffinEntryV1 => {
    const row = record(raw, `contestStats.poffins[${index}]`)
    knownKeys(row, ['entryId', 'statId', 'sourceItemId', 'sourceInventoryInstanceId', 'sourceOperationId', 'consumedAt'], `contestStats.poffins[${index}]`)
    if (!isContestStatId(row.statId) || row.sourceItemId !== 'Poffin') throw new Error(`contestStats.poffins[${index}] has invalid canonical identity`)
    return Object.freeze({
      entryId: text(row.entryId, `contestStats.poffins[${index}].entryId`, 120),
      statId: row.statId,
      sourceItemId: 'Poffin',
      sourceInventoryInstanceId: text(row.sourceInventoryInstanceId, `contestStats.poffins[${index}].sourceInventoryInstanceId`, 240),
      sourceOperationId: text(row.sourceOperationId, `contestStats.poffins[${index}].sourceOperationId`, 160),
      consumedAt: safeInteger(row.consumedAt, `contestStats.poffins[${index}].consumedAt`),
    })
  })
  if (new Set(poffins.map(entry => entry.entryId)).size !== poffins.length
    || new Set(poffins.map(entry => entry.sourceOperationId)).size !== poffins.length) throw new Error('contestStats.poffins identities must be unique')
  let grooming: PokemonContestGroomingV1 | null = null
  if (root.grooming !== null && root.grooming !== undefined) {
    const row = record(root.grooming, 'contestStats.grooming')
    knownKeys(row, ['campaignDay', 'sourceTrainerSlug', 'sourceOperationId', 'groomedAt'], 'contestStats.grooming')
    grooming = Object.freeze({
      campaignDay: safeInteger(row.campaignDay, 'contestStats.grooming.campaignDay'),
      sourceTrainerSlug: text(row.sourceTrainerSlug, 'contestStats.grooming.sourceTrainerSlug', 160),
      sourceOperationId: text(row.sourceOperationId, 'contestStats.grooming.sourceOperationId', 160),
      groomedAt: safeInteger(row.groomedAt, 'contestStats.grooming.groomedAt'),
    })
  }
  const rawReallocations = Array.isArray(root.reallocations) ? root.reallocations : (() => { throw new Error('contestStats.reallocations must be an array') })()
  if (rawReallocations.length > 8) throw new Error('contestStats.reallocations is unbounded')
  const reallocations = rawReallocations.map((raw, index): PokemonContestPoffinReallocationV1 => {
    const row = record(raw, `contestStats.reallocations[${index}]`)
    knownKeys(row, ['reallocationId', 'fromStatId', 'toStatId', 'dice', 'campaignDay', 'sourceTrainerSlug', 'sourceFeatureId', 'sourceOperationId'], `contestStats.reallocations[${index}]`)
    if (!isContestStatId(row.fromStatId) || !isContestStatId(row.toStatId) || row.fromStatId === row.toStatId
      || (row.dice !== 1 && row.dice !== 2) || row.sourceFeatureId !== 'Flexible Preparations') throw new Error(`contestStats.reallocations[${index}] is invalid`)
    return Object.freeze({
      reallocationId: text(row.reallocationId, `contestStats.reallocations[${index}].reallocationId`, 120),
      fromStatId: row.fromStatId,
      toStatId: row.toStatId,
      dice: row.dice,
      campaignDay: safeInteger(row.campaignDay, `contestStats.reallocations[${index}].campaignDay`),
      sourceTrainerSlug: text(row.sourceTrainerSlug, `contestStats.reallocations[${index}].sourceTrainerSlug`, 160),
      sourceFeatureId: 'Flexible Preparations',
      sourceOperationId: text(row.sourceOperationId, `contestStats.reallocations[${index}].sourceOperationId`, 160),
    })
  })
  if (new Set(reallocations.map(entry => entry.reallocationId)).size !== reallocations.length) throw new Error('contestStats.reallocation identities must be unique')
  return Object.freeze({
    schemaVersion: 1,
    legacyDescription: text(root.legacyDescription ?? '', 'contestStats.legacyDescription', 2_000),
    poffins: Object.freeze(poffins),
    grooming,
    reallocations: Object.freeze(reallocations),
  })
}

export const contestPoffinAllowance = (levelInput: unknown, hasGrace: boolean): number => {
  const level = Math.max(1, Math.min(100, Number.isFinite(Number(levelInput)) ? Math.floor(Number(levelInput)) : 1))
  const rules = contestCatalog.preparation.poffins
  const standard = Math.min(rules.standardMaximum, rules.baseAllowance + Math.floor(level / rules.levelsPerAdditionalPoffin))
  return Math.min(rules.standardMaximum + (hasGrace ? rules.graceAdditionalMaximum : 0), standard + (hasGrace ? rules.graceAdditionalMaximum : 0))
}

export interface DerivePokemonContestPreparationOptions {
  readonly hasGrace?: boolean
  readonly styleExpertStatIds?: readonly ContestStatId[]
  readonly campaignDay?: number
}

export const derivePokemonContestPreparation = (
  sheet: CharacterSheet,
  options: DerivePokemonContestPreparationOptions = {},
): PokemonContestPreparationProjectionV1 => {
  const state = parsePokemonContestStatsState(sheet.contestStats)
  const hasGrace = options.hasGrace === true
  const campaignDay = Math.max(0, Math.floor(options.campaignDay ?? 0))
  const allowance = contestPoffinAllowance(sheet.level, hasGrace)
  const chronologically = [...state.poffins].sort((left, right) => left.consumedAt - right.consumedAt || left.entryId.localeCompare(right.entryId))
  const activeIds = new Set(chronologically.slice(0, allowance).map(entry => entry.entryId))
  const baseRows = new Map(resolveStats(sheet).map(row => [row.key, row]))
  const activeReallocations = state.reallocations.filter(entry => entry.campaignDay === campaignDay)
  const styleCounts = new Map<ContestStatId, number>()
  for (const statId of options.styleExpertStatIds ?? []) if (isContestStatId(statId)) styleCounts.set(statId, (styleCounts.get(statId) ?? 0) + 2)
  const rows = emptyContestStatRecord<DerivedContestStatRow>((statId) => {
    const canonical = contestStatById.get(statId)!
    const combatValue = Math.max(0, Math.floor(baseRows.get(canonical.combatStatId)?.baseTotal ?? 0))
    const combatDice = Math.min(contestCatalog.preparation.combatContribution.maximumDice, Math.floor(combatValue / contestCatalog.preparation.combatContribution.pointsPerDie))
    const statPoffins = chronologically.filter(entry => entry.statId === statId)
    const poffinActive = statPoffins.filter(entry => activeIds.has(entry.entryId))
    const featureDice = styleCounts.get(statId) ?? 0
    const delta = activeReallocations.reduce((sum, entry) => sum + (entry.toStatId === statId ? entry.dice : entry.fromStatId === statId ? -entry.dice : 0), 0)
    const reallocatedPoffinDice = Math.max(0, poffinActive.length + delta)
    const contributions: ContestStatContribution[] = [
      {
        id: `combat:${canonical.combatStatId}`,
        kind: 'combat-stat',
        statId,
        dice: combatDice,
        active: true,
        label: canonical.combatStatLabel,
        sourceId: canonical.combatStatId,
        explanation: `${combatValue} ${canonical.combatStatLabel} grants ${combatDice}d6 (1d6 per 10, maximum 3d6; Combat Stages excluded).`,
      },
      ...statPoffins.map(entry => ({
        id: entry.entryId,
        kind: 'poffin' as const,
        statId,
        dice: 1,
        active: activeIds.has(entry.entryId),
        label: 'Poffin',
        sourceId: entry.sourceOperationId,
        explanation: activeIds.has(entry.entryId) ? 'Accepted Poffin grants +1d6.' : 'Stored Poffin die is suppressed by the current Trainer allowance.',
      })),
      ...(featureDice ? [{
        id: `feature:style-expert:${statId}`,
        kind: 'feature-poffin-equivalent' as const,
        statId,
        dice: featureDice,
        active: true,
        label: 'Style Expert',
        sourceId: 'Style Expert',
        explanation: `Style Expert grants +${featureDice}d6 counted as Poffin-derived dice.`,
      }] : []),
      ...activeReallocations.flatMap(entry => entry.fromStatId === statId || entry.toStatId === statId ? [{
        id: entry.reallocationId,
        kind: 'temporary-reallocation' as const,
        statId,
        dice: entry.toStatId === statId ? entry.dice : -entry.dice,
        active: true,
        label: 'Flexible Preparations',
        sourceId: entry.sourceOperationId,
        explanation: `${entry.toStatId === statId ? '+' : '-'}${entry.dice}d6 until the campaign day ends.`,
      }] : []),
    ]
    return Object.freeze({
      statId,
      label: canonical.label,
      combatStatId: canonical.combatStatId,
      combatStatValue: combatValue,
      combatDice,
      poffinDiceStored: statPoffins.length,
      poffinDiceActive: reallocatedPoffinDice,
      featureDice,
      totalDice: combatDice + reallocatedPoffinDice + featureDice,
      contributions: Object.freeze(contributions),
    })
  })
  return Object.freeze({
    schemaVersion: 1,
    level: Math.max(1, Math.floor(sheet.level || 1)),
    poffinAllowance: allowance,
    poffinsConsumed: chronologically.length,
    poffinsActive: activeIds.size,
    poffinsSuppressed: Math.max(0, chronologically.length - activeIds.size),
    graceActive: hasGrace,
    groomedToday: state.grooming?.campaignDay === campaignDay,
    rows: Object.freeze(rows),
    legacyDescription: state.legacyDescription,
  })
}

export const canConsumeContestPoffin = (input: {
  readonly sheet: CharacterSheet
  readonly hasGrace: boolean
}): { readonly ok: true, readonly allowance: number } | { readonly ok: false, readonly allowance: number, readonly code: 'contest.poffin-allowance-exhausted', readonly reason: string } => {
  const state = parsePokemonContestStatsState(input.sheet.contestStats)
  const allowance = contestPoffinAllowance(input.sheet.level, input.hasGrace)
  return state.poffins.length < allowance
    ? { ok: true, allowance }
    : { ok: false, allowance, code: 'contest.poffin-allowance-exhausted', reason: `This Pokémon has used all ${allowance} current Poffin allowances.` }
}
