import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  parseSheetEquipmentStateForOwner,
  type EquippedItemInstanceV1,
} from '~~/shared/itemAutomation/equipment'
import {
  equipmentEventProviderOwnerContext,
  resolveEquipmentEventProviders,
  type ResolveEquipmentEventProvidersResult,
} from '../itemAutomation/equipmentEventProviders'
import { baseEffectiveRuntimeAbilityIds } from '../abilityAutomation/effectiveRuntimeAbilities'
import {
  createMoveAutomationItemEffectResolver,
  type MoveAutomationItemEffectResolver,
} from './itemEffects'
import { createMoveAutomationRemainingGlobalFieldResolver } from './remainingGlobalFields'

export interface AuthoritativeMoveEquipmentEventProviderQueries {
  resolve(placementId: string): ResolveEquipmentEventProvidersResult | null
}
const key = (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>): string => (
  `${placement.sheetKind}:${placement.sheetSlug}`
)
const scopesFor = (input: {
  readonly placement: SheetPlacement
  readonly instance: EquippedItemInstanceV1
  readonly slotsByInstance: ReadonlyMap<string, readonly string[]>
}): readonly ('pokemon-held' | 'trainer-accessory' | 'trainer-other-equipment')[] => {
  if (input.placement.sheetKind === 'pokemon') return ['pokemon-held']
  const slots = input.slotsByInstance.get(input.instance.instanceId) ?? []
  return [...new Set(slots.map(slot => slot === 'accessory'
    ? 'trainer-accessory' as const
    : 'trainer-other-equipment' as const))]
}

export const createMoveEquipmentEventProviderQueries = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly sheets: readonly {
    readonly kind: 'trainer' | 'pokemon'
    readonly slug: string
    readonly sheet: CharacterSheet | TrainerSheet
  }[]
  readonly itemEffects: MoveAutomationItemEffectResolver
  readonly recordSheetRead?: (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>) => void
  readonly isTransformed?: (placementId: string) => boolean
}): AuthoritativeMoveEquipmentEventProviderQueries => {
  const placements = new Map(input.placements.map(placement => [placement.id, placement]))
  const sheets = new Map(input.sheets.map(snapshot => [`${snapshot.kind}:${snapshot.slug}`, snapshot.sheet]))
  return Object.freeze({
    resolve: (placementId: string): ResolveEquipmentEventProvidersResult | null => {
      const placement = placements.get(placementId)
      if (!placement) return null
      const sheet = sheets.get(key(placement))
      if (!sheet?.equipmentState) return null
      input.recordSheetRead?.(placement)
      const state = parseSheetEquipmentStateForOwner(sheet.equipmentState, {
        kind: placement.sheetKind,
        slug: placement.sheetSlug,
      })
      const slotsByInstance = new Map<string, string[]>()
      for (const slot of state.slots) {
        if (!slot.instanceId) continue
        const slots = slotsByInstance.get(slot.instanceId) ?? []
        slots.push(slot.slotId)
        slotsByInstance.set(slot.instanceId, slots)
      }
      return resolveEquipmentEventProviders({
        equipmentState: state,
        owner: equipmentEventProviderOwnerContext({
          kind: placement.sheetKind,
          slug: placement.sheetSlug,
          sheet,
          transformed: input.isTransformed?.(placement.id) === true,
        }),
        isSuppressed: (instance) => {
          const scopes = scopesFor({ placement, instance, slotsByInstance })
          return scopes.length === 0 || scopes.every(scope => input.itemEffects.resolve({
            placementId: placement.id,
            scope,
            timing: 'static',
          }).suppressed)
        },
      })
    },
  })
}

export const createEncounterEquipmentEventProviderQueries = (input: {
  readonly map: TabletopMap
  readonly sheets: readonly {
    readonly kind: 'trainer' | 'pokemon'
    readonly slug: string
    readonly sheet: CharacterSheet | TrainerSheet
  }[]
}): AuthoritativeMoveEquipmentEventProviderQueries => {
  const bySheet = new Map(input.sheets.map(snapshot => [`${snapshot.kind}:${snapshot.slug}`, snapshot.sheet]))
  const byPlacement = new Map(input.map.placements.map(placement => [placement.id, placement]))
  const itemEffects = createMoveAutomationItemEffectResolver({
    placements: input.map.placements,
    globalFields: createMoveAutomationRemainingGlobalFieldResolver(input.map),
    effects: input.map.encounterState?.effects ?? [],
    suppressAllForPlacement: (placementId) => {
      const placement = byPlacement.get(placementId)
      const sheet = placement ? bySheet.get(key(placement)) : null
      return Boolean(placement && sheet && baseEffectiveRuntimeAbilityIds({
        map: input.map,
        placement,
        sheet,
      }).includes('Klutz'))
    },
  })
  return createMoveEquipmentEventProviderQueries({
    placements: input.map.placements,
    sheets: input.sheets,
    itemEffects,
    isTransformed: placementId => (
      input.map.encounterState?.abilityTransformations?.entries.some(snapshot => (
        snapshot.placementId === placementId && snapshot.kind === 'transformation'
      )) === true
    ),
  })
}
