import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { computeFullMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAbilityInstances } from '../instanceParameters'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'

const INITIATIVE_ABILITIES = Object.freeze([
  'Sand Rush', 'Slush Rush', 'Surge Surfer', 'Swift Swim',
] as const)

/** Server-authoritative weather/terrain-or-low-HP Initiative doubling. */
export const aa085to100InitiativeMultiplier = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
}): 1 | 2 => {
  const effective = new Set(projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAbilityInstances(input.sheet.abilities),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).filter(ability => {
    const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(ability.canonicalId)
    return ability.effective && runtime !== null
      && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash)
  }).map(ability => ability.canonicalId))
  if (!INITIATIVE_ABILITIES.some(ability => effective.has(ability))) return 1

  const hpTotal = resolveStats(input.sheet).find(stat => stat.key === 'hp')?.total ?? 0
  const maximumHp = Math.max(1, computeFullMaxHp(input.sheet, hpTotal))
  const currentHp = Math.max(0, Math.floor(input.sheet.combat?.currentHp ?? maximumHp))
  const lowHp = currentHp * 2 < maximumHp
  const weather = new Set(createMoveAutomationWeatherResolver(input.map, {
    subjectPlacementId: input.placement.id,
  }).active().map(entry => entry.kind))
  const terrain = new Set((input.map.fieldEffects?.terrains ?? []).map(entry => entry.kind))
  return lowHp
    || (effective.has('Sand Rush') && weather.has('sandstorm'))
    || (effective.has('Slush Rush') && weather.has('hail'))
    || (effective.has('Swift Swim') && weather.has('rainy'))
    || (effective.has('Surge Surfer') && terrain.has('electric'))
    ? 2 : 1
}
