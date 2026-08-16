import { createHash } from 'node:crypto'
import rulesJson from '../../../data/reference/rules.json'
import { stableJsonStringify } from '../../../shared/automation/stableJson'
import {
  createOpenCampaignAttentionItem,
  type CampaignAttentionItem,
} from '../../../shared/campaignAttention/model'
import {
  EDGE_INSTANCE_LIMIT_PER_SHEET,
  resolveEdgeInstance,
} from '../../../shared/edgeAutomation/instances'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from '../../../shared/featureAutomation/manifest'
import { FEATURE_INSTANCE_LIMIT_PER_SHEET } from '../../../shared/featureAutomation/instances'
import type { TrainerAdvancementRow, TrainerSheet } from '../../../src/types/trainerSheet'
import type { StoredSheetDocument } from '../../storage/sheetRepository'
import { resolveEffectiveFeatures } from '../featureAutomation/effectiveFeatures'

const RULE_ID = 'Trainer Advancement Choices'
const RULE_RECORD_SHA256 = '799baf0001a3b8aaa53cf548a388890eafb7b65427dc30f568a6f9a36280c6ef'
const SHEET_LIMIT = 10_000

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

interface MilestoneStatOption {
  readonly id: 'attack-special-attack'
  readonly immediatePoints: number
  readonly scheduledEvenLevels: readonly number[]
}
interface MilestoneFeatureOption { readonly id: 'general-feature', readonly featureSlots: 1 }
interface MilestoneEdgeOption { readonly id: 'two-edges', readonly edgeSlots: 2 }
interface Milestone {
  readonly level: number
  readonly options: readonly (MilestoneStatOption | MilestoneFeatureOption | MilestoneEdgeOption)[]
}
interface TrainerChoiceMechanics {
  readonly maximumLevel: 50
  readonly featureEntitlements: {
    readonly paidAtLevelOne: 4
    readonly paidEveryOddLevelFrom: 3
    readonly freeTrainingAtLevelOne: 1
    readonly freeTrainingFeatureIds: readonly string[]
    readonly nonEntitlementAcquisitionKinds: readonly string[]
    readonly maximumClassFeatures: 4
  }
  readonly edgeEntitlements: {
    readonly atLevelOne: 4
    readonly everyEvenLevelFrom: 2
    readonly bonusSkillEdgeLevels: readonly number[]
    readonly skillEdgeIds: readonly string[]
    readonly nonEntitlementAcquisitionKinds: readonly string[]
  }
  readonly milestoneChoices: readonly Milestone[]
}

const rule = object((rulesJson as Record<string, unknown>)[RULE_ID])
if (!rule || hash(stableJsonStringify(rule)) !== RULE_RECORD_SHA256) {
  throw new Error('Canonical Trainer advancement-choice authority is unavailable or stale.')
}
const mechanics = object(rule.trainerAdvancementChoiceMechanics) as unknown as TrainerChoiceMechanics
if (!mechanics || mechanics.maximumLevel !== 50) {
  throw new Error('Canonical Trainer advancement-choice mechanics are unavailable or stale.')
}
export const TRAINER_ADVANCEMENT_CHOICE_RULE_SHA256 = RULE_RECORD_SHA256

export const TRAINER_CHOICE_PENDING_KINDS = [
  'free-training-feature',
  'feature-or-class',
  'feature-configuration',
  'edge',
  'edge-configuration',
  'skill-rank',
  'milestone-choice',
] as const
export type TrainerChoicePendingKind = typeof TRAINER_CHOICE_PENDING_KINDS[number]
export type TrainerChoiceStatus = 'none' | 'pending' | 'invalid'

export interface TrainerChoiceDetection {
  readonly schemaVersion: 1
  readonly status: TrainerChoiceStatus
  readonly pendingKinds: readonly TrainerChoicePendingKind[]
  readonly paidFeatureEntitlement: number
  readonly countedFeatureRanks: number
  readonly edgeEntitlement: number
  readonly countedEdgeRanks: number
  readonly reachedMilestones: number
  readonly resolvedMilestones: number
  readonly expectedBonusSkillEdges: number
  readonly recordedBonusSkillEdges: number
  readonly milestoneStatPointBudgetBonus: number
}

