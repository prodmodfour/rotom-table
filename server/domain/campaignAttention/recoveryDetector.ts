import { createHash } from 'node:crypto'
import { stableJsonStringify } from '../../../shared/automation/stableJson'
import { parseAbilityDailyUsageLedger } from '../../../shared/abilityAutomation/resources'
import { parseCampaignClockV1, type CampaignClockV1 } from '../../../shared/campaignClock'
import {
  createOpenCampaignAttentionItem,
  type CampaignAttentionItem,
  type CampaignAttentionUrgency,
} from '../../../shared/campaignAttention/model'
import { parseCapabilityUsageLedger } from '../../../shared/capabilityAutomation/state'
import { parseEdgeUsageLedger } from '../../../shared/edgeAutomation/state'
import {
  ITEM_MEDICAL_TREATMENT_DURATION_MINUTES,
  parseItemMedicalTreatmentState,
  type ItemMedicalTreatmentV1,
} from '../../../shared/itemAutomation/medicalTreatments'
import {
  normalizedFeatureApState,
  normalizedFeatureUsageLedger,
} from '../../../shared/featureAutomation/state'
import type { CharacterSheet } from '../../../src/types/characterSheet'
import type { TrainerSheet } from '../../../src/types/trainerSheet'
import {
  computePokemonHealingVitals,
  computeTrainerHealingVitals,
  MAX_INJURIES_HEALED_PER_DAY,
} from '../../../src/utils/sheets/healing'
import { computeTrainerMaxAp } from '../../../src/utils/sheets/trainerDerived'
import type { StoredItemOperationRecord } from '../../storage/itemOperationRepository'
import type { StoredSheetDocument } from '../../storage/sheetRepository'
import { itemMedicalTreatmentId } from '../itemAutomation/medicalTreatments'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../itemAutomation/registry'

