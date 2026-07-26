import { aa080IsDefensiveAbility } from '#shared/abilityAutomation/aa080'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { SpawnedPokemon } from '~/types/pokemon'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'

const activeEffect = (effect: EncounterEffect): boolean => effect.suppression.sources.length === 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)

export interface Aa081ProjectedAbility {
  readonly canonicalId: string
  readonly effective?: boolean
  readonly suppressionReasonCode?: string | null
}

const roundSuppressed = (
  effects: readonly EncounterEffect[],
  placementId: string,
): boolean => effects.some(effect => (
  effect.kind === 'capability'
  && activeEffect(effect)
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === 'ability.neutralizing-gas.suppressed'
  && effect.source.placementId !== placementId
  && effect.affected.placementIds.includes(placementId)
))

const nearbyGasOwnerIds = <Ability extends Aa081ProjectedAbility>(input: {
  readonly abilitiesByPlacement: ReadonlyMap<string, readonly Ability[]>
  readonly tokensById: ReadonlyMap<string, SpawnedPokemon>
  readonly placementId: string
}): readonly string[] => {
  const target = input.tokensById.get(input.placementId)
  if (!target) return []
  return [...input.abilitiesByPlacement.entries()].flatMap(([ownerId, abilities]) => {
    if (ownerId === input.placementId
      || !abilities.some(ability => ability.canonicalId === 'Neutralizing Gas'
        && ability.effective !== false)) return []
    const owner = input.tokensById.get(ownerId)
    return owner && ptuGridDistanceBetweenFootprints(owner, target) <= 1 ? [ownerId] : []
  }).sort()
}

/**
 * Apply only the canonical Defensive-ability suppression lane. Triggered-mode
 * blocking is checked separately by the event/move router so unrelated Static
 * and activated abilities remain effective.
 */
export const projectAa081NeutralizingGasAbilities = <Ability extends Aa081ProjectedAbility>(input: {
  readonly abilitiesByPlacement: ReadonlyMap<string, readonly Ability[]>
  readonly tokensById: ReadonlyMap<string, SpawnedPokemon>
  readonly effects: readonly EncounterEffect[]
  readonly preserveSuppressedEntries: boolean
}): ReadonlyMap<string, readonly Ability[]> => {
  const projected = new Map<string, readonly Ability[]>()
  for (const [placementId, abilities] of input.abilitiesByPlacement) {
    const suppressed = nearbyGasOwnerIds({ ...input, placementId }).length > 0
      || roundSuppressed(input.effects, placementId)
    if (!suppressed) {
      projected.set(placementId, abilities)
      continue
    }
    projected.set(placementId, Object.freeze(abilities.flatMap(ability => {
      if (!aa080IsDefensiveAbility(ability.canonicalId) || ability.effective === false) return [ability]
      if (!input.preserveSuppressedEntries) return []
      return [Object.freeze({
        ...ability,
        effective: false,
        suppressionReasonCode: 'ability.suppressed.neutralizing-gas',
      }) as Ability]
    })))
  }
  return projected
}

export const aa081NeutralizingGasBlocksTriggeredAbility = <Ability extends Aa081ProjectedAbility>(input: {
  readonly abilitiesByPlacement: ReadonlyMap<string, readonly Ability[]>
  readonly tokensById: ReadonlyMap<string, SpawnedPokemon>
  readonly effects: readonly EncounterEffect[]
  readonly ownerPlacementId: string
}): boolean => {
  return nearbyGasOwnerIds({ ...input, placementId: input.ownerPlacementId }).length > 0
    || roundSuppressed(input.effects, input.ownerPlacementId)
}