interface AdvancementEvidence {
  readonly selectedStatMilestones: ReadonlySet<number>
  readonly statPointBudgetBonus: number
  readonly malformed: boolean
}

const expectedStatPoints = (milestone: Milestone, level: number): number => {
  const option = milestone.options.find((candidate): candidate is MilestoneStatOption => (
    candidate.id === 'attack-special-attack'
  ))
  if (!option) throw new Error('Trainer milestone lost its exact Stat-option authority.')
  return option.immediatePoints + option.scheduledEvenLevels.filter(value => value <= level).length
}

const advancementEvidence = (sheet: TrainerSheet): AdvancementEvidence => {
  if (sheet.advancement !== undefined && !Array.isArray(sheet.advancement)) {
    return { selectedStatMilestones: new Set(), statPointBudgetBonus: 0, malformed: true }
  }
  const rows = sheet.advancement ?? []
  if (rows.length > mechanics.milestoneChoices.length) {
    return { selectedStatMilestones: new Set(), statPointBudgetBonus: 0, malformed: true }
  }
  const byLevel = new Map<number, TrainerAdvancementRow>()
  for (const row of rows) {
    if (!row || !integer(row.level, 1, mechanics.maximumLevel) || byLevel.has(row.level)
      || !mechanics.milestoneChoices.some(milestone => milestone.level === row.level)) {
      return { selectedStatMilestones: new Set(), statPointBudgetBonus: 0, malformed: true }
    }
    byLevel.set(row.level, row)
  }
  const selected = new Set<number>()
  let bonus = 0
  for (const milestone of mechanics.milestoneChoices) {
    const row = byLevel.get(milestone.level)
    if (!row) continue
    const present = [row.stats, row.attack, row.spAttack].map(value => value !== undefined)
    if (!present.some(Boolean)) continue
    if (!present.every(Boolean) || !integer(row.stats) || !integer(row.attack) || !integer(row.spAttack)
      || milestone.level > sheet.level || row.attack + row.spAttack !== row.stats
      || row.stats !== expectedStatPoints(milestone, sheet.level)) {
      return { selectedStatMilestones: new Set(), statPointBudgetBonus: 0, malformed: true }
    }
    selected.add(milestone.level)
    bonus += row.stats
  }
  return { selectedStatMilestones: selected, statPointBudgetBonus: bonus, malformed: false }
}

/** Exact additional Trainer Stat budget selected through structured milestone rows. */
export const trainerMilestoneStatPointBudgetBonus = (sheet: TrainerSheet): number => {
  const evidence = advancementEvidence(sheet)
  if (evidence.malformed) throw new Error('Trainer milestone Stat-choice evidence is malformed or stale.')
  return evidence.statPointBudgetBonus
}

const paidFeatureEntitlement = (level: number): number => (
  mechanics.featureEntitlements.paidAtLevelOne
  + Math.max(0, Math.floor((level - mechanics.featureEntitlements.paidEveryOddLevelFrom) / 2) + 1)
)
const edgeEntitlement = (level: number): number => (
  mechanics.edgeEntitlements.atLevelOne
  + Math.max(0, Math.floor((level - mechanics.edgeEntitlements.everyEvenLevelFrom) / 2) + 1)
  + mechanics.edgeEntitlements.bonusSkillEdgeLevels.filter(threshold => threshold <= level).length
)
const optionalCounter = (value: unknown, maximum: number): number | null => (
  value === undefined ? 0 : integer(value, 0, maximum) ? value : null
)
const allowsRank = (canonicalId: string, rank: number): boolean => {
  const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(canonicalId)
  if (!manifest) return false
  const maximum = manifest.tags.flatMap((tag) => {
    const match = /^Ranked\s+(\d+)$/iu.exec(tag)
    return match ? [Number(match[1])] : []
  }).at(0) ?? 1
  return integer(rank, 1, maximum)
}

