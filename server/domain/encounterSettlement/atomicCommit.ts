import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ENCOUNTER_SETTLEMENT_LIMITS,
  parseEncounterSettlementDocument,
  type EncounterSettlementAllocation,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementAudience,
  type EncounterSettlementDecisionSubject,
  type EncounterSettlementDocument,
  type EncounterSettlementReceipt,
} from '#shared/encounterSettlement/document'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  evaluateEncounterSettlementEligibility,
  type EncounterSettlementEligibilityAuthoritySnapshot,
} from './eligibility'
import {
  planEncounterSettlementRewardPackage,
  type EncounterSettlementRewardDestinationAuthority,
  type EncounterSettlementRewardPackagePlan,
} from './rewardPackage'
import type {
  EncounterSettlementBatchExperiencePlan,
  EncounterSettlementExperienceSheetWrite,
} from './experienceAllocation'
import type {
  EncounterSettlementLootAllocationPlan,
  EncounterSettlementLootContainerWrite,
} from './lootAllocation'
import type {
  EncounterSettlementCapturePlan,
  EncounterSettlementCaptureSheetWrite,
} from './captureSettlement'
import type {
  EncounterSettlementOutcomeFact,
  EncounterSettlementOutcomePlan,
} from './outcomeSettlement'
import type {
  EncounterSettlementCleanupPlan,
  EncounterSettlementCleanupSheetWrite,
} from './temporaryCleanup'

export const ENCOUNTER_SETTLEMENT_ATOMIC_COMMIT_SCHEMA_VERSION = 1 as const

export interface EncounterSettlementAtomicSheetAuthority {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly document: CharacterSheet | TrainerSheet
}

export interface EncounterSettlementAtomicGroupAuthority {
  readonly slug: string
  readonly revision: number
  readonly document: GroupInventoryDocument
}

export interface EncounterSettlementAtomicAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly settlement: EncounterSettlementDocument
  readonly eligibility: EncounterSettlementEligibilityAuthoritySnapshot
  readonly sheetsComplete: true
  readonly sheets: readonly EncounterSettlementAtomicSheetAuthority[]
  readonly groupsComplete: true
  readonly groups: readonly EncounterSettlementAtomicGroupAuthority[]
  readonly map: TabletopMap
  readonly encounterDocument: EncounterDocument
  readonly additionalRewardDestinations: readonly EncounterSettlementRewardDestinationAuthority[]
}

export interface EncounterSettlementAtomicSheetWrite {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextDocument: CharacterSheet | TrainerSheet
  readonly sourceKinds: readonly ('experience' | 'loot' | 'capture' | 'cleanup')[]
}

export interface EncounterSettlementAtomicGroupWrite {
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextDocument: GroupInventoryDocument
  readonly sourceKinds: readonly ['loot']
}

export interface EncounterSettlementAtomicSettlementWrite {
  readonly settlementId: string
  readonly expectedRevision: number
  readonly revision: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextDocument: EncounterSettlementDocument
}

export type EncounterSettlementHistoryFactKind =
  | 'experience-award'
  | 'loot-award'
  | 'capture-settled'
  | 'outcome'
  | 'cleanup'
  | 'completion'

export interface EncounterSettlementHistoryFact {
  readonly factId: string
  readonly kind: EncounterSettlementHistoryFactKind
  readonly audience: EncounterSettlementAudience
  readonly subjectKind: 'sheet' | 'inventory' | 'capture' | 'outcome' | 'cleanup' | 'settlement'
  readonly subjectId: string
  readonly resultCode: string
  readonly payload: Readonly<Record<string, unknown>>
}

export type EncounterSettlementAttentionReason =
  | 'level-threshold'
  | 'advancement-review'
  | 'capture-review'
  | 'medical-review'
  | 'equipment-review'
  | 'continuation-review'

export interface EncounterSettlementAttentionSource {
  readonly sourceId: string
  readonly reason: EncounterSettlementAttentionReason
  readonly audience: 'gm' | 'owner'
  readonly entityKind: 'trainer-sheet' | 'pokemon-sheet' | 'profile' | 'campaign'
  readonly entityId: string
  readonly sourceFactId: string
  readonly authority: EncounterSettlementAuthorityRef
}

export interface EncounterSettlementAtomicComponentPlans {
  readonly experience: EncounterSettlementBatchExperiencePlan
  readonly loot: EncounterSettlementLootAllocationPlan
  readonly capture: EncounterSettlementCapturePlan
  readonly outcomes: EncounterSettlementOutcomePlan
  readonly cleanup: EncounterSettlementCleanupPlan
}

export interface EncounterSettlementAtomicCommitPlan {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_ATOMIC_COMMIT_SCHEMA_VERSION
  readonly operationId: string
  readonly settlementId: string
  readonly expectedSettlementRevision: number
  readonly campaignMinute: number
  readonly committedAt: number
  readonly authorityDefinitionSha256: string
  readonly planDefinitionSha256: string
  readonly rewardValidation: EncounterSettlementRewardPackagePlan
  readonly settlementWrite: EncounterSettlementAtomicSettlementWrite
  readonly encounterWrite: NonNullable<EncounterSettlementOutcomePlan['encounterWrite']>
  readonly mapWrite: EncounterSettlementCleanupPlan['mapWrite']
  readonly sheetWrites: readonly EncounterSettlementAtomicSheetWrite[]
  readonly groupWrites: readonly EncounterSettlementAtomicGroupWrite[]
  readonly historyFacts: readonly EncounterSettlementHistoryFact[]
  readonly attentionSources: readonly EncounterSettlementAttentionSource[]
}

export type EncounterSettlementAtomicCommitErrorCode =
  | 'incomplete-authority'
  | 'incomplete-component-plan'
  | 'component-document-drift'
  | 'invalid-reward-merge'
  | 'ineligible-settlement'
  | 'invalid-current-document'
  | 'stale-component-write'
  | 'conflicting-aggregate-write'
  | 'invalid-attention-source'
  | 'terminal-settlement'
  | 'overflow'

