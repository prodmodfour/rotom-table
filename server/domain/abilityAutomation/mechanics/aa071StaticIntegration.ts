import { createHash } from 'node:crypto'
import type {
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveMultiHitConditionEffectTemplate,
  MoveMultiHitEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  AA071_FORECAST_TYPE_CAPABILITY_PREFIX,
  AA071_FOREST_LORD_ORIGIN_CAPABILITY,
  AA071_WEATHER_TYPE_BY_KIND,
  aa071ForewarnMoveCapabilityId,
} from '#shared/abilityAutomation/aa071'
import { pokemonTypeId, type PokemonTypeId } from '#shared/pokemonTypes'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveAutomationRollModifier } from '#shared/moveAutomation/random'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { resistMultiplierOneStepFurther } from '~/utils/typeChart'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)
const activeEffect = (effect: EncounterEffect): boolean => (
  effect.suppression.sources.length === 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
)

export interface Aa071ForecastTypeResolution {
  readonly typeId: PokemonTypeId | null
  readonly activeWeatherTypes: readonly PokemonTypeId[]
  readonly ambiguous: boolean
}

/** Resolve Forecast from authoritative weather plus an optional reviewed concurrent-weather choice. */
export const aa071ForecastTypeResolution = (input: {
  readonly contextMap: AuthoritativeMoveRulesContext['map']
  readonly placementId: string
  readonly hasForecast: boolean
}): Aa071ForecastTypeResolution => {
  if (!input.hasForecast) return Object.freeze({ typeId: null, activeWeatherTypes: [], ambiguous: false })
  const activeWeatherTypes: readonly PokemonTypeId[] = Object.freeze([...new Set<PokemonTypeId>(
    createMoveAutomationWeatherResolver(input.contextMap, {
      subjectPlacementId: input.placementId,
    }).active()
      .map(weather => AA071_WEATHER_TYPE_BY_KIND[weather.kind]),
  )])
  if (activeWeatherTypes.length === 0) {
    return Object.freeze({ typeId: 'normal', activeWeatherTypes, ambiguous: false })
  }
  if (activeWeatherTypes.length === 1) {
    return Object.freeze({ typeId: activeWeatherTypes[0]!, activeWeatherTypes, ambiguous: false })
  }
  const selected = (input.contextMap.encounterState?.effects ?? []).find(effect => (
    effect.kind === 'capability'
    && activeEffect(effect)
    && effect.affected.placementIds.includes(input.placementId)
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId.startsWith(AA071_FORECAST_TYPE_CAPABILITY_PREFIX)
    && activeWeatherTypes.includes(pokemonTypeId(
      effect.payload.capabilityId.slice(AA071_FORECAST_TYPE_CAPABILITY_PREFIX.length),
    ) ?? 'normal')
  ))
  const typeId = selected?.kind === 'capability'
    ? pokemonTypeId(selected.payload.capabilityId.slice(AA071_FORECAST_TYPE_CAPABILITY_PREFIX.length))
    : null
  return Object.freeze({ typeId, activeWeatherTypes, ambiguous: typeId === null })
}

