import { sunnyRainyDamagePolicy } from '#shared/moveAutomation/weather'
import type { MapFieldEffects } from '~/types/map'

export interface FieldEffectDamageContribution {
  readonly id: string
  readonly sourceId: string
  readonly stackingGroup: string
  readonly reasonCode: string
  readonly label: string
  readonly value: number
}

const contribution = (
  id: string,
  sourceId: string,
  stackingGroup: string,
  reasonCode: string,
  label: string,
  value: number,
): FieldEffectDamageContribution => ({
  id,
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
      `weather.${weather}`,
      `weather.${weather}.damage-roll`,
      policy.reasonCode,
      weather === 'sunny' ? 'Sunny Weather' : 'Rainy Weather',
      policy.value,
    ))
  }

  // Terrain remains on its existing aggregate compatibility path until
  // MA-140/MA-141 install authoritative membership and grounding queries.
  let terrainBonus = 0
  if (terrainKinds.has('electric') && typeId === 'electric') terrainBonus += 10
  if (terrainKinds.has('grassy') && typeId === 'grass') terrainBonus += 10
  if (terrainKinds.has('psychic') && typeId === 'psychic') terrainBonus += 10
  if (terrainKinds.has('misty') && typeId === 'dragon') terrainBonus -= 10
  if (terrainBonus !== 0) {
    result.push(contribution(
      'damage.field-roll',
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
): number => fieldEffectDamageContributions(attackType, fieldEffects)
  .reduce((total, item) => total + item.value, 0)
