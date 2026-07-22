import type {
  EncounterEffectNumericAttribute,
  EncounterNumericModifierEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { TabletopMap } from '~/types/map'

export interface EncounterNumericModifierStep {
  readonly effectId: string
  readonly reason: string
  readonly input: number
  readonly output: number
  readonly delta: number
}

const activeEffects = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
  readonly attribute: EncounterEffectNumericAttribute
}): readonly EncounterNumericModifierEffect[] => {
  const effects = (input.map.encounterState?.effects ?? []).filter(
    (effect): effect is EncounterNumericModifierEffect => (
      effect.kind === 'numeric-modifier'
      && effect.payload.attribute === input.attribute
      && effect.affected.placementIds.includes(input.placementId)
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
    ),
  )
  // Repeated Aromatic Mist uses refresh the same source bonus for recipients
  // they overlap without erasing a still-live bonus on different recipients.
  const latestFlavorfulBySource = new Map<string, EncounterNumericModifierEffect>()
  for (const effect of effects) {
    if (effect.tags.includes('flavorful-aroma')) {
      latestFlavorfulBySource.set(`${effect.source.placementId}:${input.attribute}`, effect)
    }
  }
  return Object.freeze(effects.filter(effect => (
    !effect.tags.includes('flavorful-aroma')
    || latestFlavorfulBySource.get(`${effect.source.placementId}:${input.attribute}`)?.id === effect.id
  )))
}

const rounded = (value: number, effect: EncounterNumericModifierEffect): number => {
  if (effect.payload.rounding === 'floor') return Math.floor(value)
  if (effect.payload.rounding === 'round') return Math.round(value)
  if (effect.payload.rounding === 'ceil') return Math.ceil(value)
  return value
}

const apply = (value: number, effect: EncounterNumericModifierEffect): number => {
  const stacks = Math.max(1, effect.stacks)
  if (effect.payload.operation === 'set') return rounded(effect.payload.value, effect)
  if (effect.payload.operation === 'multiply') {
    return rounded(value * (effect.payload.value ** stacks), effect)
  }
  return rounded(value + effect.payload.value * stacks, effect)
}

/** Apply map-owned numeric effects in their persisted deterministic order. */
export const applyEncounterNumericModifiers = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
  readonly attribute: EncounterEffectNumericAttribute
  readonly baseValue: number
}): { readonly value: number; readonly steps: readonly EncounterNumericModifierStep[] } => {
  let value = input.baseValue
  const steps: EncounterNumericModifierStep[] = []
  for (const effect of activeEffects(input)) {
    const previous = value
    value = apply(value, effect)
    steps.push(Object.freeze({
      effectId: effect.id,
      reason: effect.tags.includes('flavorful-aroma')
        ? `Flavorful Aroma ${input.attribute}`
        : `Encounter ${input.attribute} modifier`,
      input: previous,
      output: value,
      delta: value - previous,
    }))
  }
  return Object.freeze({ value, steps: Object.freeze(steps) })
}

export const encounterNumericModifierEffects = activeEffects
