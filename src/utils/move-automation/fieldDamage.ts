import {
  electricGrassyTerrainDamagePolicy,
} from '#shared/moveAutomation/terrain'
import {
  SAND_FORCE_ABILITY_NAME,
  sandForceDamagePolicy,
  sunnyRainyDamagePolicy,
} from '#shared/moveAutomation/weather'
import type { MapFieldEffects } from '~/types/map'
import { sheetHasCanonicalAbility, type SheetAbilityNameSource } from '~/utils/sheetAbilities'

export interface FieldEffectDamageContribution {
  readonly id: string
  readonly sourceKind: 'field' | 'ability'
  readonly sourceId: string
  readonly stackingGroup: string
  readonly reasonCode: string
  readonly label: string
  readonly value: number
}

const contribution = (
  id: string,
  sourceKind: FieldEffectDamageContribution['sourceKind'],
  sourceId: string,
  stackingGroup: string,
  reasonCode: string,
  label: string,
  value: number,
): FieldEffectDamageContribution => ({
  id,
  sourceKind,
  sourceId,
  stackingGroup,
  reasonCode,
  label,
  value,
})

/** Compatibility-field contributions with stable arithmetic trace identities. */
export const fieldEffectDamageContributions = (
  attackType: string,
  fieldEffects: MapFieldEffects | null | undefined,
  actorAbilities?: readonly SheetAbilityNameSource[] | null,
): readonly FieldEffectDamageContribution[] => {
  const typeId = attackType.trim().toLowerCase()
  const weatherKinds = new Set((fieldEffects?.weather ?? []).map(effect => effect.kind))
  const terrainKinds = new Set((fieldEffects?.terrains ?? []).map(effect => effect.kind))
  const result: FieldEffectDamageContribution[] = []

  for (const weather of ['sunny', 'rainy'] as const) {
    if (!weatherKinds.has(weather)) continue
    const policy = sunnyRainyDamagePolicy(weather, typeId)
    if (!policy) continue
    result.push(contribution(
      `damage.weather.${weather}.${policy.typeId}`,
      'field',
      `weather.${weather}`,
      `weather.${weather}.damage-roll`,
      policy.reasonCode,
      weather === 'sunny' ? 'Sunny Weather' : 'Rainy Weather',
      policy.value,
    ))
  }

  if (weatherKinds.has('sandstorm')) {
    const policy = sandForceDamagePolicy(
      typeId,
      sheetHasCanonicalAbility(actorAbilities, SAND_FORCE_ABILITY_NAME),
    )
    if (policy) {
      result.push(contribution(
        'damage.weather.sandstorm.sand-force',
        'ability',
        SAND_FORCE_ABILITY_NAME,
        'ability.sand-force.damage-roll',
        policy.reasonCode,
        SAND_FORCE_ABILITY_NAME,
        policy.value,
      ))
    }
  }

  for (const terrain of ['electric', 'grassy'] as const) {
    const effect = (fieldEffects?.terrains ?? []).find(candidate => candidate.kind === terrain)
    if (!effect) continue
    const policy = electricGrassyTerrainDamagePolicy(terrain, typeId)
    if (!policy) continue
    result.push(contribution(
      `damage.terrain.${terrain}.${policy.typeId}`,
      'field',
      effect.source ?? `terrain.${terrain}`,
      `terrain.${terrain}.damage-roll`,
      policy.reasonCode,
      terrain === 'electric' ? 'Electric Terrain' : 'Grassy Terrain',
      policy.value,
    ))
  }

  // Misty/Psychic remain on the aggregate compatibility path until MA-141.
  let terrainBonus = 0
  if (terrainKinds.has('psychic') && typeId === 'psychic') terrainBonus += 10
  if (terrainKinds.has('misty') && typeId === 'dragon') terrainBonus -= 10
  if (terrainBonus !== 0) {
    result.push(contribution(
      'damage.field-roll',
      'field',
      'active-field-effects',
      'field-damage-roll',
      'damage.field-roll-modifier',
      'field',
      terrainBonus,
    ))
  }

  return result
}

export const fieldEffectDamageBonus = (
  attackType: string,
  fieldEffects: MapFieldEffects | null | undefined,
  actorAbilities?: readonly SheetAbilityNameSource[] | null,
): number => fieldEffectDamageContributions(attackType, fieldEffects, actorAbilities)
  .reduce((total, item) => total + item.value, 0)
