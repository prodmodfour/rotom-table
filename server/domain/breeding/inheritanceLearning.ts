import { createHash } from 'node:crypto'
import movesJson from '../../../data/reference/moves.json'
import rulesetJson from '../../../data/breeding-automation/ruleset.json'
import lineageContractJson from '../../../data/breeding-automation/lineage-contract.json'
import sourceManifestJson from '../../../data/breeding-automation/source-manifest.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  currentMoveSourceNameForLegacyIdentity,
  isReviewedLegacyMoveMechanicalFingerprint,
  projectLegacyMoveMechanicalAuthority,
} from '#shared/ruleset/moveMechanicalAuthority'
import {
  BREEDING_INHERITANCE_CHECKPOINT_LEVELS,
  BREEDING_INHERITANCE_ILLEGAL_REASON_IDS,
  type BreedingInheritanceCheckpointLevel,
  type BreedingInheritanceIllegalReasonId,
  type BreedingInheritanceLearningOutcomeV1,
  type BreedingInheritanceLearningRecordV1,
  type BreedingInheritancePermanentMoveProvenanceV1,
  type PokemonBreedingOriginV1,
} from '#shared/breeding/lineage'
import {
  parseBreedingInheritanceLearningRecordIdSyntax,
  parseBreedingMoveIdSyntax,
  type BreedingInheritanceLearningRecordId,
  type BreedingMoveId,
  type BreedingOfferId,
  type BreedingOfferOptionId,
} from '#shared/breeding/ids'
import type { PokemonEggDocumentV1, PokemonEggInheritanceCandidateV1 } from '#shared/breeding/egg'
import {
  parseBreedingOperationCommandV1,
  type BreedingOperationCommandV1,
} from '#shared/breeding/operations'
import type { BreedingOptionOfferRecordV1 } from '#shared/breeding/ledgers'
import type { CharacterSheet, CharacterSheetAppliedMove, CharacterSheetMove } from '~/types/characterSheet'
import { isSlug } from '#shared/paths'
import { BREEDING_CANONICAL_MOVES, canonicalBreedingMoveIdentity } from './canonicalIds'
import {
  appendBreedingInheritanceLearningRecord,
  breedingInheritanceCandidateDefinitionSha256,
  breedingInheritanceCandidateSetDefinitionSha256,
  createBreedingInheritanceLearningRecordV1,
  parseAuthoritativeBreedingInheritanceLearningRecordV1,
  parseAuthoritativePokemonBreedingOriginV1,
  parseAuthoritativePokemonEggDocumentV1,
} from './lineage'
import {
  createBreedingOptionOfferRecordV1,
  createBreedingOptionOfferRevisionV1,
  parseAuthoritativeBreedingOptionOfferRecordV1,
} from './ledgers'
import { createBreedingOperationCommandHash } from './operations'

interface ReferenceMoveRecord {
  readonly name: string
  readonly type?: string
  readonly frequency?: string
  readonly ac?: number | string
  readonly damage_base?: number | null
  readonly damage_roll?: string
  readonly damage_class?: string
  readonly range?: string
  readonly effect?: string
  readonly special?: string
}

export interface BreedingInheritancePrerequisiteEvaluationV1 {
  readonly schemaVersion: 1
  readonly moveId: BreedingMoveId
  readonly checkpointLevel: number
  readonly frequency: string | null
  readonly damageBase: number | null
  readonly maximumFrequency: 'EOT' | 'Scene' | null
  readonly maximumDamageBase: 7 | 9 | null
  readonly moveRecordDefinitionSha256: string | null
  readonly rulesetDefinitionSha256: string
  readonly policyDefinitionSha256: string
  readonly legal: boolean
  readonly reasonIds: readonly BreedingInheritanceIllegalReasonId[]
  readonly definitionSha256: string
}

export interface BreedingInheritanceLearningChildSnapshotV1 {
  readonly slug: string
  readonly revision: number
  readonly document: CharacterSheet
}

export interface BreedingInheritanceLearningPlanV1 {
  readonly schemaVersion: 1
  readonly originId: PokemonBreedingOriginV1['originId']
  readonly eggId: PokemonBreedingOriginV1['eggId']
  readonly childSheetSlug: string
  readonly childSheetRevisionBefore: number
  readonly childSheetRevisionAfter: number
  readonly records: readonly BreedingInheritanceLearningRecordV1[]
  readonly nextOrigin: PokemonBreedingOriginV1
  readonly nextSheetDocument: CharacterSheet
  readonly consumedOffers: readonly BreedingOptionOfferRecordV1[]
  readonly sourceDefinitionHashes: readonly string[]
  readonly definitionSha256: string
}

export type BreedingInheritanceLearningErrorCode =
  | 'breeding.inheritance-learning.invalid-input'
  | 'breeding.inheritance-learning.wrong-command'
  | 'breeding.inheritance-learning.stale-authority'
  | 'breeding.inheritance-learning.checkpoint-unavailable'
  | 'breeding.inheritance-learning.choice-required'
  | 'breeding.inheritance-learning.invalid-choice'
  | 'breeding.inheritance-learning.move-data-unavailable'
  | 'breeding.inheritance-learning.move-list-invalid'

export class BreedingInheritanceLearningError extends Error {
  readonly code: BreedingInheritanceLearningErrorCode
  constructor(code: BreedingInheritanceLearningErrorCode, message: string) {
    super(message)
    this.name = 'BreedingInheritanceLearningError'
    this.code = code
  }
}

