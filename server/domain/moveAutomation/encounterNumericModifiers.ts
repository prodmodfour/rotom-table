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
  readonly map: Pick<TabletopMap, 'encounterState' | 'updatedAt'>
  readonly placementId: string
  readonly attribute: EncounterEffectNumericAttribute
  readonly now?: number
  readonly isCapabilityEffective?: (canonicalId: string) => boolean
  readonly isCapabilityInstanceEffective?: (capabilityInstanceId: string, canonicalId: string) => boolean
}): readonly EncounterNumericModifierEffect[] => {
  const evaluationTime = input.now ?? input.map.updatedAt ?? 0
  const effects = (input.map.encounterState?.effects ?? []).filter(
    (effect): effect is EncounterNumericModifierEffect => (
      effect.kind === 'numeric-modifier'
      && effect.payload.attribute === input.attribute
      && effect.affected.placementIds.includes(input.placementId)
      && effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
      && (() => {
        const modeTag = effect.tags.find(tag => tag.startsWith('capability-mode.'))
        if (!modeTag) return true
        const modeKind = modeTag.slice('capability-mode.'.length)
        return (input.map.encounterState?.capabilityRuntime?.modes ?? []).some(mode => (
          mode.actorPlacementId === input.placementId
          && mode.mode === modeKind
          && (mode.expiresAt === null || mode.expiresAt > evaluationTime)
          && (input.isCapabilityInstanceEffective?.(mode.capabilityInstanceId, mode.canonicalId)
            ?? input.isCapabilityEffective?.(mode.canonicalId) ?? true)
        ))
      })()
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
  readonly map: Pick<TabletopMap, 'encounterState' | 'updatedAt'>
  readonly placementId: string
  readonly attribute: EncounterEffectNumericAttribute
  readonly baseValue: number
  readonly now?: number
  readonly isCapabilityEffective?: (canonicalId: string) => boolean
  readonly isCapabilityInstanceEffective?: (capabilityInstanceId: string, canonicalId: string) => boolean
  /** Ability-owned policy for ignoring only increases or only decreases. */
  readonly changePolicy?: 'all' | 'non-decreasing' | 'non-increasing'
  /** White Smoke-style protection: external effects may not lower this placement's value. */
  readonly protectedFromExternalDecreasesPlacementId?: string
}): { readonly value: number; readonly steps: readonly EncounterNumericModifierStep[] } => {
  let value = input.baseValue
  const steps: EncounterNumericModifierStep[] = []
  for (const effect of activeEffects(input)) {
    const previous = value
    const candidate = apply(value, effect)
    if (input.changePolicy === 'non-decreasing' && candidate < previous) continue
    if (input.changePolicy === 'non-increasing' && candidate > previous) continue
    if (candidate < previous
      && input.protectedFromExternalDecreasesPlacementId
      && effect.source.placementId !== input.protectedFromExternalDecreasesPlacementId) continue
    value = candidate
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

/**
 * Context-sensitive half of Blender: its persisted mode effect supplies +2
 * against every attack; Ranged attacks gain the reviewed additional +2.
 */
export const capabilityContextualTargetEvasionBonus = (input: {
  readonly map: Pick<TabletopMap, 'encounterState' | 'updatedAt'>
  readonly placementId: string
  readonly range: string
  readonly now?: number
  readonly isCapabilityEffective?: (canonicalId: string) => boolean
  readonly isCapabilityInstanceEffective?: (capabilityInstanceId: string, canonicalId: string) => boolean
  readonly hasCapabilityForPlacement?: (placementId: string, canonicalId: string) => boolean
  readonly hasCapabilityInstanceForPlacement?: (placementId: string, capabilityInstanceId: string, canonicalId: string) => boolean
  readonly speciesForPlacement?: (placementId: string) => string | null
}): number => {
  const livingWeaponBonus = (input.map.encounterState?.capabilityRuntime?.links ?? []).some(link => (
    link.kind === 'living-weapon'
    && link.participantPlacementIds.includes(input.placementId)
    && input.hasCapabilityForPlacement?.(link.ownerPlacementId, 'Living Weapon') === true
    && (input.hasCapabilityInstanceForPlacement?.(
      link.ownerPlacementId,
      link.capabilityInstanceId,
      link.canonicalId,
    ) ?? true)
    && ['doublade', 'aegislash'].includes(input.speciesForPlacement?.(link.ownerPlacementId)?.trim().toLocaleLowerCase('en-US') ?? '')
  )) ? 2 : 0
  // PTU expresses most ranged attacks as a numeric/template range rather than
  // literally including the word “Ranged”; only explicit Melee ranges use the
  // melee Blender bonus without the additional ranged +2.
  if (/\bmelee\b/i.test(input.range)) return livingWeaponBonus
  return livingWeaponBonus + (activeEffects({
    map: input.map,
    placementId: input.placementId,
    attribute: 'evasion',
    now: input.now,
    isCapabilityEffective: input.isCapabilityEffective,
    isCapabilityInstanceEffective: input.isCapabilityInstanceEffective,
  })
    .some(effect => effect.tags.includes('capability-mode.blended')) ? 2 : 0)
}