export const aa071MoveAccuracyModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly targetPlacementId?: string
}): readonly MoveAutomationRollModifier[] => {
  const actorId = input.context.actor.placement.id
  const modifiers: MoveAutomationRollModifier[] = []
  if (input.targetPlacementId && input.context.queries.abilities.has(actorId, 'Frisk')) {
    const target = input.context.queries.tokens.get(input.targetPlacementId)
    if (target && ptuGridDistanceBetweenFootprints(input.context.actor.token, target) <= 1) {
      modifiers.push({ sourceId: 'ability.frisk', reason: 'Frisk Accuracy', value: 2 })
    }
  }
  const forestLord = (input.context.map.encounterState?.effects ?? []).find(effect => (
    effect.kind === 'capability'
    && activeEffect(effect)
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId === AA071_FOREST_LORD_ORIGIN_CAPABILITY
    && effect.affected.placementIds.includes(actorId)
    && input.context.intent.originCell !== undefined
    && effect.affected.cells.some(cell => (
      cell.x === input.context.intent.originCell!.x
      && cell.y === input.context.intent.originCell!.y
      && cell.z === input.context.intent.originCell!.z
    ))
  ))
  if (forestLord && ['grass', 'ghost'].includes(input.script.type.trim().toLowerCase())) {
    modifiers.push({ sourceId: forestLord.id, reason: 'Forest Lord Accuracy', value: 2 })
  }
  const forewarnEffect = (input.context.map.encounterState?.effects ?? []).filter(effect => (
    effect.kind === 'capability'
    && activeEffect(effect)
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId === aa071ForewarnMoveCapabilityId(input.script.moveName)
    && effect.affected.placementIds.includes(actorId)
  )).sort((left, right) => (
    left.createdRound - right.createdRound
    || left.createdTurn - right.createdTurn
    || left.id.localeCompare(right.id)
  )).at(-1)
  if (forewarnEffect?.kind === 'capability') modifiers.push({
    sourceId: forewarnEffect.id,
    reason: 'Forewarn Accuracy Penalty',
    value: -Math.max(0, forewarnEffect.payload.value ?? 2),
  })
  return Object.freeze(modifiers)
}

export const aa071MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const type = input.moveType.trim().toLowerCase()
  const maximumHp = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
  if (Math.max(0, input.actor.currentHp) * 3 > maximumHp) return Object.freeze([])
  const ability = type === 'fighting'
    ? input.context.queries.abilities.activeForPlacement(input.actor.id)
      .find(candidate => candidate.canonicalId === 'Focus')
    : type === 'ice'
      ? input.context.queries.abilities.activeForPlacement(input.actor.id)
        .find(candidate => candidate.canonicalId === 'Freezing Point')
      : null
  if (!ability) return Object.freeze([])
  return Object.freeze([{
    id: `ability.aa071.last-chance.${shortHash(input.operation.id, input.recipient.id, ability.instanceId)}`,
    stage: 'pre-type-modifiers',
    priority: 38,
    source: { kind: 'ability', id: ability.instanceId },
    stackingGroup: `aa071-last-chance:${ability.instanceId}`,
    reasonCode: ability.canonicalId === 'Focus'
      ? 'ability.focus.last-chance'
      : 'ability.freezing-point.last-chance',
    operation: 'add',
    value: 5,
  }])
}

const increasedNaturalTrigger = (
  trigger: NonNullable<MoveConditionEffectOperation['payload']['accuracyRollTrigger']>['trigger'],
): NonNullable<MoveConditionEffectOperation['payload']['accuracyRollTrigger']>['trigger'] => {
  if (trigger.kind === 'range') return { ...trigger, minimum: Math.max(1, trigger.minimum - 1) }
  const minimum = Math.min(...trigger.values)
  return minimum > 1
    ? { ...trigger, values: [...new Set([...trigger.values, minimum - 1])].sort((left, right) => left - right) }
    : trigger
}

