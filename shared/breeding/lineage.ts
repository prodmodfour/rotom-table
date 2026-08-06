import { isSlug } from '../paths'
import {
  parseBreederSnapshotV1,
  parseBreedingParentSnapshotV1,
  parsePokemonEggOffspringBlueprintV1,
  parsePokemonEggRulesetReferenceV1,
  parsePokemonEggSourceV1,
  parsePokemonEggSpecialStateV1,
  type BreederSnapshotV1,
  type BreedingParentSnapshotV1,
  type PokemonEggOffspringBlueprintV1,
  type PokemonEggRulesetReferenceV1,
  type PokemonEggSourceV1,
  type PokemonEggSpecialStateV1,
} from './egg'
import {
  parseBreedingInheritanceLearningRecordIdSyntax,
  parseBreedingMoveIdSyntax,
  parseBreedingOperationIdSyntax,
  parsePokemonBreedingOriginIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingInheritanceLearningRecordId,
  type BreedingMoveId,
  type BreedingOperationId,
  type PokemonBreedingOriginId,
  type PokemonEggId,
} from './ids'

export const POKEMON_BREEDING_ORIGIN_SCHEMA_VERSION = 1 as const
export const BREEDING_INHERITANCE_LEARNING_SCHEMA_VERSION = 1 as const
export const BREEDING_INHERITANCE_CHECKPOINT_LEVELS = Object.freeze([20, 30, 40, 50, 60, 70, 80, 90, 100] as const)
export const BREEDING_INHERITANCE_ILLEGAL_REASON_IDS = Object.freeze([
  'breeding.inheritance.frequency-too-high',
  'breeding.inheritance.damage-base-too-high',
  'breeding.inheritance.move-data-unavailable',
] as const)
export type BreedingInheritanceCheckpointLevel = typeof BREEDING_INHERITANCE_CHECKPOINT_LEVELS[number]
export type BreedingInheritanceIllegalReasonId = typeof BREEDING_INHERITANCE_ILLEGAL_REASON_IDS[number]

export interface BreedingInheritancePermanentMoveProvenanceV1 {
  readonly schemaVersion: 1
  readonly kind: 'breeding-inheritance'
  readonly originId: PokemonBreedingOriginId
  readonly eggId: PokemonEggId
  readonly learningRecordId: BreedingInheritanceLearningRecordId
  readonly checkpointLevel: BreedingInheritanceCheckpointLevel
  readonly moveId: BreedingMoveId
  readonly operationId: BreedingOperationId
  readonly candidateDefinitionSha256: string
}
export interface BreedingInheritanceLearnedOutcomeV1 {
  readonly kind: 'learned'
  readonly moveId: BreedingMoveId
  readonly candidateDefinitionSha256: string
  readonly permanentMoveProvenance: BreedingInheritancePermanentMoveProvenanceV1
}
export interface BreedingInheritanceEmptyIllegalOutcomeV1 {
  readonly kind: 'empty-illegal'
  readonly moveId: BreedingMoveId
  readonly reasonIds: readonly BreedingInheritanceIllegalReasonId[]
  readonly prerequisiteEvaluationDefinitionSha256: string
}
export interface BreedingInheritanceEmptyNoCandidateOutcomeV1 {
  readonly kind: 'empty-no-candidate'
  readonly candidateSetDefinitionSha256: string
}
export type BreedingInheritanceLearningOutcomeV1 =
  | BreedingInheritanceLearnedOutcomeV1
  | BreedingInheritanceEmptyIllegalOutcomeV1
  | BreedingInheritanceEmptyNoCandidateOutcomeV1
export type BreedingInheritanceLearningApplicationV1 =
  | { readonly kind: 'hatch-construction', readonly childSheetRevision: 0 }
  | { readonly kind: 'level-up', readonly childSheetRevisionBefore: number, readonly childSheetRevisionAfter: number }
