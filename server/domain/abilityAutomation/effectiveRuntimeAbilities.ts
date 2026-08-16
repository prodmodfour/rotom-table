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
import { createEncounterEquipmentGrantQueries } from '../moveAutomation/equipmentGrantQueries'
import { activeReviewedItemFormChange } from '../itemAutomation/formChanges'

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
  readonly map: Pick<TabletopMap, 'encounterState'> & Partial<Omit<TabletopMap, 'encounterState'>>
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
    & Partial<Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>>
  readonly sheet: CharacterSheet | TrainerSheet
  /** Test/recovery seam; production callers use the manifest-selected registry. */
  readonly abilityRuntimeRegistry?: AbilityAutomationRuntimeRegistry
}

/** Exact manifest-selected effective ability instances for authoritative non-Move paths. */
export const baseEffectiveRuntimeAbilities = (
  input: EffectiveRuntimeAbilitiesInput,
): readonly AuthoritativeEffectiveAbility[] => {
  if (!authoritativeAbilityOwnerIsConscious(input.sheet)) return Object.freeze([])
  const sheetAbilityInstances = resolveSheetAndEdgeAbilityInstances(input.sheet)
  const itemFormChange = 'species' in input.sheet
    ? activeReviewedItemFormChange({
        map: input.map,
        placementId: input.placement.id,
        pokemonSheet: input.sheet,
      })
    : null
  const itemFormAbility = itemFormChange ? [{
    instanceId: `item-form-change:${input.placement.id}:${itemFormChange.entry.abilityId.toLocaleLowerCase('en-US').replaceAll(' ', '-')}`,
    canonicalId: itemFormChange.entry.abilityId,
    parameterStatus: 'not-parameterized' as const,
    parameterData: null,
  }] : []
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
    baseAbilities: [...sheetAbilityInstances, ...soullessWonderGuard, ...itemFormAbility],
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

export const baseEffectiveRuntimeAbilityIds = (
  input: EffectiveRuntimeAbilitiesInput,
): readonly string[] => Object.freeze(
  baseEffectiveRuntimeAbilities(input).map(ability => ability.canonicalId),
)

/** Exact base plus active, hash-current while-equipped Ability grants. */
export const effectiveRuntimeAbilities = (
  input: EffectiveRuntimeAbilitiesInput,
): readonly AuthoritativeEffectiveAbility[] => {
  const base = baseEffectiveRuntimeAbilities(input)
  if (!authoritativeAbilityOwnerIsConscious(input.sheet)
    || !input.sheet.equipmentState
    || input.placement.sheetKind === undefined
    || input.placement.sheetSlug === undefined
    || !Array.isArray(input.map.placements)) return base
  const map = input.map as TabletopMap
  const placement = input.placement as SheetPlacement
  const grants = createEncounterEquipmentGrantQueries({
    map,
    sheets: [{
      kind: placement.sheetKind,
      slug: placement.sheetSlug,
      sheet: input.sheet,
    }],
  }).resolve(placement.id)?.active ?? []
  const ordinals = new Map<string, number>()
  const equipmentAbilities = grants.flatMap((entry) => {
    if (entry.grant.kind !== 'ability') return []
    const ordinal = (ordinals.get(entry.grant.grantId) ?? 0) + 1
    ordinals.set(entry.grant.grantId, ordinal)
    return [{
      instanceId: `equipment-grant:${placement.id}:${entry.grant.grantId}:${ordinal}`,
      canonicalId: entry.grant.canonicalId,
      parameterStatus: 'not-parameterized' as const,
      parameterData: null,
    }]
  })
  if (equipmentAbilities.length === 0) return base
  const projected = projectAuthoritativeEffectiveAbilities({
    baseAbilities: equipmentAbilities,
    species: 'species' in input.sheet ? input.sheet.species : null,
    target: {
      placementId: placement.id,
      ...(placement.sideId ? { sideId: placement.sideId } : {}),
      position: placement.position,
    },
    effects: map.encounterState?.effects ?? [],
    transformationSnapshots: map.encounterState?.abilityTransformations,
  }).filter((ability) => {
    if (!ability.effective) return false
    const runtime = (input.abilityRuntimeRegistry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY)
      .resolve(ability.canonicalId)
    return runtime !== null
      && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash)
  })
  return Object.freeze([...base, ...projected])
}

/** Exact manifest-selected effective ability names for authoritative non-Move paths. */
export const effectiveRuntimeAbilityIds = (
  input: EffectiveRuntimeAbilitiesInput,
): readonly string[] => Object.freeze(
  effectiveRuntimeAbilities(input).map(ability => ability.canonicalId),
)
