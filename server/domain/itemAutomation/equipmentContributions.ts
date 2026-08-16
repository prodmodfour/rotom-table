import type { StrictJsonValue } from '~~/shared/automation/strictJson'
import {
  parseSheetEquipmentStateForOwner,
  type EquippedItemInstanceV1,
  type EquipmentOwnerKind,
  type SheetEquipmentStateV1,
} from '~~/shared/itemAutomation/equipment'
import type {
  EquipmentContributionMetric,
  EquipmentContributionOperation,
  EquipmentContributionPredicateV1,
  EquipmentContributionV1,
} from '~~/shared/itemAutomation/equipmentContributions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { equipmentContributionDefinitionFor } from './equipmentContributionRegistry'
import { evaluateEquipmentCompatibility } from './equipmentCompatibility'

export interface EquipmentContributionOwnerContext {
  readonly kind: EquipmentOwnerKind
  readonly slug: string
  readonly speciesId: string | null
  /** True only while an authoritative transformation currently changes the owner. */
  readonly transformed: boolean
  /** Current authoritative sheet used to revalidate dynamic compatibility. */
  readonly sheet?: CharacterSheet | TrainerSheet
}

export interface EquipmentContributionFactContext {
  readonly environmentIds?: ReadonlySet<'ice-or-deep-snow' | 'fully-submerged'>
  readonly moveType?: string | null
  readonly effectivenessMultiplier?: number | null
  readonly criticalHit?: boolean
}

export interface ResolvedEquipmentContribution {
  readonly contributionId: string
  readonly instanceId: string
  readonly instanceRevision: number
  readonly canonicalItemId: string
  readonly metric: EquipmentContributionMetric
  readonly targetIds: readonly string[]
  readonly operation: EquipmentContributionOperation
  readonly value: number
  readonly cap: number | null
  readonly conditionLabels: readonly string[]
}

export interface InactiveEquipmentContributionSource {
  readonly instanceId: string
  readonly canonicalItemId: string
  readonly reasonCode:
    | 'equipment-contribution.inactive'
    | 'equipment-contribution.definition-missing'
    | 'equipment-contribution.definition-stale'
    | 'equipment-contribution.configuration-invalid'
    | 'equipment-contribution.compatibility-invalid'
    | 'equipment-contribution.predicate-not-met'
    | 'equipment-contribution.suppressed'
}

export interface ResolveEquipmentContributionsResult {
  readonly active: readonly ResolvedEquipmentContribution[]
  readonly inactive: readonly InactiveEquipmentContributionSource[]
}

export interface EquipmentMetricContributionStep {
  readonly contributionId: string
  readonly instanceId: string
  readonly canonicalItemId: string
  readonly operation: EquipmentContributionOperation
  readonly value: number
  readonly cap: number | null
  readonly before: number
  readonly applied: number
  readonly after: number
}

export interface EquipmentMetricResolution {
  readonly metric: EquipmentContributionMetric
  readonly targetId: string
  readonly base: number
  readonly contributions: readonly EquipmentMetricContributionStep[]
  readonly final: number
  readonly conflict: boolean
  readonly conflictReason: string | null
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}

const normalized = (value: string): string => value.trim().normalize('NFC').toLocaleLowerCase('en-US')

const configurationValue = (
  instance: EquippedItemInstanceV1,
  field: string,
): StrictJsonValue | undefined => instance.configuration?.values[field]

const resolveTargets = (
  definition: EquipmentContributionV1,
  instance: EquippedItemInstanceV1,
): readonly string[] | null => {
  if (definition.target.kind === 'fixed') return definition.target.ids
  const value = configurationValue(instance, definition.target.field)
  if (definition.target.kind === 'configuration') {
    return typeof value === 'string' && value.trim() ? [value] : null
  }
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !entry.trim())) return null
  const targets = value as string[]
  return new Set(targets).size === targets.length ? targets : null
}

const isFactPredicate = (predicate: EquipmentContributionPredicateV1): boolean => [
  'environment', 'effectiveness', 'critical-hit', 'move-type', 'move-type-configuration',
].includes(predicate.kind)