export interface BreedingInheritanceLearningRecordV1 {
  readonly schemaVersion: 1
  readonly learningRecordId: BreedingInheritanceLearningRecordId
  readonly originId: PokemonBreedingOriginId
  readonly eggId: PokemonEggId
  readonly childSheetSlug: string
  readonly checkpointLevel: BreedingInheritanceCheckpointLevel
  readonly application: BreedingInheritanceLearningApplicationV1
  readonly outcome: BreedingInheritanceLearningOutcomeV1
  readonly recordedAtCampaignMinute: number
  readonly operationId: BreedingOperationId
  readonly definitionSha256: string
}
export interface PokemonBreedingOriginV1 {
  readonly schemaVersion: 1
  readonly originId: PokemonBreedingOriginId
  readonly eggId: PokemonEggId
  readonly sourceEggRevision: number
  readonly sourceEggDocumentSha256: string
  readonly source: PokemonEggSourceV1
  readonly ruleset: PokemonEggRulesetReferenceV1
  readonly definitionHashes: readonly string[]
  readonly parents: readonly BreedingParentSnapshotV1[]
  readonly breeder: BreederSnapshotV1 | null
  readonly offspring: PokemonEggOffspringBlueprintV1
  readonly special: PokemonEggSpecialStateV1
  readonly ownerTrainerSlugAtHatch: string
  readonly childSheetSlug: string
  readonly hatchedAtCampaignMinute: number
  readonly hatchOperationId: BreedingOperationId
  readonly settlementOperationId: BreedingOperationId
  readonly inheritanceLearningRecords: readonly BreedingInheritanceLearningRecordV1[]
  readonly lineageDefinitionSha256: string
}

export type PokemonBreedingLineageValidationCode =
  | 'breeding.lineage.invalid-document'
  | 'breeding.lineage.unknown-field'
  | 'breeding.lineage.invalid-id'
  | 'breeding.lineage.invalid-invariant'
