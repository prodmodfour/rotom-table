import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { computeFullMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAbilityInstances } from '../instanceParameters'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'

/** Server-authoritative Chlorophyll multiplier for calculated or explicit Initiative. */
export const aa063ChlorophyllInitiativeMultiplier = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
}): 1 | 2 => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Chlorophyll')
  if (!runtime) return 1
  const active = projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAbilityInstances(input.sheet.abilities),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).some(ability => ability.effective
    && ability.canonicalId === 'Chlorophyll'
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
  if (!active) return 1
  const hpTotal = resolveStats(input.sheet).find(stat => stat.key === 'hp')?.total ?? 0
  const maximumHp = Math.max(1, computeFullMaxHp(input.sheet, hpTotal))
  const currentHp = Math.max(0, Math.floor(input.sheet.combat?.currentHp ?? maximumHp))
  const sunny = createMoveAutomationWeatherResolver(input.map).active()
    .some(weather => weather.kind === 'sunny')
  return sunny || currentHp * 2 < maximumHp ? 2 : 1
}