const predicateLabel = (
  predicate: EquipmentContributionPredicateV1,
  instance: EquippedItemInstanceV1,
): string | null => {
  if (predicate.kind === 'environment') return predicate.environmentId === 'fully-submerged' ? 'Fully submerged' : 'On ice or deep snow'
  if (predicate.kind === 'effectiveness') return 'Super-effective direct damage'
  if (predicate.kind === 'critical-hit') return 'Critical-hit damage'
  if (predicate.kind === 'move-type') return `${predicate.typeId}-type`
  if (predicate.kind === 'move-type-configuration') {
    const value = configurationValue(instance, predicate.field)
    return typeof value === 'string' ? `${value}-type` : null
  }
  return null
}

const predicateMatches = (
  predicate: EquipmentContributionPredicateV1,
  instance: EquippedItemInstanceV1,
  owner: EquipmentContributionOwnerContext,
  facts: EquipmentContributionFactContext,
): boolean => {
  if (predicate.kind === 'environment') return facts.environmentIds?.has(predicate.environmentId) === true
  if (predicate.kind === 'effectiveness') {
    return typeof facts.effectivenessMultiplier === 'number' && facts.effectivenessMultiplier > 1
  }
  if (predicate.kind === 'critical-hit') return facts.criticalHit === true
  if (predicate.kind === 'owner-untransformed') return !owner.transformed
  if (predicate.kind === 'move-type') {
    return typeof facts.moveType === 'string' && normalized(facts.moveType) === normalized(predicate.typeId)
  }
  if (predicate.kind === 'move-type-configuration') {
    const configured = configurationValue(instance, predicate.field)
    return typeof configured === 'string' && typeof facts.moveType === 'string'
      && normalized(configured) === normalized(facts.moveType)
  }
  if (predicate.kind === 'owner-species') {
    return owner.speciesId !== null
      && predicate.speciesIds.some(species => normalized(species) === normalized(owner.speciesId!))
  }
  const configured = configurationValue(instance, predicate.field)
  if (predicate.kind === 'configuration-equals') return configured === predicate.value
  return typeof configured === 'string' && predicate.values.includes(configured)
}

export const equipmentContributionOwnerContext = (input: {
  readonly kind: EquipmentOwnerKind
  readonly slug: string
  readonly sheet: CharacterSheet | TrainerSheet
  readonly transformed?: boolean
}): EquipmentContributionOwnerContext => ({
  kind: input.kind,
  slug: input.slug,
  speciesId: input.kind === 'pokemon' ? (input.sheet as CharacterSheet).species : null,
  transformed: input.transformed === true,
  sheet: input.sheet,
})

export const resolveEquipmentContributions = (input: {
  readonly equipmentState: unknown
  readonly owner: EquipmentContributionOwnerContext
  readonly facts?: EquipmentContributionFactContext
  /** Encounter overlays such as Magic Room can suppress one otherwise active whole item. */
  readonly isSuppressed?: (instance: EquippedItemInstanceV1) => boolean
  /** Inspector mode retains fact-dependent definitions as labelled conditional values. */
  readonly includeContextual?: boolean
}): ResolveEquipmentContributionsResult => {
  const state = parseSheetEquipmentStateForOwner(input.equipmentState, {
    kind: input.owner.kind,
    slug: input.owner.slug,
  })
  const facts = input.facts ?? {}
  const active: ResolvedEquipmentContribution[] = []
  const inactive: InactiveEquipmentContributionSource[] = []
  for (const instance of state.instances) {
    if (instance.activity.status !== 'active') {
      inactive.push({
        instanceId: instance.instanceId,
        canonicalItemId: instance.canonicalItemId,
        reasonCode: 'equipment-contribution.inactive',
      })
      continue
    }
    if (input.isSuppressed?.(instance)) {
      inactive.push({
        instanceId: instance.instanceId,
        canonicalItemId: instance.canonicalItemId,
        reasonCode: 'equipment-contribution.suppressed',
      })
      continue
    }
    const definition = equipmentContributionDefinitionFor(instance.canonicalItemId)
    if (!definition) {
      inactive.push({
        instanceId: instance.instanceId,
        canonicalItemId: instance.canonicalItemId,
        reasonCode: 'equipment-contribution.definition-missing',
      })
      continue
    }
    if (instance.canonicalRecordSha256 !== definition.canonicalRecordSha256
      || instance.equipmentDefinitionSha256 !== definition.equipmentDefinitionSha256) {
      inactive.push({
        instanceId: instance.instanceId,
        canonicalItemId: instance.canonicalItemId,
        reasonCode: 'equipment-contribution.definition-stale',
      })
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
        inactive.push({
          instanceId: instance.instanceId,
          canonicalItemId: instance.canonicalItemId,
          reasonCode: 'equipment-contribution.compatibility-invalid',
        })
        continue
      }
    }
    for (const contribution of definition.contributions) {
      const targetIds = resolveTargets(contribution, instance)
      if (!targetIds) {
        inactive.push({
          instanceId: instance.instanceId,
          canonicalItemId: instance.canonicalItemId,
          reasonCode: 'equipment-contribution.configuration-invalid',
        })
        continue
      }
      if (!contribution.predicates.every(predicate => (
        (input.includeContextual === true && isFactPredicate(predicate))
        || predicateMatches(predicate, instance, input.owner, facts)
      ))) {
        inactive.push({
          instanceId: instance.instanceId,
          canonicalItemId: instance.canonicalItemId,
          reasonCode: 'equipment-contribution.predicate-not-met',
        })
        continue
      }
      active.push({
        contributionId: contribution.contributionId,
        instanceId: instance.instanceId,
        instanceRevision: instance.revision,
        canonicalItemId: instance.canonicalItemId,
        metric: contribution.metric,
        targetIds,
        operation: contribution.operation,
        value: contribution.value,
        cap: contribution.cap,
        conditionLabels: contribution.predicates
          .flatMap(predicate => predicateLabel(predicate, instance) ?? []),
      })
    }
  }
  active.sort((left, right) => left.contributionId.localeCompare(right.contributionId)
    || left.instanceId.localeCompare(right.instanceId))
  inactive.sort((left, right) => left.instanceId.localeCompare(right.instanceId)
    || left.reasonCode.localeCompare(right.reasonCode))
  return deepFreeze({ active, inactive })
}