const frostbiteCondition = (input: {
  readonly id: string
  readonly sourceOperationId: string
  readonly conditionId: 'slowed' | 'frozen'
  readonly minimum: number
  readonly rollId: string
}): MoveConditionEffectOperation => ({
  id: input.id,
  kind: 'condition',
  source: { kind: 'operation', id: input.sourceOperationId },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: `ability.frostbite.${input.conditionId}`,
  payload: {
    action: 'apply',
    conditionId: input.conditionId,
    conditionSource: null,
    filter: null,
    randomChoice: null,
    accuracyRollTrigger: {
      rollId: input.rollId,
      trigger: { kind: 'range', minimum: input.minimum },
    },
    applyTypeImmunity: true,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const multiHitCondition = (input: {
  readonly id: string
  readonly conditionId: 'slowed' | 'frozen'
  readonly minimum: number
}): MoveMultiHitConditionEffectTemplate => ({
  id: input.id,
  timing: 'after-each',
  trigger: 'hit',
  naturalAccuracyMinimum: input.minimum,
  recipient: 'target',
  kind: 'condition',
  reasonCode: `ability.frostbite.${input.conditionId}`,
  payload: {
    action: 'apply',
    conditionId: input.conditionId,
    conditionSource: null,
    filter: null,
    randomChoice: null,
    applyTypeImmunity: true,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

/** Apply Frostbite after handler/static operation expansion, including multi-hit payloads. */
export const aa071FrostbiteOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  if (!input.context.queries.abilities.has(actorId, 'Frostbite')
    || input.script.type.trim().toLowerCase() !== 'ice'
    || input.script.damageClass === 'Status') return input.operations
  let hasOrdinaryFreeze = false
  const transformed = input.operations.map((operation): MoveEffectOperation => {
    if (operation.kind === 'condition'
      && operation.payload.action === 'apply'
      && operation.payload.conditionId?.trim().toLowerCase() === 'frozen') {
      hasOrdinaryFreeze = true
      if (!operation.payload.accuracyRollTrigger) return operation
      return {
        ...operation,
        payload: {
          ...operation.payload,
          accuracyRollTrigger: {
            ...operation.payload.accuracyRollTrigger,
            trigger: increasedNaturalTrigger(operation.payload.accuracyRollTrigger.trigger),
          },
        },
      }
    }
    if (operation.kind !== 'multi-hit') return operation
    let hasFreeze = false
    const effects = operation.payload.effects.map((effect) => {
      if (effect.kind !== 'condition'
        || effect.payload.action !== 'apply'
        || effect.payload.conditionId?.trim().toLowerCase() !== 'frozen') return effect
      hasFreeze = true
      return effect.naturalAccuracyMinimum === undefined
        ? effect
        : { ...effect, naturalAccuracyMinimum: Math.max(1, effect.naturalAccuracyMinimum - 1) }
    })
    if (operation.payload.accuracy.kind !== 'automatic') {
      const suffix = shortHash(input.context.resolutionId ?? input.script.moveName, operation.id, actorId)
      effects.push(multiHitCondition({
        id: `ability.frostbite.slowed.${suffix}`,
        conditionId: 'slowed', minimum: 18,
      }))
      if (!hasFreeze) effects.push(multiHitCondition({
        id: `ability.frostbite.frozen.${suffix}`,
        conditionId: 'frozen', minimum: 20,
      }))
    }
    return { ...operation, payload: { ...operation.payload, effects } } as MoveMultiHitEffectOperation
  })
  const accuracySource = transformed.find((operation): operation is MoveDamageEffectOperation => (
    operation.kind === 'damage' && operation.payload.accuracyRollId !== null
  ))
  if (!accuracySource || !accuracySource.payload.accuracyRollId) return Object.freeze(transformed)
  const suffix = shortHash(input.context.resolutionId ?? input.script.moveName, accuracySource.id, actorId)
  return Object.freeze([
    ...transformed,
    frostbiteCondition({
      id: `ability.frostbite.slowed.${suffix}`,
      sourceOperationId: accuracySource.id,
      conditionId: 'slowed', minimum: 18,
      rollId: accuracySource.payload.accuracyRollId,
    }),
    ...(hasOrdinaryFreeze ? [] : [frostbiteCondition({
      id: `ability.frostbite.frozen.${suffix}`,
      sourceOperationId: accuracySource.id,
      conditionId: 'frozen', minimum: 20,
      rollId: accuracySource.payload.accuracyRollId,
    })]),
  ])
}

export const aa071ResistDamageType = (input: {
  readonly resolved: MoveDamageTypeResolution
  readonly steps: number
  readonly sources: readonly string[]
}): MoveDamageTypeResolution => {
  let passiveMultiplier = input.resolved.passiveMultiplier
  let finalMultiplier = input.resolved.finalMultiplier
  for (let step = 0; step < input.steps; step += 1) {
    passiveMultiplier = resistMultiplierOneStepFurther(passiveMultiplier)
    finalMultiplier = resistMultiplierOneStepFurther(finalMultiplier)
  }
  return Object.freeze({
    ...input.resolved,
    passiveMultiplier,
    passiveSources: [...input.resolved.passiveSources, ...input.sources],
    finalMultiplier,
    finalRelation: finalMultiplier === 0
      ? 'immune'
      : finalMultiplier < 1
        ? 'resistant'
        : finalMultiplier > 1
          ? 'weak'
          : 'neutral',
  })
}