export class EncounterSettlementAtomicCommitError extends Error {
  constructor(
    readonly code: EncounterSettlementAtomicCommitErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementAtomicCommitError'
  }
}

type JsonObject = Readonly<Record<string, unknown>>
type SheetWriteSource = 'experience' | 'loot' | 'capture' | 'cleanup'

interface CandidateSheetWrite {
  readonly source: SheetWriteSource
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextDocument: CharacterSheet | TrainerSheet
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const HASH = /^[a-f0-9]{64}$/
const RECEIPT_SUBJECT_CHUNK = ENCOUNTER_SETTLEMENT_LIMITS.receiptSubjects
const MAX_HISTORY_FACTS = 16_384
const MAX_ATTENTION_SOURCES = 4_096

const fail = (
  code: EncounterSettlementAtomicCommitErrorCode,
  path: string,
  message: string,
): never => {
  throw new EncounterSettlementAtomicCommitError(code, path, message)
}
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const jsonValue = <Value>(value: Value, path: string): Value => {
  try { return JSON.parse(JSON.stringify(value)) as Value }
  catch { return fail('invalid-current-document', path, 'must be JSON-serializable.') }
}
const hashJson = (value: unknown, path: string): string => createHash('sha256')
  .update(stableJsonStringify(jsonValue(value, path), {
    path,
    limits: {
      maxDepth: 64,
      maxNodes: 1_500_000,
      maxObjectFields: 20_000,
      maxArrayEntries: 150_000,
      maxStringLength: 250_000,
    },
  }))
  .digest('hex')

export const encounterSettlementAtomicDefinitionSha256 = (value: unknown): string => (
  hashJson(value, 'encounterSettlementAtomicDefinition')
)
const deterministicId = (prefix: string, ...parts: readonly string[]): string => {
  const hash = createHash('sha256').update(prefix)
  for (const part of parts) hash.update('\u0000').update(part)
  return `${prefix}${hash.digest('hex')}`
}
const sheetKey = (kind: SheetKind, slug: string): string => `${kind}\u0000${slug}`
const destinationKey = (destination: EncounterSettlementRewardDestinationAuthority['destination']): string => (
  `${destination.kind}\u0000${destination.id}`
)

const withoutOwnedField = (
  document: EncounterSettlementDocument,
  base: EncounterSettlementDocument,
  field: 'allocations' | 'persistentConsequences',
): EncounterSettlementDocument => ({ ...document, [field]: base[field] })

const assertComponentDocument = (input: {
  readonly base: EncounterSettlementDocument
  readonly candidate: EncounterSettlementDocument
  readonly field: 'allocations' | 'persistentConsequences' | null
  readonly path: string
}): void => {
  const candidate = parseEncounterSettlementDocument(input.candidate)
  if (candidate.settlementId !== input.base.settlementId || candidate.revision !== input.base.revision) {
    fail('component-document-drift', input.path, 'must be planned from the same settlement identity and revision.')
  }
  const comparable = input.field
    ? withoutOwnedField(candidate, input.base, input.field)
    : candidate
  if (hashJson(comparable, `${input.path}.comparable`) !== hashJson(input.base, `${input.path}.base`)) {
    fail('component-document-drift', input.path, 'changed settlement fields outside its owned orchestration domain.')
  }
}

const mergeAllocations = (
  base: EncounterSettlementDocument,
  plans: EncounterSettlementAtomicComponentPlans,
): readonly EncounterSettlementAllocation[] => {
  const sourceForKind = {
    experience: plans.experience.document,
    money: plans.loot.document,
    item: plans.loot.document,
    capture: plans.capture.document,
    narrative: base,
  } as const
  const allocations: EncounterSettlementAllocation[] = []
  const ids = new Set<string>()
  for (const line of base.rewardPackage.lines) {
    const source = sourceForKind[line.payload.kind]
    for (const allocation of source.allocations.filter(row => row.rewardId === line.rewardId)) {
      if (ids.has(allocation.allocationId)) {
        fail('invalid-reward-merge', allocation.allocationId, 'duplicates one allocation identity across reward providers.')
      }
      ids.add(allocation.allocationId)
      allocations.push(allocation)
    }
  }
  allocations.sort((left, right) => left.allocationId.localeCompare(right.allocationId))
  return Object.freeze(allocations)
}

const mergeRewardDestinations = (
  plans: EncounterSettlementAtomicComponentPlans,
  additional: readonly EncounterSettlementRewardDestinationAuthority[],
): readonly EncounterSettlementRewardDestinationAuthority[] => {
  const rows = [
    ...plans.experience.destinationAuthorities,
    ...plans.loot.destinationAuthorities,
    ...plans.capture.destinationAuthorities,
    ...additional,
  ]
  const merged = new Map<string, EncounterSettlementRewardDestinationAuthority>()
  for (const [index, row] of rows.entries()) {
    const path = `rewardDestinations[${index}]`
    const key = destinationKey(row.destination)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, deepCloneJson(row))
      continue
    }
    if (existing.destination.revision !== row.destination.revision
      || !sameJsonValue(existing.permission, row.permission)
      || !sameJsonValue(existing.capacity, row.capacity)) {
      fail('invalid-reward-merge', path, 'contains conflicting authority for one reward destination.')
    }
    const writes = new Map(existing.writes.map(write => [write.sourceWriteId, write]))
    for (const write of row.writes) {
      const duplicate = writes.get(write.sourceWriteId)
      if (duplicate && !sameJsonValue(duplicate, write)) {
        fail('invalid-reward-merge', path, 'contains conflicting writes with one deterministic identity.')
      }
      writes.set(write.sourceWriteId, write)
    }
    merged.set(key, Object.freeze({
      ...existing,
      writes: Object.freeze([...writes.values()].sort((left, right) => left.sourceWriteId.localeCompare(right.sourceWriteId))),
    }))
  }
  return Object.freeze([...merged.values()].sort((left, right) => destinationKey(left.destination).localeCompare(destinationKey(right.destination))))
}