const operationOrder: Record<EquipmentContributionOperation, number> = {
  add: 0,
  'multiply-floor': 1,
  set: 2,
}

export const resolveEquipmentMetric = (input: {
  readonly contributions: readonly ResolvedEquipmentContribution[]
  readonly metric: EquipmentContributionMetric
  readonly targetId: string
  readonly base: number
}): EquipmentMetricResolution => {
  if (!Number.isFinite(input.base)) throw new Error('Equipment metric base must be finite.')
  const matching = input.contributions.filter(contribution => (
    contribution.metric === input.metric && contribution.targetIds.includes(input.targetId)
  )).sort((left, right) => operationOrder[left.operation] - operationOrder[right.operation]
    || left.contributionId.localeCompare(right.contributionId)
    || left.instanceId.localeCompare(right.instanceId))
  const setValues = [...new Set(matching.filter(row => row.operation === 'set').map(row => row.value))]
  if (setValues.length > 1) {
    return deepFreeze({
      metric: input.metric,
      targetId: input.targetId,
      base: input.base,
      contributions: matching.map(contribution => ({
        contributionId: contribution.contributionId,
        instanceId: contribution.instanceId,
        canonicalItemId: contribution.canonicalItemId,
        operation: contribution.operation,
        value: contribution.value,
        cap: contribution.cap,
        before: input.base,
        applied: 0,
        after: input.base,
      })),
      final: input.base,
      conflict: true,
      conflictReason: 'Conflicting equipment sources set different default values.',
    })
  }
  let current = input.base
  const steps: EquipmentMetricContributionStep[] = []
  for (const contribution of matching) {
    const before = current
    if (contribution.operation === 'add') {
      current += contribution.value
      if (contribution.cap !== null) current = Math.max(before, Math.min(current, contribution.cap))
    }
    else if (contribution.operation === 'multiply-floor') current = Math.floor(current * contribution.value)
    else current = contribution.value
    steps.push({
      contributionId: contribution.contributionId,
      instanceId: contribution.instanceId,
      canonicalItemId: contribution.canonicalItemId,
      operation: contribution.operation,
      value: contribution.value,
      cap: contribution.cap,
      before,
      applied: current - before,
      after: current,
    })
  }
  return deepFreeze({
    metric: input.metric,
    targetId: input.targetId,
    base: input.base,
    contributions: steps,
    final: current,
    conflict: false,
    conflictReason: null,
  })
}

export const parseEffectiveEquipmentState = (input: {
  readonly equipmentState: unknown
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
}): SheetEquipmentStateV1 => parseSheetEquipmentStateForOwner(input.equipmentState, {
  kind: input.ownerKind,
  slug: input.ownerSlug,
})
