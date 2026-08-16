import { stableJsonStringify } from '~~/shared/automation/stableJson'
import {
  parseSheetEquipmentStateForOwner,
  type EquipmentActivityReasonV1,
  type EquipmentActivityStatus,
  type SheetEquipmentStateV1,
} from '~~/shared/itemAutomation/equipment'
import {
  evaluateEquipmentCompatibility,
  type EquipmentCompatibilityOwner,
  type EquipmentCompatibilityReasonCode,
} from './equipmentCompatibility'

const MANAGED_REASON_CODES = new Set<string>([
  'equipment.definition-pending',
  'equipment.definition-unavailable',
  'equipment.record-stale',
  'equipment.owner-incompatible',
  'equipment.slot-incompatible',
  'equipment.slot-occupied',
  'equipment.unresolved-slot',
  'equipment.exclusivity-conflict',
  'equipment.configuration-required',
  'equipment.configuration-unexpected',
  'equipment.configuration-invalid',
  'equipment.configuration-stale',
  'equipment.capability-required',
  'equipment.skill-required',
  'equipment.species-incompatible',
  'equipment.evolution-stage-incompatible',
] satisfies readonly (EquipmentCompatibilityReasonCode | 'equipment.definition-pending')[])

export interface EquipmentCompatibilityReconciliationResult {
  readonly changed: boolean
  readonly state: SheetEquipmentStateV1
}

const nextRevision = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} cannot advance within the safe integer range.`)
  }
  return value + 1
}

const activityStatus = (input: {
  readonly current: EquipmentActivityStatus
  readonly unmanaged: readonly EquipmentActivityReasonV1[]
  readonly compatibility: readonly EquipmentActivityReasonV1[]
}): EquipmentActivityStatus => {
  if (!input.unmanaged.length && !input.compatibility.length) return 'active'
  const breakage = input.unmanaged.some(reason => reason.code.startsWith('equipment.breakage.'))
  const inactive = input.unmanaged.some(reason => reason.code.startsWith('equipment.inactive.'))
  const suppressed = input.unmanaged.some(reason => reason.code.startsWith('equipment.suppression.'))
  const unknown = input.unmanaged.some(reason => !reason.code.startsWith('equipment.breakage.')
    && !reason.code.startsWith('equipment.inactive.')
    && !reason.code.startsWith('equipment.suppression.'))
  if (breakage || (unknown && input.current === 'broken')) return 'broken'
  if (input.compatibility.length || inactive || (unknown && input.current === 'inactive')) return 'inactive'
  if (suppressed || (unknown && input.current === 'suppressed')) return 'suppressed'
  return 'inactive'
}

/**
 * Revalidate every assigned whole item against current reviewed definitions.
 * Dynamic source-loss/suppression/breakage reasons are preserved verbatim;
 * only compatibility-owned reasons are replaced.
 */
export const reconcileSheetEquipmentCompatibility = (input: {
  readonly owner: EquipmentCompatibilityOwner
  readonly equipmentState: SheetEquipmentStateV1
  /** False only while constructing a never-persisted migration document. */
  readonly incrementStateRevision?: boolean
}): EquipmentCompatibilityReconciliationResult => {
  const state = parseSheetEquipmentStateForOwner(input.equipmentState, {
    kind: input.owner.kind,
    slug: input.owner.slug,
  })
  let changed = false
  const instances = state.instances.map((instance) => {
    const requestedSlots = state.slots
      .filter(slot => slot.instanceId === instance.instanceId)
      .map(slot => slot.slotId)
    const compatibility = evaluateEquipmentCompatibility({
      owner: input.owner,
      equipmentState: state,
      canonicalItemId: instance.canonicalItemId,
      canonicalRecordSha256: instance.canonicalRecordSha256,
      requestedSlots,
      configuration: instance.configuration,
      currentInstanceId: instance.instanceId,
    })
    const unmanaged = instance.activity.reasons.filter(row => !MANAGED_REASON_CODES.has(row.code))
    const compatibilityReasons: EquipmentActivityReasonV1[] = compatibility.reasons.map(row => ({
      code: row.code,
      sourceId: row.sourceId,
    }))
    if (compatibility.equipmentDefinitionSha256 === null) compatibilityReasons.push({
      code: 'equipment.definition-pending',
      sourceId: instance.activity.reasons.find(row => row.code === 'equipment.definition-pending')?.sourceId
        ?? instance.equippedByOperationId,
    })
    const reasons = [...unmanaged, ...compatibilityReasons]
    const status = activityStatus({ current: instance.activity.status, unmanaged, compatibility: compatibilityReasons })
    const definitionHash = compatibility.equipmentDefinitionSha256
    const activity = { status, reasons }
    if (definitionHash === instance.equipmentDefinitionSha256
      && stableJsonStringify(activity) === stableJsonStringify(instance.activity)) return instance
    changed = true
    return {
      ...instance,
      revision: input.incrementStateRevision === false
        ? instance.revision
        : nextRevision(instance.revision, `Equipment instance ${instance.instanceId} revision`),
      equipmentDefinitionSha256: definitionHash,
      activity,
    }
  })
  if (!changed) return Object.freeze({ changed: false, state })
  const revision = input.incrementStateRevision === false
    ? state.revision
    : nextRevision(state.revision, `${input.owner.kind} equipment state revision`)
  return Object.freeze({
    changed: true,
    state: parseSheetEquipmentStateForOwner({ ...state, revision, instances }, {
      kind: input.owner.kind,
      slug: input.owner.slug,
    }),
  })
}