const mergeJsonChanges = (
  previous: unknown,
  current: unknown,
  candidate: unknown,
  path: string,
): unknown => {
  if (sameJsonValue(current, candidate)) return deepCloneJson(current)
  if (sameJsonValue(current, previous)) return deepCloneJson(candidate)
  if (sameJsonValue(candidate, previous)) return deepCloneJson(current)
  if (!isObject(previous) || !isObject(current) || !isObject(candidate)) {
    return fail('conflicting-aggregate-write', path, 'is changed divergently by more than one settlement provider.')
  }
  const result: Record<string, unknown> = {}
  const keys = new Set([...Object.keys(previous), ...Object.keys(current), ...Object.keys(candidate)])
  for (const key of keys) {
    const value = mergeJsonChanges(previous[key], current[key], candidate[key], `${path}.${key}`)
    if (value !== undefined) result[key] = value
  }
  return result
}

const normalizeCandidateMetadata = <Document extends Record<string, unknown>>(
  candidate: Document,
  previous: Document,
): Document => ({
  ...deepCloneJson(candidate),
  ...(Object.hasOwn(previous, 'slug') ? { slug: previous.slug } : {}),
  ...(Object.hasOwn(previous, 'revision') ? { revision: previous.revision } : {}),
  ...(Object.hasOwn(previous, 'updatedAt') ? { updatedAt: previous.updatedAt } : {}),
}) as Document

const validateAtomicAuthority = (
  authority: EncounterSettlementAtomicAuthoritySnapshot,
): {
  readonly settlement: EncounterSettlementDocument
  readonly sheets: ReadonlyMap<string, EncounterSettlementAtomicSheetAuthority>
  readonly groups: ReadonlyMap<string, EncounterSettlementAtomicGroupAuthority>
} => {
  if (!authority || authority.completeness !== 'authoritative-current'
    || authority.sheetsComplete !== true || authority.groupsComplete !== true
    || !Array.isArray(authority.sheets) || !Array.isArray(authority.groups)
    || !Array.isArray(authority.additionalRewardDestinations)) {
    fail('incomplete-authority', 'authority', 'must contain one complete current atomic settlement read.')
  }
  const settlement = parseEncounterSettlementDocument(authority.settlement)
  const sheets = new Map<string, EncounterSettlementAtomicSheetAuthority>()
  authority.sheets.forEach((row, index) => {
    const path = `authority.sheets[${index}]`
    if (!row || !['pokemon', 'trainer'].includes(row.kind) || !isId(row.slug)
      || !integer(row.revision) || !row.document || typeof row.document !== 'object') {
      fail('invalid-current-document', path, 'must be one exact current sheet document.')
    }
    const key = sheetKey(row.kind, row.slug)
    if (sheets.has(key)) fail('invalid-current-document', path, 'duplicates one sheet authority.')
    sheets.set(key, row)
  })
  const groups = new Map<string, EncounterSettlementAtomicGroupAuthority>()
  authority.groups.forEach((row, index) => {
    const path = `authority.groups[${index}]`
    if (!row || !isId(row.slug) || !integer(row.revision) || !row.document || typeof row.document !== 'object') {
      fail('invalid-current-document', path, 'must be one exact current group inventory document.')
    }
    if (groups.has(row.slug)) fail('invalid-current-document', path, 'duplicates one group inventory authority.')
    groups.set(row.slug, row)
  })
  if (authority.map.slug !== settlement.encounter.linkedMapSlug
    || Number(authority.map.revision ?? 0) !== settlement.encounter.linkedMapRevision
    || authority.encounterDocument.encounterId !== settlement.encounter.encounterId
    || authority.encounterDocument.revision !== settlement.encounter.encounterRevision) {
    fail('invalid-current-document', 'authority', 'map and Encounter Document must match the settlement checkpoint exactly.')
  }
  return { settlement, sheets, groups }
}

const candidateSheetWrites = (
  plans: EncounterSettlementAtomicComponentPlans,
): readonly CandidateSheetWrite[] => {
  const experience = plans.experience.sheetWrites.map((write: EncounterSettlementExperienceSheetWrite): CandidateSheetWrite => ({
    source: 'experience', kind: 'pokemon', slug: write.sheetSlug,
    expectedRevision: write.expectedRevision,
    beforeDefinitionSha256: write.beforeDefinitionSha256,
    afterDefinitionSha256: write.afterDefinitionSha256,
    nextDocument: write.nextSheet,
  }))
  const loot = plans.loot.containerWrites.flatMap((write: EncounterSettlementLootContainerWrite): CandidateSheetWrite[] => (
    write.kind === 'trainer' ? [{
      source: 'loot', kind: 'trainer', slug: write.slug,
      expectedRevision: write.expectedRevision,
      beforeDefinitionSha256: write.beforeDefinitionSha256,
      afterDefinitionSha256: write.afterDefinitionSha256,
      nextDocument: write.nextDocument as TrainerSheet,
    }] : []
  ))
  const capture = plans.capture.sheetWrites.map((write: EncounterSettlementCaptureSheetWrite): CandidateSheetWrite => ({
    source: 'capture', kind: write.kind, slug: write.slug,
    expectedRevision: write.expectedRevision,
    beforeDefinitionSha256: write.beforeDefinitionSha256,
    afterDefinitionSha256: write.afterDefinitionSha256,
    nextDocument: write.nextSheet,
  }))
  const cleanup = plans.cleanup.sheetWrites.map((write: EncounterSettlementCleanupSheetWrite): CandidateSheetWrite => ({
    source: 'cleanup', kind: write.kind, slug: write.slug,
    expectedRevision: write.expectedRevision,
    beforeDefinitionSha256: write.beforeDefinitionSha256,
    afterDefinitionSha256: write.afterDefinitionSha256,
    nextDocument: write.nextSheet,
  }))
  return Object.freeze([...experience, ...loot, ...capture, ...cleanup])
}

