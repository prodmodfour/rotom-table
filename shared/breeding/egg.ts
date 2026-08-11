import { isSlug } from '../paths'
import {
  isBreedingCanonicalLocalIdSyntax,
  parseBreedingAbilityIdSyntax,
  parseBreedingEggGroupIdSyntax,
  parseBreedingMoveIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  parseBreedingRollRecordIdSyntax,
  parseBreedingSpeciesIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingAbilityId,
  type BreedingEggGroupId,
  type BreedingMoveId,
  type BreedingOfferOptionId,
  type BreedingOperationId,
  type BreedingProjectId,
  type BreedingRollRecordId,
  type BreedingSpeciesId,
  type PokemonEggId,
} from './ids'

export const POKEMON_EGG_DOCUMENT_SCHEMA_VERSION = 1 as const
export const POKEMON_EGG_REVISION_MAXIMUM = 2_147_483_647 as const
export const POKEMON_EGG_DEFINITION_HASH_MAXIMUM = 256 as const
export const POKEMON_EGG_INHERITANCE_CANDIDATE_MAXIMUM = 256 as const
export const POKEMON_EGG_STATUSES = Object.freeze([
  'incubating', 'ready', 'awaiting-special-adjudication', 'hatching', 'hatched', 'cancelled', 'invalidated-by-gm',
] as const)
export const POKEMON_EGG_ACTIVE_STATUSES = Object.freeze([
  'incubating', 'ready', 'awaiting-special-adjudication', 'hatching',
] as const)
export const POKEMON_EGG_SETTLED_STATUSES = Object.freeze(['hatched', 'cancelled', 'invalidated-by-gm'] as const)
export const POKEMON_EGG_TERMINAL_NON_HATCH_STATUSES = Object.freeze(['cancelled', 'invalidated-by-gm'] as const)
export const POKEMON_EGG_SOURCE_KINDS = Object.freeze(['breeding', 'fossil', 'gm', 'feature-artificial'] as const)
export type PokemonEggStatus = typeof POKEMON_EGG_STATUSES[number]
export type PokemonEggSourceKind = typeof POKEMON_EGG_SOURCE_KINDS[number]
export type PokemonEggGenderId = 'female' | 'male' | 'genderless'
export type PokemonEducationRank = 'Untrained' | 'Novice' | 'Adept' | 'Expert' | 'Master'
export const POKEMON_EGG_GM_PROVENANCE_KINDS = Object.freeze(['gm-authored','mysterious','campaign-gift','imported'] as const)
export type PokemonEggGmProvenanceKind = typeof POKEMON_EGG_GM_PROVENANCE_KINDS[number]
export interface PokemonEggGmSourceProvenanceV1 {
  readonly schemaVersion: 1
  readonly provenanceKind: PokemonEggGmProvenanceKind
  readonly provenanceId: string
  readonly eggId: PokemonEggId
  readonly ownerTrainerSlug: string
  readonly ownerTrainerRevision: number
  readonly ownerTrainerDefinitionSha256: string
  readonly createdByGmProfileId: string
  readonly sourceSystemId: string | null
  readonly sourceRecordId: string | null
  readonly sourceRecordDefinitionSha256: string | null
  readonly importReceiptDefinitionSha256: string | null
  readonly importEvidenceDefinitionSha256: string | null
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface PokemonEggLegacyGmSourceV1 {
  readonly kind: 'gm'
  readonly reasonId: string
  readonly evidenceDefinitionSha256: string
}
export interface PokemonEggTypedGmSourceV1 extends PokemonEggLegacyGmSourceV1 {
  readonly provenance: PokemonEggGmSourceProvenanceV1
}

export type PokemonEggSourceV1 =
  | { readonly kind: 'breeding', readonly projectId: BreedingProjectId }
  | { readonly kind: 'fossil', readonly sourceId: string, readonly evidenceDefinitionSha256: string }
  | PokemonEggLegacyGmSourceV1
  | PokemonEggTypedGmSourceV1
  | { readonly kind: 'feature-artificial', readonly providerId: string, readonly evidenceDefinitionSha256: string }
export interface PokemonEggRulesetReferenceV1 { readonly rulesetId: string, readonly definitionSha256: string }
export interface BreedingParentMaturitySnapshotV1 {
  readonly policyId: 'gm-confirmed-per-parent' | 'minimum-level'
  readonly minimumLevel: number | null
  readonly gmConfirmed: boolean | null
  readonly eligible: boolean
  readonly evidenceDefinitionSha256: string
}
export interface BreedingParentSnapshotV1 {
  readonly schemaVersion: 1
  readonly parentIndex: 0 | 1
  readonly pokemonSheetSlug: string
  readonly displayNameAtSnapshot: string
  readonly ownerTrainerSlug: string
  readonly sheetRevision: number
  readonly sourceSheetSha256: string
  readonly speciesId: BreedingSpeciesId
  readonly familyRootSpeciesId: BreedingSpeciesId
  readonly speciesSpecDefinitionSha256: string
  readonly genderId: PokemonEggGenderId
  readonly roleId: 'female-parent' | 'male-parent'
  readonly roleEvidenceDefinitionSha256: string
  readonly level: number
  readonly maturity: BreedingParentMaturitySnapshotV1
  readonly eggGroupIds: readonly BreedingEggGroupId[]
  readonly effectiveKnownMoves: readonly BreedingParentEffectiveKnownMoveV1[]
  readonly effectiveMoveSnapshotDefinitionSha256: string
  readonly controlEvidenceDefinitionSha256: string
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreederSnapshotV1 {
  readonly schemaVersion: 1
  readonly trainerSheetSlug: string
  readonly sheetRevision: number
  readonly sourceSheetSha256: string
  readonly pokemonEducationRank: PokemonEducationRank
  readonly permissionEvidenceIds: readonly string[]
  readonly providerSnapshotDefinitionSha256: string
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}
export type BreedingResolvedValueKind = 'random' | 'rank-choice' | 'fixed'
export interface BreedingResolvedValueV1<Value extends string = string> {
  readonly valueId: Value
  readonly resolutionKind: BreedingResolvedValueKind
  readonly rollRecordId: BreedingRollRecordId | null
  readonly optionId: BreedingOfferOptionId | null
  readonly choiceEvidenceId: string | null
}
export interface PokemonEggKnownMoveEvidenceV1 {
  readonly evidenceId: string
  readonly sourceKind: 'sheet-known-move' | 'permanent-move-grant' | 'effective-provider'
  readonly sourceId: string
  readonly sourceDefinitionSha256: string
}
export interface BreedingParentEffectiveKnownMoveV1 {
  readonly moveId: BreedingMoveId
  readonly evidence: readonly PokemonEggKnownMoveEvidenceV1[]
}
export interface PokemonEggParentInheritanceSourceV1 {
  readonly kind: 'parent'
  readonly parentIndex: 0 | 1
  readonly parentRef: string
  readonly parentSpeciesId: BreedingSpeciesId
  readonly pathwayId: 'child-egg-move' | 'child-machine-compatible'
  readonly knownMoveEvidence: readonly PokemonEggKnownMoveEvidenceV1[]
}
export interface PokemonEggSourceAuthorityInheritanceSourceV1 {
  readonly kind: 'source-authority'
  readonly authorityKind: 'fossil' | 'gm' | 'feature-provider'
  readonly authorityId: string
  readonly evidenceDefinitionSha256: string
}
export type PokemonEggInheritanceSourceV1 = PokemonEggParentInheritanceSourceV1 | PokemonEggSourceAuthorityInheritanceSourceV1
export interface PokemonEggInheritanceCandidateV1 {
  readonly moveId: BreedingMoveId
  readonly sources: readonly PokemonEggInheritanceSourceV1[]
}
export interface PokemonEggBabyTemplateEffectsV1 {
  readonly baseStatPenaltyEach: number
  readonly skillRankPenalty: 1
  readonly capabilityPenalty: 2
  readonly sizePercentOfAdult: number
  readonly recoveryBaseStatPointsEachInterval: 1
  readonly recoveryIntervalLevels: 5
  readonly recoveryStepCount: number
  readonly removeSkillAndCapabilityPenaltyAfterFinalRecovery: true
}
export interface PokemonEggBabyTemplateV1 {
  readonly applied: boolean
  readonly choiceOptionId: BreedingOfferOptionId | null
  readonly choiceEvidenceId: string | null
  readonly effects: PokemonEggBabyTemplateEffectsV1 | null
}
export const POKEMON_EGG_SERPENTS_MARK_PATTERN_IDS = Object.freeze(['attack','crush','fear','life','speed','stealth'] as const)
export type PokemonEggSerpentsMarkPatternId = typeof POKEMON_EGG_SERPENTS_MARK_PATTERN_IDS[number]
export interface PokemonEggSerpentsMarkInheritanceV1 {
  readonly patternId: PokemonEggSerpentsMarkPatternId
  readonly selectionKind: 'single-parent' | 'same-parent-pattern' | 'bounded-coin'
  readonly sourceParentSheetSlugs: readonly string[]
  readonly selectionRollRecordId: BreedingRollRecordId | null
  readonly providerEvidenceDefinitionSha256s: readonly string[]
}
export const POKEMON_EGG_FOSSIL_STAT_IDS = Object.freeze(['hp','atk','def','satk','sdef','spd'] as const)
export type PokemonEggFossilStatId = typeof POKEMON_EGG_FOSSIL_STAT_IDS[number]
export interface PokemonEggFossilRestorationV1 {
  readonly tutorPointDelta: -2
  readonly extraAbilityId: BreedingAbilityId
  readonly extraAbilityTier: 'basic' | 'advanced'
  readonly sourceTrainerSlug: string
  readonly providerEvidenceDefinitionSha256: string
  readonly providerHandoffDefinitionSha256: string
}
export interface PokemonEggPrehistoricBondV1 {
  readonly highestBaseStatId: PokemonEggFossilStatId
  readonly selectionKind: 'unique-highest' | 'bounded-gm-tie'
  readonly selectionOptionId: BreedingOfferOptionId | null
  readonly choiceEvidenceId: string | null
  readonly heldItemId: string
  readonly heldItemName: string
  readonly heldItemEffect: string
  readonly heldItemEffectDefinitionSha256: string
  readonly sourceTrainerSlug: string
  readonly providerEvidenceDefinitionSha256: string
  readonly providerHandoffDefinitionSha256: string
}
export interface PokemonEggMarsupialV1 {
  readonly providerRecordSha256: string
  readonly providerMechanicFieldsSha256: string
  readonly providerEvidenceDefinitionSha256s: readonly string[]
  readonly forcedBaseStatPenaltyEach: 5
  readonly motherPouchRequired: true
  readonly removalLevel: 25
}
export const POKEMON_EGG_PLAYING_GOD_CONTEST_STAT_IDS = Object.freeze(['beauty','cool','cute','smart','tough'] as const)
export type PokemonEggPlayingGodContestStatId = typeof POKEMON_EGG_PLAYING_GOD_CONTEST_STAT_IDS[number]
export interface PokemonEggPlayingGodBaseStatIncreasesV1 {
  readonly hp: number
  readonly atk: number
  readonly def: number
  readonly satk: number
  readonly sdef: number
  readonly spd: number
}
export interface PokemonEggPlayingGodV1 {
  readonly sourceTrainerSlug: string
  readonly sourceTrainerRevision: number
  readonly featureContributionDefinitionSha256: string
  readonly featureHandoffDefinitionSha256: string
  readonly chemistryAuthorityDefinitionSha256: string
  readonly technologyEducationRank: 5 | 6
  readonly colorationContestStatId: PokemonEggPlayingGodContestStatId | null
  readonly inheritanceMoveIds: readonly BreedingMoveId[]
  readonly baseStatIncreases: PokemonEggPlayingGodBaseStatIncreasesV1
  readonly upgradeOptionIds: readonly BreedingOfferOptionId[]
}
export interface PokemonEggProviderTraitsV1 {
  readonly serpentsMark: PokemonEggSerpentsMarkInheritanceV1 | null
  readonly fossilRestoration: PokemonEggFossilRestorationV1 | null
  readonly prehistoricBond: PokemonEggPrehistoricBondV1 | null
  /** Added by BR-067. Absent means a readable pre-BR-067 blueprint. */
  readonly marsupial?: PokemonEggMarsupialV1 | null
  /** Added by BR-067. Absent means a readable pre-BR-067 blueprint. */
  readonly playingGod?: PokemonEggPlayingGodV1 | null
}
export interface PokemonEggOffspringBlueprintV1 {
  readonly schemaVersion: 1
  readonly speciesId: BreedingSpeciesId
  readonly familyRootSpeciesId: BreedingSpeciesId
  readonly speciesSpecDefinitionSha256: string
  readonly nature: BreedingResolvedValueV1
  readonly ability: BreedingResolvedValueV1<BreedingAbilityId>
  readonly gender: BreedingResolvedValueV1<PokemonEggGenderId>
  readonly inheritanceCandidates: readonly PokemonEggInheritanceCandidateV1[]
  readonly providerTraits: PokemonEggProviderTraitsV1
  readonly startingLevel: number
  readonly babyTemplate: PokemonEggBabyTemplateV1
  readonly definitionSha256: string
}
export type PokemonEggReadinessKind = 'incubation-complete' | 'gm-mark-ready'
export interface PokemonEggIncubationStateV1 {
  readonly averageCampaignMinutes: number
  readonly targetCampaignMinutes: number
  readonly accumulatedCampaignMinutes: number
  readonly variationPolicyId: 'fixed-average' | 'server-random-half-to-double' | 'gm-within-half-to-double'
  readonly durationResultDefinitionSha256: string
  readonly lastAppliedClockRevision: number
  readonly lastAppliedClockMinute: number
  readonly readyAtCampaignMinute: number | null
  readonly readinessKind: PokemonEggReadinessKind | null
  readonly readyOperationId: BreedingOperationId | null
  readonly paused: boolean
  readonly pauseReasonId: string | null
  readonly pauseOperationId: BreedingOperationId | null
}
export type PokemonEggSpecialStateId = 'not-rolled' | 'normal' | 'pending-adjudication' | 'resolved'
export type PokemonEggSpecialTriggerId = 'roll-1' | 'roll-100' | 'provider-force'
export interface PokemonEggSpecialStateV1 {
  readonly state: PokemonEggSpecialStateId
  readonly rollRecordId: BreedingRollRecordId | null
  readonly rollTotal: number | null
  readonly triggerIds: readonly PokemonEggSpecialTriggerId[]
  readonly adjudicationId: string | null
  readonly outcomeId: string | null
  readonly automaticShiny: false
}
export interface PokemonEggTerminalV1 {
  readonly reasonId: string
  readonly atCampaignMinute: number
  readonly operationId: BreedingOperationId
}
export interface PokemonEggDocumentV1 {
  readonly schemaVersion: 1
  readonly eggId: PokemonEggId
  readonly revision: number
  readonly status: PokemonEggStatus
  readonly ownerTrainerSlug: string
  readonly source: PokemonEggSourceV1
  readonly ruleset: PokemonEggRulesetReferenceV1
  readonly definitionHashes: readonly string[]
  readonly parents: readonly BreedingParentSnapshotV1[]
  readonly breeder: BreederSnapshotV1 | null
  readonly offspring: PokemonEggOffspringBlueprintV1
  readonly incubation: PokemonEggIncubationStateV1
  readonly special: PokemonEggSpecialStateV1
  readonly hatchOperationId: BreedingOperationId | null
  readonly childSheetSlug: string | null
  readonly terminal: PokemonEggTerminalV1 | null
  readonly createdAtCampaignMinute: number
  readonly updatedAtCampaignMinute: number
  readonly statusChangedAtCampaignMinute: number
  readonly lastOperationId: BreedingOperationId
}

export type PokemonEggValidationCode =
  | 'breeding.egg.invalid-document'
  | 'breeding.egg.unknown-field'
  | 'breeding.egg.invalid-id'
  | 'breeding.egg.invalid-status'
  | 'breeding.egg.invalid-invariant'
export class PokemonEggValidationError extends Error {
  readonly code: PokemonEggValidationCode
  readonly path: string
  constructor(code: PokemonEggValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const RULESET_ID = /^[a-z0-9][a-z0-9.-]{0,95}$/
const TERMINAL_REASON = /^breeding\.egg-terminal\.[a-z0-9]+(?:-[a-z0-9]+)*$/
const GM_REASON = /^breeding\.egg-source\.[a-z0-9]+(?:-[a-z0-9]+)*$/
const STATUS_SET = new Set<string>(POKEMON_EGG_STATUSES)
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
const fail = (code: PokemonEggValidationCode, path: string, message: string): never => {
  throw new PokemonEggValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.egg.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.egg.invalid-document', path, 'must be a plain data object without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.egg.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.egg.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.egg.invalid-document', path, `must be an array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) fail('breeding.egg.invalid-document', path, 'cannot be sparse.')
  if (Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail('breeding.egg.unknown-field', path, 'cannot contain enriched fields.')
  return value
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('breeding.egg.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return value as number
}
const nullableInteger = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null => (
  value === null ? null : integer(value, path, minimum, maximum)
)
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.egg.invalid-document', path, 'must be a lowercase SHA-256 value.')
const id = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value)
  ? value
  : fail('breeding.egg.invalid-id', path, 'must be a bounded stable identifier.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.egg.invalid-id', path, 'must be a canonical sheet slug of at most 160 characters.')
const safeText = (value: unknown, path: string, maximum = 160): string => (
  typeof value === 'string' && value.length >= 1 && value.length <= maximum && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : fail('breeding.egg.invalid-document', path, `must be non-empty, trimmed, control-free text of at most ${maximum} characters.`)
)
const sortedUnique = <Value extends string>(values: readonly Value[], path: string): readonly Value[] => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) fail('breeding.egg.invalid-invariant', path, 'must be unique in strict code-point order.')
  }
  return Object.freeze([...values])
}
const operationId = (value: unknown, path: string): BreedingOperationId => (
  parseBreedingOperationIdSyntax(value) ?? fail('breeding.egg.invalid-id', path, 'must be a breeding operation ID.')
)
const nullableOperationId = (value: unknown, path: string): BreedingOperationId | null => value === null ? null : operationId(value, path)
const GM_REASON_BY_PROVENANCE: Readonly<Record<PokemonEggGmProvenanceKind, string>> = Object.freeze({
  'gm-authored': 'breeding.egg-source.gm-authored',
  mysterious: 'breeding.egg-source.mysterious',
  'campaign-gift': 'breeding.egg-source.campaign-gift',
  imported: 'breeding.egg-source.imported',
})
export const parsePokemonEggGmSourceProvenanceV1 = (value: unknown, path = 'pokemonEggGmSourceProvenance'): PokemonEggGmSourceProvenanceV1 => {
  const row = exact(value, [
    'schemaVersion','provenanceKind','provenanceId','eggId','ownerTrainerSlug','ownerTrainerRevision',
    'ownerTrainerDefinitionSha256','createdByGmProfileId','sourceSystemId','sourceRecordId',
    'sourceRecordDefinitionSha256','importReceiptDefinitionSha256','importEvidenceDefinitionSha256','capturedAtCampaignMinute','definitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || !POKEMON_EGG_GM_PROVENANCE_KINDS.includes(row.provenanceKind as PokemonEggGmProvenanceKind)) {
    fail('breeding.egg.invalid-invariant', path, 'must identify one closed v1 GM Egg provenance kind.')
  }
  const provenanceKind = row.provenanceKind as PokemonEggGmProvenanceKind
  const imported = provenanceKind === 'imported'
  const sourceSystemId = row.sourceSystemId === null ? null : id(row.sourceSystemId, `${path}.sourceSystemId`)
  const sourceRecordId = row.sourceRecordId === null ? null : id(row.sourceRecordId, `${path}.sourceRecordId`)
  const sourceRecordDefinitionSha256 = row.sourceRecordDefinitionSha256 === null ? null : hash(row.sourceRecordDefinitionSha256, `${path}.sourceRecordDefinitionSha256`)
  const importReceiptDefinitionSha256 = row.importReceiptDefinitionSha256 === null ? null : hash(row.importReceiptDefinitionSha256, `${path}.importReceiptDefinitionSha256`)
  const importEvidenceDefinitionSha256 = row.importEvidenceDefinitionSha256 === null ? null : hash(row.importEvidenceDefinitionSha256, `${path}.importEvidenceDefinitionSha256`)
  const completeImport = sourceSystemId !== null && sourceRecordId !== null && sourceRecordDefinitionSha256 !== null
    && importReceiptDefinitionSha256 !== null && importEvidenceDefinitionSha256 !== null
  const emptyImport = sourceSystemId === null && sourceRecordId === null && sourceRecordDefinitionSha256 === null
    && importReceiptDefinitionSha256 === null && importEvidenceDefinitionSha256 === null
  if (imported ? !completeImport : !emptyImport) {
    fail('breeding.egg.invalid-invariant', path, 'imported provenance alone requires the complete reviewed source-record and receipt identity; every other kind requires all import fields to be null.')
  }
  return Object.freeze({
    schemaVersion: 1,
    provenanceKind,
    provenanceId: id(row.provenanceId, `${path}.provenanceId`),
    eggId: parsePokemonEggIdSyntax(row.eggId) ?? fail('breeding.egg.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.'),
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    ownerTrainerRevision: integer(row.ownerTrainerRevision, `${path}.ownerTrainerRevision`, 0, POKEMON_EGG_REVISION_MAXIMUM),
    ownerTrainerDefinitionSha256: hash(row.ownerTrainerDefinitionSha256, `${path}.ownerTrainerDefinitionSha256`),
    createdByGmProfileId: id(row.createdByGmProfileId, `${path}.createdByGmProfileId`),
    sourceSystemId,
    sourceRecordId,
    sourceRecordDefinitionSha256,
    importReceiptDefinitionSha256,
    importEvidenceDefinitionSha256,
    capturedAtCampaignMinute: integer(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}

export const parsePokemonEggSourceV1 = (value: unknown, path = 'pokemonEggSource'): PokemonEggSourceV1 => {
  const row = record(value, path)
  if (row.kind === 'breeding') {
    const exactRow = exact(row, ['kind', 'projectId'], path)
    const projectId = parseBreedingProjectIdSyntax(exactRow.projectId)
      ?? fail('breeding.egg.invalid-id', `${path}.projectId`, 'must be a breeding project ID.')
    return Object.freeze({ kind: 'breeding', projectId })
  }
  if (row.kind === 'fossil') {
    const exactRow = exact(row, ['kind', 'sourceId', 'evidenceDefinitionSha256'], path)
    return Object.freeze({ kind: 'fossil', sourceId: id(exactRow.sourceId, `${path}.sourceId`), evidenceDefinitionSha256: hash(exactRow.evidenceDefinitionSha256, `${path}.evidenceDefinitionSha256`) })
  }
  if (row.kind === 'gm') {
    const typed = Object.hasOwn(row, 'provenance')
    const exactRow = exact(row, typed ? ['kind', 'reasonId', 'provenance', 'evidenceDefinitionSha256'] : ['kind', 'reasonId', 'evidenceDefinitionSha256'], path)
    if (typeof exactRow.reasonId !== 'string' || !GM_REASON.test(exactRow.reasonId)) fail('breeding.egg.invalid-id', `${path}.reasonId`, 'must be a typed GM source reason.')
    const reasonId = exactRow.reasonId as string
    const evidenceDefinitionSha256 = hash(exactRow.evidenceDefinitionSha256, `${path}.evidenceDefinitionSha256`)
    if (!typed) return Object.freeze({ kind: 'gm', reasonId, evidenceDefinitionSha256 })
    const provenance = parsePokemonEggGmSourceProvenanceV1(exactRow.provenance, `${path}.provenance`)
    if (reasonId !== GM_REASON_BY_PROVENANCE[provenance.provenanceKind]
      || evidenceDefinitionSha256 !== provenance.definitionSha256) {
      fail('breeding.egg.invalid-invariant', path, 'typed GM source reason and evidence must match the frozen provenance kind and definition.')
    }
    return Object.freeze({ kind: 'gm', reasonId, provenance, evidenceDefinitionSha256 })
  }
  if (row.kind === 'feature-artificial') {
    const exactRow = exact(row, ['kind', 'providerId', 'evidenceDefinitionSha256'], path)
    return Object.freeze({ kind: 'feature-artificial', providerId: id(exactRow.providerId, `${path}.providerId`), evidenceDefinitionSha256: hash(exactRow.evidenceDefinitionSha256, `${path}.evidenceDefinitionSha256`) })
  }
  return fail('breeding.egg.invalid-document', `${path}.kind`, 'must be a v1 Egg source kind.')
}
export const parsePokemonEggRulesetReferenceV1 = (value: unknown, path = 'pokemonEggRuleset'): PokemonEggRulesetReferenceV1 => {
  const row = exact(value, ['rulesetId', 'definitionSha256'], path)
  if (typeof row.rulesetId !== 'string' || !RULESET_ID.test(row.rulesetId)) fail('breeding.egg.invalid-id', `${path}.rulesetId`, 'must be a bounded ruleset ID.')
  return Object.freeze({ rulesetId: row.rulesetId as string, definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
const SOURCE_KIND_SET = new Set<string>(['sheet-known-move', 'permanent-move-grant', 'effective-provider'])
const parseEvidence = (value: unknown, path: string): PokemonEggKnownMoveEvidenceV1 => {
  const row = exact(value, ['evidenceId', 'sourceKind', 'sourceId', 'sourceDefinitionSha256'], path)
  if (typeof row.sourceKind !== 'string' || !SOURCE_KIND_SET.has(row.sourceKind)) fail('breeding.egg.invalid-document', `${path}.sourceKind`, 'must be an effective Move source kind.')
  return Object.freeze({ evidenceId: id(row.evidenceId, `${path}.evidenceId`), sourceKind: row.sourceKind as PokemonEggKnownMoveEvidenceV1['sourceKind'], sourceId: id(row.sourceId, `${path}.sourceId`), sourceDefinitionSha256: hash(row.sourceDefinitionSha256, `${path}.sourceDefinitionSha256`) })
}
const parseParentKnownMove = (value: unknown, path: string): BreedingParentEffectiveKnownMoveV1 => {
  const row = exact(value, ['moveId', 'evidence'], path)
  const moveId = parseBreedingMoveIdSyntax(row.moveId) ?? fail('breeding.egg.invalid-id', `${path}.moveId`, 'must be canonical Move ID syntax.')
  const evidence = array(row.evidence, `${path}.evidence`, 16).map((entry, index) => parseEvidence(entry, `${path}.evidence[${index}]`))
  if (evidence.length < 1) fail('breeding.egg.invalid-invariant', `${path}.evidence`, 'cannot be empty.')
  sortedUnique(evidence.map(entry => entry.evidenceId), `${path}.evidence`)
  return Object.freeze({ moveId, evidence: Object.freeze(evidence) })
}
const parseMaturity = (value: unknown, level: number, path: string): BreedingParentMaturitySnapshotV1 => {
  const row = exact(value, ['policyId', 'minimumLevel', 'gmConfirmed', 'eligible', 'evidenceDefinitionSha256'], path)
  if (typeof row.eligible !== 'boolean') fail('breeding.egg.invalid-document', `${path}.eligible`, 'must be boolean.')
  const evidenceDefinitionSha256 = hash(row.evidenceDefinitionSha256, `${path}.evidenceDefinitionSha256`)
  if (row.policyId === 'gm-confirmed-per-parent') {
    if (row.minimumLevel !== null || typeof row.gmConfirmed !== 'boolean' || row.eligible !== row.gmConfirmed) fail('breeding.egg.invalid-invariant', path, 'GM-confirmed maturity must retain its exact boolean evidence result.')
    return Object.freeze({ policyId: 'gm-confirmed-per-parent', minimumLevel: null, gmConfirmed: row.gmConfirmed as boolean, eligible: row.eligible as boolean, evidenceDefinitionSha256 })
  }
  if (row.policyId === 'minimum-level') {
    const minimumLevel = integer(row.minimumLevel, `${path}.minimumLevel`, 1, 100)
    if (row.gmConfirmed !== null || row.eligible !== (level >= minimumLevel)) fail('breeding.egg.invalid-invariant', path, 'minimum-level maturity must equal the frozen level comparison.')
    return Object.freeze({ policyId: 'minimum-level', minimumLevel, gmConfirmed: null, eligible: row.eligible as boolean, evidenceDefinitionSha256 })
  }
  return fail('breeding.egg.invalid-document', `${path}.policyId`, 'must be a v1 maturity policy ID.')
}
export const parseBreedingParentSnapshotV1 = (value: unknown, path = 'breedingParentSnapshot'): BreedingParentSnapshotV1 => {
  const row = exact(value, ['schemaVersion', 'parentIndex', 'pokemonSheetSlug', 'displayNameAtSnapshot', 'ownerTrainerSlug', 'sheetRevision', 'sourceSheetSha256', 'speciesId', 'familyRootSpeciesId', 'speciesSpecDefinitionSha256', 'genderId', 'roleId', 'roleEvidenceDefinitionSha256', 'level', 'maturity', 'eggGroupIds', 'effectiveKnownMoves', 'effectiveMoveSnapshotDefinitionSha256', 'controlEvidenceDefinitionSha256', 'capturedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || (row.parentIndex !== 0 && row.parentIndex !== 1)) fail('breeding.egg.invalid-document', path, 'has an invalid parent snapshot version or index.')
  const speciesId = parseBreedingSpeciesIdSyntax(row.speciesId) ?? fail('breeding.egg.invalid-id', `${path}.speciesId`, 'must be a canonical Species ID syntax.')
  const familyRootSpeciesId = parseBreedingSpeciesIdSyntax(row.familyRootSpeciesId) ?? fail('breeding.egg.invalid-id', `${path}.familyRootSpeciesId`, 'must be a canonical Family root Species ID syntax.')
  if (row.genderId !== 'female' && row.genderId !== 'male' && row.genderId !== 'genderless') fail('breeding.egg.invalid-document', `${path}.genderId`, 'must be a v1 Gender ID.')
  if (row.roleId !== 'female-parent' && row.roleId !== 'male-parent') fail('breeding.egg.invalid-document', `${path}.roleId`, 'must be a v1 parent role ID.')
  const level = integer(row.level, `${path}.level`, 1, 100)
  const eggGroups = array(row.eggGroupIds, `${path}.eggGroupIds`, 14).map((entry, index) => (
    parseBreedingEggGroupIdSyntax(entry) ?? fail('breeding.egg.invalid-id', `${path}.eggGroupIds[${index}]`, 'must be canonical Egg Group ID syntax.')
  ))
  const effectiveKnownMoves = array(row.effectiveKnownMoves, `${path}.effectiveKnownMoves`, 64).map((entry, index) => parseParentKnownMove(entry, `${path}.effectiveKnownMoves[${index}]`))
  sortedUnique(effectiveKnownMoves.map(entry => entry.moveId), `${path}.effectiveKnownMoves`)
  return Object.freeze({
    schemaVersion: 1,
    parentIndex: row.parentIndex as 0 | 1,
    pokemonSheetSlug: slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`),
    displayNameAtSnapshot: safeText(row.displayNameAtSnapshot, `${path}.displayNameAtSnapshot`),
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    sheetRevision: integer(row.sheetRevision, `${path}.sheetRevision`, 0, POKEMON_EGG_REVISION_MAXIMUM),
    sourceSheetSha256: hash(row.sourceSheetSha256, `${path}.sourceSheetSha256`),
    speciesId,
    familyRootSpeciesId,
    speciesSpecDefinitionSha256: hash(row.speciesSpecDefinitionSha256, `${path}.speciesSpecDefinitionSha256`),
    genderId: row.genderId as PokemonEggGenderId,
    roleId: row.roleId as BreedingParentSnapshotV1['roleId'],
    roleEvidenceDefinitionSha256: hash(row.roleEvidenceDefinitionSha256, `${path}.roleEvidenceDefinitionSha256`),
    level,
    maturity: parseMaturity(row.maturity, level, `${path}.maturity`),
    eggGroupIds: sortedUnique(eggGroups, `${path}.eggGroupIds`) as readonly BreedingEggGroupId[],
    effectiveKnownMoves: Object.freeze(effectiveKnownMoves),
    effectiveMoveSnapshotDefinitionSha256: hash(row.effectiveMoveSnapshotDefinitionSha256, `${path}.effectiveMoveSnapshotDefinitionSha256`),
    controlEvidenceDefinitionSha256: hash(row.controlEvidenceDefinitionSha256, `${path}.controlEvidenceDefinitionSha256`),
    capturedAtCampaignMinute: integer(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
const RANKS = new Set<string>(['Untrained', 'Novice', 'Adept', 'Expert', 'Master'])
export const parseBreederSnapshotV1 = (value: unknown, path = 'breederSnapshot'): BreederSnapshotV1 | null => {
  if (value === null) return null
  const row = exact(value, ['schemaVersion', 'trainerSheetSlug', 'sheetRevision', 'sourceSheetSha256', 'pokemonEducationRank', 'permissionEvidenceIds', 'providerSnapshotDefinitionSha256', 'capturedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.pokemonEducationRank !== 'string' || !RANKS.has(row.pokemonEducationRank)) fail('breeding.egg.invalid-document', path, 'has an invalid Breeder snapshot version or rank.')
  const evidence = array(row.permissionEvidenceIds, `${path}.permissionEvidenceIds`, 64).map((entry, index) => id(entry, `${path}.permissionEvidenceIds[${index}]`))
  if (evidence.length < 1) fail('breeding.egg.invalid-invariant', `${path}.permissionEvidenceIds`, 'must retain at least one permission source.')
  return Object.freeze({
    schemaVersion: 1,
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    sheetRevision: integer(row.sheetRevision, `${path}.sheetRevision`, 0, POKEMON_EGG_REVISION_MAXIMUM),
    sourceSheetSha256: hash(row.sourceSheetSha256, `${path}.sourceSheetSha256`),
    pokemonEducationRank: row.pokemonEducationRank as PokemonEducationRank,
    permissionEvidenceIds: sortedUnique(evidence, `${path}.permissionEvidenceIds`),
    providerSnapshotDefinitionSha256: hash(row.providerSnapshotDefinitionSha256, `${path}.providerSnapshotDefinitionSha256`),
    capturedAtCampaignMinute: integer(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
const parseResolved = <Value extends string>(
  value: unknown,
  path: string,
  parseValue: (value: unknown) => Value | null,
): BreedingResolvedValueV1<Value> => {
  const row = exact(value, ['valueId', 'resolutionKind', 'rollRecordId', 'optionId', 'choiceEvidenceId'], path)
  const valueId = parseValue(row.valueId) ?? fail('breeding.egg.invalid-id', `${path}.valueId`, 'must be a canonical resolved value ID.')
  if (row.resolutionKind !== 'random' && row.resolutionKind !== 'rank-choice' && row.resolutionKind !== 'fixed') fail('breeding.egg.invalid-document', `${path}.resolutionKind`, 'must be a v1 resolution kind.')
  const rollRecordId = row.rollRecordId === null ? null : parseBreedingRollRecordIdSyntax(row.rollRecordId)
  const optionId = row.optionId === null ? null : parseBreedingOfferOptionIdSyntax(row.optionId)
  const choiceEvidenceId = row.choiceEvidenceId === null ? null : id(row.choiceEvidenceId, `${path}.choiceEvidenceId`)
  if ((row.rollRecordId !== null && !rollRecordId) || (row.optionId !== null && !optionId)) fail('breeding.egg.invalid-id', path, 'contains an invalid roll or option ID.')
  if (row.resolutionKind === 'random' && (!rollRecordId || optionId || choiceEvidenceId)
    || row.resolutionKind === 'rank-choice' && (rollRecordId || !optionId || !choiceEvidenceId)
    || row.resolutionKind === 'fixed' && (rollRecordId || optionId || choiceEvidenceId)) {
    fail('breeding.egg.invalid-invariant', path, 'resolution evidence does not match its kind.')
  }
  return Object.freeze({ valueId, resolutionKind: row.resolutionKind, rollRecordId, optionId, choiceEvidenceId }) as BreedingResolvedValueV1<Value>
}
const pathwayOrder: Record<PokemonEggParentInheritanceSourceV1['pathwayId'], number> = { 'child-egg-move': 0, 'child-machine-compatible': 1 }
const authorityOrder: Record<PokemonEggSourceAuthorityInheritanceSourceV1['authorityKind'], number> = { fossil: 0, gm: 1, 'feature-provider': 2 }
const parseInheritanceSource = (value: unknown, path: string): PokemonEggInheritanceSourceV1 => {
  const row = record(value, path)
  if (row.kind === 'parent') {
    const exactRow = exact(row, ['kind', 'parentIndex', 'parentRef', 'parentSpeciesId', 'pathwayId', 'knownMoveEvidence'], path)
    if ((exactRow.parentIndex !== 0 && exactRow.parentIndex !== 1) || (exactRow.pathwayId !== 'child-egg-move' && exactRow.pathwayId !== 'child-machine-compatible')) fail('breeding.egg.invalid-document', path, 'has an invalid parent index or pathway.')
    const parentSpeciesId = parseBreedingSpeciesIdSyntax(exactRow.parentSpeciesId) ?? fail('breeding.egg.invalid-id', `${path}.parentSpeciesId`, 'must be canonical Species ID syntax.')
    const evidence = array(exactRow.knownMoveEvidence, `${path}.knownMoveEvidence`, 16).map((entry, index) => parseEvidence(entry, `${path}.knownMoveEvidence[${index}]`))
    if (evidence.length < 1) fail('breeding.egg.invalid-invariant', `${path}.knownMoveEvidence`, 'cannot be empty.')
    sortedUnique(evidence.map(entry => entry.evidenceId), `${path}.knownMoveEvidence`)
    return Object.freeze({ kind: 'parent', parentIndex: exactRow.parentIndex as 0 | 1, parentRef: id(exactRow.parentRef, `${path}.parentRef`), parentSpeciesId, pathwayId: exactRow.pathwayId as PokemonEggParentInheritanceSourceV1['pathwayId'], knownMoveEvidence: Object.freeze(evidence) })
  }
  if (row.kind === 'source-authority') {
    const exactRow = exact(row, ['kind', 'authorityKind', 'authorityId', 'evidenceDefinitionSha256'], path)
    if (exactRow.authorityKind !== 'fossil' && exactRow.authorityKind !== 'gm' && exactRow.authorityKind !== 'feature-provider') fail('breeding.egg.invalid-document', `${path}.authorityKind`, 'must be a v1 source-authority kind.')
    return Object.freeze({ kind: 'source-authority', authorityKind: exactRow.authorityKind as PokemonEggSourceAuthorityInheritanceSourceV1['authorityKind'], authorityId: id(exactRow.authorityId, `${path}.authorityId`), evidenceDefinitionSha256: hash(exactRow.evidenceDefinitionSha256, `${path}.evidenceDefinitionSha256`) })
  }
  return fail('breeding.egg.invalid-document', `${path}.kind`, 'must identify parent or source-authority provenance.')
}
export const parsePokemonEggInheritanceCandidateV1 = (value: unknown, path = 'pokemonEggInheritanceCandidate'): PokemonEggInheritanceCandidateV1 => {
  const row = exact(value, ['moveId', 'sources'], path)
  const moveId = parseBreedingMoveIdSyntax(row.moveId) ?? fail('breeding.egg.invalid-id', `${path}.moveId`, 'must be canonical Move ID syntax.')
  const sources = array(row.sources, `${path}.sources`, 4).map((entry, index) => parseInheritanceSource(entry, `${path}.sources[${index}]`))
  if (sources.length < 1) fail('breeding.egg.invalid-invariant', `${path}.sources`, 'cannot be empty.')
  for (let index = 1; index < sources.length; index += 1) {
    const before = sources[index - 1]!
    const after = sources[index]!
    if (before.kind !== after.kind) {
      if (before.kind !== 'parent') fail('breeding.egg.invalid-invariant', `${path}.sources`, 'parent sources must sort before source-authority evidence.')
    }
    else if (before.kind === 'parent' && after.kind === 'parent') {
      if (before.parentIndex > after.parentIndex || (before.parentIndex === after.parentIndex && pathwayOrder[before.pathwayId] >= pathwayOrder[after.pathwayId])) fail('breeding.egg.invalid-invariant', `${path}.sources`, 'must be unique in parent and pathway order.')
    }
    else if (before.kind === 'source-authority' && after.kind === 'source-authority') {
      if (authorityOrder[before.authorityKind] > authorityOrder[after.authorityKind]
        || (before.authorityKind === after.authorityKind && before.authorityId >= after.authorityId)) fail('breeding.egg.invalid-invariant', `${path}.sources`, 'must be unique in source-authority order.')
    }
  }
  return Object.freeze({ moveId, sources: Object.freeze(sources) })
}
const parseBaby = (value: unknown, path: string): PokemonEggBabyTemplateV1 => {
  const row = exact(value, ['applied', 'choiceOptionId', 'choiceEvidenceId', 'effects'], path)
  if (typeof row.applied !== 'boolean') fail('breeding.egg.invalid-document', `${path}.applied`, 'must be boolean.')
  const optionId = row.choiceOptionId === null ? null : parseBreedingOfferOptionIdSyntax(row.choiceOptionId)
  const evidenceId = row.choiceEvidenceId === null ? null : id(row.choiceEvidenceId, `${path}.choiceEvidenceId`)
  if ((row.choiceOptionId !== null && !optionId) || ((optionId === null) !== (evidenceId === null))) fail('breeding.egg.invalid-invariant', path, 'choice option and evidence must be paired.')
  let effects: PokemonEggBabyTemplateEffectsV1 | null = null
  if (row.effects !== null) {
    const effect = exact(row.effects, ['baseStatPenaltyEach', 'skillRankPenalty', 'capabilityPenalty', 'sizePercentOfAdult', 'recoveryBaseStatPointsEachInterval', 'recoveryIntervalLevels', 'recoveryStepCount', 'removeSkillAndCapabilityPenaltyAfterFinalRecovery'], `${path}.effects`)
    const penalty = integer(effect.baseStatPenaltyEach, `${path}.effects.baseStatPenaltyEach`, 2, 5)
    if (effect.skillRankPenalty !== 1 || effect.capabilityPenalty !== 2 || effect.recoveryBaseStatPointsEachInterval !== 1
      || effect.recoveryIntervalLevels !== 5 || effect.recoveryStepCount !== penalty || effect.removeSkillAndCapabilityPenaltyAfterFinalRecovery !== true) {
      fail('breeding.egg.invalid-invariant', `${path}.effects`, 'does not match the reviewed Baby Template.')
    }
    effects = Object.freeze({ baseStatPenaltyEach: penalty, skillRankPenalty: 1, capabilityPenalty: 2, sizePercentOfAdult: integer(effect.sizePercentOfAdult, `${path}.effects.sizePercentOfAdult`, 50, 100), recoveryBaseStatPointsEachInterval: 1, recoveryIntervalLevels: 5, recoveryStepCount: penalty, removeSkillAndCapabilityPenaltyAfterFinalRecovery: true })
  }
  if (row.applied !== (effects !== null)) fail('breeding.egg.invalid-invariant', path, 'applied must exactly match the presence of template effects.')
  return Object.freeze({ applied: row.applied as boolean, choiceOptionId: optionId, choiceEvidenceId: evidenceId, effects })
}
const parseProviderTraits = (value: unknown, path: string): PokemonEggProviderTraitsV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) fail('breeding.egg.invalid-document', path, 'must be a plain data object.')
  const record = value as Record<string, unknown>
  const keys = Object.getOwnPropertyNames(record)
  const baseKeys = ['serpentsMark','fossilRestoration','prehistoricBond'] as const
  const allowed = new Set([...baseKeys, 'marsupial', 'playingGod'])
  if (baseKeys.some(key => !Object.hasOwn(record, key)) || keys.some(key => !allowed.has(key))) {
    fail('breeding.egg.unknown-field', path, 'must contain the declared provider-trait fields only.')
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.egg.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
  }
  const row = record
  let serpentsMark: PokemonEggSerpentsMarkInheritanceV1 | null = null
  if (row.serpentsMark !== null) {
    const mark = exact(row.serpentsMark, ['patternId','selectionKind','sourceParentSheetSlugs','selectionRollRecordId','providerEvidenceDefinitionSha256s'], `${path}.serpentsMark`)
    if (typeof mark.patternId !== 'string' || !POKEMON_EGG_SERPENTS_MARK_PATTERN_IDS.includes(mark.patternId as PokemonEggSerpentsMarkPatternId)
      || (mark.selectionKind !== 'single-parent' && mark.selectionKind !== 'same-parent-pattern' && mark.selectionKind !== 'bounded-coin')) {
      fail('breeding.egg.invalid-document', `${path}.serpentsMark`, 'must identify one reviewed Serpent’s Mark inheritance policy and pattern.')
    }
    const sources = array(mark.sourceParentSheetSlugs, `${path}.serpentsMark.sourceParentSheetSlugs`, 2).map((entry, index) => slug(entry, `${path}.serpentsMark.sourceParentSheetSlugs[${index}]`))
    const hashes = array(mark.providerEvidenceDefinitionSha256s, `${path}.serpentsMark.providerEvidenceDefinitionSha256s`, 2).map((entry, index) => hash(entry, `${path}.serpentsMark.providerEvidenceDefinitionSha256s[${index}]`))
    sortedUnique(sources, `${path}.serpentsMark.sourceParentSheetSlugs`)
    sortedUnique(hashes, `${path}.serpentsMark.providerEvidenceDefinitionSha256s`)
    const selectionRollRecordId = mark.selectionRollRecordId === null ? null : parseBreedingRollRecordIdSyntax(mark.selectionRollRecordId)
    const expectedSources = mark.selectionKind === 'single-parent' ? 1 : 2
    if (sources.length !== expectedSources || hashes.length !== expectedSources
      || (mark.selectionKind === 'bounded-coin') !== (selectionRollRecordId !== null)) {
      fail('breeding.egg.invalid-invariant', `${path}.serpentsMark`, 'source, provider evidence, and coin-roll cardinality must match the inheritance policy.')
    }
    serpentsMark = Object.freeze({ patternId: mark.patternId as PokemonEggSerpentsMarkPatternId, selectionKind: mark.selectionKind as PokemonEggSerpentsMarkInheritanceV1['selectionKind'], sourceParentSheetSlugs: Object.freeze(sources), selectionRollRecordId, providerEvidenceDefinitionSha256s: Object.freeze(hashes) })
  }
  let fossilRestoration: PokemonEggFossilRestorationV1 | null = null
  if (row.fossilRestoration !== null) {
    const restoration = exact(row.fossilRestoration, ['tutorPointDelta','extraAbilityId','extraAbilityTier','sourceTrainerSlug','providerEvidenceDefinitionSha256','providerHandoffDefinitionSha256'], `${path}.fossilRestoration`)
    const extraAbilityId = parseBreedingAbilityIdSyntax(restoration.extraAbilityId)
      ?? fail('breeding.egg.invalid-id', `${path}.fossilRestoration.extraAbilityId`, 'must be a canonical Ability ID.')
    if (restoration.tutorPointDelta !== -2 || (restoration.extraAbilityTier !== 'basic' && restoration.extraAbilityTier !== 'advanced')) {
      fail('breeding.egg.invalid-invariant', `${path}.fossilRestoration`, 'must retain the reviewed Fossil Restoration Tutor Point and Ability policy.')
    }
    fossilRestoration = Object.freeze({
      tutorPointDelta: -2,
      extraAbilityId,
      extraAbilityTier: restoration.extraAbilityTier as PokemonEggFossilRestorationV1['extraAbilityTier'],
      sourceTrainerSlug: slug(restoration.sourceTrainerSlug, `${path}.fossilRestoration.sourceTrainerSlug`),
      providerEvidenceDefinitionSha256: hash(restoration.providerEvidenceDefinitionSha256, `${path}.fossilRestoration.providerEvidenceDefinitionSha256`),
      providerHandoffDefinitionSha256: hash(restoration.providerHandoffDefinitionSha256, `${path}.fossilRestoration.providerHandoffDefinitionSha256`),
    })
  }
  let prehistoricBond: PokemonEggPrehistoricBondV1 | null = null
  if (row.prehistoricBond !== null) {
    const bond = exact(row.prehistoricBond, ['highestBaseStatId','selectionKind','selectionOptionId','choiceEvidenceId','heldItemId','heldItemName','heldItemEffect','heldItemEffectDefinitionSha256','sourceTrainerSlug','providerEvidenceDefinitionSha256','providerHandoffDefinitionSha256'], `${path}.prehistoricBond`)
    if (typeof bond.highestBaseStatId !== 'string' || !POKEMON_EGG_FOSSIL_STAT_IDS.includes(bond.highestBaseStatId as PokemonEggFossilStatId)
      || (bond.selectionKind !== 'unique-highest' && bond.selectionKind !== 'bounded-gm-tie')) {
      fail('breeding.egg.invalid-document', `${path}.prehistoricBond`, 'must identify one reviewed highest-Base-Stat selection.')
    }
    const selectionOptionId = bond.selectionOptionId === null ? null : parseBreedingOfferOptionIdSyntax(bond.selectionOptionId)
    const choiceEvidenceId = bond.choiceEvidenceId === null ? null : id(bond.choiceEvidenceId, `${path}.prehistoricBond.choiceEvidenceId`)
    if ((bond.selectionKind === 'bounded-gm-tie') !== (selectionOptionId !== null && choiceEvidenceId !== null)
      || (bond.selectionKind === 'unique-highest' && (bond.selectionOptionId !== null || bond.choiceEvidenceId !== null))) {
      fail('breeding.egg.invalid-invariant', `${path}.prehistoricBond`, 'bounded ties require exactly one offer option and choice evidence; unique maxima reject both.')
    }
    prehistoricBond = Object.freeze({
      highestBaseStatId: bond.highestBaseStatId as PokemonEggFossilStatId,
      selectionKind: bond.selectionKind as PokemonEggPrehistoricBondV1['selectionKind'],
      selectionOptionId,
      choiceEvidenceId,
      heldItemId: id(bond.heldItemId, `${path}.prehistoricBond.heldItemId`),
      heldItemName: safeText(bond.heldItemName, `${path}.prehistoricBond.heldItemName`, 120),
      heldItemEffect: safeText(bond.heldItemEffect, `${path}.prehistoricBond.heldItemEffect`, 1_000),
      heldItemEffectDefinitionSha256: hash(bond.heldItemEffectDefinitionSha256, `${path}.prehistoricBond.heldItemEffectDefinitionSha256`),
      sourceTrainerSlug: slug(bond.sourceTrainerSlug, `${path}.prehistoricBond.sourceTrainerSlug`),
      providerEvidenceDefinitionSha256: hash(bond.providerEvidenceDefinitionSha256, `${path}.prehistoricBond.providerEvidenceDefinitionSha256`),
      providerHandoffDefinitionSha256: hash(bond.providerHandoffDefinitionSha256, `${path}.prehistoricBond.providerHandoffDefinitionSha256`),
    })
  }
  if (prehistoricBond && !fossilRestoration) fail('breeding.egg.invalid-invariant', `${path}.prehistoricBond`, 'Prehistoric Bond requires frozen Fossil Restoration authority.')
  let marsupial: PokemonEggMarsupialV1 | null | undefined
  if (Object.hasOwn(row, 'marsupial')) {
    if (row.marsupial === null) marsupial = null
    else {
      const provider = exact(row.marsupial, ['providerRecordSha256','providerMechanicFieldsSha256','providerEvidenceDefinitionSha256s','forcedBaseStatPenaltyEach','motherPouchRequired','removalLevel'], `${path}.marsupial`)
      const hashes = array(provider.providerEvidenceDefinitionSha256s, `${path}.marsupial.providerEvidenceDefinitionSha256s`, 8)
        .map((entry, index) => hash(entry, `${path}.marsupial.providerEvidenceDefinitionSha256s[${index}]`))
      sortedUnique(hashes, `${path}.marsupial.providerEvidenceDefinitionSha256s`)
      if (hashes.length < 2 || provider.forcedBaseStatPenaltyEach !== 5 || provider.motherPouchRequired !== true || provider.removalLevel !== 25) {
        fail('breeding.egg.invalid-invariant', `${path}.marsupial`, 'must retain the reviewed forced template, mother-pouch, and Level 25 removal policy.')
      }
      marsupial = Object.freeze({
        providerRecordSha256: hash(provider.providerRecordSha256, `${path}.marsupial.providerRecordSha256`),
        providerMechanicFieldsSha256: hash(provider.providerMechanicFieldsSha256, `${path}.marsupial.providerMechanicFieldsSha256`),
        providerEvidenceDefinitionSha256s: Object.freeze(hashes),
        forcedBaseStatPenaltyEach: 5,
        motherPouchRequired: true,
        removalLevel: 25,
      })
    }
  }
  let playingGod: PokemonEggPlayingGodV1 | null | undefined
  if (Object.hasOwn(row, 'playingGod')) {
    if (row.playingGod === null) playingGod = null
    else {
      const provider = exact(row.playingGod, ['sourceTrainerSlug','sourceTrainerRevision','featureContributionDefinitionSha256','featureHandoffDefinitionSha256','chemistryAuthorityDefinitionSha256','technologyEducationRank','colorationContestStatId','inheritanceMoveIds','baseStatIncreases','upgradeOptionIds'], `${path}.playingGod`)
      const moveIds = array(provider.inheritanceMoveIds, `${path}.playingGod.inheritanceMoveIds`, 3).map((entry, index) => parseBreedingMoveIdSyntax(entry)
        ?? fail('breeding.egg.invalid-id', `${path}.playingGod.inheritanceMoveIds[${index}]`, 'must be a canonical Move ID.'))
      sortedUnique(moveIds, `${path}.playingGod.inheritanceMoveIds`)
      const optionIds = array(provider.upgradeOptionIds, `${path}.playingGod.upgradeOptionIds`, 6).map((entry, index) => parseBreedingOfferOptionIdSyntax(entry)
        ?? fail('breeding.egg.invalid-id', `${path}.playingGod.upgradeOptionIds[${index}]`, 'must be an option ID.'))
      sortedUnique(optionIds, `${path}.playingGod.upgradeOptionIds`)
      const stats = exact(provider.baseStatIncreases, ['hp','atk','def','satk','sdef','spd'], `${path}.playingGod.baseStatIncreases`)
      const baseStatIncreases = Object.freeze({ hp: integer(stats.hp, `${path}.playingGod.baseStatIncreases.hp`, 0, 5), atk: integer(stats.atk, `${path}.playingGod.baseStatIncreases.atk`, 0, 5), def: integer(stats.def, `${path}.playingGod.baseStatIncreases.def`, 0, 5), satk: integer(stats.satk, `${path}.playingGod.baseStatIncreases.satk`, 0, 5), sdef: integer(stats.sdef, `${path}.playingGod.baseStatIncreases.sdef`, 0, 5), spd: integer(stats.spd, `${path}.playingGod.baseStatIncreases.spd`, 0, 5) })
      const coloration = provider.colorationContestStatId === null ? null : typeof provider.colorationContestStatId === 'string' && POKEMON_EGG_PLAYING_GOD_CONTEST_STAT_IDS.includes(provider.colorationContestStatId as PokemonEggPlayingGodContestStatId)
        ? provider.colorationContestStatId as PokemonEggPlayingGodContestStatId
        : fail('breeding.egg.invalid-document', `${path}.playingGod.colorationContestStatId`, 'must be null or one reviewed Contest Stat.')
      const rank = provider.technologyEducationRank === 5 || provider.technologyEducationRank === 6 ? provider.technologyEducationRank : fail('breeding.egg.invalid-invariant', `${path}.playingGod.technologyEducationRank`, 'must be current Expert or Master Technology Education rank.')
      const statCount = Object.values(baseStatIncreases).reduce((sum, value) => sum + value, 0)
      if (optionIds.length !== rank || moveIds.length > 3 || statCount > 5 || (coloration === null ? 0 : 1) + moveIds.length + statCount !== rank) {
        fail('breeding.egg.invalid-invariant', `${path}.playingGod`, 'upgrade provenance must exactly spend the bounded Technology Education rank with reviewed per-kind limits.')
      }
      playingGod = Object.freeze({ sourceTrainerSlug: slug(provider.sourceTrainerSlug, `${path}.playingGod.sourceTrainerSlug`), sourceTrainerRevision: integer(provider.sourceTrainerRevision, `${path}.playingGod.sourceTrainerRevision`), featureContributionDefinitionSha256: hash(provider.featureContributionDefinitionSha256, `${path}.playingGod.featureContributionDefinitionSha256`), featureHandoffDefinitionSha256: hash(provider.featureHandoffDefinitionSha256, `${path}.playingGod.featureHandoffDefinitionSha256`), chemistryAuthorityDefinitionSha256: hash(provider.chemistryAuthorityDefinitionSha256, `${path}.playingGod.chemistryAuthorityDefinitionSha256`), technologyEducationRank: rank, colorationContestStatId: coloration, inheritanceMoveIds: Object.freeze(moveIds), baseStatIncreases, upgradeOptionIds: Object.freeze(optionIds) })
    }
  }
  return Object.freeze({ serpentsMark, fossilRestoration, prehistoricBond, ...(Object.hasOwn(row, 'marsupial') ? { marsupial } : {}), ...(Object.hasOwn(row, 'playingGod') ? { playingGod } : {}) })
}
export const parsePokemonEggOffspringBlueprintV1 = (value: unknown, path = 'pokemonEggOffspringBlueprint'): PokemonEggOffspringBlueprintV1 => {
  const row = exact(value, ['schemaVersion', 'speciesId', 'familyRootSpeciesId', 'speciesSpecDefinitionSha256', 'nature', 'ability', 'gender', 'inheritanceCandidates', 'providerTraits', 'startingLevel', 'babyTemplate', 'definitionSha256'], path)
  if (row.schemaVersion !== 1) fail('breeding.egg.invalid-document', `${path}.schemaVersion`, 'must be 1.')
  const speciesId = parseBreedingSpeciesIdSyntax(row.speciesId) ?? fail('breeding.egg.invalid-id', `${path}.speciesId`, 'must be canonical Species ID syntax.')
  const familyRootSpeciesId = parseBreedingSpeciesIdSyntax(row.familyRootSpeciesId) ?? fail('breeding.egg.invalid-id', `${path}.familyRootSpeciesId`, 'must be canonical Family root Species ID syntax.')
  const candidates = array(row.inheritanceCandidates, `${path}.inheritanceCandidates`, POKEMON_EGG_INHERITANCE_CANDIDATE_MAXIMUM).map((entry, index) => parsePokemonEggInheritanceCandidateV1(entry, `${path}.inheritanceCandidates[${index}]`))
  sortedUnique(candidates.map(entry => entry.moveId), `${path}.inheritanceCandidates`)
  const providerTraits = parseProviderTraits(row.providerTraits, `${path}.providerTraits`)
  const babyTemplate = parseBaby(row.babyTemplate, `${path}.babyTemplate`)
  const marsupial = providerTraits.marsupial ?? null
  if (marsupial) {
    if (speciesId !== 'kangaskhan' || !babyTemplate.applied || babyTemplate.effects?.baseStatPenaltyEach !== 5
      || babyTemplate.choiceOptionId !== null || babyTemplate.choiceEvidenceId !== null) {
      fail('breeding.egg.invalid-invariant', path, 'Marsupial authority requires one Kangaskhan with the forced five-point Baby Template and no campaign choice.')
    }
  }
  else if (babyTemplate.effects?.baseStatPenaltyEach === 5) {
    fail('breeding.egg.invalid-invariant', `${path}.babyTemplate`, 'a five-point Baby Template requires frozen Marsupial authority.')
  }
  if (providerTraits.playingGod) {
    const inherited = candidates.filter(candidate => candidate.sources.some(source => source.kind === 'source-authority' && source.authorityKind === 'feature-provider' && source.authorityId === 'feature.playing-god')).map(candidate => candidate.moveId).sort()
    if (speciesId === 'kangaskhan' || JSON.stringify(inherited) !== JSON.stringify(providerTraits.playingGod.inheritanceMoveIds)) {
      fail('breeding.egg.invalid-invariant', `${path}.providerTraits.playingGod`, 'Playing God Move upgrades must exactly match feature-provider inheritance sources and cannot create Kangaskhan.')
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    speciesId,
    familyRootSpeciesId,
    speciesSpecDefinitionSha256: hash(row.speciesSpecDefinitionSha256, `${path}.speciesSpecDefinitionSha256`),
    nature: parseResolved(row.nature, `${path}.nature`, value => isBreedingCanonicalLocalIdSyntax(value) ? value : null),
    ability: parseResolved(row.ability, `${path}.ability`, parseBreedingAbilityIdSyntax),
    gender: parseResolved(row.gender, `${path}.gender`, value => value === 'female' || value === 'male' || value === 'genderless' ? value : null),
    inheritanceCandidates: Object.freeze(candidates),
    providerTraits,
    startingLevel: integer(row.startingLevel, `${path}.startingLevel`, 1, 100),
    babyTemplate,
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
const parseIncubation = (value: unknown, path: string): PokemonEggIncubationStateV1 => {
  const row = exact(value, ['averageCampaignMinutes', 'targetCampaignMinutes', 'accumulatedCampaignMinutes', 'variationPolicyId', 'durationResultDefinitionSha256', 'lastAppliedClockRevision', 'lastAppliedClockMinute', 'readyAtCampaignMinute', 'readinessKind', 'readyOperationId', 'paused', 'pauseReasonId', 'pauseOperationId'], path)
  const average = integer(row.averageCampaignMinutes, `${path}.averageCampaignMinutes`, 1, 31_536_000)
  const target = integer(row.targetCampaignMinutes, `${path}.targetCampaignMinutes`, 1, 31_536_000)
  const accumulated = integer(row.accumulatedCampaignMinutes, `${path}.accumulatedCampaignMinutes`, 0, target)
  if (row.variationPolicyId !== 'fixed-average' && row.variationPolicyId !== 'server-random-half-to-double' && row.variationPolicyId !== 'gm-within-half-to-double') fail('breeding.egg.invalid-document', `${path}.variationPolicyId`, 'must be a v1 duration policy.')
  const readyAt = nullableInteger(row.readyAtCampaignMinute, `${path}.readyAtCampaignMinute`)
  if (row.readinessKind !== null && row.readinessKind !== 'incubation-complete' && row.readinessKind !== 'gm-mark-ready') fail('breeding.egg.invalid-document', `${path}.readinessKind`, 'must be a v1 readiness kind.')
  const readyOperationId = nullableOperationId(row.readyOperationId, `${path}.readyOperationId`)
  if ((readyAt === null) !== (row.readinessKind === null) || (readyAt === null) !== (readyOperationId === null)) fail('breeding.egg.invalid-invariant', path, 'readiness time, kind, and operation must be paired.')
  if (row.readinessKind === 'incubation-complete' && accumulated !== target) fail('breeding.egg.invalid-invariant', path, 'incubation-complete requires target progress.')
  if (accumulated === target && row.readinessKind === null) fail('breeding.egg.invalid-invariant', path, 'target progress must atomically record readiness.')
  if (typeof row.paused !== 'boolean') fail('breeding.egg.invalid-document', `${path}.paused`, 'must be boolean.')
  const pauseReasonId = row.pauseReasonId === null ? null : id(row.pauseReasonId, `${path}.pauseReasonId`)
  const pauseOperationId = nullableOperationId(row.pauseOperationId, `${path}.pauseOperationId`)
  if (row.paused !== (pauseReasonId !== null && pauseOperationId !== null) || (!row.paused && (pauseReasonId !== null || pauseOperationId !== null))) fail('breeding.egg.invalid-invariant', path, 'pause reason and operation must exist exactly while paused.')
  return Object.freeze({ averageCampaignMinutes: average, targetCampaignMinutes: target, accumulatedCampaignMinutes: accumulated, variationPolicyId: row.variationPolicyId, durationResultDefinitionSha256: hash(row.durationResultDefinitionSha256, `${path}.durationResultDefinitionSha256`), lastAppliedClockRevision: integer(row.lastAppliedClockRevision, `${path}.lastAppliedClockRevision`), lastAppliedClockMinute: integer(row.lastAppliedClockMinute, `${path}.lastAppliedClockMinute`), readyAtCampaignMinute: readyAt, readinessKind: row.readinessKind, readyOperationId, paused: row.paused, pauseReasonId, pauseOperationId }) as PokemonEggIncubationStateV1
}
const TRIGGER_ORDER: Record<PokemonEggSpecialTriggerId, number> = { 'roll-1': 0, 'roll-100': 1, 'provider-force': 2 }
export const parsePokemonEggSpecialStateV1 = (value: unknown, path = 'pokemonEggSpecial'): PokemonEggSpecialStateV1 => {
  const row = exact(value, ['state', 'rollRecordId', 'rollTotal', 'triggerIds', 'adjudicationId', 'outcomeId', 'automaticShiny'], path)
  if (row.state !== 'not-rolled' && row.state !== 'normal' && row.state !== 'pending-adjudication' && row.state !== 'resolved') fail('breeding.egg.invalid-document', `${path}.state`, 'must be a v1 special state.')
  if (row.automaticShiny !== false) fail('breeding.egg.invalid-invariant', `${path}.automaticShiny`, 'must remain false; special never implies Shiny.')
  const rollRecordId = row.rollRecordId === null ? null : parseBreedingRollRecordIdSyntax(row.rollRecordId)
  const rollTotal = nullableInteger(row.rollTotal, `${path}.rollTotal`, 1, 100)
  if ((row.rollRecordId !== null && !rollRecordId) || ((rollRecordId === null) !== (rollTotal === null))) fail('breeding.egg.invalid-invariant', path, 'special roll ID and total must be paired.')
  const triggerIds = array(row.triggerIds, `${path}.triggerIds`, 3).map((entry, index) => {
    if (entry !== 'roll-1' && entry !== 'roll-100' && entry !== 'provider-force') return fail('breeding.egg.invalid-document', `${path}.triggerIds[${index}]`, 'must be a v1 trigger ID.')
    return entry
  })
  for (let index = 1; index < triggerIds.length; index += 1) if (TRIGGER_ORDER[triggerIds[index - 1]!] >= TRIGGER_ORDER[triggerIds[index]!]) fail('breeding.egg.invalid-invariant', `${path}.triggerIds`, 'must be unique in trigger order.')
  if ((rollTotal === 1) !== triggerIds.includes('roll-1') || (rollTotal === 100) !== triggerIds.includes('roll-100')) fail('breeding.egg.invalid-invariant', path, 'roll triggers must match the persisted d100 total.')
  const adjudicationId = row.adjudicationId === null ? null : id(row.adjudicationId, `${path}.adjudicationId`)
  const outcomeId = row.outcomeId === null ? null : id(row.outcomeId, `${path}.outcomeId`)
  if (row.state === 'not-rolled' && (rollRecordId || triggerIds.length || adjudicationId || outcomeId)
    || row.state === 'normal' && (!rollRecordId || triggerIds.length || adjudicationId || outcomeId)
    || row.state === 'pending-adjudication' && (!rollRecordId || triggerIds.length < 1 || adjudicationId || outcomeId)
    || row.state === 'resolved' && (!rollRecordId || triggerIds.length < 1 || !adjudicationId || !outcomeId)) {
    fail('breeding.egg.invalid-invariant', path, 'special state does not match its roll, triggers, and adjudication evidence.')
  }
  return Object.freeze({ state: row.state, rollRecordId, rollTotal, triggerIds: Object.freeze(triggerIds), adjudicationId, outcomeId, automaticShiny: false }) as PokemonEggSpecialStateV1
}
const parseTerminal = (value: unknown, path: string): PokemonEggTerminalV1 | null => {
  if (value === null) return null
  const row = exact(value, ['reasonId', 'atCampaignMinute', 'operationId'], path)
  if (typeof row.reasonId !== 'string' || !TERMINAL_REASON.test(row.reasonId)) fail('breeding.egg.invalid-id', `${path}.reasonId`, 'must be a typed Egg terminal reason.')
  return Object.freeze({ reasonId: row.reasonId as string, atCampaignMinute: integer(row.atCampaignMinute, `${path}.atCampaignMinute`), operationId: operationId(row.operationId, `${path}.operationId`) })
}

const validateStatusInvariants = (egg: PokemonEggDocumentV1): void => {
  const ready = egg.incubation.readinessKind !== null
  if (egg.status === 'incubating' && ready) fail('breeding.egg.invalid-invariant', 'pokemonEgg.status', 'incubating cannot already be ready.')
  if (egg.status !== 'incubating' && egg.incubation.paused) fail('breeding.egg.invalid-invariant', 'pokemonEgg.incubation.paused', 'only an incubating Egg may remain explicitly paused.')
  if (['ready', 'awaiting-special-adjudication', 'hatching', 'hatched'].includes(egg.status) && !ready) fail('breeding.egg.invalid-invariant', 'pokemonEgg.status', 'this status requires readiness.')
  if (egg.status === 'ready' && (egg.special.state !== 'not-rolled' || egg.hatchOperationId || egg.childSheetSlug)) fail('breeding.egg.invalid-invariant', 'pokemonEgg.status', 'ready must precede the special roll and hatch operation.')
  if (egg.status === 'incubating' && (egg.special.state !== 'not-rolled' || egg.hatchOperationId || egg.childSheetSlug)) fail('breeding.egg.invalid-invariant', 'pokemonEgg.status', 'incubating cannot contain hatch state.')
  if (egg.status === 'awaiting-special-adjudication' && (egg.special.state !== 'pending-adjudication' || !egg.hatchOperationId || egg.childSheetSlug)) fail('breeding.egg.invalid-invariant', 'pokemonEgg.status', 'awaiting-special requires one pending roll and hatch operation.')
  if ((egg.status === 'hatching' || egg.status === 'hatched') && (!['normal', 'resolved'].includes(egg.special.state) || !egg.hatchOperationId)) fail('breeding.egg.invalid-invariant', 'pokemonEgg.status', 'hatching requires a terminal special-roll state and hatch operation.')
  if ((egg.status === 'hatched') !== (egg.childSheetSlug !== null)) fail('breeding.egg.invalid-invariant', 'pokemonEgg.childSheetSlug', 'must exist exactly for a hatched Egg.')
  const terminal = (POKEMON_EGG_TERMINAL_NON_HATCH_STATUSES as readonly string[]).includes(egg.status)
  if (terminal !== (egg.terminal !== null)) fail('breeding.egg.invalid-invariant', 'pokemonEgg.terminal', 'must exist exactly for a non-hatch terminal status.')
  if (egg.terminal && egg.terminal.operationId !== egg.lastOperationId) fail('breeding.egg.invalid-invariant', 'pokemonEgg.terminal.operationId', 'must be the operation that wrote the terminal revision.')
  if (egg.terminal && (egg.terminal.atCampaignMinute < egg.createdAtCampaignMinute || egg.terminal.atCampaignMinute > egg.updatedAtCampaignMinute)) fail('breeding.egg.invalid-invariant', 'pokemonEgg.terminal.atCampaignMinute', 'must be within the Egg time range.')
  if (egg.incubation.readyAtCampaignMinute !== null && (egg.incubation.readyAtCampaignMinute < egg.createdAtCampaignMinute || egg.incubation.readyAtCampaignMinute > egg.updatedAtCampaignMinute)) fail('breeding.egg.invalid-invariant', 'pokemonEgg.incubation.readyAtCampaignMinute', 'must be within the Egg time range.')
}

/** Parse, detach, deeply freeze, and enforce every PokemonEggDocument v1 invariant. */
export const parsePokemonEggDocumentV1 = (value: unknown, path = 'pokemonEgg'): PokemonEggDocumentV1 => {
  const row = exact(value, ['schemaVersion', 'eggId', 'revision', 'status', 'ownerTrainerSlug', 'source', 'ruleset', 'definitionHashes', 'parents', 'breeder', 'offspring', 'incubation', 'special', 'hatchOperationId', 'childSheetSlug', 'terminal', 'createdAtCampaignMinute', 'updatedAtCampaignMinute', 'statusChangedAtCampaignMinute', 'lastOperationId'], path)
  if (row.schemaVersion !== 1) fail('breeding.egg.invalid-document', `${path}.schemaVersion`, 'must be schema version 1.')
  const eggId = parsePokemonEggIdSyntax(row.eggId) ?? fail('breeding.egg.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.')
  if (typeof row.status !== 'string' || !STATUS_SET.has(row.status)) fail('breeding.egg.invalid-status', `${path}.status`, 'must be a v1 Egg status.')
  const source = parsePokemonEggSourceV1(row.source, `${path}.source`)
  const parents = array(row.parents, `${path}.parents`, 2).map((entry, index) => parseBreedingParentSnapshotV1(entry, `${path}.parents[${index}]`))
  const breeder = parseBreederSnapshotV1(row.breeder, `${path}.breeder`)
  if (source.kind === 'breeding') {
    if (parents.length !== 2 || parents[0]!.parentIndex !== 0 || parents[1]!.parentIndex !== 1 || !breeder) fail('breeding.egg.invalid-invariant', path, 'breeding source requires ordered two-parent and Breeder snapshots.')
    if (parents[0]!.pokemonSheetSlug === parents[1]!.pokemonSheetSlug) fail('breeding.egg.invalid-invariant', `${path}.parents`, 'must identify two distinct parent sheets.')
    if (!parents[0]!.maturity.eligible || !parents[1]!.maturity.eligible) fail('breeding.egg.invalid-invariant', `${path}.parents`, 'accepted Egg parents must retain positive maturity evidence.')
    if (parents[0]!.roleId === parents[1]!.roleId) fail('breeding.egg.invalid-invariant', `${path}.parents`, 'must retain complementary parent roles.')
  }
  else if (parents.length !== 0 || breeder !== null) fail('breeding.egg.invalid-invariant', path, 'non-breeding sources cannot manufacture parent or Breeder snapshots.')
  const definitionHashes = array(row.definitionHashes, `${path}.definitionHashes`, POKEMON_EGG_DEFINITION_HASH_MAXIMUM).map((entry, index) => hash(entry, `${path}.definitionHashes[${index}]`))
  if (definitionHashes.length < 1) fail('breeding.egg.invalid-invariant', `${path}.definitionHashes`, 'cannot be empty.')
  sortedUnique(definitionHashes, `${path}.definitionHashes`)
  const childSheetSlug = row.childSheetSlug === null ? null : slug(row.childSheetSlug, `${path}.childSheetSlug`)
  const createdAt = integer(row.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`)
  const updatedAt = integer(row.updatedAtCampaignMinute, `${path}.updatedAtCampaignMinute`)
  const statusChangedAt = integer(row.statusChangedAtCampaignMinute, `${path}.statusChangedAtCampaignMinute`)
  if (createdAt > statusChangedAt || statusChangedAt > updatedAt) fail('breeding.egg.invalid-invariant', path, 'created, status-changed, and updated campaign minutes must be monotonic.')
  const egg: PokemonEggDocumentV1 = {
    schemaVersion: 1,
    eggId,
    revision: integer(row.revision, `${path}.revision`, 0, POKEMON_EGG_REVISION_MAXIMUM),
    status: row.status as PokemonEggStatus,
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    source,
    ruleset: parsePokemonEggRulesetReferenceV1(row.ruleset, `${path}.ruleset`),
    definitionHashes: Object.freeze(definitionHashes),
    parents: Object.freeze(parents),
    breeder,
    offspring: parsePokemonEggOffspringBlueprintV1(row.offspring, `${path}.offspring`),
    incubation: parseIncubation(row.incubation, `${path}.incubation`),
    special: parsePokemonEggSpecialStateV1(row.special, `${path}.special`),
    hatchOperationId: nullableOperationId(row.hatchOperationId, `${path}.hatchOperationId`),
    childSheetSlug,
    terminal: parseTerminal(row.terminal, `${path}.terminal`),
    createdAtCampaignMinute: createdAt,
    updatedAtCampaignMinute: updatedAt,
    statusChangedAtCampaignMinute: statusChangedAt,
    lastOperationId: operationId(row.lastOperationId, `${path}.lastOperationId`),
  }
  for (const parent of egg.parents) if (parent.capturedAtCampaignMinute > createdAt) fail('breeding.egg.invalid-invariant', `${path}.parents`, 'parent snapshots cannot postdate Egg acceptance.')
  if (egg.breeder && egg.breeder.capturedAtCampaignMinute > createdAt) fail('breeding.egg.invalid-invariant', `${path}.breeder`, 'Breeder snapshot cannot postdate Egg acceptance.')
  const serpentsMark = egg.offspring.providerTraits.serpentsMark
  if (serpentsMark && (egg.source.kind !== 'breeding'
    || serpentsMark.sourceParentSheetSlugs.some(source => !egg.parents.some(parent => parent.pokemonSheetSlug === source)))) {
    fail('breeding.egg.invalid-invariant', `${path}.offspring.providerTraits.serpentsMark`, 'Serpent’s Mark inheritance sources must be frozen parents of this bred Egg.')
  }
  const fossilRestoration = egg.offspring.providerTraits.fossilRestoration
  const prehistoricBond = egg.offspring.providerTraits.prehistoricBond
  if ((fossilRestoration !== null || prehistoricBond !== null) && egg.source.kind !== 'fossil') {
    fail('breeding.egg.invalid-invariant', `${path}.offspring.providerTraits`, 'Fossil provider traits require one fossil source Egg.')
  }
  if (fossilRestoration && fossilRestoration.extraAbilityId === egg.offspring.ability.valueId) {
    fail('breeding.egg.invalid-invariant', `${path}.offspring.providerTraits.fossilRestoration.extraAbilityId`, 'must differ from the frozen primary Ability.')
  }
  for (const candidate of egg.offspring.inheritanceCandidates) {
    for (const candidateSource of candidate.sources) {
      if (egg.source.kind === 'breeding') {
        if (candidateSource.kind !== 'parent') fail('breeding.egg.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'breeding inheritance must come from a frozen parent.')
        const parentSource = candidateSource as PokemonEggParentInheritanceSourceV1
        const parent = egg.parents[parentSource.parentIndex]
        if (!parent || parentSource.parentRef !== parent.pokemonSheetSlug || parentSource.parentSpeciesId !== parent.speciesId) {
          fail('breeding.egg.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'parent attribution must match the frozen parent snapshots.')
        }
        const knownMove = parent!.effectiveKnownMoves.find(move => move.moveId === candidate.moveId)
        if (!knownMove || JSON.stringify(knownMove.evidence) !== JSON.stringify(parentSource.knownMoveEvidence)) {
          fail('breeding.egg.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'candidate evidence must exactly match the frozen effective known Move snapshot.')
        }
      }
      else {
        if (candidateSource.kind !== 'source-authority') fail('breeding.egg.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'parentless Eggs require typed source-authority inheritance evidence.')
        const authoritySource = candidateSource as PokemonEggSourceAuthorityInheritanceSourceV1
        const expectedKind = egg.source.kind === 'feature-artificial' ? 'feature-provider' : egg.source.kind
        if (authoritySource.authorityKind !== expectedKind) fail('breeding.egg.invalid-invariant', `${path}.offspring.inheritanceCandidates`, 'inheritance authority must match the Egg source kind.')
      }
    }
  }
  validateStatusInvariants(egg)
  return deepFreeze(egg)
}
export const isPokemonEggStatus = (value: unknown): value is PokemonEggStatus => typeof value === 'string' && STATUS_SET.has(value)
export const isPokemonEggSettledStatus = (value: unknown): boolean => typeof value === 'string' && (POKEMON_EGG_SETTLED_STATUSES as readonly string[]).includes(value)
