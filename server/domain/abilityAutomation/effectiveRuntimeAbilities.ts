import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { parseCapabilityLabel } from '#shared/capabilityAutomation/catalog'
import { projectAuthoritativeEffectiveAbilities } from './effectiveAbilities'
import type { AuthoritativeEffectiveAbility } from './context'
import { resolveSheetAndEdgeAbilityInstances } from '../edgeAutomation/permanentGrants'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import {
  ABILITY_AUTOMATION_RUNTIME_REGISTRY,
  type AbilityAutomationRuntimeRegistry,
} from './registry'

/** Fainted owners retain durable overlays but cannot use Abilities unless a rule says otherwise. */
export const authoritativeAbilityOwnerIsConscious = (
  sheet: CharacterSheet | TrainerSheet,
): boolean => {
  const currentHp = 'species' in sheet ? sheet.combat?.currentHp : sheet.currentHp
  const conditions = 'species' in sheet ? sheet.combat?.conditions : sheet.conditions
  return (currentHp === undefined || currentHp > 0)
    && !(conditions ?? []).some(condition => condition.trim().toLowerCase() === 'fainted')
}

export const hasEffectiveSoullessCapability = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
  readonly sheet: CharacterSheet | TrainerSheet
}): boolean => {
  if (!('species' in input.sheet) || !pokemonHasResolvedCapability(input.sheet, 'Soulless')) return false
  return !(input.map.encounterState?.effects ?? []).some(effect => {
    if (effect.kind !== 'capability' || effect.payload.action === 'grant'
      || effect.suppression.sources.length > 0
      || (effect.duration.remaining !== null && effect.duration.remaining <= 0)
      || !effect.affected.placementIds.includes(input.placementId)) return false
    const parsed = parseCapabilityLabel(effect.payload.capabilityId
      .replace(/^(?:capability|movement)[.:]/i, '')
      .replace(/[._-]+/g, ' '))
    return parsed.canonicalId === 'Soulless'
  })
}

export interface EffectiveRuntimeAbilitiesInput {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
  readonly sheet: CharacterSheet | TrainerSheet
  /** Test/recovery seam; production callers use the manifest-selected registry. */
  readonly abilityRuntimeRegistry?: AbilityAutomationRuntimeRegistry
}

/** Exact manifest-selected effective ability instances for authoritative non-Move paths. */
export const effectiveRuntimeAbilities = (
  input: EffectiveRuntimeAbilitiesInput,
): readonly AuthoritativeEffectiveAbility[] => {
  if (!authoritativeAbilityOwnerIsConscious(input.sheet)) return Object.freeze([])
  const sheetAbilityInstances = resolveSheetAndEdgeAbilityInstances(input.sheet)
  const soullessWonderGuard = hasEffectiveSoullessCapability({
    map: input.map,
    placementId: input.placement.id,
    sheet: input.sheet,
  })
    && !sheetAbilityInstances.some(ability => ability.canonicalId === 'Wonder Guard')
    ? [{
        instanceId: `capability:${input.placement.id}:Soulless:Wonder_Guard`,
        canonicalId: 'Wonder Guard',
        parameterStatus: 'not-parameterized' as const,
        parameterData: null,
      }]
    : []
  return Object.freeze(projectAuthoritativeEffectiveAbilities({
    baseAbilities: [...sheetAbilityInstances, ...soullessWonderGuard],
    species: 'species' in input.sheet ? input.sheet.species : null,
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).filter((ability) => {
    if (!ability.effective) return false
    const runtime = (input.abilityRuntimeRegistry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY)
      .resolve(ability.canonicalId)
    return runtime !== null
      && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash)
  }))
}

/** Exact manifest-selected effective ability names for authoritative non-Move paths. */
export const effectiveRuntimeAbilityIds = (
  input: EffectiveRuntimeAbilitiesInput,
): readonly string[] => Object.freeze(
  effectiveRuntimeAbilities(input).map(ability => ability.canonicalId),
)
