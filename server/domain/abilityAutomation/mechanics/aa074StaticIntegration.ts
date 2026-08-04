import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'
import {
  AA074_HUNGER_FULL_BELLY_MODE,
  AA074_HUNGER_HANGRY_MODE,
  aa074HungerModeForPlacement,
} from '#shared/abilityAutomation/aa074'

export const AA074_HEAVY_METAL_ABILITY = 'Heavy Metal' as const
export const AA074_HUGE_POWER_ABILITY = 'Huge Power' as const
export const AA074_HUGE_POWER_PURE_POWER_ABILITY = 'Huge Power / Pure Power' as const

const effectiveSet = (values: readonly string[]): ReadonlySet<string> => new Set(values)

/**
 * Apply AA-074 Base Stat and Weight Class rules before Combat Stages. Huge
 * Power's legacy clause doubles only species+nature+Vitamin Base Attack; the
 * errata identity supersedes it when malformed data grants both names.
 */
export const aa074AdjustedToken = (input: {
  readonly token: SpawnedPokemon
  readonly sheet: CharacterSheet | null
  readonly effectiveAbilityIds: readonly string[]
}): SpawnedPokemon => {
  const abilities = effectiveSet(input.effectiveAbilityIds)
  const heavyMetal = abilities.has(AA074_HEAVY_METAL_ABILITY)
  const errataPower = abilities.has(AA074_HUGE_POWER_PURE_POWER_ABILITY)
  const legacyPower = !errataPower && abilities.has(AA074_HUGE_POWER_ABILITY)
  if (!heavyMetal && !errataPower && !legacyPower) return input.token

  const baseAttack = input.sheet
    ? resolveStats(input.sheet).find(stat => stat.key === 'atk')?.base ?? 0
    : 0
  const attackBonus = errataPower
    ? 5 + Math.floor(Math.max(0, input.token.level) / 10)
    : legacyPower
      ? Math.max(0, baseAttack)
      : 0
  return {
    ...input.token,
    atk: input.token.atk + attackBonus,
    def: input.token.def + (heavyMetal ? 2 : 0),
    ...(typeof input.token.spd === 'number'
      ? { spd: Math.max(1, input.token.spd - (heavyMetal ? 2 : 0)) }
      : {}),
    ...(typeof input.token.weightClass === 'number'
      ? { weightClass: Math.max(1, input.token.weightClass + (heavyMetal ? 2 : 0)) }
      : {}),
  }
}

export const aa074HeavyMetalInitiativeSpeedOffset = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
}): 0 | -2 => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(AA074_HEAVY_METAL_ABILITY)
  if (!runtime) return 0
  const effective = projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(input.sheet),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).some(ability => ability.effective
    && ability.canonicalId === AA074_HEAVY_METAL_ABILITY
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
  return effective ? -2 : 0
}

export const aa074HustleAccuracyModifier = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): number => input.context.queries.abilities.has(input.placementId, 'Hustle') ? -2 : 0

export const aa074HungerSwitchAccuracyModifier = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): number => input.context.queries.abilities.has(input.placementId, 'Hunger Switch')
  && aa074HungerModeForPlacement(
    input.context.map.encounterState?.effects,
    input.placementId,
  ) === AA074_HUNGER_FULL_BELLY_MODE
  ? 2
  : 0

export const aa074MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actorId: string
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  if (input.context.queries.abilities.has(input.actorId, 'Hustle')) modifiers.push({
    id: 'ability.hustle.damage-roll',
    stage: 'pre-type-modifiers',
    priority: 42,
    source: { kind: 'ability', id: 'Hustle' },
    stackingGroup: 'aa074-hustle',
    reasonCode: 'ability.hustle.damage-roll-bonus',
    operation: 'add',
    value: 10,
  })
  if (input.context.queries.abilities.has(input.actorId, 'Hunger Switch')
    && aa074HungerModeForPlacement(
      input.context.map.encounterState?.effects,
      input.actorId,
    ) === AA074_HUNGER_HANGRY_MODE) modifiers.push({
    id: 'ability.hunger-switch.damage-roll',
    stage: 'pre-type-modifiers',
    priority: 43,
    source: { kind: 'ability', id: 'Hunger Switch' },
    stackingGroup: 'aa074-hunger-switch',
    reasonCode: 'ability.hunger-switch.damage-roll-bonus',
    operation: 'add',
    value: 5,
  })
  return Object.freeze(modifiers)
}

export const aa074HyperCutterBlocksStage = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
  readonly stage: string
  readonly delta: number
}): boolean => input.stage === 'atk'
  && input.delta < 0
  && input.context.queries.abilities.has(input.placementId, 'Hyper Cutter')