const aggregateSheetWrites = (input: {
  readonly plans: EncounterSettlementAtomicComponentPlans
  readonly sheets: ReadonlyMap<string, EncounterSettlementAtomicSheetAuthority>
  readonly committedAt: number
}): readonly EncounterSettlementAtomicSheetWrite[] => {
  const candidates = candidateSheetWrites(input.plans)
  const bySheet = new Map<string, CandidateSheetWrite[]>()
  for (const candidate of candidates) {
    const key = sheetKey(candidate.kind, candidate.slug)
    const authority = input.sheets.get(key)
    if (!authority || authority.revision !== candidate.expectedRevision
      || hashJson(authority.document, `${key}.before`) !== candidate.beforeDefinitionSha256
      || hashJson(candidate.nextDocument, `${key}.${candidate.source}.after`) !== candidate.afterDefinitionSha256) {
      fail('stale-component-write', key, `${candidate.source} no longer matches current sheet authority.`)
    }
    const rows = bySheet.get(key) ?? []
    rows.push(candidate)
    bySheet.set(key, rows)
  }
  const writes: EncounterSettlementAtomicSheetWrite[] = []
  for (const [key, rows] of bySheet) {
    const authority = input.sheets.get(key)!
    const previous = deepCloneJson(authority.document) as unknown as Record<string, unknown>
    let merged = previous
    const sources = new Set<SheetWriteSource>()
    for (const row of rows.sort((left, right) => left.source.localeCompare(right.source))) {
      const candidate = normalizeCandidateMetadata(
        row.nextDocument as unknown as Record<string, unknown>,
        previous,
      )
      merged = mergeJsonChanges(previous, merged, candidate, key) as Record<string, unknown>
      sources.add(row.source)
    }
    const next = {
      ...merged,
      slug: authority.slug,
      revision: authority.revision + 1,
      updatedAt: input.committedAt,
    } as unknown as CharacterSheet | TrainerSheet
    writes.push(Object.freeze({
      kind: authority.kind,
      slug: authority.slug,
      expectedRevision: authority.revision,
      revision: authority.revision + 1,
      beforeDefinitionSha256: hashJson(authority.document, `${key}.aggregateBefore`),
      afterDefinitionSha256: hashJson(next, `${key}.aggregateAfter`),
      nextDocument: next,
      sourceKinds: Object.freeze([...sources].sort()),
    }))
  }
  return Object.freeze(writes.sort((left, right) => sheetKey(left.kind, left.slug).localeCompare(sheetKey(right.kind, right.slug))))
}

const aggregateGroupWrites = (input: {
  readonly plans: EncounterSettlementAtomicComponentPlans
  readonly groups: ReadonlyMap<string, EncounterSettlementAtomicGroupAuthority>
  readonly committedAt: number
}): readonly EncounterSettlementAtomicGroupWrite[] => {
  const writes: EncounterSettlementAtomicGroupWrite[] = []
  for (const write of input.plans.loot.containerWrites.filter(row => row.kind === 'group')) {
    const authority = input.groups.get(write.slug)
      ?? fail('stale-component-write', `group:${write.slug}`, 'loot group inventory authority is unavailable.')
    if (authority.revision !== write.expectedRevision
      || hashJson(authority.document, `group.${write.slug}.before`) !== write.beforeDefinitionSha256
      || hashJson(write.nextDocument, `group.${write.slug}.after`) !== write.afterDefinitionSha256) {
      fail('stale-component-write', `group:${write.slug}`, 'loot no longer matches current group inventory authority.')
    }
    const nextDocument = {
      ...deepCloneJson(write.nextDocument as GroupInventoryDocument),
      slug: write.slug,
      revision: authority.revision + 1,
      updatedAt: input.committedAt,
    }
    writes.push(Object.freeze({
      slug: write.slug,
      expectedRevision: authority.revision,
      revision: authority.revision + 1,
      beforeDefinitionSha256: hashJson(authority.document, `group.${write.slug}.aggregateBefore`),
      afterDefinitionSha256: hashJson(nextDocument, `group.${write.slug}.aggregateAfter`),
      nextDocument,
      sourceKinds: Object.freeze(['loot'] as const),
    }))
  }
  return Object.freeze(writes.sort((left, right) => left.slug.localeCompare(right.slug)))
}

const receiptChunks = (input: {
  readonly operationId: string
  readonly settlementId: string
  readonly kind: EncounterSettlementReceipt['kind']
  readonly subjects: readonly EncounterSettlementDecisionSubject[]
  readonly campaignMinute: number
}): { readonly receipts: readonly EncounterSettlementReceipt[], readonly receiptBySubject: ReadonlyMap<string, string> } => {
  const receipts: EncounterSettlementReceipt[] = []
  const receiptBySubject = new Map<string, string>()
  for (let offset = 0; offset < input.subjects.length; offset += RECEIPT_SUBJECT_CHUNK) {
    const subjects = input.subjects.slice(offset, offset + RECEIPT_SUBJECT_CHUNK)
    const receiptId = deterministicId(
      'settlement-commit-receipt:v1:', input.settlementId, input.operationId, input.kind, String(offset / RECEIPT_SUBJECT_CHUNK),
    )
    receipts.push(Object.freeze({
      receiptId,
      kind: input.kind,
      audience: input.kind === 'completion' ? 'public' : 'gm',
      operationId: input.operationId,
      result: 'accepted',
      subjects: Object.freeze(subjects),
      sourceReceiptId: null,
      acceptedAtCampaignMinute: input.campaignMinute,
    }))
    for (const subject of subjects) receiptBySubject.set(`${subject.kind}\u0000${subject.id}`, receiptId)
  }
  return { receipts: Object.freeze(receipts), receiptBySubject }
}