export class PokemonBreedingLineageValidationError extends Error {
  readonly code: PokemonBreedingLineageValidationCode
  readonly path: string
  constructor(code: PokemonBreedingLineageValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonBreedingLineageValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const CHECKPOINT_SET = new Set<number>(BREEDING_INHERITANCE_CHECKPOINT_LEVELS)
const ILLEGAL_REASON_SET = new Set<string>(BREEDING_INHERITANCE_ILLEGAL_REASON_IDS)
const fail = (code: PokemonBreedingLineageValidationCode, path: string, message: string): never => {
  throw new PokemonBreedingLineageValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.lineage.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.lineage.invalid-document', path, 'must be a plain data object without symbols.')
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.lineage.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail('breeding.lineage.unknown-field', path, 'must contain exactly the declared fields.')
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.lineage.invalid-document', path, `must be an array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) fail('breeding.lineage.invalid-document', path, 'cannot be sparse.')
  if (Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail('breeding.lineage.unknown-field', path, 'cannot contain enriched fields.')
  return value
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail('breeding.lineage.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  return value as number
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.lineage.invalid-document', path, 'must be a lowercase SHA-256 value.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.lineage.invalid-id', path, 'must be a canonical sheet slug of at most 160 characters.')
const operationId = (value: unknown, path: string): BreedingOperationId => parseBreedingOperationIdSyntax(value)
  ?? fail('breeding.lineage.invalid-id', path, 'must be a breeding operation ID.')
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
const sortedHashes = (value: unknown, path: string): readonly string[] => {
  const hashes = array(value, path, 256).map((entry, index) => hash(entry, `${path}[${index}]`))
  if (hashes.length < 1) fail('breeding.lineage.invalid-invariant', path, 'cannot be empty.')
  for (let index = 1; index < hashes.length; index += 1) if (hashes[index - 1]! >= hashes[index]!) fail('breeding.lineage.invalid-invariant', path, 'must be unique in strict code-point order.')
  return Object.freeze(hashes)
}
const parseCheckpoint = (value: unknown, path: string): BreedingInheritanceCheckpointLevel => {
  const level = integer(value, path, 20, 100)
  return CHECKPOINT_SET.has(level) ? level as BreedingInheritanceCheckpointLevel : fail('breeding.lineage.invalid-document', path, 'must be a canonical inheritance checkpoint Level.')
}
const parseMove = (value: unknown, path: string): BreedingMoveId => parseBreedingMoveIdSyntax(value)
  ?? fail('breeding.lineage.invalid-id', path, 'must be canonical Move ID syntax.')

const parsePermanentMoveProvenance = (value: unknown, path: string): BreedingInheritancePermanentMoveProvenanceV1 => {
  const row = exact(value, ['schemaVersion', 'kind', 'originId', 'eggId', 'learningRecordId', 'checkpointLevel', 'moveId', 'operationId', 'candidateDefinitionSha256'], path)
  if (row.schemaVersion !== 1 || row.kind !== 'breeding-inheritance') fail('breeding.lineage.invalid-document', path, 'must be breeding-inheritance provenance v1.')
  return Object.freeze({
    schemaVersion: 1,
    kind: 'breeding-inheritance',
    originId: parsePokemonBreedingOriginIdSyntax(row.originId) ?? fail('breeding.lineage.invalid-id', `${path}.originId`, 'must be a breeding origin ID.'),
    eggId: parsePokemonEggIdSyntax(row.eggId) ?? fail('breeding.lineage.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.'),
    learningRecordId: parseBreedingInheritanceLearningRecordIdSyntax(row.learningRecordId) ?? fail('breeding.lineage.invalid-id', `${path}.learningRecordId`, 'must be an inheritance learning record ID.'),
    checkpointLevel: parseCheckpoint(row.checkpointLevel, `${path}.checkpointLevel`),
    moveId: parseMove(row.moveId, `${path}.moveId`),
    operationId: operationId(row.operationId, `${path}.operationId`),
    candidateDefinitionSha256: hash(row.candidateDefinitionSha256, `${path}.candidateDefinitionSha256`),
  })
}
const parseOutcome = (value: unknown, path: string): BreedingInheritanceLearningOutcomeV1 => {
  const row = record(value, path)
  if (row.kind === 'learned') {
    const exactRow = exact(row, ['kind', 'moveId', 'candidateDefinitionSha256', 'permanentMoveProvenance'], path)
    return Object.freeze({
      kind: 'learned',
      moveId: parseMove(exactRow.moveId, `${path}.moveId`),
      candidateDefinitionSha256: hash(exactRow.candidateDefinitionSha256, `${path}.candidateDefinitionSha256`),
      permanentMoveProvenance: parsePermanentMoveProvenance(exactRow.permanentMoveProvenance, `${path}.permanentMoveProvenance`),
    })
  }
  if (row.kind === 'empty-illegal') {
    const exactRow = exact(row, ['kind', 'moveId', 'reasonIds', 'prerequisiteEvaluationDefinitionSha256'], path)
    const reasonIds = array(exactRow.reasonIds, `${path}.reasonIds`, BREEDING_INHERITANCE_ILLEGAL_REASON_IDS.length).map((entry, index) => {
      if (typeof entry !== 'string' || !ILLEGAL_REASON_SET.has(entry)) fail('breeding.lineage.invalid-document', `${path}.reasonIds[${index}]`, 'must be a v1 inheritance prerequisite reason.')
      return entry as BreedingInheritanceIllegalReasonId
    })
    if (reasonIds.length < 1) fail('breeding.lineage.invalid-invariant', `${path}.reasonIds`, 'cannot be empty.')
    for (let index = 1; index < reasonIds.length; index += 1) {
      const before = BREEDING_INHERITANCE_ILLEGAL_REASON_IDS.indexOf(reasonIds[index - 1]!)
      const after = BREEDING_INHERITANCE_ILLEGAL_REASON_IDS.indexOf(reasonIds[index]!)
      if (before >= after) fail('breeding.lineage.invalid-invariant', `${path}.reasonIds`, 'must be unique in declared reason order.')
    }
    return Object.freeze({ kind: 'empty-illegal', moveId: parseMove(exactRow.moveId, `${path}.moveId`), reasonIds: Object.freeze(reasonIds), prerequisiteEvaluationDefinitionSha256: hash(exactRow.prerequisiteEvaluationDefinitionSha256, `${path}.prerequisiteEvaluationDefinitionSha256`) })
  }
  if (row.kind === 'empty-no-candidate') {
    const exactRow = exact(row, ['kind', 'candidateSetDefinitionSha256'], path)
    return Object.freeze({ kind: 'empty-no-candidate', candidateSetDefinitionSha256: hash(exactRow.candidateSetDefinitionSha256, `${path}.candidateSetDefinitionSha256`) })
  }
  return fail('breeding.lineage.invalid-document', `${path}.kind`, 'must be a v1 inheritance-learning outcome.')
}

const parseLearningApplication = (value: unknown, path: string): BreedingInheritanceLearningApplicationV1 => {
  const row = record(value, path)
  if (row.kind === 'hatch-construction') {
    const exactRow = exact(row, ['kind', 'childSheetRevision'], path)
    if (exactRow.childSheetRevision !== 0) fail('breeding.lineage.invalid-invariant', `${path}.childSheetRevision`, 'hatch construction must create child revision 0.')
    return Object.freeze({ kind: 'hatch-construction', childSheetRevision: 0 })
  }
  if (row.kind === 'level-up') {
    const exactRow = exact(row, ['kind', 'childSheetRevisionBefore', 'childSheetRevisionAfter'], path)
    const before = integer(exactRow.childSheetRevisionBefore, `${path}.childSheetRevisionBefore`, 0, 2_147_483_646)
    const after = integer(exactRow.childSheetRevisionAfter, `${path}.childSheetRevisionAfter`, 1, 2_147_483_647)
    if (after !== before + 1) fail('breeding.lineage.invalid-invariant', path, 'level-up revision after must be exactly revision before plus one.')
    return Object.freeze({ kind: 'level-up', childSheetRevisionBefore: before, childSheetRevisionAfter: after })
  }
  return fail('breeding.lineage.invalid-document', `${path}.kind`, 'must be a v1 inheritance-learning application kind.')
}
export const parseBreedingInheritanceLearningRecordV1 = (value: unknown, path = 'inheritanceLearningRecord'): BreedingInheritanceLearningRecordV1 => {
  const row = exact(value, ['schemaVersion', 'learningRecordId', 'originId', 'eggId', 'childSheetSlug', 'checkpointLevel', 'application', 'outcome', 'recordedAtCampaignMinute', 'operationId', 'definitionSha256'], path)
  if (row.schemaVersion !== 1) fail('breeding.lineage.invalid-document', `${path}.schemaVersion`, 'must be 1.')
  const learningRecordId = parseBreedingInheritanceLearningRecordIdSyntax(row.learningRecordId) ?? fail('breeding.lineage.invalid-id', `${path}.learningRecordId`, 'must be an inheritance learning record ID.')
  const originId = parsePokemonBreedingOriginIdSyntax(row.originId) ?? fail('breeding.lineage.invalid-id', `${path}.originId`, 'must be a breeding origin ID.')
  const eggId = parsePokemonEggIdSyntax(row.eggId) ?? fail('breeding.lineage.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  const checkpointLevel = parseCheckpoint(row.checkpointLevel, `${path}.checkpointLevel`)
  const operation = operationId(row.operationId, `${path}.operationId`)
  const outcome = parseOutcome(row.outcome, `${path}.outcome`)
  if (outcome.kind === 'learned') {
    const provenance = outcome.permanentMoveProvenance
    if (provenance.originId !== originId || provenance.eggId !== eggId || provenance.learningRecordId !== learningRecordId
      || provenance.checkpointLevel !== checkpointLevel || provenance.moveId !== outcome.moveId || provenance.operationId !== operation
      || provenance.candidateDefinitionSha256 !== outcome.candidateDefinitionSha256) {
      fail('breeding.lineage.invalid-invariant', `${path}.outcome.permanentMoveProvenance`, 'must exactly bind this record and learned candidate.')
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    learningRecordId,
    originId,
    eggId,
    childSheetSlug: slug(row.childSheetSlug, `${path}.childSheetSlug`),
    checkpointLevel,
    application: parseLearningApplication(row.application, `${path}.application`),
    outcome,
    recordedAtCampaignMinute: integer(row.recordedAtCampaignMinute, `${path}.recordedAtCampaignMinute`),
    operationId: operation,
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

/** Parse and freeze child-retained breeding origin and inheritance-learning provenance. */
export const parsePokemonBreedingOriginV1 = (value: unknown, path = 'pokemonBreedingOrigin'): PokemonBreedingOriginV1 => {
  const row = exact(value, ['schemaVersion', 'originId', 'eggId', 'sourceEggRevision', 'sourceEggDocumentSha256', 'source', 'ruleset', 'definitionHashes', 'parents', 'breeder', 'offspring', 'special', 'ownerTrainerSlugAtHatch', 'childSheetSlug', 'hatchedAtCampaignMinute', 'hatchOperationId', 'settlementOperationId', 'inheritanceLearningRecords', 'lineageDefinitionSha256'], path)
  if (row.schemaVersion !== 1) fail('breeding.lineage.invalid-document', `${path}.schemaVersion`, 'must be 1.')
  const originId = parsePokemonBreedingOriginIdSyntax(row.originId) ?? fail('breeding.lineage.invalid-id', `${path}.originId`, 'must be a breeding origin ID.')
  const eggId = parsePokemonEggIdSyntax(row.eggId) ?? fail('breeding.lineage.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  const source = parsePokemonEggSourceV1(row.source, `${path}.source`)
  const parents = array(row.parents, `${path}.parents`, 2).map((entry, index) => parseBreedingParentSnapshotV1(entry, `${path}.parents[${index}]`))
  const breeder = parseBreederSnapshotV1(row.breeder, `${path}.breeder`)
  if (source.kind === 'breeding') {
    if (parents.length !== 2 || parents[0]!.parentIndex !== 0 || parents[1]!.parentIndex !== 1 || !breeder) fail('breeding.lineage.invalid-invariant', path, 'breeding origin requires the ordered accepted parent and Breeder snapshots.')
    if (!parents[0]!.maturity.eligible || !parents[1]!.maturity.eligible || parents[0]!.roleId === parents[1]!.roleId) fail('breeding.lineage.invalid-invariant', `${path}.parents`, 'accepted parents require positive maturity and complementary role evidence.')
  }
  else if (parents.length !== 0 || breeder !== null) fail('breeding.lineage.invalid-invariant', path, 'parentless source origins cannot manufacture parent or Breeder lineage.')
  const offspring = parsePokemonEggOffspringBlueprintV1(row.offspring, `${path}.offspring`)
  for (const candidate of offspring.inheritanceCandidates) {
    for (const candidateSource of candidate.sources) {
      if (source.kind === 'breeding') {
        if (candidateSource.kind !== 'parent') fail('breeding.lineage.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'breeding lineage candidates require frozen parent evidence.')
        if (candidateSource.kind === 'parent') {
          const parent = parents[candidateSource.parentIndex]
          const knownMove = parent?.effectiveKnownMoves.find(move => move.moveId === candidate.moveId)
          if (!parent || candidateSource.parentRef !== parent.pokemonSheetSlug || candidateSource.parentSpeciesId !== parent.speciesId
            || !knownMove || JSON.stringify(knownMove.evidence) !== JSON.stringify(candidateSource.knownMoveEvidence)) fail('breeding.lineage.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'candidate provenance must exactly match a frozen parent Move snapshot.')
        }
      }
      else {
        if (candidateSource.kind !== 'source-authority') fail('breeding.lineage.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'parentless lineage candidates require typed source authority.')
        if (candidateSource.kind === 'source-authority') {
          const expectedKind = source.kind === 'feature-artificial' ? 'feature-provider' : source.kind
          if (candidateSource.authorityKind !== expectedKind) fail('breeding.lineage.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'candidate authority must match the Egg source kind.')
        }
      }
    }
  }
  const special = parsePokemonEggSpecialStateV1(row.special, `${path}.special`)
  if (special.state !== 'normal' && special.state !== 'resolved') fail('breeding.lineage.invalid-invariant', `${path}.special.state`, 'hatched origin requires a terminal special-roll state.')
  const childSheetSlug = slug(row.childSheetSlug, `${path}.childSheetSlug`)
  const hatchedAtCampaignMinute = integer(row.hatchedAtCampaignMinute, `${path}.hatchedAtCampaignMinute`)
  const hatchOperationId = operationId(row.hatchOperationId, `${path}.hatchOperationId`)
  const settlementOperationId = operationId(row.settlementOperationId, `${path}.settlementOperationId`)
  const records = array(row.inheritanceLearningRecords, `${path}.inheritanceLearningRecords`, BREEDING_INHERITANCE_CHECKPOINT_LEVELS.length)
    .map((entry, index) => parseBreedingInheritanceLearningRecordV1(entry, `${path}.inheritanceLearningRecords[${index}]`))
  const hatchCheckpointCount = BREEDING_INHERITANCE_CHECKPOINT_LEVELS.filter(level => level <= offspring.startingLevel).length
  if (records.length < hatchCheckpointCount) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords`, 'must record every checkpoint reached by the hatch starting Level.')
  const candidateByMove = new Map(offspring.inheritanceCandidates.map(candidate => [candidate.moveId, candidate]))
  const learnedMoves = new Set<string>()
  const learningRecordIds = new Set<string>()
  const closedOperationIds = new Set<string>()
  let activeOperationId: string | null = null
  for (let index = 0; index < records.length; index += 1) {
    const learning = records[index]!
    if (learning.checkpointLevel !== BREEDING_INHERITANCE_CHECKPOINT_LEVELS[index]) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords`, 'must form a gap-free prefix of canonical checkpoints.')
    if (learning.originId !== originId || learning.eggId !== eggId || learning.childSheetSlug !== childSheetSlug) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords[${index}]`, 'must bind this origin, Egg, and child sheet.')
    if (learningRecordIds.has(learning.learningRecordId)) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords`, 'learning record identities must be unique.')
    learningRecordIds.add(learning.learningRecordId)
    if (activeOperationId !== learning.operationId) {
      if (activeOperationId !== null) closedOperationIds.add(activeOperationId)
      if (closedOperationIds.has(learning.operationId)) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords`, 'one operation may own only one contiguous checkpoint batch.')
      activeOperationId = learning.operationId
    }
    if (index < hatchCheckpointCount) {
      if (learning.application.kind !== 'hatch-construction' || learning.operationId !== settlementOperationId || learning.recordedAtCampaignMinute !== hatchedAtCampaignMinute) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords[${index}]`, 'starting-Level checkpoints must be written by child construction at hatch settlement.')
    }
    else {
      if (learning.application.kind !== 'level-up' || learning.operationId === settlementOperationId) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords[${index}]`, 'post-hatch checkpoints require a level-up application and operation.')
      const application = learning.application as Extract<BreedingInheritanceLearningApplicationV1, { readonly kind: 'level-up' }>
      const previous = records[index - 1]
      if (previous) {
        const previousAfter = previous.application.kind === 'hatch-construction' ? 0 : previous.application.childSheetRevisionAfter
        if (previous.operationId === learning.operationId) {
          if (previous.application.kind !== 'level-up'
            || previous.application.childSheetRevisionBefore !== application.childSheetRevisionBefore
            || previous.application.childSheetRevisionAfter !== application.childSheetRevisionAfter
            || previous.recordedAtCampaignMinute !== learning.recordedAtCampaignMinute) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords`, 'one level-up checkpoint batch must share revision and campaign-time evidence.')
        }
        else if (application.childSheetRevisionBefore < previousAfter
          || learning.recordedAtCampaignMinute < previous.recordedAtCampaignMinute) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords`, 'level-up revisions and campaign times must remain monotonic.')
      }
    }
    if (learning.outcome.kind === 'learned' || learning.outcome.kind === 'empty-illegal') {
      if (!candidateByMove.has(learning.outcome.moveId)) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords[${index}].outcome.moveId`, 'must be one of the frozen inheritance candidates.')
    }
    if (learning.outcome.kind === 'learned') {
      if (learnedMoves.has(learning.outcome.moveId)) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords[${index}].outcome.moveId`, 'cannot learn the same frozen candidate twice.')
      learnedMoves.add(learning.outcome.moveId)
    }
    if (learning.outcome.kind === 'empty-no-candidate' && [...candidateByMove.keys()].some(moveId => !learnedMoves.has(moveId))) fail('breeding.lineage.invalid-invariant', `${path}.inheritanceLearningRecords[${index}].outcome`, 'is allowed only when no unlearned frozen candidate remains.')
  }
  const origin: PokemonBreedingOriginV1 = {
    schemaVersion: 1,
    originId,
    eggId,
    sourceEggRevision: integer(row.sourceEggRevision, `${path}.sourceEggRevision`, 1, 2_147_483_647),
    sourceEggDocumentSha256: hash(row.sourceEggDocumentSha256, `${path}.sourceEggDocumentSha256`),
    source,
    ruleset: parsePokemonEggRulesetReferenceV1(row.ruleset, `${path}.ruleset`),
    definitionHashes: sortedHashes(row.definitionHashes, `${path}.definitionHashes`),
    parents: Object.freeze(parents),
    breeder,
    offspring,
    special,
    ownerTrainerSlugAtHatch: slug(row.ownerTrainerSlugAtHatch, `${path}.ownerTrainerSlugAtHatch`),
    childSheetSlug,
    hatchedAtCampaignMinute,
    hatchOperationId,
    settlementOperationId,
    inheritanceLearningRecords: Object.freeze(records),
    lineageDefinitionSha256: hash(row.lineageDefinitionSha256, `${path}.lineageDefinitionSha256`),
  }
  return deepFreeze(origin)
}
