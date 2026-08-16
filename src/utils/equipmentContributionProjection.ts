import type {
  EquipmentContributionMetric,
  EquipmentContributionProjectionSourceV1,
  EquipmentContributionProjectionV1,
} from '#shared/itemAutomation/equipmentContributions'
import type { SheetEquipmentProjectionV1 } from '#shared/itemAutomation/equipment'

export interface EquipmentContributionProjectionCarrier {
  readonly slug?: string
  readonly equipmentContributionProjection?: EquipmentContributionProjectionV1
  readonly equipmentProjection?: SheetEquipmentProjectionV1
}

/** Presentation-only Magic Room filter. Server mechanics always use exact instance scope. */
export const equipmentProjectionSourceSuppressedByMagicRoom = (
  sheet: EquipmentContributionProjectionCarrier | null | undefined,
  source: EquipmentContributionProjectionSourceV1,
): boolean => {
  const equipment = sheet?.equipmentProjection
  if (!equipment || equipment.owner.slug !== sheet?.slug) return true
  if (equipment.owner.kind === 'pokemon') return true
  const instanceIds = new Set(equipment.instances.filter(instance => (
    instance.activity.status === 'active' && instance.canonicalItemId === source.sourceLabel
  )).map(instance => instance.instanceId))
  const slots = equipment.slots.filter(slot => slot.instanceId && instanceIds.has(slot.instanceId))
  return slots.length === 0 || slots.every(slot => slot.slotId === 'accessory')
}

const projectionFor = (
  sheet: EquipmentContributionProjectionCarrier | null | undefined,
): EquipmentContributionProjectionV1 | null => {
  const projection = sheet?.equipmentContributionProjection
  if (!projection || projection.owner.slug !== sheet?.slug) return null
  return projection
}

export const projectedEquipmentContributionSources = (input: {
  readonly sheet: EquipmentContributionProjectionCarrier | null | undefined
  readonly metric: EquipmentContributionMetric
  readonly targetId: string
  /** Contextual sources are presentation-only unless an authoritative caller supplies their facts. */
  readonly includeContextual?: boolean
  readonly sourceFilter?: (source: EquipmentContributionProjectionSourceV1) => boolean
}): readonly EquipmentContributionProjectionSourceV1[] => {
  const row = projectionFor(input.sheet)?.values.find(value => (
    value.metric === input.metric && value.targetId === input.targetId && !value.conflict
  ))
  if (!row) return []
  return row.sources.filter(source => (
    (input.includeContextual === true || source.conditionLabels.length === 0)
    && (input.sourceFilter?.(source) ?? true)
  ))
}

export const applyProjectedEquipmentContributions = (input: {
  readonly sheet: EquipmentContributionProjectionCarrier | null | undefined
  readonly metric: EquipmentContributionMetric
  readonly targetId: string
  readonly base: number
  readonly includeContextual?: boolean
  readonly sourceFilter?: (source: EquipmentContributionProjectionSourceV1) => boolean
}): number => {
  if (!Number.isFinite(input.base)) return input.base
  let value = input.base
  for (const source of projectedEquipmentContributionSources(input)) {
    if (source.operation === 'add') {
      const before = value
      value += source.value
      if (source.cap !== null) value = Math.max(before, Math.min(value, source.cap))
    }
    else if (source.operation === 'multiply-floor') value = Math.floor(value * source.value)
    else value = source.value
  }
  return value
}

export const projectedEquipmentContributionDelta = (input: {
  readonly sheet: EquipmentContributionProjectionCarrier | null | undefined
  readonly metric: EquipmentContributionMetric
  readonly targetId: string
  readonly base?: number
}): number => {
  const base = input.base ?? 0
  return applyProjectedEquipmentContributions({ ...input, base }) - base
}
