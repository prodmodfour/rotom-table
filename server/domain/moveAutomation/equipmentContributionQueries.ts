import type { SheetPlacement } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type {
  EquipmentContributionMetric,
} from '~~/shared/itemAutomation/equipmentContributions'
import type { EquippedItemInstanceV1 } from '~~/shared/itemAutomation/equipment'
import {
  equipmentContributionOwnerContext,
  parseEffectiveEquipmentState,
  resolveEquipmentContributions,
  resolveEquipmentMetric,
  type EquipmentContributionFactContext,
  type EquipmentMetricResolution,
  type ResolveEquipmentContributionsResult,
} from '../itemAutomation/equipmentContributions'
import type { MoveAutomationItemEffectResolver } from './itemEffects'

export interface MoveEquipmentContributionSheetSnapshot {
  readonly kind: 'trainer' | 'pokemon'
  readonly slug: string
  readonly sheet: CharacterSheet | TrainerSheet
}

export interface AuthoritativeMoveEquipmentContributionQueries {
  resolve(input: {
    readonly placementId: string
    readonly facts?: EquipmentContributionFactContext
    readonly includeContextual?: boolean
  }): ResolveEquipmentContributionsResult | null
  metric(input: {
    readonly placementId: string
    readonly metric: EquipmentContributionMetric
    readonly targetId: string
    readonly base: number
    readonly facts?: EquipmentContributionFactContext
  }): EquipmentMetricResolution | null
}

const placementKey = (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>): string => (
  `${placement.sheetKind}:${placement.sheetSlug}`
)

const scopeForInstance = (input: {
  readonly placement: SheetPlacement
  readonly instance: EquippedItemInstanceV1
  readonly slotsByInstance: ReadonlyMap<string, readonly string[]>
}): readonly ('pokemon-held' | 'trainer-accessory' | 'trainer-other-equipment')[] => {
  if (input.placement.sheetKind === 'pokemon') return ['pokemon-held']
  const slots = input.slotsByInstance.get(input.instance.instanceId) ?? []
  return [...new Set(slots.map(slot => (
    slot === 'accessory' ? 'trainer-accessory' as const : 'trainer-other-equipment' as const
  )))]
}

export const createMoveEquipmentContributionQueries = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly sheets: readonly MoveEquipmentContributionSheetSnapshot[]
  readonly itemEffects: MoveAutomationItemEffectResolver
  readonly recordSheetRead?: (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>) => void
  readonly isTransformed?: (placementId: string) => boolean
}): AuthoritativeMoveEquipmentContributionQueries => {
  const placements = new Map(input.placements.map(placement => [placement.id, placement]))
  const sheets = new Map(input.sheets.map(snapshot => [`${snapshot.kind}:${snapshot.slug}`, snapshot.sheet]))

  const resolve: AuthoritativeMoveEquipmentContributionQueries['resolve'] = (request) => {
    const placement = placements.get(request.placementId)
    if (!placement) return null
    const sheet = sheets.get(placementKey(placement))
    if (!sheet?.equipmentState) return null
    input.recordSheetRead?.(placement)
    const state = parseEffectiveEquipmentState({
      equipmentState: sheet.equipmentState,
      ownerKind: placement.sheetKind,
      ownerSlug: placement.sheetSlug,
    })
    const slotsByInstance = new Map<string, string[]>()
    for (const slot of state.slots) {
      if (!slot.instanceId) continue
      const slots = slotsByInstance.get(slot.instanceId) ?? []
      slots.push(slot.slotId)
      slotsByInstance.set(slot.instanceId, slots)
    }
    return resolveEquipmentContributions({
      equipmentState: state,
      owner: equipmentContributionOwnerContext({
        kind: placement.sheetKind,
        slug: placement.sheetSlug,
        sheet,
        transformed: input.isTransformed?.(placement.id) === true,
      }),
      ...(request.facts ? { facts: request.facts } : {}),
      ...(request.includeContextual === true ? { includeContextual: true } : {}),
      isSuppressed: (instance) => {
        const scopes = scopeForInstance({ placement, instance, slotsByInstance })
        if (scopes.length === 0) return true
        return scopes.every(scope => input.itemEffects.resolve({
          placementId: placement.id,
          scope,
          timing: 'static',
        }).suppressed)
      },
    })
  }

  return Object.freeze({
    resolve,
    metric: (
      request: Parameters<AuthoritativeMoveEquipmentContributionQueries['metric']>[0],
    ): EquipmentMetricResolution | null => {
      const resolved = resolve({
        placementId: request.placementId,
        ...(request.facts ? { facts: request.facts } : {}),
      })
      if (!resolved) return null
      return resolveEquipmentMetric({
        contributions: resolved.active,
        metric: request.metric,
        targetId: request.targetId,
        base: request.base,
      })
    },
  })
}