const terminalSettlementDocument = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly operationId: string
  readonly campaignMinute: number
  readonly completedEncounterRevision: number
}): EncounterSettlementDocument => {
  if (input.settlement.revision >= Number.MAX_SAFE_INTEGER) fail('overflow', 'settlement.revision', 'cannot advance beyond the safe integer bound.')
  const consequenceSubjects = input.settlement.persistentConsequences
    .filter(row => row.state !== 'excluded')
    .map(row => ({ kind: 'consequence' as const, id: row.consequenceId }))
  const allocationSubjects = input.settlement.allocations
    .filter(row => row.state !== 'excluded')
    .map(row => ({ kind: 'allocation' as const, id: row.allocationId }))
  const cleanupSubjects = input.settlement.temporaryCleanup
    .filter(row => row.state !== 'excluded')
    .map(row => ({ kind: 'cleanup' as const, id: row.cleanupId }))
  const rewardSubjects = input.settlement.rewardPackage.lines
    .filter(row => row.disposition !== 'excluded')
    .map(row => ({ kind: 'reward' as const, id: row.rewardId }))
  if (input.settlement.persistentConsequences.some(row => row.state === 'proposed')
    || input.settlement.allocations.some(row => row.state === 'proposed')
    || input.settlement.temporaryCleanup.some(row => row.state === 'proposed')
    || input.settlement.rewardPackage.lines.some(row => row.disposition === 'pending')) {
    fail('ineligible-settlement', 'settlement', 'contains proposed or pending work at the commit boundary.')
  }
  const consequenceReceipts = receiptChunks({
    operationId: input.operationId, settlementId: input.settlement.settlementId,
    kind: 'consequence', subjects: consequenceSubjects, campaignMinute: input.campaignMinute,
  })
  const allocationReceipts = receiptChunks({
    operationId: input.operationId, settlementId: input.settlement.settlementId,
    kind: 'allocation', subjects: allocationSubjects, campaignMinute: input.campaignMinute,
  })
  const cleanupReceipts = receiptChunks({
    operationId: input.operationId, settlementId: input.settlement.settlementId,
    kind: 'cleanup', subjects: cleanupSubjects, campaignMinute: input.campaignMinute,
  })
  const rewardReceipts = receiptChunks({
    operationId: input.operationId, settlementId: input.settlement.settlementId,
    kind: 'reward', subjects: rewardSubjects, campaignMinute: input.campaignMinute,
  })
  const completionReceiptId = deterministicId(
    'settlement-commit-receipt:v1:', input.settlement.settlementId, input.operationId, 'completion', '0',
  )
  const completionReceipt: EncounterSettlementReceipt = Object.freeze({
    receiptId: completionReceiptId,
    kind: 'completion',
    audience: 'public',
    operationId: input.operationId,
    result: 'accepted',
    subjects: Object.freeze([{ kind: 'settlement' as const, id: input.settlement.settlementId }]),
    sourceReceiptId: null,
    acceptedAtCampaignMinute: input.campaignMinute,
  })
  const receiptFor = (map: ReadonlyMap<string, string>, kind: string, id: string): string => (
    map.get(`${kind}\u0000${id}`)
      ?? fail('ineligible-settlement', id, 'has no bounded terminal receipt assignment.')
  )
  return parseEncounterSettlementDocument({
    ...input.settlement,
    revision: input.settlement.revision + 1,
    status: 'completed',
    unresolvedGates: [],
    persistentConsequences: input.settlement.persistentConsequences.map(row => row.state === 'excluded' ? row : ({
      ...row,
      state: 'applied',
      receiptId: receiptFor(consequenceReceipts.receiptBySubject, 'consequence', row.consequenceId),
    })),
    rewardPackage: {
      ...input.settlement.rewardPackage,
      status: 'committed',
      lines: input.settlement.rewardPackage.lines.map(line => line.disposition === 'excluded' ? line : ({
        ...line,
        disposition: 'committed',
      })),
    },
    allocations: input.settlement.allocations.map(row => row.state === 'excluded' ? row : ({
      ...row,
      state: 'applied',
      receiptId: receiptFor(allocationReceipts.receiptBySubject, 'allocation', row.allocationId),
    })),
    temporaryCleanup: input.settlement.temporaryCleanup.map(row => row.state === 'excluded' ? row : ({
      ...row,
      state: 'applied',
      receiptId: receiptFor(cleanupReceipts.receiptBySubject, 'cleanup', row.cleanupId),
    })),
    receipts: [
      ...input.settlement.receipts,
      ...consequenceReceipts.receipts,
      ...rewardReceipts.receipts,
      ...allocationReceipts.receipts,
      ...cleanupReceipts.receipts,
      completionReceipt,
    ],
    completion: {
      state: 'accepted',
      operationId: input.operationId,
      receiptId: completionReceiptId,
      completedEncounterRevision: input.completedEncounterRevision,
      completedAtCampaignMinute: input.campaignMinute,
    },
    updatedAtCampaignMinute: input.campaignMinute,
  })
}

const historyFact = (input: Omit<EncounterSettlementHistoryFact, 'factId'> & {
  readonly operationId: string
  readonly settlementId: string
  readonly ordinal: string
}): EncounterSettlementHistoryFact => Object.freeze({
  factId: deterministicId(
    'settlement-history-fact:v1:', input.settlementId, input.operationId, input.kind, input.ordinal,
  ),
  kind: input.kind,
  audience: input.audience,
  subjectKind: input.subjectKind,
  subjectId: input.subjectId,
  resultCode: input.resultCode,
  payload: Object.freeze(jsonValue(input.payload, 'historyFact.payload')),
})