const SHEET_LIMIT = 10_000
const OPERATION_LIMIT = 10_000
const CONDITION_LIMIT = 128
const MOVE_USAGE_LIMIT = 512
const MAX_INJURIES = 10

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const identity = (prefix: string, ...parts: readonly (string | number)[]): string => (
  `${prefix}${hash(stableJsonStringify(parts))}`
)
const object = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number => (
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

export const CAMPAIGN_RECOVERY_NEED_KINDS = [
  'fainted',
  'injuries',
  'critical-injuries',
  'daily-injury-limit',
  'hp-recovery',
  'condition-follow-up',
  'active-treatment',
  'daily-move-recovery',
  'daily-ability-recovery',
  'daily-capability-recovery',
  'multi-day-capability-recovery',
  'trainer-ap-recovery',
  'feature-rest-recovery',
] as const
export type CampaignRecoveryNeedKind = typeof CAMPAIGN_RECOVERY_NEED_KINDS[number]

export const CAMPAIGN_RECOVERY_EXPLANATION_CODES = [
  'malformed-current-authority',
  'zero-or-negative-hp',
  'hp-below-current-healing-cap',
  'injuries-remain',
  'five-or-more-injuries-block-natural-hp-recovery',
  'daily-injury-healing-limit-reached',
  'condition-or-status-follow-up-remains',
  'accepted-treatment-is-still-in-progress',
  'daily-move-uses-require-rest-or-day-advance',
  'daily-ability-uses-require-day-advance',
  'capability-use-requires-additional-day-advances',
  'trainer-ap-requires-extended-rest',
  'feature-state-requires-extended-rest',
] as const
export type CampaignRecoveryExplanationCode = typeof CAMPAIGN_RECOVERY_EXPLANATION_CODES[number]

export type CampaignRecoveryStatus = 'none' | 'needs-attention' | 'invalid'
export type CampaignRecoveryNextStep =
  | 'repair-current-authority'
  | 'start-treatment'
  | 'wait-for-active-treatment'
  | 'take-extended-rest'
  | 'advance-campaign-day'
  | null

export interface CampaignRecoveryDetection {
  readonly schemaVersion: 1
  readonly status: CampaignRecoveryStatus
  readonly needKinds: readonly CampaignRecoveryNeedKind[]
  readonly explanationCodes: readonly CampaignRecoveryExplanationCode[]
  readonly injuries: number
  readonly injuryHealsRemainingToday: number
  /** Exact number of ordinary P8-051 next-day transitions required if no other treatment intervenes. */
  readonly naturalRecoveryDays: number
  readonly minimumResourceDayAdvances: number
  readonly activeTreatment: boolean
  readonly activeTreatmentRemainingMinutes: number
  readonly nextStep: CampaignRecoveryNextStep
}

interface RecoveryAccumulator {
  readonly needs: Set<CampaignRecoveryNeedKind>
  readonly explanations: Set<CampaignRecoveryExplanationCode>
  minimumResourceDayAdvances: number
}

const emptyDetection = (): CampaignRecoveryDetection => Object.freeze({
  schemaVersion: 1,
  status: 'none',
  needKinds: Object.freeze([]),
  explanationCodes: Object.freeze([]),
  injuries: 0,
  injuryHealsRemainingToday: MAX_INJURIES_HEALED_PER_DAY,
  naturalRecoveryDays: 0,
  minimumResourceDayAdvances: 0,
  activeTreatment: false,
  activeTreatmentRemainingMinutes: 0,
  nextStep: null,
})

const invalidDetection = (): CampaignRecoveryDetection => Object.freeze({
  ...emptyDetection(),
  status: 'invalid',
  explanationCodes: Object.freeze(['malformed-current-authority'] as const),
  nextStep: 'repair-current-authority',
})

const add = (
  accumulator: RecoveryAccumulator,
  need: CampaignRecoveryNeedKind,
  explanation: CampaignRecoveryExplanationCode,
): void => {
  accumulator.needs.add(need)
  accumulator.explanations.add(explanation)
}

const validateConditionFollowUp = (value: unknown): number => {
  if (value === undefined) return 0
  if (!Array.isArray(value) || value.length > CONDITION_LIMIT) {
    throw new Error('Recovery attention requires a bounded condition collection.')
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() !== entry || entry.length < 1
      || entry.length > 200 || /[\u0000-\u001f\u007f]/u.test(entry)) {
      throw new Error('Recovery attention found malformed condition authority.')
    }
  }
  return value.length
}

const validateFreeformStatus = (value: unknown): boolean => {
  if (value === undefined || value === '') return false
  if (typeof value !== 'string' || value.trim() !== value || value.length > 2_000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error('Recovery attention found malformed status follow-up authority.')
  }
  return value.length > 0
}

const dailyMoveUses = (value: unknown): number => {
  if (value === undefined) return 0
  const root = object(value)
  if (!root || !exactKeys(root, ['daily'])) {
    throw new Error('Recovery attention found malformed daily Move authority.')
  }
  const daily = object(root.daily)
  if (!daily || Object.keys(daily).length > MOVE_USAGE_LIMIT) {
    throw new Error('Recovery attention requires bounded daily Move authority.')
  }
  let uses = 0
  for (const [key, candidate] of Object.entries(daily)) {
    const row = object(candidate)
    if (!key || key.length > 200 || !row
      || !exactKeys(row, Object.hasOwn(row, 'updatedAt')
        ? ['moveName', 'uses', 'updatedAt']
        : ['moveName', 'uses'])
      || typeof row.moveName !== 'string' || row.moveName.trim() !== row.moveName
      || row.moveName.length < 1 || row.moveName.length > 160
      || !integer(row.uses, 0, 1_000)
      || (Object.hasOwn(row, 'updatedAt') && !integer(row.updatedAt))) {
      throw new Error('Recovery attention found malformed daily Move usage evidence.')
    }
    uses += row.uses
    if (!Number.isSafeInteger(uses)) throw new Error('Recovery attention Move usage overflowed.')
  }
  return uses
}

