import {
  applyNumericAbilityPassiveProviderGroup,
  type ResolvedAbilityPassiveProviderGroup,
} from './passiveProviders'
import { deepFreezeStrictJson } from '../automation/strictJson'

export const ABILITY_STAT_KEYS = ['attack', 'special-attack', 'defense', 'special-defense', 'speed', 'hp'] as const
export const ABILITY_COMBAT_STAGE_KEYS = ['attack', 'special-attack', 'defense', 'special-defense', 'speed', 'accuracy'] as const
export const ABILITY_EVASION_KEYS = ['physical', 'special', 'speed'] as const
export const ABILITY_MOVEMENT_SPEED_KEYS = ['overland', 'swim', 'sky', 'levitate', 'burrow', 'teleport'] as const
export type AbilityStatKey = (typeof ABILITY_STAT_KEYS)[number]
export type AbilityCombatStageKey = (typeof ABILITY_COMBAT_STAGE_KEYS)[number]
export type AbilityEvasionKey = (typeof ABILITY_EVASION_KEYS)[number]
export type AbilityMovementSpeedKey = (typeof ABILITY_MOVEMENT_SPEED_KEYS)[number]
export interface AbilityStatProviderFact {
  readonly placementId: string
  readonly baseStats: Readonly<Record<AbilityStatKey, number>>
  readonly combatStages: Readonly<Record<AbilityCombatStageKey, number>>
  /** Sheet/condition modifiers applied after stat-derived Evasion. */
  readonly evasionBonuses: Readonly<Record<AbilityEvasionKey, number>>
  /** Reviewed offset applied to effective Speed for Initiative. */
  readonly initiativeOffset: number
  readonly movementSpeeds: Readonly<Record<AbilityMovementSpeedKey, number>>
  readonly movementTraits: readonly string[]
}
export interface AbilityStatProviderTraceEntry {
  readonly groupKey: string
  readonly attribute: string
  readonly providerIds: readonly string[]
  readonly before: number | readonly string[]
  readonly after: number | readonly string[]
}
export interface AbilityStatProviderResolution {
  readonly placementId: string
  readonly baseStats: Readonly<Record<AbilityStatKey, number>>
  readonly combatStages: Readonly<Record<AbilityCombatStageKey, number>>
  readonly effectiveStats: Readonly<Record<AbilityStatKey, number>>
  readonly evasion: Readonly<Record<AbilityEvasionKey, number>>
  readonly initiative: number
  readonly movementSpeeds: Readonly<Record<AbilityMovementSpeedKey, number>>
  readonly movementTraits: readonly string[]
  readonly trace: readonly AbilityStatProviderTraceEntry[]
}
export class AbilityStatProviderError extends Error {
  constructor(readonly code: 'invalid-fact' | 'invalid-scope' | 'unsupported-provider' | 'duplicate-trait', detail: string) {
    super(detail)
    this.name = 'AbilityStatProviderError'
  }
}
const fail = (code: AbilityStatProviderError['code'], detail: string): never => {
  throw new AbilityStatProviderError(code, detail)
}
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const scopeKey = (placementId: string): string => `placement:${placementId}`
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const validateFact = (fact: AbilityStatProviderFact): void => {
  if (!ID.test(fact.placementId)
    || ABILITY_STAT_KEYS.some(key => !finite(fact.baseStats[key]) || fact.baseStats[key] < 0)
    || ABILITY_COMBAT_STAGE_KEYS.some(key => !Number.isSafeInteger(fact.combatStages[key]))
    || ABILITY_EVASION_KEYS.some(key => !finite(fact.evasionBonuses[key]))
    || !finite(fact.initiativeOffset)
    || ABILITY_MOVEMENT_SPEED_KEYS.some(key => !finite(fact.movementSpeeds[key]) || fact.movementSpeeds[key] < 0)
    || fact.movementTraits.some(value => !ID.test(value))) {
    fail('invalid-fact', 'Stat provider fact contains invalid authoritative values.')
  }
  if (new Set(fact.movementTraits).size !== fact.movementTraits.length) {
    fail('duplicate-trait', 'Movement traits must not repeat.')
  }
}
const clampStage = (value: number): number => Math.max(-6, Math.min(6, Math.trunc(value)))
const applyStage = (stat: number, stage: number): number => {
  const multiplier = stage >= 0 ? 1 + stage * 0.2 : 1 + stage * 0.1
  return stat <= 0 ? 0 : Math.max(1, Math.floor(stat * multiplier))
}
const applySpeedStage = (speed: number, stage: number): number => {
  const base = Math.max(0, Math.trunc(speed))
  if (base <= 0) return 0
  const delta = Math.trunc(clampStage(stage) / 2)
  if (delta >= 0) return base + delta
  return Math.max(base < 2 ? base : 2, base + delta)
}
const groupFor = (
  groups: readonly ResolvedAbilityPassiveProviderGroup[],
  attribute: string,
): readonly ResolvedAbilityPassiveProviderGroup[] => groups.filter(group => group.attribute === attribute)
const numericGroups = (
  base: number,
  groups: readonly ResolvedAbilityPassiveProviderGroup[],
  attribute: string,
  trace: AbilityStatProviderTraceEntry[],
): number => {
  let value = base
  for (const group of groupFor(groups, attribute)) {
    const before = value
    value = applyNumericAbilityPassiveProviderGroup(value, group)
    trace.push({
      groupKey: group.key, attribute,
      providerIds: group.providers.map(provider => provider.providerId),
      before, after: value,
    })
  }
  return value
}
const traitGroups = (
  base: readonly string[],
  groups: readonly ResolvedAbilityPassiveProviderGroup[],
  trace: AbilityStatProviderTraceEntry[],
): readonly string[] => {
  const values = new Set(base)
  for (const group of groups.filter(group => (
    group.domain === 'movement'
    && ['movement.phasing'].includes(group.attribute)
  ))) {
    const before = [...values].sort()
    for (const provider of group.providers) {
      const entries = typeof provider.value === 'string'
        ? [provider.value]
        : Array.isArray(provider.value) ? provider.value : []
      if (provider.operation === 'grant') entries.forEach(entry => values.add(entry))
      else if (provider.operation === 'deny') entries.forEach(entry => values.delete(entry))
      else fail('unsupported-provider', `Movement trait group ${group.key} is not grant/deny.`)
    }
    const after = [...values].sort()
    trace.push({
      groupKey: group.key, attribute: group.attribute,
      providerIds: group.providers.map(provider => provider.providerId),
      before, after,
    })
  }
  return Object.freeze([...values].sort())
}
const ensureNumericGroups = (groups: readonly ResolvedAbilityPassiveProviderGroup[]): void => {
  const supported = new Set<string>([
    ...ABILITY_STAT_KEYS.map(key => `stat.${key}`),
    ...ABILITY_COMBAT_STAGE_KEYS.map(key => `stat.combat-stage.${key}`),
    'stat.initiative',
    ...ABILITY_EVASION_KEYS.map(key => `evasion.${key}`),
    ...ABILITY_MOVEMENT_SPEED_KEYS.map(key => `movement.${key}`),
    'movement.phasing',
  ])
  for (const group of groups) {
    if (!supported.has(group.attribute)) {
      fail('unsupported-provider', `Stat provider resolver does not support ${group.attribute}.`)
    }
    if (group.attribute.startsWith('stat.combat-stage.') && group.providers.some(provider => (
      provider.operation === 'multiply'
      || typeof provider.value !== 'number'
      || !Number.isSafeInteger(provider.value)
    ))) {
      fail('unsupported-provider', `Combat Stage group ${group.key} must use integer non-multiply operations.`)
    }
  }
}
/** Resolve placement-scoped providers in raw-stat → CS → evasion/initiative → movement order. */
export const resolveAbilityStatProviders = (input: {
  readonly groups: readonly ResolvedAbilityPassiveProviderGroup[]
  readonly fact: AbilityStatProviderFact
}): AbilityStatProviderResolution => {
  validateFact(input.fact)
  const expectedScope = scopeKey(input.fact.placementId)
  const groups = input.groups.filter(group => group.scopeKey === expectedScope)
  ensureNumericGroups(groups)
  const trace: AbilityStatProviderTraceEntry[] = []
  const baseStats = Object.fromEntries(ABILITY_STAT_KEYS.map(key => [
    key,
    Math.max(0, Math.floor(numericGroups(input.fact.baseStats[key], groups, `stat.${key}`, trace))),
  ])) as unknown as Record<AbilityStatKey, number>
  const combatStages = Object.fromEntries(ABILITY_COMBAT_STAGE_KEYS.map(key => [
    key,
    clampStage(numericGroups(input.fact.combatStages[key], groups, `stat.combat-stage.${key}`, trace)),
  ])) as unknown as Record<AbilityCombatStageKey, number>
  const stageForStat: Record<AbilityStatKey, AbilityCombatStageKey | null> = {
    attack: 'attack', 'special-attack': 'special-attack', defense: 'defense',
    'special-defense': 'special-defense', speed: 'speed', hp: null,
  }
  const effectiveStats = Object.fromEntries(ABILITY_STAT_KEYS.map((key) => {
    const stage = stageForStat[key]
    return [key, stage === null ? baseStats[key] : applyStage(baseStats[key], combatStages[stage])]
  })) as unknown as Record<AbilityStatKey, number>
  const evasionStat: Record<AbilityEvasionKey, AbilityStatKey> = {
    physical: 'defense', special: 'special-defense', speed: 'speed',
  }
  const evasion = Object.fromEntries(ABILITY_EVASION_KEYS.map((key) => {
    const statEvasion = Math.min(6, Math.max(0, Math.floor(effectiveStats[evasionStat[key]] / 5)))
    const beforeProviders = statEvasion + input.fact.evasionBonuses[key]
    const provided = numericGroups(beforeProviders, groups, `evasion.${key}`, trace)
    return [key, Math.min(9, Math.max(0, Math.floor(provided)))]
  })) as unknown as Record<AbilityEvasionKey, number>
  const initiative = Math.max(0, Math.floor(numericGroups(
    effectiveStats.speed + input.fact.initiativeOffset,
    groups,
    'stat.initiative',
    trace,
  )))
  const speedStage = combatStages.speed
  const movementSpeeds = Object.fromEntries(ABILITY_MOVEMENT_SPEED_KEYS.map((key) => {
    const providerValue = Math.max(0, Math.floor(numericGroups(
      input.fact.movementSpeeds[key],
      groups,
      `movement.${key}`,
      trace,
    )))
    return [key, key === 'teleport' ? providerValue : applySpeedStage(providerValue, speedStage)]
  })) as unknown as Record<AbilityMovementSpeedKey, number>
  const movementTraits = traitGroups(input.fact.movementTraits, groups, trace)
  return deepFreezeStrictJson({
    placementId: input.fact.placementId,
    baseStats, combatStages, effectiveStats, evasion, initiative,
    movementSpeeds, movementTraits, trace: Object.freeze(trace),
  })
}