const buildHistoryFacts = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly operationId: string
  readonly plans: EncounterSettlementAtomicComponentPlans
}): readonly EncounterSettlementHistoryFact[] => {
  const facts: EncounterSettlementHistoryFact[] = []
  for (const row of input.plans.experience.recipientPreviews) {
    facts.push(historyFact({
      operationId: input.operationId, settlementId: input.settlement.settlementId,
      ordinal: `experience:${row.sheetSlug}`, kind: 'experience-award', audience: 'destination-owner',
      subjectKind: 'sheet', subjectId: row.sheetSlug, resultCode: 'experience-committed',
      payload: { amount: row.grantAmount, levelBefore: row.levelBefore, levelAfter: row.levelAfter },
    }))
  }
  for (const row of input.plans.loot.previews) {
    facts.push(historyFact({
      operationId: input.operationId, settlementId: input.settlement.settlementId,
      ordinal: `loot:${row.allocationId}`, kind: 'loot-award', audience: 'destination-owner',
      subjectKind: 'inventory', subjectId: `${row.destination.kind}:${row.destination.id}`,
      resultCode: row.kind === 'money' ? 'money-committed' : 'item-committed',
      payload: row.kind === 'money'
        ? { rewardId: row.rewardId, amount: row.amount }
        : { rewardId: row.rewardId, canonicalItemId: row.canonicalItemId, amount: row.amount, serialized: row.serialized },
    }))
  }
  for (const row of input.plans.capture.previews) {
    facts.push(historyFact({
      operationId: input.operationId, settlementId: input.settlement.settlementId,
      ordinal: `capture:${row.rewardId}`, kind: 'capture-settled', audience: 'destination-owner',
      subjectKind: 'capture', subjectId: row.pokemonSheetSlug, resultCode: `capture-${row.rosterAfter}`,
      payload: { rewardId: row.rewardId, caughtBallPreserved: true },
    }))
  }
  for (const row of input.plans.outcomes.outcomeFacts) {
    const outcome = row as EncounterSettlementOutcomeFact
    facts.push(historyFact({
      operationId: input.operationId, settlementId: input.settlement.settlementId,
      ordinal: `outcome:${outcome.factId}`, kind: 'outcome', audience: outcome.audience,
      subjectKind: 'outcome', subjectId: outcome.subjectId, resultCode: outcome.resultCode,
      payload: { kind: outcome.kind, mechanicalEffect: outcome.mechanicalEffect, summary: outcome.summary },
    }))
  }
  for (const row of input.plans.cleanup.previews) {
    facts.push(historyFact({
      operationId: input.operationId, settlementId: input.settlement.settlementId,
      ordinal: `cleanup:${row.cleanupId}:${row.sourceId}`, kind: 'cleanup', audience: 'public',
      subjectKind: 'cleanup', subjectId: row.cleanupId, resultCode: row.resultCode,
      payload: { sourceKind: row.sourceKind, action: row.action, changed: row.changed },
    }))
  }
  facts.push(historyFact({
    operationId: input.operationId, settlementId: input.settlement.settlementId,
    ordinal: 'completion', kind: 'completion', audience: 'public',
    subjectKind: 'settlement', subjectId: input.settlement.settlementId,
    resultCode: 'settlement-completed', payload: { schemaVersion: 1 },
  }))
  if (facts.length > MAX_HISTORY_FACTS) fail('overflow', 'historyFacts', `cannot exceed ${MAX_HISTORY_FACTS} facts.`)
  const ids = facts.map(row => row.factId)
  if (new Set(ids).size !== ids.length) fail('overflow', 'historyFacts', 'contains duplicate deterministic fact identities.')
  return Object.freeze(facts.sort((left, right) => left.factId.localeCompare(right.factId)))
}

const buildAttentionSources = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly operationId: string
  readonly experience: EncounterSettlementBatchExperiencePlan
  readonly historyFacts: readonly EncounterSettlementHistoryFact[]
  readonly additional: readonly EncounterSettlementAttentionSource[]
}): readonly EncounterSettlementAttentionSource[] => {
  const sources: EncounterSettlementAttentionSource[] = []
  for (const preview of input.experience.recipientPreviews.filter(row => row.crossedThresholds.length > 0)) {
    const sourceFact = input.historyFacts.find(row => row.kind === 'experience-award' && row.subjectId === preview.sheetSlug)
      ?? fail('invalid-attention-source', preview.sheetSlug, 'lost its Experience history source.')
    sources.push(Object.freeze({
      sourceId: deterministicId(
        'settlement-attention-source:v1:', input.settlement.settlementId, input.operationId,
        'level-threshold', preview.sheetSlug,
      ),
      reason: 'level-threshold',
      audience: 'owner',
      entityKind: 'pokemon-sheet',
      entityId: preview.sheetSlug,
      sourceFactId: sourceFact.factId,
      authority: Object.freeze({ kind: 'sheet', id: preview.sheetSlug, revision: preview.expectedRevision + 1 }),
    }))
  }
  for (const [index, row] of input.additional.entries()) {
    const path = `additionalAttentionSources[${index}]`
    if (!row || !isId(row.sourceId) || !['level-threshold', 'advancement-review', 'capture-review', 'medical-review', 'equipment-review', 'continuation-review'].includes(row.reason)
      || !['gm', 'owner'].includes(row.audience)
      || !['trainer-sheet', 'pokemon-sheet', 'profile', 'campaign'].includes(row.entityKind)
      || !isId(row.entityId) || !isId(row.sourceFactId)
      || !row.authority || !isId(row.authority.id) || !integer(row.authority.revision)) {
      fail('invalid-attention-source', path, 'must be one bounded authority-linked continuation source.')
    }
    if (!input.historyFacts.some(fact => fact.factId === row.sourceFactId)) {
      fail('invalid-attention-source', path, 'must point to one fact committed by this settlement.')
    }
    sources.push(Object.freeze(deepCloneJson(row)))
  }
  if (sources.length > MAX_ATTENTION_SOURCES) fail('overflow', 'attentionSources', `cannot exceed ${MAX_ATTENTION_SOURCES} entries.`)
  const ids = sources.map(row => row.sourceId)
  if (new Set(ids).size !== ids.length) fail('invalid-attention-source', 'attentionSources', 'contains duplicate stable identities.')
  return Object.freeze(sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId)))
}

const authorityEvidence = (authority: EncounterSettlementAtomicAuthoritySnapshot): string => hashJson({
  completeness: authority.completeness,
  settlement: authority.settlement,
  eligibility: authority.eligibility,
  sheetsComplete: authority.sheetsComplete,
  sheets: [...authority.sheets].sort((left, right) => sheetKey(left.kind, left.slug).localeCompare(sheetKey(right.kind, right.slug))),
  groupsComplete: authority.groupsComplete,
  groups: [...authority.groups].sort((left, right) => left.slug.localeCompare(right.slug)),
  map: authority.map,
  encounterDocument: authority.encounterDocument,
  additionalRewardDestinations: [...authority.additionalRewardDestinations].sort((left, right) => destinationKey(left.destination).localeCompare(destinationKey(right.destination))),
}, 'atomicSettlementAuthority')