const validateCurrentTreatmentOperation = (input: {
  readonly treatment: ItemMedicalTreatmentV1
  readonly stored: StoredSheetDocument
  readonly operations: ReadonlyMap<string, StoredItemOperationRecord>
  readonly clock: CampaignClockV1
}): void => {
  const { treatment, stored } = input
  const operation = input.operations.get(treatment.sourceOperationId)
  const plan = operation?.plan
  const result = operation?.result
  const context = plan?.nonEncounterContext
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(treatment.canonicalItemId)
  const reviewed = definition?.spec.effects.find(effect => effect.operation === 'apply-medical-treatment')
  const targets = context?.targetAuthorities.filter(target => (
    target.sheetKind === stored.kind
    && target.sheetSlug === stored.slug
  )) ?? []
  const matching = plan?.operations.filter((candidate) => {
    const payload = object(candidate.payload)
    return candidate.kind === 'campaign-fact'
      && candidate.aggregate.kind === 'sheet'
      && candidate.aggregate.sheetKind === stored.kind
      && candidate.aggregate.id === stored.slug
      && targets.some(target => (
        target.targetId === candidate.subjectId
        && target.sheetRevision === candidate.aggregate.revision
      ))
      && payload?.action === 'apply-medical-treatment'
      && payload.treatmentId === treatment.treatmentId
      && payload.treatmentKind === 'bandages'
      && payload.canonicalItemId === treatment.canonicalItemId
      && payload.canonicalDefinitionSha256 === treatment.canonicalDefinitionSha256
      && payload.sourceOperationId === treatment.sourceOperationId
      && payload.targetKind === stored.kind
      && payload.targetSlug === stored.slug
      && payload.appliedAtCampaignMinute === treatment.appliedAtCampaignMinute
      && payload.durationMinutes === reviewed?.durationMinutes
      && payload.tickMinutes === reviewed?.tickMinutes
      && payload.healingNumerator === reviewed?.healingNumerator
      && payload.healingDenominator === reviewed?.healingDenominator
      && payload.injuryAtCompletion === reviewed?.injuryAtCompletion
      && payload.stopOnHpLoss === reviewed?.stopOnHpLoss
      && payload.obeyDailyInjuryLimit === reviewed?.obeyDailyInjuryLimit
      && exactKeys(payload, [
        'action', 'treatmentId', 'treatmentKind', 'canonicalItemId',
        'canonicalDefinitionSha256', 'sourceOperationId', 'targetKind', 'targetSlug',
        'appliedAtCampaignMinute', 'durationMinutes', 'tickMinutes', 'healingNumerator',
        'healingDenominator', 'injuryAtCompletion', 'stopOnHpLoss', 'obeyDailyInjuryLimit',
      ])
  }) ?? []
  if (!operation || operation.operationId !== treatment.sourceOperationId
    || operation.status !== 'accepted' || result?.status !== 'accepted'
    || result.operationId !== treatment.sourceOperationId
    || operation.canonicalItemId !== treatment.canonicalItemId
    || operation.canonicalDefinitionSha256 !== treatment.canonicalDefinitionSha256
    || plan?.operationId !== treatment.sourceOperationId
    || plan.canonicalItemId !== treatment.canonicalItemId
    || plan.canonicalDefinitionSha256 !== treatment.canonicalDefinitionSha256
    || result.canonicalItemId !== treatment.canonicalItemId
    || !definition || !reviewed
    || definition.definitionSha256 !== treatment.canonicalDefinitionSha256
    || context?.context !== 'extended-action'
    || context.extendedAction.mode !== 'extended'
    || context.extendedAction.phase !== 'completion'
    || context.campaignTime.campaignMinute !== treatment.appliedAtCampaignMinute
    || context.campaignTime.clockRevision > input.clock.revision
    || context.campaignTime.campaignMinute > input.clock.campaignMinute
    || targets.length !== 1 || matching.length !== 1
    || matching[0]!.aggregate.revision >= stored.revision
    || treatment.treatmentId !== itemMedicalTreatmentId({
      operationId: treatment.sourceOperationId,
      targetKind: stored.kind,
      targetSlug: stored.slug,
    })) {
    throw new Error('Active medical attention lost its exact accepted item-operation authority.')
  }
}

