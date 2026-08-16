import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  parseSheetEquipmentStateForOwner,
  type EquippedItemInstanceV1,
} from '~~/shared/itemAutomation/equipment'
import type { EquipmentGrantV1 } from '~~/shared/itemAutomation/equipmentGrants'
import { parseItemReBreatherState } from '#shared/itemAutomation/guidedAdjudication'
import { evaluateEquipmentCompatibility } from './equipmentCompatibility'
import {
  equipmentContributionOwnerContext,
  type EquipmentContributionOwnerContext,
} from './equipmentContributions'
import { equipmentGrantDefinitionFor } from './equipmentGrantRegistry'

export interface ResolvedEquipmentGrant {
  readonly grant: EquipmentGrantV1
  readonly instanceId: string
  readonly instanceRevision: number
  readonly canonicalItemId: string
}
export interface InactiveEquipmentGrantSource {
  readonly instanceId: string
  readonly canonicalItemId: string
  readonly reasonCode:
    | 'equipment-grant.inactive'
    | 'equipment-grant.definition-missing'
    | 'equipment-grant.definition-stale'
    | 'equipment-grant.compatibility-invalid'
    | 'equipment-grant.suppressed'
    | 'equipment-grant.guided-inactive'
}
export interface ResolveEquipmentGrantsResult {
  readonly active: readonly ResolvedEquipmentGrant[]
  readonly inactive: readonly InactiveEquipmentGrantSource[]
}

const frozen = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) frozen((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}

export const resolveEquipmentGrants = (input: {
  readonly equipmentState: unknown
  readonly owner: EquipmentContributionOwnerContext
  readonly isSuppressed?: (instance: EquippedItemInstanceV1) => boolean
}): ResolveEquipmentGrantsResult => {
  const state = parseSheetEquipmentStateForOwner(input.equipmentState, {
    kind: input.owner.kind,
    slug: input.owner.slug,
  })
  const active: ResolvedEquipmentGrant[] = []
  const inactive: InactiveEquipmentGrantSource[] = []
  for (const instance of state.instances) {
    const inactiveSource = (reasonCode: InactiveEquipmentGrantSource['reasonCode']): void => {
      inactive.push({ instanceId: instance.instanceId, canonicalItemId: instance.canonicalItemId, reasonCode })
    }
    if (instance.activity.status !== 'active') {
      inactiveSource('equipment-grant.inactive')
      continue
    }
    if (input.isSuppressed?.(instance)) {
      inactiveSource('equipment-grant.suppressed')
      continue
    }
    const definition = equipmentGrantDefinitionFor(instance.canonicalItemId)
    if (!definition) {
      inactiveSource('equipment-grant.definition-missing')
      continue
    }
    if (instance.canonicalRecordSha256 !== definition.canonicalRecordSha256
      || instance.equipmentDefinitionSha256 !== definition.equipmentDefinitionSha256) {
      inactiveSource('equipment-grant.definition-stale')
      continue
    }
    if (input.owner.sheet) {
      const requestedSlots = state.slots
        .filter(slot => slot.instanceId === instance.instanceId)
        .map(slot => slot.slotId)
      const compatibility = evaluateEquipmentCompatibility({
        owner: input.owner.kind === 'trainer'
          ? { kind: 'trainer', slug: input.owner.slug, sheet: input.owner.sheet as TrainerSheet }
          : { kind: 'pokemon', slug: input.owner.slug, sheet: input.owner.sheet as CharacterSheet },
        equipmentState: state,
        canonicalItemId: instance.canonicalItemId,
        canonicalRecordSha256: instance.canonicalRecordSha256,
        requestedSlots,
        configuration: instance.configuration,
        currentInstanceId: instance.instanceId,
      })
      if (!compatibility.eligible) {
        inactiveSource('equipment-grant.compatibility-invalid')
        continue
      }
    }
    for (const grant of definition.grants) {
      if (grant.kind === 'capability' && grant.activation === 'while-re-breather-active') {
        try {
          const state = parseItemReBreatherState(instance.serializedState.reBreather)
          if (instance.canonicalItemId !== 'Re-Breather' || state.mode !== 'active') {
            inactiveSource('equipment-grant.guided-inactive')
            continue
          }
        }
        catch {
          inactiveSource('equipment-grant.guided-inactive')
          continue
        }
      }
      active.push({
        grant,
        instanceId: instance.instanceId,
        instanceRevision: instance.revision,
        canonicalItemId: instance.canonicalItemId,
      })
    }
  }
  active.sort((left, right) => left.grant.grantId.localeCompare(right.grant.grantId)
    || left.instanceId.localeCompare(right.instanceId))
  inactive.sort((left, right) => left.instanceId.localeCompare(right.instanceId)
    || left.reasonCode.localeCompare(right.reasonCode))
  return frozen({ active, inactive })
}

export const equipmentGrantOwnerContext = equipmentContributionOwnerContext