interface CurrentFeatureEvidence {
  readonly count: number
  readonly classCount: number
  readonly malformed: boolean
}
const currentFeatureEvidence = (sheet: TrainerSheet): CurrentFeatureEvidence => {
  for (const value of [sheet.features, sheet.classes, sheet.orders]) {
    if (value !== undefined && !Array.isArray(value)) return { count: 0, classCount: 0, malformed: true }
  }
  const effective = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet })
  if (effective.unresolved.length > 0) return { count: 0, classCount: 0, malformed: true }
  const excluded = new Set(mechanics.featureEntitlements.nonEntitlementAcquisitionKinds)
  const counted = effective.instances.filter(instance => (
    instance.parameterStatus === 'ready'
    && !excluded.has(instance.instance.acquisition.kind)
    && instance.sources.some(source => ['sheet', 'class', 'orders'].includes(source.kind))
  ))
  if (effective.instances.some(instance => (
    instance.sources.some(source => ['sheet', 'class', 'orders'].includes(source.kind))
    && instance.parameterStatus !== 'ready'
  ))) return { count: 0, classCount: 0, malformed: true }
  const ids = counted.map(instance => instance.instanceId)
  if (new Set(ids).size !== ids.length || counted.some(instance => (
    !allowsRank(instance.canonicalId, instance.instance.rank)
  ))) return { count: 0, classCount: 0, malformed: true }
  const count = counted.reduce((total, instance) => total + instance.instance.rank, 0)
  const classCount = counted.reduce((total, instance) => {
    const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(instance.canonicalId)!
    return total + (manifest.tags.includes('Class') ? instance.instance.rank : 0)
  }, 0)
  return { count, classCount, malformed: false }
}

interface CurrentEdgeEvidence {
  readonly count: number
  readonly skillCount: number
  readonly malformed: boolean
}
const currentEdgeEvidence = (sheet: TrainerSheet): CurrentEdgeEvidence => {
  if (sheet.edges !== undefined && !Array.isArray(sheet.edges)) {
    return { count: 0, skillCount: 0, malformed: true }
  }
  const rows = sheet.edges ?? []
  if (rows.length > EDGE_INSTANCE_LIMIT_PER_SHEET) {
    return { count: 0, skillCount: 0, malformed: true }
  }
  const excluded = new Set(mechanics.edgeEntitlements.nonEntitlementAcquisitionKinds)
  const skillIds = new Set(mechanics.edgeEntitlements.skillEdgeIds)
  const instances = rows.map((entry, index) => resolveEdgeInstance({
    family: 'trainer', entry, ownerId: sheet.slug, index,
  }))
  if (instances.some(instance => instance.status !== 'ready' || !instance.data)) {
    return { count: 0, skillCount: 0, malformed: true }
  }
  const counted = instances.flatMap(instance => instance.data && !excluded.has(instance.data.acquisition.kind)
    ? [instance.data] : [])
  const ids = counted.map(instance => instance.instanceId)
  if (new Set(ids).size !== ids.length) return { count: 0, skillCount: 0, malformed: true }
  return {
    count: counted.reduce((total, instance) => total + instance.rank, 0),
    skillCount: counted.filter(instance => skillIds.has(instance.canonicalId))
      .reduce((total, instance) => total + instance.rank, 0),
    malformed: false,
  }
}

const milestoneAssignments = (
  reached: readonly Milestone[],
  selectedStatMilestones: ReadonlySet<number>,
  allowUnresolved: boolean,
): ReadonlySet<string> => {
  let states = new Set(['0:0'])
  for (const milestone of reached) {
    const options = selectedStatMilestones.has(milestone.level)
      ? milestone.options.filter(option => option.id === 'attack-special-attack')
      : [
          ...allowUnresolved ? [null] : [],
          ...milestone.options.filter(option => option.id !== 'attack-special-attack'),
        ]
    const next = new Set<string>()
    for (const state of states) {
      const [featureCount, edgeCount] = state.split(':').map(Number) as [number, number]
      for (const option of options) {
        next.add(`${featureCount + (option && 'featureSlots' in option ? option.featureSlots : 0)}:${edgeCount + (option && 'edgeSlots' in option ? option.edgeSlots : 0)}`)
      }
    }
    states = next
  }
  return states
}