const fail = (code: BreedingInheritanceLearningErrorCode, message: string): never => {
  throw new BreedingInheritanceLearningError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
const exact = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.inheritance-learning.invalid-input', `${path} must be one plain exact object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.inheritance-learning.invalid-input', `${path} must contain exactly ${fields.join(', ')}.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.inheritance-learning.invalid-input', `${path}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const strictArray = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.inheritance-learning.invalid-input', `${path} must be one dense plain array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.inheritance-learning.invalid-input', `${path}[${index}] must be an enumerable data entry.`)
    }
  }
  return value
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail('breeding.inheritance-learning.invalid-input', `${path} must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}

const moves = movesJson as unknown as Readonly<Record<string, ReferenceMoveRecord>>
const sourceHashes = new Map((sourceManifestJson.runtimeSources as readonly { readonly path: string, readonly sha256: string }[])
  .map(value => [value.path, value.sha256]))
const moveSourceSha256 = sourceHashes.get('data/reference/moves.json')
  ?? fail('breeding.inheritance-learning.stale-authority', 'The source manifest no longer binds data/reference/moves.json.')

export const BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION = deepFreeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-inheritance-learning-v1' as const,
  candidateAuthority: 'immutable-child-origin-candidate-set' as const,
  checkpoints: BREEDING_INHERITANCE_CHECKPOINT_LEVELS,
  prerequisiteBands: Object.freeze([
    Object.freeze({ minimumLevel: 1, maximumLevel: 19, maximumFrequency: 'EOT' as const, maximumDamageBase: 7 as const }),
    Object.freeze({ minimumLevel: 20, maximumLevel: 29, maximumFrequency: 'Scene' as const, maximumDamageBase: 9 as const }),
    Object.freeze({ minimumLevel: 30, maximumLevel: 100, maximumFrequency: null, maximumDamageBase: null }),
  ]),
  frequencyClasses: Object.freeze({ atWill: Object.freeze(['At-Will']), eot: Object.freeze(['EOT']), scene: Object.freeze(['Scene', 'Scene x2']), restricted: Object.freeze(['Daily', 'Daily x2', 'Daily x3']) }),
  illegalCheckpoint: 'record-empty-and-retain-candidate' as const,
  noCandidateCheckpoint: 'record-empty-only-after-all-candidates-learned' as const,
  levelUpChoice: 'one-command-bound-server-option-per-checkpoint-with-unlearned-candidates' as const,
  levelUpBatch: 'all-next-contiguous-checkpoints-at-or-below-current-server-owned-level' as const,
  moveSlots: Object.freeze({ maximum: 6 as const, appendWhenOpen: true, replacementRequiresBoundedSlotOption: true, alreadyKnownRebindsProvenance: true, appliedTmOrTutorReclassifiesToNaturalAndFreesSlot: true }),
  hatchConstruction: Object.freeze({ selection: 'first-unlearned-frozen-candidate-in-canonical-order' as const, fullMoveList: 'replace-oldest-slot-in-round-robin-order' as const }),
  compatibilityFields: Object.freeze({ eggMoves: 'display-only', inheritedMoves: 'learned-checkpoint-projection-only', inheritedRemaining: 'minimum-of-unlearned-candidates-and-unreached-checkpoints' }),
  provenance: 'one-self-hashed-lineage-record-and-exact-breeding-inheritance-permanent-move-source' as const,
  clientAuthority: 'none' as const,
  sourceDefinitionHashes: Object.freeze([moveSourceSha256, rulesetJson.definitionSha256, lineageContractJson.definitionSha256].sort(compare)),
})
export const BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256 = sha256(BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION)

const canonicalMoveRecord = (moveId: string): { readonly id: BreedingMoveId, readonly record: ReferenceMoveRecord, readonly recordSha256: string } | null => {
  const id = parseBreedingMoveIdSyntax(moveId)
  const identity = id ? canonicalBreedingMoveIdentity(id) : null
  const currentSourceName = identity
    ? currentMoveSourceNameForLegacyIdentity(identity.id, identity.sourceName)
    : ''
  const record = identity ? moves[currentSourceName] : null
  const currentRecordSha256 = record
    ? sha256(projectLegacyMoveMechanicalAuthority(record as unknown as Readonly<Record<string, unknown>>))
    : ''
  if (!id || !identity || !record || record.name !== currentSourceName
    || !isReviewedLegacyMoveMechanicalFingerprint({
      canonicalId: identity.id,
      frozenSourceName: identity.sourceName,
      frozenRecordSha256: identity.sourceRecordSha256,
      currentSourceName,
      currentRecordSha256,
    })) return null
  return Object.freeze({ id, record, recordSha256: identity.sourceRecordSha256 })
}
const prerequisiteBand = (level: number): { readonly maximumFrequency: 'EOT' | 'Scene' | null, readonly maximumDamageBase: 7 | 9 | null } => (
  level < 20
    ? { maximumFrequency: 'EOT', maximumDamageBase: 7 }
    : level < 30
      ? { maximumFrequency: 'Scene', maximumDamageBase: 9 }
      : { maximumFrequency: null, maximumDamageBase: null }
)
const frequencyRank = (frequency: string): number | null => {
  if (frequency === 'At-Will') return 0
  if (frequency === 'EOT') return 1
  if (frequency === 'Scene' || /^Scene x[1-9][0-9]*$/u.test(frequency)) return 2
  if (frequency === 'Daily' || /^Daily x[1-9][0-9]*$/u.test(frequency)) return 3
  return null
}

/** Evaluate only current app-owned Move data against the frozen errata bands. */
export const evaluateBreedingInheritancePrerequisiteV1 = (inputValue: unknown): BreedingInheritancePrerequisiteEvaluationV1 => {
  const input = exact(inputValue, ['moveId', 'level'], 'inheritancePrerequisiteInput')
  const moveId = parseBreedingMoveIdSyntax(input.moveId)
    ?? fail('breeding.inheritance-learning.invalid-input', 'inheritancePrerequisiteInput.moveId must be canonical Move ID syntax.')
  const level = integer(input.level, 'inheritancePrerequisiteInput.level', 1, 100)
  const authority = canonicalMoveRecord(moveId)
  const band = prerequisiteBand(level)
  const reasonIds: BreedingInheritanceIllegalReasonId[] = []
  let frequency: string | null = null
  let damageBase: number | null = null
  if (!authority || typeof authority.record.frequency !== 'string' || frequencyRank(authority.record.frequency) === null
    || (authority.record.damage_base !== undefined && authority.record.damage_base !== null
      && (!Number.isSafeInteger(authority.record.damage_base) || authority.record.damage_base < 1))
    || (band.maximumDamageBase !== null && authority.record.damage_base == null
      && authority.record.damage_class !== 'Status')) {
    reasonIds.push('breeding.inheritance.move-data-unavailable')
  }
  else {
    frequency = authority.record.frequency
    damageBase = authority.record.damage_base ?? null
    const rank = frequencyRank(frequency)!
    const maximumRank = band.maximumFrequency === 'EOT' ? 1 : band.maximumFrequency === 'Scene' ? 2 : null
    if (maximumRank !== null && rank > maximumRank) reasonIds.push('breeding.inheritance.frequency-too-high')
    if (band.maximumDamageBase !== null && damageBase !== null && damageBase > band.maximumDamageBase) reasonIds.push('breeding.inheritance.damage-base-too-high')
  }
  const orderedReasons = BREEDING_INHERITANCE_ILLEGAL_REASON_IDS.filter(value => reasonIds.includes(value))
  const definition = {
    schemaVersion: 1 as const,
    moveId,
    checkpointLevel: level,
    frequency,
    damageBase,
    maximumFrequency: band.maximumFrequency,
    maximumDamageBase: band.maximumDamageBase,
    moveRecordDefinitionSha256: authority?.recordSha256 ?? null,
    rulesetDefinitionSha256: rulesetJson.definitionSha256,
    policyDefinitionSha256: BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256,
    legal: orderedReasons.length === 0,
    reasonIds: Object.freeze(orderedReasons),
  }
  return deepFreeze({ ...definition, definitionSha256: sha256(definition) })
}

const learningRecordId = (originId: string, operationId: string, checkpointLevel: number): BreedingInheritanceLearningRecordId => {
  const value = `inheritance-learning:v1:${sha256({ originId, operationId, checkpointLevel }).slice(0, 32)}`
  return parseBreedingInheritanceLearningRecordIdSyntax(value)
    ?? fail('breeding.inheritance-learning.stale-authority', 'A deterministic inheritance-learning identity could not be constructed.')
}
const provenance = (input: {
  readonly origin: Pick<PokemonBreedingOriginV1, 'originId' | 'eggId'>
  readonly operationId: BreedingOperationCommandV1['operationId']
  readonly checkpointLevel: BreedingInheritanceCheckpointLevel
  readonly candidate: PokemonEggInheritanceCandidateV1
}): BreedingInheritancePermanentMoveProvenanceV1 => {
  const id = learningRecordId(input.origin.originId, input.operationId, input.checkpointLevel)
  return deepFreeze({
    schemaVersion: 1,
    kind: 'breeding-inheritance',
    originId: input.origin.originId,
    eggId: input.origin.eggId,
    learningRecordId: id,
    checkpointLevel: input.checkpointLevel,
    moveId: input.candidate.moveId,
    operationId: input.operationId,
    candidateDefinitionSha256: breedingInheritanceCandidateDefinitionSha256(input.candidate),
  })
}
const learnedOutcome = (input: Parameters<typeof provenance>[0]): BreedingInheritanceLearningOutcomeV1 => {
  const permanentMoveProvenance = provenance(input)
  return deepFreeze({
    kind: 'learned',
    moveId: input.candidate.moveId,
    candidateDefinitionSha256: permanentMoveProvenance.candidateDefinitionSha256,
    permanentMoveProvenance,
  })
}
const illegalOutcome = (candidate: PokemonEggInheritanceCandidateV1, evaluation: BreedingInheritancePrerequisiteEvaluationV1): BreedingInheritanceLearningOutcomeV1 => deepFreeze({
  kind: 'empty-illegal',
  moveId: candidate.moveId,
  reasonIds: evaluation.reasonIds,
  prerequisiteEvaluationDefinitionSha256: evaluation.definitionSha256,
})
const noCandidateOutcome = (origin: PokemonBreedingOriginV1): BreedingInheritanceLearningOutcomeV1 => deepFreeze({
  kind: 'empty-no-candidate',
  candidateSetDefinitionSha256: breedingInheritanceCandidateSetDefinitionSha256(origin.offspring.inheritanceCandidates),
})

const canonicalMoveRow = (moveId: string, source: BreedingInheritancePermanentMoveProvenanceV1): CharacterSheetMove => {
  const authority = canonicalMoveRecord(moveId)
  if (!authority) return fail('breeding.inheritance-learning.move-data-unavailable', `Move ${moveId} is unavailable from current app-owned authority.`)
  const record = authority.record
  const category = record.damage_class === 'Physical' || record.damage_class === 'Special' || record.damage_class === 'Status'
    ? record.damage_class
    : undefined
  return deepFreeze({
    name: record.name,
    ...(record.type === undefined ? {} : { type: record.type }),
    ...(category === undefined ? {} : { category }),
    ...(record.damage_base === undefined || record.damage_base === null ? {} : { db: record.damage_base }),
    ...(record.damage_roll === undefined ? {} : { damageRoll: record.damage_roll }),
    ...(record.frequency === undefined ? {} : { frequency: record.frequency }),
    ...(record.ac === undefined ? {} : { ac: record.ac }),
    ...(record.range === undefined ? {} : { range: record.range }),
    ...(record.effect === undefined ? {} : { effect: record.effect }),
    ...(record.special === undefined ? {} : { special: record.special }),
    permanentMoveSource: source,
  })
}
interface CanonicalMoveList { readonly rows: CharacterSheetMove[], readonly ids: BreedingMoveId[] }
interface CanonicalAppliedMoveList { readonly rows: CharacterSheetAppliedMove[], readonly ids: BreedingMoveId[] }
const assertPlainDataGraph = (value: unknown, path: string, seen = new Set<object>(), depth = 0): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    return fail('breeding.inheritance-learning.move-list-invalid', `${path} must contain only finite JSON numbers.`)
  }
  if (typeof value !== 'object' || seen.has(value) || depth > 8) return fail('breeding.inheritance-learning.move-list-invalid', `${path} must be one bounded acyclic JSON data graph.`)
  const keys = Array.isArray(value)
    ? (strictArray(value, path, 64), [...Array(value.length).keys()].map(String))
    : Object.getOwnPropertyNames(value)
  if (keys.length > 64) return fail('breeding.inheritance-learning.move-list-invalid', `${path} exceeds the bounded JSON field count.`)
  if (!Array.isArray(value) && ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0)) {
    return fail('breeding.inheritance-learning.move-list-invalid', `${path} must contain only plain JSON data objects.`)
  }
  seen.add(value)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.inheritance-learning.move-list-invalid', `${path}.${key} must be an enumerable data field.`)
    assertPlainDataGraph(descriptor.value, `${path}.${key}`, seen, depth + 1)
  }
  seen.delete(value)
}
const canonicalMoveList = (document: CharacterSheet): CanonicalMoveList => {
  const value = document.movelist ?? []
  strictArray(value, 'childSheet.document.movelist', 6)
  assertPlainDataGraph(value, 'childSheet.document.movelist')
  const rows = structuredClone(value) as CharacterSheetMove[]
  const ids: BreedingMoveId[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.name !== 'string') {
      return fail('breeding.inheritance-learning.move-list-invalid', `Move slot ${index + 1} is malformed.`)
    }
    const identity = canonicalMoveRecord(canonicalBreedingMoveIdentityByName(row.name) ?? '')
    if (!identity) return fail('breeding.inheritance-learning.move-list-invalid', `Move slot ${index + 1} is not one current canonical Move.`)
    if (ids.includes(identity.id)) return fail('breeding.inheritance-learning.move-list-invalid', `Move slot ${index + 1} duplicates ${identity.id}.`)
    ids.push(identity.id)
  }
  return { rows, ids }
}
const canonicalAppliedMoveList = (document: CharacterSheet, naturalIds: readonly BreedingMoveId[]): CanonicalAppliedMoveList => {
  const value = document.appliedMoves ?? []
  strictArray(value, 'childSheet.document.appliedMoves', 3)
  assertPlainDataGraph(value, 'childSheet.document.appliedMoves')
  const rows = structuredClone(value) as CharacterSheetAppliedMove[]
  const ids: BreedingMoveId[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.name !== 'string'
      || (row.source !== 'tm' && row.source !== 'tutor')) {
      return fail('breeding.inheritance-learning.move-list-invalid', `Applied Move slot ${index + 1} is malformed.`)
    }
    const identity = canonicalMoveRecord(canonicalBreedingMoveIdentityByName(row.name) ?? '')
    if (!identity) return fail('breeding.inheritance-learning.move-list-invalid', `Applied Move slot ${index + 1} is not one current canonical Move.`)
    if (ids.includes(identity.id) || naturalIds.includes(identity.id)) return fail('breeding.inheritance-learning.move-list-invalid', `Applied Move slot ${index + 1} duplicates ${identity.id}.`)
    ids.push(identity.id)
  }
  return { rows, ids }
}
const canonicalMoveIdBySourceName = new Map<string, BreedingMoveId>(
  BREEDING_CANONICAL_MOVES.map(identity => [identity.sourceName, identity.id]),
)
const canonicalBreedingMoveIdentityByName = (name: string): BreedingMoveId | null => canonicalMoveIdBySourceName.get(name) ?? null

const hydrateOrigin = (originValue: unknown, recordsValue: readonly unknown[]): PokemonBreedingOriginV1 => {
  let origin = parseAuthoritativePokemonBreedingOriginV1(originValue)
  const records = strictArray(recordsValue, 'learningRecords', 9)
  for (let index = 0; index < records.length; index += 1) {
    const record = parseAuthoritativeBreedingInheritanceLearningRecordV1(records[index], `learningRecords[${index}]`)
    if (origin.inheritanceLearningRecords.some(existing => existing.learningRecordId === record.learningRecordId)) continue
    origin = appendBreedingInheritanceLearningRecord(origin, record)
  }
  return origin
}
export const hydratePokemonBreedingOriginLearningV1 = (inputValue: unknown): PokemonBreedingOriginV1 => {
  const input = exact(inputValue, ['origin', 'learningRecords'], 'hydrateInheritanceOriginInput')
  return hydrateOrigin(input.origin, strictArray(input.learningRecords, 'hydrateInheritanceOriginInput.learningRecords', 9))
}

const nextCheckpointLevels = (origin: PokemonBreedingOriginV1, requested: readonly number[]): readonly BreedingInheritanceCheckpointLevel[] => {
  const levels = requested.map((value, index) => integer(value, `checkpointLevels[${index}]`, 20, 100) as BreedingInheritanceCheckpointLevel)
  for (let index = 0; index < levels.length; index += 1) {
    if (levels[index] !== BREEDING_INHERITANCE_CHECKPOINT_LEVELS[origin.inheritanceLearningRecords.length + index]) {
      return fail('breeding.inheritance-learning.checkpoint-unavailable', 'Requested checkpoints must be the next contiguous canonical inheritance prefix.')
    }
  }
  return Object.freeze(levels)
}

type SlotMode = 'auto' | `replace-${0 | 1 | 2 | 3 | 4 | 5}`
const slotModes = Object.freeze(['auto', 'replace-0', 'replace-1', 'replace-2', 'replace-3', 'replace-4', 'replace-5'] as const)
const slotEvidence = (mode: SlotMode): string => `inheritance-slot-mode:${mode}`
const optionIdFor = (operationId: string, checkpointLevel: number, moveId: string, mode: SlotMode): BreedingOfferOptionId => (
  `option:v1:${sha256({ operationId, checkpointLevel, moveId, mode }).slice(0, 32)}` as BreedingOfferOptionId
)
const offerIdFor = (operationId: string, checkpointLevel: number, chunk: number): BreedingOfferId => (
  `breeding-offer:v1:${sha256({ operationId, checkpointLevel, chunk }).slice(0, 32)}` as BreedingOfferId
)
export const breedingInheritanceLearningOptionIdV1 = (inputValue: unknown): BreedingOfferOptionId => {
  const input = exact(inputValue, ['operationId', 'checkpointLevel', 'moveId', 'slotMode'], 'inheritanceOptionIdInput')
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: input.operationId,
    commandKind: 'record-inheritance-learning',
    actor: { profileId: 'identity-probe', selectedTrainerSlug: null },
    ruleset: { rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 },
    scopes: [{ kind: 'pokemon-sheet', sheetSlug: 'identity-probe', expectedRevision: 0, fields: ['lineage', 'moves'] }],
    payload: { originId: 'pokemon-breeding-origin:v1:00000000000000000000000000000000', eggId: 'pokemon-egg:v1:00000000000000000000000000000000', childSheetSlug: 'identity-probe', checkpointLevels: [input.checkpointLevel], selectedOptionIds: [] },
  })
  const moveId = parseBreedingMoveIdSyntax(input.moveId)
    ?? fail('breeding.inheritance-learning.invalid-input', 'inheritanceOptionIdInput.moveId must be canonical syntax.')
  if (!slotModes.includes(input.slotMode as SlotMode)) return fail('breeding.inheritance-learning.invalid-input', 'inheritanceOptionIdInput.slotMode is invalid.')
  return optionIdFor(command.operationId, integer(input.checkpointLevel, 'inheritanceOptionIdInput.checkpointLevel', 20, 100), moveId, input.slotMode as SlotMode)
}
const optionMode = (offer: BreedingOptionOfferRecordV1, optionId: string): SlotMode => {
  const option = offer.options.find(value => value.optionId === optionId)
    ?? fail('breeding.inheritance-learning.invalid-choice', 'Selected option is absent from its offer.')
  const modes = slotModes.filter(mode => option.authorityEvidenceIds.includes(slotEvidence(mode)))
  if (modes.length !== 1) return fail('breeding.inheritance-learning.invalid-choice', 'Inheritance option must bind exactly one move-slot mode.')
  return modes[0]!
}

const validateCommandTarget = (
  command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'record-inheritance-learning' }>,
  origin: PokemonBreedingOriginV1,
  child: BreedingInheritanceLearningChildSnapshotV1,
): readonly BreedingInheritanceCheckpointLevel[] => {
  const scope = command.scopes[0]
  if (command.payload.originId !== origin.originId || command.payload.eggId !== origin.eggId
    || command.payload.childSheetSlug !== origin.childSheetSlug || child.slug !== origin.childSheetSlug
    || scope?.kind !== 'pokemon-sheet' || scope.sheetSlug !== child.slug || scope.expectedRevision !== child.revision
    || command.ruleset.rulesetId !== origin.ruleset.rulesetId || command.ruleset.definitionSha256 !== origin.ruleset.definitionSha256
    || child.document.slug !== undefined && child.document.slug !== child.slug) {
    return fail('breeding.inheritance-learning.stale-authority', 'Command, lineage, ruleset, child identity, and exact sheet revision must agree.')
  }
  const levels = nextCheckpointLevels(origin, command.payload.checkpointLevels)
  const reached = BREEDING_INHERITANCE_CHECKPOINT_LEVELS
    .slice(origin.inheritanceLearningRecords.length)
    .filter(level => level <= child.document.level)
  if (levels.length !== reached.length || levels.some((level, index) => level !== reached[index])) {
    return fail('breeding.inheritance-learning.checkpoint-unavailable', 'One operation must process every next contiguous checkpoint reached by the current server-owned Level.')
  }
  return levels
}

/** Issue command-bound candidate and replacement options. Callers persist them before settlement. */
export const createBreedingInheritanceLearningOptionOffersV1 = (inputValue: unknown): readonly BreedingOptionOfferRecordV1[] => {
  const input = exact(inputValue, ['command', 'origin', 'learningRecords', 'childSheet', 'issuedAtCampaignMinute', 'expiresAtCampaignMinute'], 'inheritanceOfferInput')
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'record-inheritance-learning') return fail('breeding.inheritance-learning.wrong-command', 'Inheritance offers require record-inheritance-learning.')
  const command = commandValue
  const origin = hydrateOrigin(input.origin, strictArray(input.learningRecords, 'inheritanceOfferInput.learningRecords', 9))
  const childInput = exact(input.childSheet, ['slug', 'revision', 'document'], 'inheritanceOfferInput.childSheet')
  const child: BreedingInheritanceLearningChildSnapshotV1 = {
    slug: String(childInput.slug),
    revision: integer(childInput.revision, 'inheritanceOfferInput.childSheet.revision', 0, 2_147_483_646),
    document: childInput.document as CharacterSheet,
  }
  const levels = validateCommandTarget(command, origin, child)
  const currentMoveList = canonicalMoveList(child.document)
  canonicalAppliedMoveList(child.document, currentMoveList.ids)
  const issuedAt = integer(input.issuedAtCampaignMinute, 'inheritanceOfferInput.issuedAtCampaignMinute')
  const expiresAt = integer(input.expiresAtCampaignMinute, 'inheritanceOfferInput.expiresAtCampaignMinute', issuedAt + 1, issuedAt + 525_600)
  const commandHash = createBreedingOperationCommandHash(command)
  const learned = new Set(origin.inheritanceLearningRecords.flatMap(record => record.outcome.kind === 'learned' ? [record.outcome.moveId] : []))
  const optionsByLevel = new Map<number, Array<{ readonly optionId: BreedingOfferOptionId, readonly kind: 'inheritance-slot', readonly canonicalValueId: string, readonly valueDefinitionSha256: string, readonly authorityEvidenceIds: readonly string[] }>>()
  for (const level of levels) {
    const options: Array<{ readonly optionId: BreedingOfferOptionId, readonly kind: 'inheritance-slot', readonly canonicalValueId: string, readonly valueDefinitionSha256: string, readonly authorityEvidenceIds: readonly string[] }> = []
    for (const candidate of origin.offspring.inheritanceCandidates.filter(value => !learned.has(value.moveId))) {
      const evaluation = evaluateBreedingInheritancePrerequisiteV1({ moveId: candidate.moveId, level })
      const alreadyKnown = currentMoveList.ids.includes(candidate.moveId)
      const modes: readonly SlotMode[] = !evaluation.legal || alreadyKnown || currentMoveList.rows.length < 6
        ? ['auto']
        : slotModes.slice(1, currentMoveList.rows.length + 1)
      const candidateHash = breedingInheritanceCandidateDefinitionSha256(candidate)
      for (const mode of modes) {
        const optionId = optionIdFor(command.operationId, level, candidate.moveId, mode)
        const authorityEvidenceIds = [
          `inheritance-candidate:${candidateHash.slice(0, 32)}`,
          `inheritance-checkpoint:${level}`,
          `inheritance-origin:${origin.lineageDefinitionSha256.slice(0, 32)}`,
          slotEvidence(mode),
        ].sort(compare)
        options.push(Object.freeze({
          optionId,
          kind: 'inheritance-slot',
          canonicalValueId: candidate.moveId,
          valueDefinitionSha256: sha256({ candidateDefinitionSha256: candidateHash, checkpointLevel: level, slotMode: mode, evaluationDefinitionSha256: evaluation.definitionSha256, originDefinitionSha256: sha256(origin), childSheetRevision: child.revision, childSheetDefinitionSha256: sha256(child.document), policyDefinitionSha256: BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256 }),
          authorityEvidenceIds: Object.freeze(authorityEvidenceIds),
        }))
      }
    }
    optionsByLevel.set(level, options.sort((left, right) => compare(left.optionId, right.optionId)))
  }
  const offers: BreedingOptionOfferRecordV1[] = []
  for (const level of levels) {
    const options = optionsByLevel.get(level)!
    for (let offset = 0, chunk = 0; offset < options.length; offset += 64, chunk += 1) {
      offers.push(createBreedingOptionOfferRecordV1({
        schemaVersion: 1,
        offerId: offerIdFor(command.operationId, level, chunk),
        choiceKind: 'inheritance-slot',
        target: { kind: 'pokemon-sheet', sheetSlug: child.slug, revision: child.revision },
        chooserProfileId: command.actor.profileId,
        minimumPokemonEducationRank: null,
        options: Object.freeze(options.slice(offset, offset + 64)),
        issuedOperationId: command.operationId,
        issuedCommandSha256: commandHash,
        issuedAtCampaignMinute: issuedAt,
        expiresAtCampaignMinute: expiresAt,
      }))
    }
  }
  return Object.freeze(offers.sort((left, right) => compare(left.offerId, right.offerId)))
}

const selectedOffers = (input: {
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'record-inheritance-learning' }>
  readonly origin: PokemonBreedingOriginV1
  readonly child: BreedingInheritanceLearningChildSnapshotV1
  readonly offers: readonly unknown[]
  readonly at: number
}): ReadonlyMap<number, { readonly offer: BreedingOptionOfferRecordV1, readonly optionId: BreedingOfferOptionId, readonly candidate: PokemonEggInheritanceCandidateV1, readonly mode: SlotMode }> => {
  const offers = strictArray(input.offers, 'inheritanceLearningInput.offers', 9).map((value, index) => parseAuthoritativeBreedingOptionOfferRecordV1(value, `inheritanceLearningInput.offers[${index}]`))
  const commandHash = createBreedingOperationCommandHash(input.command)
  const selected = new Map<number, { readonly offer: BreedingOptionOfferRecordV1, readonly optionId: BreedingOfferOptionId, readonly candidate: PokemonEggInheritanceCandidateV1, readonly mode: SlotMode }>()
  for (const optionId of input.command.payload.selectedOptionIds) {
    const matches = offers.filter(offer => offer.options.some(option => option.optionId === optionId))
    if (matches.length !== 1) return fail('breeding.inheritance-learning.invalid-choice', 'Every selected option must resolve exactly one submitted active offer.')
    const offer = matches[0]!
    const option = offer.options.find(value => value.optionId === optionId)!
    const checkpointEvidence = option.authorityEvidenceIds.filter(value => /^inheritance-checkpoint:(20|30|40|50|60|70|80|90|100)$/u.test(value))
    const level = checkpointEvidence.length === 1 ? Number(checkpointEvidence[0]!.split(':')[1]) : null
    const candidate = input.origin.offspring.inheritanceCandidates.find(value => value.moveId === option.canonicalValueId)
    const mode = optionMode(offer, optionId)
    const candidateHash = candidate ? breedingInheritanceCandidateDefinitionSha256(candidate) : null
    const evaluation = candidate && level ? evaluateBreedingInheritancePrerequisiteV1({ moveId: candidate.moveId, level }) : null
    const expectedValueHash = candidate && level && evaluation ? sha256({ candidateDefinitionSha256: candidateHash, checkpointLevel: level, slotMode: mode, evaluationDefinitionSha256: evaluation.definitionSha256, originDefinitionSha256: sha256(input.origin), childSheetRevision: input.child.revision, childSheetDefinitionSha256: sha256(input.child.document), policyDefinitionSha256: BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256 }) : null
    if (!candidate || level === null || selected.has(level) || option.kind !== 'inheritance-slot'
      || option.valueDefinitionSha256 !== expectedValueHash
      || option.optionId !== optionIdFor(input.command.operationId, level, candidate.moveId, mode)
      || !option.authorityEvidenceIds.includes(`inheritance-candidate:${candidateHash!.slice(0, 32)}`)
      || !option.authorityEvidenceIds.includes(`inheritance-origin:${input.origin.lineageDefinitionSha256.slice(0, 32)}`)
      || offer.status !== 'active' || offer.revision !== 0 || offer.choiceKind !== 'inheritance-slot'
      || offer.target.kind !== 'pokemon-sheet' || offer.target.sheetSlug !== input.child.slug || offer.target.revision !== input.child.revision
      || offer.chooserProfileId !== input.command.actor.profileId || offer.issuedOperationId !== input.command.operationId
      || offer.issuedCommandSha256 !== commandHash || offer.issuedAtCampaignMinute > input.at
      || offer.expiresAtCampaignMinute === null || input.at >= offer.expiresAtCampaignMinute) {
      return fail('breeding.inheritance-learning.invalid-choice', 'Selected inheritance option identity, candidate, slot, target, command, or expiry authority drifted.')
    }
    selected.set(level, Object.freeze({ offer, optionId, candidate, mode }))
  }
  if (offers.some(offer => ![...selected.values()].some(value => value.offer.offerId === offer.offerId))) {
    return fail('breeding.inheritance-learning.invalid-choice', 'Submitted offers must be exactly the selected offer set.')
  }
  return selected
}

const compatibilityProjection = (origin: PokemonBreedingOriginV1): { readonly inheritedMoves: Record<string, string>, readonly inheritedRemaining: number } => {
  const inheritedMoves: Record<string, string> = {}
  const learned = new Set<string>()
  for (const record of origin.inheritanceLearningRecords) {
    if (record.outcome.kind !== 'learned') continue
    const authority = canonicalMoveRecord(record.outcome.moveId)
      ?? fail('breeding.inheritance-learning.move-data-unavailable', `Learned Move ${record.outcome.moveId} lost canonical display authority.`)
    inheritedMoves[String(record.checkpointLevel)] = authority.record.name
    learned.add(record.outcome.moveId)
  }
  const remainingCandidates = origin.offspring.inheritanceCandidates.filter(candidate => !learned.has(candidate.moveId)).length
  const remainingCheckpoints = BREEDING_INHERITANCE_CHECKPOINT_LEVELS.length - origin.inheritanceLearningRecords.length
  return { inheritedMoves, inheritedRemaining: Math.min(remainingCandidates, remainingCheckpoints) }
}

/** Reduce one contiguous reached checkpoint batch into lineage records and one sheet revision. */
export const planBreedingInheritanceLearningV1 = (inputValue: unknown): BreedingInheritanceLearningPlanV1 => {
  const input = exact(inputValue, ['command', 'origin', 'learningRecords', 'childSheet', 'offers', 'recordedAtCampaignMinute'], 'inheritanceLearningInput')
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'record-inheritance-learning') return fail('breeding.inheritance-learning.wrong-command', 'Inheritance learning requires record-inheritance-learning.')
  const command = commandValue
  let origin = hydrateOrigin(input.origin, strictArray(input.learningRecords, 'inheritanceLearningInput.learningRecords', 9))
  const childInput = exact(input.childSheet, ['slug', 'revision', 'document'], 'inheritanceLearningInput.childSheet')
  const child: BreedingInheritanceLearningChildSnapshotV1 = {
    slug: String(childInput.slug),
    revision: integer(childInput.revision, 'inheritanceLearningInput.childSheet.revision', 0, 2_147_483_646),
    document: childInput.document as CharacterSheet,
  }
  const levels = validateCommandTarget(command, origin, child)
  const at = integer(input.recordedAtCampaignMinute, 'inheritanceLearningInput.recordedAtCampaignMinute')
  if (at < origin.hatchedAtCampaignMinute || origin.inheritanceLearningRecords.some(record => record.recordedAtCampaignMinute > at)) {
    return fail('breeding.inheritance-learning.stale-authority', 'Inheritance campaign time cannot predate hatch or prior learning evidence.')
  }
  const choices = selectedOffers({ command, origin, child, offers: strictArray(input.offers, 'inheritanceLearningInput.offers', 9), at })
  const learned = new Set(origin.inheritanceLearningRecords.flatMap(record => record.outcome.kind === 'learned' ? [record.outcome.moveId] : []))
  const moveList = canonicalMoveList(child.document)
  const rows = moveList.rows
  const ids = moveList.ids
  const appliedMoveList = canonicalAppliedMoveList(child.document, ids)
  const appliedRows = appliedMoveList.rows
  const appliedIds = appliedMoveList.ids
  let reclassifiedAppliedMove = false
  const records: BreedingInheritanceLearningRecordV1[] = []
  const consumed: BreedingOptionOfferRecordV1[] = []
  for (const level of levels) {
    const unlearned = origin.offspring.inheritanceCandidates.filter(candidate => !learned.has(candidate.moveId))
    const choice = choices.get(level)
    let outcome: BreedingInheritanceLearningOutcomeV1
    if (unlearned.length === 0) {
      if (choice) return fail('breeding.inheritance-learning.invalid-choice', `Checkpoint ${level} rejects a choice after all candidates were learned.`)
      outcome = noCandidateOutcome(origin)
    }
    else {
      if (!choice) return fail('breeding.inheritance-learning.choice-required', `Checkpoint ${level} requires one server-issued inheritance candidate option.`)
      if (!unlearned.some(candidate => candidate.moveId === choice.candidate.moveId)) {
        return fail('breeding.inheritance-learning.invalid-choice', `Checkpoint ${level} selected an already learned candidate.`)
      }
      const evaluation = evaluateBreedingInheritancePrerequisiteV1({ moveId: choice.candidate.moveId, level })
      if (!evaluation.legal) {
        if (choice.mode !== 'auto') return fail('breeding.inheritance-learning.invalid-choice', 'Illegal candidates cannot claim a replacement slot.')
        outcome = illegalOutcome(choice.candidate, evaluation)
      }
      else {
        const existingIndexes = ids.flatMap((id, index) => id === choice.candidate.moveId ? [index] : [])
        if (existingIndexes.length > 1) return fail('breeding.inheritance-learning.move-list-invalid', 'The selected candidate occurs in multiple current Move slots.')
        const source = provenance({ origin, operationId: command.operationId, checkpointLevel: level, candidate: choice.candidate })
        if (existingIndexes.length === 1) {
          if (choice.mode !== 'auto') return fail('breeding.inheritance-learning.invalid-choice', 'An already known candidate must retain its existing slot.')
          rows[existingIndexes[0]!] = canonicalMoveRow(choice.candidate.moveId, source)
        }
        else if (choice.mode === 'auto') {
          if (rows.length >= 6) return fail('breeding.inheritance-learning.choice-required', `Checkpoint ${level} requires a bounded replacement slot.`)
          rows.push(canonicalMoveRow(choice.candidate.moveId, source))
          ids.push(choice.candidate.moveId)
        }
        else {
          const index = Number(choice.mode.slice('replace-'.length))
          if (!Number.isSafeInteger(index) || index < 0 || index >= rows.length) return fail('breeding.inheritance-learning.invalid-choice', `Replacement slot ${index} is not occupied.`)
          rows[index] = canonicalMoveRow(choice.candidate.moveId, source)
          ids[index] = choice.candidate.moveId
        }
        const appliedIndex = appliedIds.indexOf(choice.candidate.moveId)
        if (appliedIndex >= 0) {
          appliedRows.splice(appliedIndex, 1)
          appliedIds.splice(appliedIndex, 1)
          reclassifiedAppliedMove = true
        }
        learned.add(choice.candidate.moveId)
        outcome = learnedOutcome({ origin, operationId: command.operationId, checkpointLevel: level, candidate: choice.candidate })
      }
      consumed.push(createBreedingOptionOfferRevisionV1({
        ...choice.offer,
        revision: 1,
        status: 'consumed',
        selectedOptionId: choice.optionId,
        settlementOperationId: command.operationId,
        settlementCommandSha256: createBreedingOperationCommandHash(command),
        settledAtCampaignMinute: at,
        settlementReasonId: null,
      }))
    }
    const record = createBreedingInheritanceLearningRecordV1({
      schemaVersion: 1,
      learningRecordId: learningRecordId(origin.originId, command.operationId, level),
      originId: origin.originId,
      eggId: origin.eggId,
      childSheetSlug: origin.childSheetSlug,
      checkpointLevel: level,
      application: { kind: 'level-up', childSheetRevisionBefore: child.revision, childSheetRevisionAfter: child.revision + 1 },
      outcome,
      recordedAtCampaignMinute: at,
      operationId: command.operationId,
    })
    origin = appendBreedingInheritanceLearningRecord(origin, record)
    records.push(record)
  }
  if (choices.size !== consumed.length) return fail('breeding.inheritance-learning.invalid-choice', 'Selected choices must settle exactly one reached candidate checkpoint each.')
  const compatibility = compatibilityProjection(origin)
  const nextSheetDocument = deepFreeze({
    ...structuredClone(child.document),
    movelist: rows,
    ...((child.document.appliedMoves !== undefined || reclassifiedAppliedMove) ? { appliedMoves: appliedRows } : {}),
    inheritedMoves: compatibility.inheritedMoves,
    inheritedRemaining: compatibility.inheritedRemaining,
  })
  const sourceDefinitionHashes = [
    ...BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION.sourceDefinitionHashes,
    BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256,
    origin.lineageDefinitionSha256,
    ...records.map(record => record.definitionSha256),
    ...consumed.map(offer => offer.definitionSha256),
    ...records.flatMap(record => record.outcome.kind === 'empty-illegal' ? [record.outcome.prerequisiteEvaluationDefinitionSha256] : record.outcome.kind === 'learned' ? [record.outcome.candidateDefinitionSha256] : [record.outcome.candidateSetDefinitionSha256]),
  ].filter((value, index, values) => values.indexOf(value) === index).sort(compare)
  const definition = {
    schemaVersion: 1 as const,
    originId: origin.originId,
    eggId: origin.eggId,
    childSheetSlug: child.slug,
    childSheetRevisionBefore: child.revision,
    childSheetRevisionAfter: child.revision + 1,
    records: Object.freeze(records),
    nextOrigin: origin,
    nextSheetDocument,
    consumedOffers: Object.freeze(consumed.sort((left, right) => compare(left.offerId, right.offerId))),
    sourceDefinitionHashes: Object.freeze(sourceDefinitionHashes),
  }
  return deepFreeze({ ...definition, definitionSha256: sha256(definition) })
}

interface HatchOutcomeDraft {
  readonly checkpointLevel: BreedingInheritanceCheckpointLevel
  readonly outcome: BreedingInheritanceLearningOutcomeV1
}
const hatchOutcomeDrafts = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'complete-hatch' }>
  readonly originId: PokemonBreedingOriginV1['originId']
}): readonly HatchOutcomeDraft[] => {
  const originStub = {
    originId: input.originId,
    eggId: input.egg.eggId,
    offspring: input.egg.offspring,
  } as PokemonBreedingOriginV1
  const learned = new Set<string>()
  const drafts: HatchOutcomeDraft[] = []
  for (const level of BREEDING_INHERITANCE_CHECKPOINT_LEVELS.filter(value => value <= input.egg.offspring.startingLevel)) {
    const candidate = input.egg.offspring.inheritanceCandidates.find(value => !learned.has(value.moveId))
    if (!candidate) {
      drafts.push(Object.freeze({ checkpointLevel: level, outcome: deepFreeze({ kind: 'empty-no-candidate' as const, candidateSetDefinitionSha256: breedingInheritanceCandidateSetDefinitionSha256(input.egg.offspring.inheritanceCandidates) }) }))
      continue
    }
    const evaluation = evaluateBreedingInheritancePrerequisiteV1({ moveId: candidate.moveId, level })
    if (!evaluation.legal) drafts.push(Object.freeze({ checkpointLevel: level, outcome: illegalOutcome(candidate, evaluation) }))
    else {
      learned.add(candidate.moveId)
      drafts.push(Object.freeze({ checkpointLevel: level, outcome: learnedOutcome({ origin: originStub, operationId: input.command.operationId, checkpointLevel: level, candidate }) }))
    }
  }
  return Object.freeze(drafts)
}

/** Apply deterministic starting-Level checkpoints before the revision-zero child insert. */
export const applyBreedingHatchConstructionInheritanceV1 = (inputValue: unknown): CharacterSheet => {
  const input = exact(inputValue, ['egg', 'command', 'document'], 'hatchInheritanceInput')
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'complete-hatch') return fail('breeding.inheritance-learning.wrong-command', 'Hatch inheritance requires complete-hatch.')
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  const command = commandValue
  if (egg.eggId !== command.payload.eggId || egg.status !== 'hatching' || egg.childSheetSlug !== null) return fail('breeding.inheritance-learning.stale-authority', 'Hatch inheritance command and Egg disagree.')
  const document = input.document as CharacterSheet
  const moveList = canonicalMoveList(document)
  const rows = moveList.rows
  const ids = moveList.ids
  let replacementOrdinal = 0
  const drafts = hatchOutcomeDrafts({ egg, command, originId: command.payload.originId })
  for (const draft of drafts) {
    if (draft.outcome.kind !== 'learned') continue
    const source = draft.outcome.permanentMoveProvenance
    const existing = ids.indexOf(draft.outcome.moveId)
    if (existing >= 0) rows[existing] = canonicalMoveRow(draft.outcome.moveId, source)
    else if (rows.length < 6) {
      rows.push(canonicalMoveRow(draft.outcome.moveId, source))
      ids.push(draft.outcome.moveId)
    }
    else {
      const index = replacementOrdinal % 6
      rows[index] = canonicalMoveRow(draft.outcome.moveId, source)
      ids[index] = draft.outcome.moveId
      replacementOrdinal += 1
    }
  }
  const inheritedMoves: Record<string, string> = {}
  const learned = new Set<string>()
  for (const draft of drafts) {
    if (draft.outcome.kind !== 'learned') continue
    const authority = canonicalMoveRecord(draft.outcome.moveId)
      ?? fail('breeding.inheritance-learning.move-data-unavailable', `Hatch Move ${draft.outcome.moveId} is unavailable.`)
    inheritedMoves[String(draft.checkpointLevel)] = authority.record.name
    learned.add(draft.outcome.moveId)
  }
  return deepFreeze({
    ...structuredClone(document),
    movelist: rows,
    inheritedMoves,
    inheritedRemaining: Math.min(
      egg.offspring.inheritanceCandidates.filter(candidate => !learned.has(candidate.moveId)).length,
      BREEDING_INHERITANCE_CHECKPOINT_LEVELS.length - drafts.length,
    ),
  })
}

/** Create the exact origin-owned initial records after storage allocates the child slug. */
export const createBreedingHatchConstructionLearningRecordsV1 = (inputValue: unknown): readonly BreedingInheritanceLearningRecordV1[] => {
  const input = exact(inputValue, ['egg', 'command', 'childSheetSlug', 'recordedAtCampaignMinute'], 'hatchInheritanceRecordInput')
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'complete-hatch') return fail('breeding.inheritance-learning.wrong-command', 'Hatch records require complete-hatch.')
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  const command = commandValue
  const childSheetSlug = isSlug(input.childSheetSlug) && input.childSheetSlug.length <= 160
    ? input.childSheetSlug
    : fail('breeding.inheritance-learning.invalid-input', 'hatchInheritanceRecordInput.childSheetSlug must be a bounded canonical slug.')
  const recordedAt = integer(input.recordedAtCampaignMinute, 'hatchInheritanceRecordInput.recordedAtCampaignMinute')
  if (egg.eggId !== command.payload.eggId || egg.status !== 'hatched' || egg.childSheetSlug !== childSheetSlug
    || recordedAt < egg.updatedAtCampaignMinute) return fail('breeding.inheritance-learning.stale-authority', 'Hatch record command, terminal Egg, child identity, and campaign time disagree.')
  return Object.freeze(hatchOutcomeDrafts({ egg, command, originId: command.payload.originId }).map(draft => createBreedingInheritanceLearningRecordV1({
    schemaVersion: 1,
    learningRecordId: learningRecordId(command.payload.originId, command.operationId, draft.checkpointLevel),
    originId: command.payload.originId,
    eggId: egg.eggId,
    childSheetSlug,
    checkpointLevel: draft.checkpointLevel,
    application: { kind: 'hatch-construction', childSheetRevision: 0 },
    outcome: draft.outcome,
    recordedAtCampaignMinute: recordedAt,
    operationId: command.operationId,
  })))
}

export const breedingInheritanceLearningOriginStateSha256 = (origin: PokemonBreedingOriginV1): string => sha256(origin)
export const breedingInheritanceLearningSheetDefinitionSha256 = (document: CharacterSheet): string => sha256(document)
export const breedingInheritanceLearningPlanEquals = (left: unknown, right: unknown): boolean => same(left, right)