export const planEncounterSettlementAtomicCommit = (input: {
  readonly operationId: string
  readonly campaignMinute: number
  readonly committedAt: number
  readonly authority: EncounterSettlementAtomicAuthoritySnapshot
  readonly components: EncounterSettlementAtomicComponentPlans
  readonly additionalAttentionSources?: readonly EncounterSettlementAttentionSource[]
}): EncounterSettlementAtomicCommitPlan => {
  if (!isId(input.operationId)) fail('invalid-current-document', 'operationId', 'must be one stable bounded operation identity.')
  if (!integer(input.campaignMinute) || !integer(input.committedAt)) {
    fail('invalid-current-document', 'commitTime', 'must contain bounded server-owned campaign and persistence timestamps.')
  }
  const current = validateAtomicAuthority(input.authority)
  const base = current.settlement
  if (base.status === 'committing' || base.status === 'completed' || base.status === 'cancelled'
    || base.completion.state !== 'open') {
    fail('terminal-settlement', 'settlement', 'cannot create a new atomic plan after settlement commit has begun.')
  }
  if (input.campaignMinute < base.updatedAtCampaignMinute) {
    fail('invalid-current-document', 'campaignMinute', 'cannot precede the latest settlement authority minute.')
  }
  const plans = input.components
  if (!plans.experience.complete || !plans.loot.complete || !plans.capture.complete
    || !plans.outcomes.complete || !plans.cleanup.complete
    || plans.outcomes.encounterWrite === null || plans.cleanup.lifecycle === null) {
    fail('incomplete-component-plan', 'components', 'every reward, outcome, and cleanup provider must be complete before atomic commit.')
  }
  assertComponentDocument({ base, candidate: plans.experience.document, field: 'allocations', path: 'components.experience.document' })
  assertComponentDocument({ base, candidate: plans.loot.document, field: 'allocations', path: 'components.loot.document' })
  assertComponentDocument({ base, candidate: plans.capture.document, field: 'allocations', path: 'components.capture.document' })
  assertComponentDocument({ base, candidate: plans.outcomes.document, field: 'persistentConsequences', path: 'components.outcomes.document' })
  assertComponentDocument({ base, candidate: plans.cleanup.document, field: null, path: 'components.cleanup.document' })

  const mergedDraft = parseEncounterSettlementDocument({
    ...base,
    persistentConsequences: plans.outcomes.document.persistentConsequences,
    allocations: mergeAllocations(base, plans),
  })
  const rewardDestinations = mergeRewardDestinations(plans, input.authority.additionalRewardDestinations)
  const rewardValidation = planEncounterSettlementRewardPackage({
    settlement: mergedDraft,
    authority: { completeness: 'authoritative-current', destinations: rewardDestinations },
  })
  if (!rewardValidation.eligible) {
    fail('invalid-reward-merge', 'rewardValidation', 'combined reward writes are not one complete eligible package.')
  }
  const eligibility = evaluateEncounterSettlementEligibility({
    settlement: rewardValidation.document,
    authority: input.authority.eligibility,
  })
  if (!eligibility.eligible || eligibility.outcome !== 'eligible' || eligibility.unresolvedGates.length > 0) {
    fail('ineligible-settlement', 'eligibility', 'fresh complete authority still contains blocking settlement gates.')
  }

  const encounterWrite = plans.outcomes.encounterWrite
    ?? fail('incomplete-component-plan', 'components.outcomes.encounterWrite', 'is required for atomic commit.')
  if (encounterWrite.expectedRevision !== input.authority.encounterDocument.revision
    || encounterWrite.beforeDefinitionSha256 !== hashJson(input.authority.encounterDocument, 'atomicEncounterBefore')
    || encounterWrite.afterDefinitionSha256 !== hashJson(encounterWrite.nextDocument, 'atomicEncounterAfter')
    || encounterWrite.revision !== encounterWrite.expectedRevision + 1) {
    fail('stale-component-write', 'components.outcomes.encounterWrite', 'no longer matches current Encounter Document authority.')
  }
  const mapWrite = plans.cleanup.mapWrite
  if (mapWrite && (mapWrite.mapSlug !== input.authority.map.slug
    || mapWrite.expectedRevision !== Number(input.authority.map.revision ?? 0)
    || mapWrite.beforeDefinitionSha256 !== hashJson(input.authority.map, 'atomicMapBefore')
    || mapWrite.afterDefinitionSha256 !== hashJson(mapWrite.nextMap, 'atomicMapAfter')
    || mapWrite.revision !== mapWrite.expectedRevision + 1)) {
    fail('stale-component-write', 'components.cleanup.mapWrite', 'no longer matches current map authority.')
  }
  const sheetWrites = aggregateSheetWrites({ plans, sheets: current.sheets, committedAt: input.committedAt })
  const groupWrites = aggregateGroupWrites({ plans, groups: current.groups, committedAt: input.committedAt })
  const terminalDocument = terminalSettlementDocument({
    settlement: parseEncounterSettlementDocument({
      ...rewardValidation.document,
      status: 'ready',
      unresolvedGates: [],
    }),
    operationId: input.operationId,
    campaignMinute: input.campaignMinute,
    completedEncounterRevision: encounterWrite.revision,
  })
  const settlementWrite: EncounterSettlementAtomicSettlementWrite = Object.freeze({
    settlementId: base.settlementId,
    expectedRevision: base.revision,
    revision: base.revision + 1,
    beforeDefinitionSha256: hashJson(base, 'atomicSettlementBefore'),
    afterDefinitionSha256: hashJson(terminalDocument, 'atomicSettlementAfter'),
    nextDocument: terminalDocument,
  })
  const historyFacts = buildHistoryFacts({ settlement: terminalDocument, operationId: input.operationId, plans })
  const attentionSources = buildAttentionSources({
    settlement: terminalDocument,
    operationId: input.operationId,
    experience: plans.experience,
    historyFacts,
    additional: input.additionalAttentionSources ?? [],
  })
  const authorityDefinitionSha256 = authorityEvidence(input.authority)
  const planDefinitionSha256 = hashJson({
    schemaVersion: ENCOUNTER_SETTLEMENT_ATOMIC_COMMIT_SCHEMA_VERSION,
    operationId: input.operationId,
    settlementId: base.settlementId,
    expectedSettlementRevision: base.revision,
    campaignMinute: input.campaignMinute,
    committedAt: input.committedAt,
    authorityDefinitionSha256,
    settlementWrite,
    encounterWrite,
    mapWrite,
    sheetWrites,
    groupWrites,
    historyFacts,
    attentionSources,
  }, 'atomicSettlementPlan')
  return Object.freeze({
    schemaVersion: ENCOUNTER_SETTLEMENT_ATOMIC_COMMIT_SCHEMA_VERSION,
    operationId: input.operationId,
    settlementId: base.settlementId,
    expectedSettlementRevision: base.revision,
    campaignMinute: input.campaignMinute,
    committedAt: input.committedAt,
    authorityDefinitionSha256,
    planDefinitionSha256,
    rewardValidation,
    settlementWrite,
    encounterWrite,
    mapWrite,
    sheetWrites,
    groupWrites,
    historyFacts,
    attentionSources,
  })
}