export const detectTrainerChoiceState = (sheet: TrainerSheet): TrainerChoiceDetection => {
  const pending = new Set<TrainerChoicePendingKind>()
  if (!sheet || typeof sheet.slug !== 'string' || !sheet.slug
    || !integer(sheet.level, 1, mechanics.maximumLevel)) {
    return Object.freeze({
      schemaVersion: 1, status: 'invalid', pendingKinds: Object.freeze([]),
      paidFeatureEntitlement: 0, countedFeatureRanks: 0, edgeEntitlement: 0,
      countedEdgeRanks: 0, reachedMilestones: 0, resolvedMilestones: 0,
      expectedBonusSkillEdges: 0, recordedBonusSkillEdges: 0,
      milestoneStatPointBudgetBonus: 0,
    })
  }
  const features = currentFeatureEvidence(sheet)
  const edges = currentEdgeEvidence(sheet)
  const advancement = advancementEvidence(sheet)
  const featureBudget = paidFeatureEntitlement(sheet.level)
  const edgeBudget = edgeEntitlement(sheet.level)
  const reached = mechanics.milestoneChoices.filter(milestone => milestone.level <= sheet.level)
  const expectedBonusSkillEdges = mechanics.edgeEntitlements.bonusSkillEdgeLevels
    .filter(level => level <= sheet.level).length
  const recordedBonusSkillEdges = optionalCounter(sheet.bonusSkillEdges, expectedBonusSkillEdges)
  const remainingFeatures = optionalCounter(sheet.remainingFeatures, FEATURE_INSTANCE_LIMIT_PER_SHEET)
  const remainingEdges = optionalCounter(sheet.remainingEdges, EDGE_INSTANCE_LIMIT_PER_SHEET)
  const training = sheet.trainingFeature
  const trainingValid = training === undefined
    || mechanics.featureEntitlements.freeTrainingFeatureIds.includes(training)
  const maxMilestoneFeatures = reached.filter(milestone => (
    milestone.options.some(option => option.id === 'general-feature')
  )).length
  const maxMilestoneEdges = reached.filter(milestone => (
    milestone.options.some(option => option.id === 'two-edges')
  )).length * 2
  if (features.malformed) pending.add('feature-configuration')
  if (edges.malformed) pending.add('edge-configuration')
  if (advancement.malformed) pending.add('milestone-choice')
  const extraFeatures = Math.max(0, features.count - featureBudget)
  const extraEdges = Math.max(0, edges.count - edgeBudget)
  const assignmentKey = `${extraFeatures}:${extraEdges}`
  const completeAssignments = milestoneAssignments(reached, advancement.selectedStatMilestones, false)
  const partialAssignments = milestoneAssignments(reached, advancement.selectedStatMilestones, true)
  if (!partialAssignments.has(assignmentKey)) pending.add('milestone-choice')
  const invalid = features.malformed || edges.malformed || advancement.malformed
    || recordedBonusSkillEdges === null || remainingFeatures === null || remainingEdges === null
    || !trainingValid || features.classCount > mechanics.featureEntitlements.maximumClassFeatures
    || features.count > featureBudget + maxMilestoneFeatures
    || edges.count > edgeBudget + maxMilestoneEdges
    || (recordedBonusSkillEdges !== null && recordedBonusSkillEdges > edges.skillCount)
    || !partialAssignments.has(assignmentKey)
  if (!invalid) {
    if (training === undefined) pending.add('free-training-feature')
    if (features.count < featureBudget || (remainingFeatures ?? 0) > 0) pending.add('feature-or-class')
    if (edges.count < edgeBudget || (remainingEdges ?? 0) > 0) pending.add('edge')
    if ((recordedBonusSkillEdges ?? 0) < expectedBonusSkillEdges) pending.add('skill-rank')
    if (!completeAssignments.has(assignmentKey)) pending.add('milestone-choice')
  }
  return Object.freeze({
    schemaVersion: 1,
    status: invalid ? 'invalid' : pending.size > 0 ? 'pending' : 'none',
    pendingKinds: Object.freeze([...pending].sort((left, right) => (
      TRAINER_CHOICE_PENDING_KINDS.indexOf(left) - TRAINER_CHOICE_PENDING_KINDS.indexOf(right)
    ))),
    paidFeatureEntitlement: featureBudget,
    countedFeatureRanks: features.count,
    edgeEntitlement: edgeBudget,
    countedEdgeRanks: edges.count,
    reachedMilestones: reached.length,
    resolvedMilestones: invalid || pending.has('milestone-choice') ? 0 : reached.length,
    expectedBonusSkillEdges,
    recordedBonusSkillEdges: recordedBonusSkillEdges ?? 0,
    milestoneStatPointBudgetBonus: advancement.statPointBudgetBonus,
  })
}