const treatmentState = (input: {
  readonly stored: StoredSheetDocument
  readonly document: Record<string, unknown>
  readonly operations: ReadonlyMap<string, StoredItemOperationRecord>
  readonly clock: CampaignClockV1
}): { readonly active: boolean, readonly remainingMinutes: number } => {
  const state = parseItemMedicalTreatmentState(input.document.itemMedicalTreatments)
  for (const entry of state.entries) {
    if (entry.target.kind !== input.stored.kind || entry.target.slug !== input.stored.slug
      || entry.appliedAtCampaignMinute > input.clock.campaignMinute
      || (entry.terminalCampaignMinute !== null
        && entry.terminalCampaignMinute > input.clock.campaignMinute)) {
      throw new Error('Medical attention treatment lifecycle is not current for its containing sheet.')
    }
  }
  const active = state.entries.find(entry => entry.status === 'active')
  if (!active) return Object.freeze({ active: false, remainingMinutes: 0 })
  if (active.nextTickCampaignMinute <= input.clock.campaignMinute
    || active.endsAtCampaignMinute <= input.clock.campaignMinute) {
    throw new Error('Medical attention has overdue campaign-time treatment authority.')
  }
  validateCurrentTreatmentOperation({
    treatment: active,
    stored: input.stored,
    operations: input.operations,
    clock: input.clock,
  })
  return Object.freeze({
    active: true,
    remainingMinutes: active.endsAtCampaignMinute - input.clock.campaignMinute,
  })
}

const validateCommonResources = (input: {
  readonly document: Record<string, unknown>
  readonly slug: string
  readonly accumulator: RecoveryAccumulator
}): void => {
  const moveUses = dailyMoveUses(input.document.moveUsage)
  if (moveUses > 0) add(input.accumulator, 'daily-move-recovery', 'daily-move-uses-require-rest-or-day-advance')

  if (input.document.abilityUsage !== undefined) {
    const ledger = parseAbilityDailyUsageLedger(input.document.abilityUsage)
    if (ledger.entries.some(entry => entry.ownerId !== input.slug)) {
      throw new Error('Recovery attention found Ability usage for another sheet owner.')
    }
    if (ledger.entries.some(entry => entry.spent > 0)) {
      add(input.accumulator, 'daily-ability-recovery', 'daily-ability-uses-require-day-advance')
      input.accumulator.minimumResourceDayAdvances = Math.max(input.accumulator.minimumResourceDayAdvances, 1)
    }
  }

  if (input.document.capabilityUsage !== undefined) {
    const ledger = parseCapabilityUsageLedger(input.document.capabilityUsage)
    const daily = ledger.entries.some(entry => entry.period === 'daily')
    const weekly = ledger.entries
      .filter(entry => entry.period === 'weekly')
      .reduce((maximum, entry) => Math.max(maximum, entry.remainingDayAdvances ?? 0), 0)
    if (daily) {
      add(input.accumulator, 'daily-capability-recovery', 'capability-use-requires-additional-day-advances')
      input.accumulator.minimumResourceDayAdvances = Math.max(input.accumulator.minimumResourceDayAdvances, 1)
    }
    if (weekly > 0) {
      add(input.accumulator, 'multi-day-capability-recovery', 'capability-use-requires-additional-day-advances')
      input.accumulator.minimumResourceDayAdvances = Math.max(input.accumulator.minimumResourceDayAdvances, weekly)
    }
  }

  // Edge day scope is keyed to its authoritative period rather than cleared by
  // P8-051. Parsing still prevents malformed resource state from being hidden.
  if (input.document.edgeUsage !== undefined) parseEdgeUsageLedger(input.document.edgeUsage)
}

