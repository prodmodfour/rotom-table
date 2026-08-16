import { createHash } from 'node:crypto'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { stableJsonStringify } from '~~/shared/automation/stableJson'
import {
  parseSheetEquipmentStateForOwner,
  type EquippedItemInstanceV1,
} from '~~/shared/itemAutomation/equipment'
import type { EquipmentEventProviderV1 } from '~~/shared/itemAutomation/equipmentEventProviders'
import { evaluateEquipmentCompatibility } from './equipmentCompatibility'
import {
  equipmentContributionOwnerContext,
  type EquipmentContributionOwnerContext,
} from './equipmentContributions'
import {
  equipmentEventProviderDefinitionFor,
  equipmentEventProviderDefinitionSha256,
} from './equipmentEventProviderRegistry'

export interface ResolvedEquipmentEventProvider {
  readonly provider: EquipmentEventProviderV1
  /** Private server-only source identity. Never project this value. */
  readonly instanceId: string
  readonly instanceRevision: number
  readonly canonicalItemId: string
  readonly providerDefinitionSha256: string
  /** Opaque stable source/provider binding used by receipts and frequency ledgers. */
  readonly sourceBindingSha256: string
  /** Strict reviewed configuration, retained only inside the authoritative runtime. */
  readonly configuration: unknown
}
export interface InactiveEquipmentEventProviderSource {
  readonly instanceId: string
  readonly canonicalItemId: string
  readonly reasonCode:
    | 'equipment-provider.inactive'
    | 'equipment-provider.definition-missing'
    | 'equipment-provider.definition-stale'
    | 'equipment-provider.compatibility-invalid'
    | 'equipment-provider.suppressed'
}
export interface ResolveEquipmentEventProvidersResult {
  readonly active: readonly ResolvedEquipmentEventProvider[]
  readonly inactive: readonly InactiveEquipmentEventProviderSource[]
}

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'equipmentProviderBinding',
    limits: { maxDepth: 8, maxNodes: 1_000, maxObjectFields: 32, maxArrayEntries: 64, maxStringLength: 500 },
  }))
  .digest('hex')
const frozen = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) frozen((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}

export const resolveEquipmentEventProviders = (input: {
  readonly equipmentState: unknown
  readonly owner: EquipmentContributionOwnerContext
  readonly isSuppressed?: (instance: EquippedItemInstanceV1) => boolean
}): ResolveEquipmentEventProvidersResult => {
  const state = parseSheetEquipmentStateForOwner(input.equipmentState, {
    kind: input.owner.kind,
    slug: input.owner.slug,
  })
  const active: ResolvedEquipmentEventProvider[] = []
  const inactive: InactiveEquipmentEventProviderSource[] = []
  for (const instance of state.instances) {
    const inactiveSource = (reasonCode: InactiveEquipmentEventProviderSource['reasonCode']): void => {
      inactive.push({ instanceId: instance.instanceId, canonicalItemId: instance.canonicalItemId, reasonCode })
    }
    if (instance.activity.status !== 'active') {
      inactiveSource('equipment-provider.inactive')
      continue
    }
    if (input.isSuppressed?.(instance)) {
      inactiveSource('equipment-provider.suppressed')
      continue
    }
    const definition = equipmentEventProviderDefinitionFor(instance.canonicalItemId)
    const definitionHash = equipmentEventProviderDefinitionSha256(instance.canonicalItemId)
    if (!definition || !definitionHash) {
      inactiveSource('equipment-provider.definition-missing')
      continue
    }
    if (instance.canonicalRecordSha256 !== definition.canonicalRecordSha256
      || instance.equipmentDefinitionSha256 !== definition.equipmentDefinitionSha256) {
      inactiveSource('equipment-provider.definition-stale')
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
        inactiveSource('equipment-provider.compatibility-invalid')
        continue
      }
    }
    for (const provider of definition.providers) {
      active.push({
        provider,
        instanceId: instance.instanceId,
        instanceRevision: instance.revision,
        canonicalItemId: instance.canonicalItemId,
        providerDefinitionSha256: definitionHash,
        sourceBindingSha256: sha256({
          schemaVersion: 1,
          ownerKind: input.owner.kind,
          ownerSlug: input.owner.slug,
          instanceId: instance.instanceId,
          providerId: provider.providerId,
          providerDefinitionSha256: definitionHash,
        }),
        configuration: instance.configuration,
      })
    }
  }
  active.sort((left, right) => right.provider.priority - left.provider.priority
    || left.provider.providerId.localeCompare(right.provider.providerId)
    || left.instanceId.localeCompare(right.instanceId))
  inactive.sort((left, right) => left.instanceId.localeCompare(right.instanceId)
    || left.reasonCode.localeCompare(right.reasonCode))
  return frozen({ active, inactive })
}

export const equipmentEventProviderOwnerContext = equipmentContributionOwnerContext