const atomicPlanDefinitionEvidence = (plan: EncounterSettlementAtomicCommitPlan): JsonObject => ({
  schemaVersion: plan.schemaVersion,
  operationId: plan.operationId,
  settlementId: plan.settlementId,
  expectedSettlementRevision: plan.expectedSettlementRevision,
  campaignMinute: plan.campaignMinute,
  committedAt: plan.committedAt,
  authorityDefinitionSha256: plan.authorityDefinitionSha256,
  settlementWrite: plan.settlementWrite,
  encounterWrite: plan.encounterWrite,
  mapWrite: plan.mapWrite,
  sheetWrites: plan.sheetWrites,
  groupWrites: plan.groupWrites,
  historyFacts: plan.historyFacts,
  attentionSources: plan.attentionSources,
})

export const assertEncounterSettlementAtomicPlanIntegrity = (
  plan: EncounterSettlementAtomicCommitPlan,
): EncounterSettlementAtomicCommitPlan => {
  if (!plan || plan.schemaVersion !== ENCOUNTER_SETTLEMENT_ATOMIC_COMMIT_SCHEMA_VERSION
    || !isId(plan.operationId) || !isId(plan.settlementId)
    || !integer(plan.expectedSettlementRevision) || !integer(plan.campaignMinute)
    || !integer(plan.committedAt) || !HASH.test(plan.authorityDefinitionSha256)
    || !HASH.test(plan.planDefinitionSha256)) {
    fail('invalid-current-document', 'plan', 'must be one bounded versioned atomic settlement plan.')
  }
  if (hashJson(atomicPlanDefinitionEvidence(plan), 'atomicSettlementPlan') !== plan.planDefinitionSha256) {
    fail('component-document-drift', 'plan', 'definition hash does not match its exact write and evidence set.')
  }
  if (plan.operationId !== plan.settlementWrite.nextDocument.completion.operationId
    || plan.settlementId !== plan.settlementWrite.settlementId
    || plan.expectedSettlementRevision !== plan.settlementWrite.expectedRevision
    || plan.settlementWrite.revision !== plan.expectedSettlementRevision + 1
    || !HASH.test(plan.settlementWrite.beforeDefinitionSha256)
    || plan.settlementWrite.afterDefinitionSha256 !== hashJson(plan.settlementWrite.nextDocument, 'integritySettlementAfter')
    || plan.encounterWrite.revision !== plan.encounterWrite.expectedRevision + 1
    || !HASH.test(plan.encounterWrite.beforeDefinitionSha256)
    || plan.encounterWrite.afterDefinitionSha256 !== hashJson(plan.encounterWrite.nextDocument, 'integrityEncounterAfter')
    || (plan.mapWrite !== null
      && (plan.mapWrite.revision !== plan.mapWrite.expectedRevision + 1
        || !HASH.test(plan.mapWrite.beforeDefinitionSha256)
        || plan.mapWrite.afterDefinitionSha256 !== hashJson(plan.mapWrite.nextMap, 'integrityMapAfter')))
    || plan.sheetWrites.some(write => write.revision !== write.expectedRevision + 1
      || !HASH.test(write.beforeDefinitionSha256)
      || write.afterDefinitionSha256 !== hashJson(write.nextDocument, 'integritySheetAfter'))
    || plan.groupWrites.some(write => write.revision !== write.expectedRevision + 1
      || !HASH.test(write.beforeDefinitionSha256)
      || write.afterDefinitionSha256 !== hashJson(write.nextDocument, 'integrityGroupAfter'))) {
    fail('component-document-drift', 'plan', 'contains a write whose successor identity or definition hash is invalid.')
  }
  return plan
}

export const assertEncounterSettlementAtomicPlanCurrent = (input: {
  readonly plan: EncounterSettlementAtomicCommitPlan
  readonly currentAuthority: EncounterSettlementAtomicAuthoritySnapshot
}): EncounterSettlementAtomicCommitPlan => {
  if (input.plan.authorityDefinitionSha256 !== authorityEvidence(input.currentAuthority)
    || input.plan.settlementWrite.beforeDefinitionSha256 !== hashJson(input.currentAuthority.settlement, 'atomicSettlementBefore')
    || input.plan.encounterWrite.beforeDefinitionSha256 !== hashJson(input.currentAuthority.encounterDocument, 'atomicEncounterBefore')
    || (input.plan.mapWrite !== null
      && input.plan.mapWrite.beforeDefinitionSha256 !== hashJson(input.currentAuthority.map, 'atomicMapBefore'))) {
    fail('stale-component-write', 'plan', 'current complete authority no longer matches the atomic settlement plan.')
  }
  return input.plan
}