const trainerRestResources = (
  sheet: TrainerSheet,
  accumulator: RecoveryAccumulator,
): void => {
  const ap = sheet.ap
  if (ap !== undefined) {
    const row = object(ap)
    if (!row || Object.keys(row).some(key => !['left', 'spent', 'bound', 'drained', 'max'].includes(key))) {
      throw new Error('Recovery attention found malformed Trainer AP authority.')
    }
    for (const value of Object.values(row)) {
      if (!integer(value, 0, 10_000)) throw new Error('Recovery attention found malformed Trainer AP value.')
    }
  }
  const maximum = computeTrainerMaxAp(sheet)
  if (!integer(maximum, 0, 10_000)) throw new Error('Recovery attention found malformed Trainer maximum AP.')
  const left = sheet.ap?.left ?? maximum
  const bound = sheet.ap?.bound ?? 0
  const drained = sheet.ap?.drained ?? 0
  const spent = sheet.ap?.spent ?? 0
  if (left > maximum || bound + drained > maximum || spent > maximum
    || left > Math.max(0, maximum - bound - drained)) {
    throw new Error('Recovery attention found contradictory Trainer AP authority.')
  }
  if (spent > 0 || drained > 0 || left < Math.max(0, maximum - bound - drained)) {
    add(accumulator, 'trainer-ap-recovery', 'trainer-ap-requires-extended-rest')
  }

  if (sheet.featureApState !== undefined) {
    const normalized = normalizedFeatureApState(sheet.featureApState, maximum)
    if (stableJsonStringify(normalized) !== stableJsonStringify(sheet.featureApState)) {
      throw new Error('Recovery attention found malformed Feature AP authority.')
    }
    if (normalized.spent > 0 || normalized.temporary.length > 0
      || normalized.bindings.some(binding => binding.release === 'extended-rest')
      || normalized.drains.some(drain => drain.recovery === 'extended-rest')) {
      add(accumulator, 'feature-rest-recovery', 'feature-state-requires-extended-rest')
    }
  }
  if (sheet.featureUsage !== undefined) {
    const normalized = normalizedFeatureUsageLedger(sheet.featureUsage)
    if (stableJsonStringify(normalized) !== stableJsonStringify(sheet.featureUsage)) {
      throw new Error('Recovery attention found malformed Feature usage authority.')
    }
    if (normalized.entries.some(entry => entry.scope !== 'campaign')) {
      add(accumulator, 'feature-rest-recovery', 'feature-state-requires-extended-rest')
    }
  }
}