export const detectTrainerChoiceAttention = (input: {
  readonly stored: StoredSheetDocument
  readonly campaignMinute: number
}): CampaignAttentionItem | null => {
  if (input.stored.kind !== 'trainer') return null
  if (!integer(input.stored.revision) || !integer(input.campaignMinute)) {
    throw new Error('Trainer choice attention requires exact current revision and campaign time.')
  }
  const raw = object(input.stored.document)
  if (!raw || raw.slug !== input.stored.slug) {
    throw new Error('Trainer choice attention requires one exact current Trainer sheet.')
  }
  const detection = detectTrainerChoiceState(raw as unknown as TrainerSheet)
  if (detection.status === 'none') return null
  const authority = Object.freeze({ kind: 'sheet' as const, id: input.stored.slug, revision: input.stored.revision })
  const sourceEvent = Object.freeze({
    kind: 'sheet-authority' as const,
    eventId: identity(
      'campaign-attention-source:v1:', 'trainer-build', input.stored.slug, input.stored.revision,
    ),
    campaignMinute: input.campaignMinute,
  })
  const itemId = identity('campaign-attention:v1:', 'trainer-build', input.stored.slug)
  return createOpenCampaignAttentionItem({
    itemId,
    reason: 'trainer-advancement',
    audience: 'owner',
    urgency: detection.status === 'invalid' ? 'blocking' : 'normal',
    entity: Object.freeze({ kind: 'trainer-sheet', id: input.stored.slug }),
    sourceEvent,
    authority,
    requiredDecision: Object.freeze({
      decisionId: identity('campaign-attention-decision:v1:', itemId),
      kind: 'review-trainer-build',
      authority,
    }),
    legalActions: Object.freeze([Object.freeze({
      actionId: identity('campaign-attention-action:v1:', itemId, 'review-trainer'),
      intent: 'review-trainer',
      href: `/sheets/trainers/${encodeURIComponent(input.stored.slug)}?attention=trainer-build`,
      authority,
      requiresConfirmation: false,
    })]),
    createdAtCampaignMinute: input.campaignMinute,
  })
}

export const projectCampaignTrainerChoiceAttention = (input: {
  readonly sheets: readonly StoredSheetDocument[]
  readonly campaignMinute: number
  readonly completeness: { readonly sheets: true }
}): readonly CampaignAttentionItem[] => {
  if (input.completeness.sheets !== true) {
    throw new Error('Trainer choice attention requires one complete current sheet read.')
  }
  if (!integer(input.campaignMinute) || input.sheets.length > SHEET_LIMIT) {
    throw new Error(`Trainer choice attention requires at most ${SHEET_LIMIT} current sheets.`)
  }
  const keys = input.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`)
  if (new Set(keys).size !== keys.length) {
    throw new Error('Trainer choice attention requires unique current sheet authority.')
  }
  const items = input.sheets.flatMap((stored) => {
    const item = detectTrainerChoiceAttention({ stored, campaignMinute: input.campaignMinute })
    return item ? [item] : []
  })
  return Object.freeze(items.sort((left, right) => (
    (left.urgency === 'blocking' ? 0 : 1) - (right.urgency === 'blocking' ? 0 : 1)
    || left.entity.id.localeCompare(right.entity.id)
    || left.itemId.localeCompare(right.itemId)
  )))
}

export const CAMPAIGN_TRAINER_CHOICE_ATTENTION_LIMIT = SHEET_LIMIT