const healthState = (input: {
  readonly stored: StoredSheetDocument
  readonly document: Record<string, unknown>
  readonly accumulator: RecoveryAccumulator
}): {
  readonly injuries: number
  readonly injuryHealsRemainingToday: number
  readonly currentHp: number
  readonly maxHp: number
} => {
  const { stored, document, accumulator } = input
  const combat = stored.kind === 'pokemon' ? object(document.combat) : null
  if (stored.kind === 'pokemon' && document.combat !== undefined && !combat) {
    throw new Error('Recovery attention found malformed Pokémon combat authority.')
  }
  const rawInjuries = stored.kind === 'pokemon' ? combat?.injuries : document.currentInjuries
  const rawHealed = stored.kind === 'pokemon' ? combat?.injuriesHealedToday : document.injuriesHealedToday
  const rawHp = stored.kind === 'pokemon' ? combat?.currentHp : document.currentHp
  if (rawInjuries !== undefined && !integer(rawInjuries, 0, MAX_INJURIES)) {
    throw new Error('Recovery attention found malformed Injury authority.')
  }
  if (rawHealed !== undefined && !integer(rawHealed, 0, MAX_INJURIES_HEALED_PER_DAY)) {
    throw new Error('Recovery attention found malformed daily Injury-healing authority.')
  }
  if (rawHp !== undefined && !integer(rawHp, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) {
    throw new Error('Recovery attention found malformed current HP authority.')
  }
  const vitals = stored.kind === 'pokemon'
    ? computePokemonHealingVitals(document as unknown as CharacterSheet)
    : computeTrainerHealingVitals(document as unknown as TrainerSheet)
  if (!integer(vitals.fullMaxHp, 1) || !integer(vitals.maxHp)
    || !integer(vitals.injuries, 0, MAX_INJURIES)
    || !integer(vitals.injuriesHealedToday, 0, MAX_INJURIES_HEALED_PER_DAY)
    || !integer(vitals.injuryHealsRemainingToday, 0, MAX_INJURIES_HEALED_PER_DAY)
    || !integer(vitals.currentHp, Number.MIN_SAFE_INTEGER, vitals.maxHp)
    || (rawHp !== undefined && rawHp !== vitals.currentHp)
    || (rawInjuries !== undefined && rawInjuries !== vitals.injuries)) {
    throw new Error('Recovery attention found contradictory derived healing authority.')
  }
  if (vitals.currentHp <= 0) add(accumulator, 'fainted', 'zero-or-negative-hp')
  if (vitals.currentHp < vitals.maxHp) add(accumulator, 'hp-recovery', 'hp-below-current-healing-cap')
  if (vitals.injuries > 0) add(accumulator, 'injuries', 'injuries-remain')
  if (vitals.injuries >= 5) {
    add(accumulator, 'critical-injuries', 'five-or-more-injuries-block-natural-hp-recovery')
  }
  if (vitals.injuries > 0 && vitals.injuryHealsRemainingToday === 0) {
    add(accumulator, 'daily-injury-limit', 'daily-injury-healing-limit-reached')
  }
  return Object.freeze({
    injuries: vitals.injuries,
    injuryHealsRemainingToday: vitals.injuryHealsRemainingToday,
    currentHp: vitals.currentHp,
    maxHp: vitals.maxHp,
  })
}

const sortedNeeds = (values: ReadonlySet<CampaignRecoveryNeedKind>): readonly CampaignRecoveryNeedKind[] => (
  Object.freeze([...values].sort((left, right) => (
    CAMPAIGN_RECOVERY_NEED_KINDS.indexOf(left) - CAMPAIGN_RECOVERY_NEED_KINDS.indexOf(right)
  )))
)
const sortedExplanations = (
  values: ReadonlySet<CampaignRecoveryExplanationCode>,
): readonly CampaignRecoveryExplanationCode[] => Object.freeze([...values].sort((left, right) => (
  CAMPAIGN_RECOVERY_EXPLANATION_CODES.indexOf(left)
  - CAMPAIGN_RECOVERY_EXPLANATION_CODES.indexOf(right)
)))

const detectSheetRecoveryStateFromAuthority = (input: {
  readonly stored: StoredSheetDocument
  readonly clock: CampaignClockV1
  readonly operations: ReadonlyMap<string, StoredItemOperationRecord>
}): CampaignRecoveryDetection => {
  if (!integer(input.stored.revision)) return invalidDetection()
  const document = object(input.stored.document)
  if (!document || document.slug !== input.stored.slug) return invalidDetection()
  try {
    if (input.stored.kind === 'pokemon') {
      if (!integer(document.level, 1, 100) || typeof document.species !== 'string' || !document.species) {
        return invalidDetection()
      }
    }
    else if (!integer(document.level, 1, 50)) return invalidDetection()

    const accumulator: RecoveryAccumulator = {
      needs: new Set(), explanations: new Set(), minimumResourceDayAdvances: 0,
    }
    const health = healthState({ stored: input.stored, document, accumulator })
    const conditionCount = input.stored.kind === 'pokemon'
      ? validateConditionFollowUp(object(document.combat)?.conditions)
      : validateConditionFollowUp(document.conditions)
    const freeformStatus = input.stored.kind === 'pokemon'
      ? validateFreeformStatus(object(document.combat)?.statusAfflictions)
      : validateFreeformStatus(document.statusAfflictions)
    if (conditionCount > 0 || freeformStatus) {
      add(accumulator, 'condition-follow-up', 'condition-or-status-follow-up-remains')
    }
    validateCommonResources({ document, slug: input.stored.slug, accumulator })
    if (input.stored.kind === 'trainer') {
      trainerRestResources(document as unknown as TrainerSheet, accumulator)
    }
    const treatment = treatmentState({
      stored: input.stored,
      document,
      operations: input.operations,
      clock: input.clock,
    })
    if (treatment.active) {
      add(accumulator, 'active-treatment', 'accepted-treatment-is-still-in-progress')
    }
    if (accumulator.needs.size === 0) return emptyDetection()

    const nextStep: CampaignRecoveryNextStep = treatment.active
      ? 'wait-for-active-treatment'
      : accumulator.needs.has('injuries')
        ? 'start-treatment'
        : accumulator.minimumResourceDayAdvances > 0
          ? 'advance-campaign-day'
          : 'take-extended-rest'
    return Object.freeze({
      schemaVersion: 1,
      status: 'needs-attention',
      needKinds: sortedNeeds(accumulator.needs),
      explanationCodes: sortedExplanations(accumulator.explanations),
      injuries: health.injuries,
      injuryHealsRemainingToday: health.injuryHealsRemainingToday,
      naturalRecoveryDays: health.injuries,
      minimumResourceDayAdvances: accumulator.minimumResourceDayAdvances,
      activeTreatment: treatment.active,
      activeTreatmentRemainingMinutes: treatment.remainingMinutes,
      nextStep,
    })
  }
  catch {
    return invalidDetection()
  }
}

const operationAuthorityMap = (
  operations: readonly StoredItemOperationRecord[],
): ReadonlyMap<string, StoredItemOperationRecord> | null => {
  if (operations.length > OPERATION_LIMIT) return null
  const ids = operations.map(operation => operation.operationId)
  return new Set(ids).size === ids.length
    ? new Map(operations.map(operation => [operation.operationId, operation]))
    : null
}

export const detectSheetRecoveryState = (input: {
  readonly stored: StoredSheetDocument
  readonly campaignClock: unknown
  readonly itemOperations: readonly StoredItemOperationRecord[]
}): CampaignRecoveryDetection => {
  let clock: CampaignClockV1
  try {
    clock = parseCampaignClockV1(input.campaignClock)
  }
  catch {
    return invalidDetection()
  }
  const operations = operationAuthorityMap(input.itemOperations)
  return operations
    ? detectSheetRecoveryStateFromAuthority({ stored: input.stored, clock, operations })
    : invalidDetection()
}

const urgencyFor = (detection: CampaignRecoveryDetection): CampaignAttentionUrgency => {
  if (detection.status === 'invalid' || detection.injuries >= MAX_INJURIES) return 'blocking'
  if (detection.needKinds.includes('fainted') || detection.needKinds.includes('critical-injuries')) return 'urgent'
  if (detection.activeTreatment && detection.needKinds.length === 1) return 'informational'
  return 'normal'
}

const attentionFromDetection = (input: {
  readonly stored: StoredSheetDocument
  readonly clock: CampaignClockV1
  readonly detection: CampaignRecoveryDetection
}): CampaignAttentionItem | null => {
  const { detection } = input
  if (detection.status === 'none') return null
  const authority = Object.freeze({
    kind: 'sheet' as const,
    id: input.stored.slug,
    revision: input.stored.revision,
  })
  const medical = detection.status !== 'invalid' && (
    detection.needKinds.includes('injuries')
    || detection.needKinds.includes('fainted')
    || detection.needKinds.includes('condition-follow-up')
    || detection.activeTreatment
  )
  const reason = medical ? 'medical-review' as const : 'recovery-review' as const
  const decision = medical && !detection.activeTreatment && detection.needKinds.includes('injuries')
    ? 'choose-treatment' as const
    : 'review-recovery' as const
  const intent = decision === 'choose-treatment' ? 'start-treatment' as const : 'review-recovery' as const
  const section = medical ? 'medical' : 'recovery'
  const itemId = identity(
    'campaign-attention:v1:', 'sheet-recovery', input.stored.kind, input.stored.slug, reason,
  )
  return createOpenCampaignAttentionItem({
    itemId,
    reason,
    audience: 'owner',
    urgency: urgencyFor(detection),
    entity: Object.freeze({
      kind: input.stored.kind === 'pokemon' ? 'pokemon-sheet' as const : 'trainer-sheet' as const,
      id: input.stored.slug,
    }),
    sourceEvent: Object.freeze({
      kind: 'sheet-authority' as const,
      eventId: identity(
        'campaign-attention-source:v1:', 'sheet-recovery', input.stored.kind,
        input.stored.slug, input.stored.revision, input.clock.revision,
      ),
      campaignMinute: input.clock.campaignMinute,
    }),
    authority,
    requiredDecision: Object.freeze({
      decisionId: identity('campaign-attention-decision:v1:', itemId),
      kind: decision,
      authority,
    }),
    legalActions: Object.freeze([Object.freeze({
      actionId: identity('campaign-attention-action:v1:', itemId, intent),
      intent,
      href: input.stored.kind === 'pokemon'
        ? `/sheets/pokemon/${encodeURIComponent(input.stored.slug)}?attention=${section}`
        : `/sheets/trainers/${encodeURIComponent(input.stored.slug)}?attention=${section}`,
      authority,
      requiresConfirmation: false,
    })]),
    createdAtCampaignMinute: input.clock.campaignMinute,
  })
}

export const detectSheetRecoveryAttention = (input: {
  readonly stored: StoredSheetDocument
  readonly campaignClock: unknown
  readonly itemOperations: readonly StoredItemOperationRecord[]
}): CampaignAttentionItem | null => {
  const clock = parseCampaignClockV1(input.campaignClock)
  return attentionFromDetection({
    stored: input.stored,
    clock,
    detection: detectSheetRecoveryState(input),
  })
}

export const projectCampaignRecoveryAttention = (input: {
  readonly sheets: readonly StoredSheetDocument[]
  readonly campaignClock: unknown
  readonly itemOperations: readonly StoredItemOperationRecord[]
  readonly completeness: {
    readonly sheets: true
    readonly campaignClock: true
    readonly itemOperations: true
  }
}): readonly CampaignAttentionItem[] => {
  if (input.completeness.sheets !== true || input.completeness.campaignClock !== true
    || input.completeness.itemOperations !== true) {
    throw new Error('Campaign recovery attention requires one complete current authority read.')
  }
  const clock = parseCampaignClockV1(input.campaignClock)
  if (input.sheets.length > SHEET_LIMIT || input.itemOperations.length > OPERATION_LIMIT) {
    throw new Error(`Campaign recovery attention is bounded to ${SHEET_LIMIT} sheets and ${OPERATION_LIMIT} item operations.`)
  }
  const sheetKeys = input.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`)
  const operationIds = input.itemOperations.map(operation => operation.operationId)
  if (new Set(sheetKeys).size !== sheetKeys.length || new Set(operationIds).size !== operationIds.length) {
    throw new Error('Campaign recovery attention requires unique current authority identities.')
  }
  const operations = new Map(input.itemOperations.map(operation => [operation.operationId, operation]))
  const items = input.sheets.flatMap((stored) => {
    const detection = detectSheetRecoveryStateFromAuthority({ stored, clock, operations })
    const item = attentionFromDetection({ stored, clock, detection })
    return item ? [item] : []
  })
  if (new Set(items.map(item => item.itemId)).size !== items.length) {
    throw new Error('Campaign recovery attention providers produced duplicate item identity.')
  }
  const urgencyRank: Readonly<Record<CampaignAttentionUrgency, number>> = {
    blocking: 0, urgent: 1, normal: 2, informational: 3,
  }
  return Object.freeze(items.sort((left, right) => (
    urgencyRank[left.urgency] - urgencyRank[right.urgency]
    || left.entity.kind.localeCompare(right.entity.kind)
    || left.entity.id.localeCompare(right.entity.id)
    || left.itemId.localeCompare(right.itemId)
  )))
}

export const CAMPAIGN_RECOVERY_ATTENTION_SHEET_LIMIT = SHEET_LIMIT
export const CAMPAIGN_RECOVERY_ATTENTION_OPERATION_LIMIT = OPERATION_LIMIT
export const CAMPAIGN_RECOVERY_TREATMENT_DURATION_MINUTES = ITEM_MEDICAL_TREATMENT_DURATION_MINUTES
