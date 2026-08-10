import { isSlug } from '../paths'
import {
  parseBreedingCheckRecordIdSyntax,
  parseBreedingConsentIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  parseBreedingSpeciesIdSyntax,
  parsePokemonBreedingOriginIdSyntax,
  parsePokemonEggIdSyntax,
  parsePokemonEggTransferConsentIdSyntax,
  type BreedingCheckRecordId,
  type BreedingConsentId,
  type BreedingOfferOptionId,
  type BreedingOperationId,
  type BreedingProjectId,
  type BreedingSpeciesId,
  type PokemonBreedingOriginId,
  type PokemonEggId,
  type PokemonEggTransferConsentId,
} from './ids'
import { parsePokemonEggRulesetReferenceV1, parsePokemonEggSourceV1, type PokemonEggRulesetReferenceV1, type PokemonEggSourceV1 } from './egg'

export const BREEDING_OPERATION_COMMAND_SCHEMA_VERSION = 1 as const
export const BREEDING_OPERATION_RESULT_SCHEMA_VERSION = 1 as const
export const BREEDING_OPERATION_COMMAND_KINDS = Object.freeze([
  'preview-breeding',
  'create-breeding-project',
  'grant-breeding-consent',
  'revoke-breeding-consent',
  'advance-breeding-project-time',
  'resolve-breeding-check',
  'produce-egg',
  'cancel-breeding-project',
  'create-source-egg',
  'transfer-egg',
  'settle-egg-transfer-consent',
  'advance-egg-incubation',
  'set-egg-incubation-pause',
  'apply-egg-warmer-capability',
  'mark-egg-ready',
  'begin-hatch',
  'resolve-hatch-special',
  'complete-hatch',
  'cancel-egg',
  'advance-campaign-clock',
  'record-inheritance-learning',
  'recover-breeding-operation',
] as const)
export type BreedingOperationCommandKind = typeof BREEDING_OPERATION_COMMAND_KINDS[number]
export const BREEDING_OPERATION_SCOPE_KINDS = Object.freeze([
  'campaign-clock', 'breeding-project', 'pokemon-egg', 'parent-consent', 'trainer-sheet', 'pokemon-sheet',
  'pokemon-sheet-allocation', 'species-acquisition', 'breeding-operation', 'egg-transfer-consent',
] as const)
export const BREEDING_ROLL_REQUEST_KINDS = Object.freeze(['offspring-family', 'nature', 'ability', 'gender', 'hatch-duration', 'provider'] as const)
export type BreedingRollRequestKind = typeof BREEDING_ROLL_REQUEST_KINDS[number]
export const BREEDING_CONSENT_SCOPES = Object.freeze(['project-participation', 'own-parent-safe-summary', 'own-parent-contribution-attribution'] as const)
export type BreedingConsentScope = typeof BREEDING_CONSENT_SCOPES[number]
export const BREEDING_TRAINER_SHEET_SCOPE_FIELDS = Object.freeze(['breeding-control', 'experience', 'inventory', 'money', 'roster'] as const)
export const BREEDING_POKEMON_SHEET_SCOPE_FIELDS = Object.freeze(['baby-template', 'lineage', 'marsupial-pouch', 'moves', 'parent-snapshot'] as const)
export type BreedingTrainerSheetScopeField = typeof BREEDING_TRAINER_SHEET_SCOPE_FIELDS[number]
export type BreedingPokemonSheetScopeField = typeof BREEDING_POKEMON_SHEET_SCOPE_FIELDS[number]

export interface BreedingCampaignClockScopeV1 { readonly kind: 'campaign-clock', readonly expectedRevision: number }
export interface BreedingProjectScopeV1 { readonly kind: 'breeding-project', readonly projectId: BreedingProjectId, readonly expectedRevision: number | null }
export interface PokemonEggScopeV1 { readonly kind: 'pokemon-egg', readonly eggId: PokemonEggId, readonly expectedRevision: number | null }
export interface BreedingConsentScopeV1 { readonly kind: 'parent-consent', readonly consentId: BreedingConsentId, readonly expectedRevision: number | null }
export interface BreedingTrainerSheetScopeV1 { readonly kind: 'trainer-sheet', readonly sheetSlug: string, readonly expectedRevision: number, readonly fields: readonly BreedingTrainerSheetScopeField[] }
export interface BreedingPokemonSheetScopeV1 { readonly kind: 'pokemon-sheet', readonly sheetSlug: string, readonly expectedRevision: number, readonly fields: readonly BreedingPokemonSheetScopeField[] }
export interface PokemonSheetAllocationScopeV1 { readonly kind: 'pokemon-sheet-allocation', readonly namespace: 'pokemon' }
export interface BreedingSpeciesAcquisitionScopeV1 { readonly kind: 'species-acquisition', readonly trainerSheetSlug: string, readonly speciesId: BreedingSpeciesId }
export interface BreedingOperationScopeV1 { readonly kind: 'breeding-operation', readonly targetOperationId: BreedingOperationId }
export interface PokemonEggTransferConsentScopeV1 { readonly kind: 'egg-transfer-consent', readonly consentId: PokemonEggTransferConsentId, readonly expectedRevision: number }
export type BreedingConflictScopeV1 =
  | BreedingCampaignClockScopeV1
  | BreedingProjectScopeV1
  | PokemonEggScopeV1
  | BreedingConsentScopeV1
  | BreedingTrainerSheetScopeV1
  | BreedingPokemonSheetScopeV1
  | PokemonSheetAllocationScopeV1
  | BreedingSpeciesAcquisitionScopeV1
  | BreedingOperationScopeV1
  | PokemonEggTransferConsentScopeV1

export interface BreedingCommandActorV1 { readonly profileId: string, readonly selectedTrainerSlug: string | null }
export interface BreedingParentCommandRefV1 { readonly pokemonSheetSlug: string, readonly expectedSheetRevision: number }
export interface BreedingHatchDestinationV1 { readonly kind: 'box' | 'team', readonly trainerSheetSlug: string }
export interface BreedingOfferResolutionRequestV1 {
  readonly selectedOptionIds: readonly BreedingOfferOptionId[]
  readonly requestedRollKinds: readonly BreedingRollRequestKind[]
}
export interface PreviewBreedingPayloadV1 { readonly ownerTrainerSlug: string, readonly breederTrainerSlug: string, readonly parentRefs: readonly [BreedingParentCommandRefV1, BreedingParentCommandRefV1], readonly optionSnapshotDefinitionSha256: string }
export interface CreateBreedingProjectPayloadV1 extends PreviewBreedingPayloadV1 { readonly projectId: BreedingProjectId, readonly consentPolicy: 'same-owner-control' | 'cross-owner-current-revision-consent' }
export interface GrantBreedingConsentPayloadV1 { readonly projectId: BreedingProjectId, readonly consentId: BreedingConsentId, readonly parentSheetSlug: string, readonly parentSheetRevision: number, readonly consentScopes: readonly BreedingConsentScope[], readonly expiresAtCampaignMinute: number | null }
export interface RevokeBreedingConsentPayloadV1 { readonly projectId: BreedingProjectId, readonly consentId: BreedingConsentId, readonly reasonId: string }
export interface AdvanceBreedingProjectTimePayloadV1 { readonly projectId: BreedingProjectId, readonly throughClockRevision: number, readonly throughCampaignMinute: number }
export interface ResolveBreedingCheckPayloadV1 { readonly projectId: BreedingProjectId, readonly checkRecordId: BreedingCheckRecordId }
export interface ProduceEggPayloadV1 { readonly projectId: BreedingProjectId, readonly eggId: PokemonEggId, readonly resolutions: BreedingOfferResolutionRequestV1 }
export interface CancelBreedingProjectPayloadV1 { readonly projectId: BreedingProjectId, readonly reasonId: string }
export interface CreateSourceEggPayloadV1 { readonly eggId: PokemonEggId, readonly ownerTrainerSlug: string, readonly source: Exclude<PokemonEggSourceV1, { readonly kind: 'breeding' }>, readonly speciesOptionId: BreedingOfferOptionId, readonly resolutions: BreedingOfferResolutionRequestV1 }
export interface TransferEggPayloadV1 { readonly eggId: PokemonEggId, readonly destinationTrainerSlug: string, readonly consentEvidenceIds: readonly [PokemonEggTransferConsentId, PokemonEggTransferConsentId] }
export interface SettleEggTransferConsentPayloadV1 { readonly consentId: PokemonEggTransferConsentId, readonly reasonId: 'breeding.egg-transfer-consent.revoked' | 'breeding.egg-transfer-consent.expired' }
export interface AdvanceEggIncubationPayloadV1 { readonly eggId: PokemonEggId, readonly throughClockRevision: number, readonly throughCampaignMinute: number }
export interface SetEggIncubationPausePayloadV1 { readonly eggId: PokemonEggId, readonly paused: boolean, readonly reasonId: string | null }
export interface ApplyEggWarmerCapabilityPayloadV1 { readonly eggId: PokemonEggId, readonly sourcePokemonSheetSlug: string, readonly expectedSourcePokemonSheetRevision: number, readonly requestReductionRoll: true }
export interface MarkEggReadyPayloadV1 { readonly eggId: PokemonEggId, readonly reasonId: string }
export interface BeginHatchPayloadV1 { readonly eggId: PokemonEggId, readonly destination: BreedingHatchDestinationV1, readonly requestSpecialRoll: true }
export interface ResolveHatchSpecialPayloadV1 { readonly eggId: PokemonEggId, readonly adjudicationOptionId: BreedingOfferOptionId }
export interface CompleteHatchPayloadV1 { readonly eggId: PokemonEggId, readonly originId: PokemonBreedingOriginId, readonly destination: BreedingHatchDestinationV1 }
export interface CancelEggPayloadV1 { readonly eggId: PokemonEggId, readonly reasonId: string }
export interface AdvanceCampaignClockPayloadV1 { readonly targetCampaignMinute: number }
export interface RecordInheritanceLearningPayloadV1 { readonly originId: PokemonBreedingOriginId, readonly eggId: PokemonEggId, readonly childSheetSlug: string, readonly checkpointLevels: readonly number[], readonly selectedOptionIds: readonly BreedingOfferOptionId[] }
export interface RecoverBreedingOperationPayloadV1 { readonly targetOperationId: BreedingOperationId, readonly action: 'inspect' | 'resume' | 'abandon' | 'retry-publication', readonly reasonId: string }
export interface BreedingCommandPayloadByKind {
  readonly 'preview-breeding': PreviewBreedingPayloadV1
  readonly 'create-breeding-project': CreateBreedingProjectPayloadV1
  readonly 'grant-breeding-consent': GrantBreedingConsentPayloadV1
  readonly 'revoke-breeding-consent': RevokeBreedingConsentPayloadV1
  readonly 'advance-breeding-project-time': AdvanceBreedingProjectTimePayloadV1
  readonly 'resolve-breeding-check': ResolveBreedingCheckPayloadV1
  readonly 'produce-egg': ProduceEggPayloadV1
  readonly 'cancel-breeding-project': CancelBreedingProjectPayloadV1
  readonly 'create-source-egg': CreateSourceEggPayloadV1
  readonly 'transfer-egg': TransferEggPayloadV1
  readonly 'settle-egg-transfer-consent': SettleEggTransferConsentPayloadV1
  readonly 'advance-egg-incubation': AdvanceEggIncubationPayloadV1
  readonly 'set-egg-incubation-pause': SetEggIncubationPausePayloadV1
  readonly 'apply-egg-warmer-capability': ApplyEggWarmerCapabilityPayloadV1
  readonly 'mark-egg-ready': MarkEggReadyPayloadV1
  readonly 'begin-hatch': BeginHatchPayloadV1
  readonly 'resolve-hatch-special': ResolveHatchSpecialPayloadV1
  readonly 'complete-hatch': CompleteHatchPayloadV1
  readonly 'cancel-egg': CancelEggPayloadV1
  readonly 'advance-campaign-clock': AdvanceCampaignClockPayloadV1
  readonly 'record-inheritance-learning': RecordInheritanceLearningPayloadV1
  readonly 'recover-breeding-operation': RecoverBreedingOperationPayloadV1
}
export type BreedingOperationCommandV1 = {
  readonly [Kind in BreedingOperationCommandKind]: {
    readonly schemaVersion: 1
    readonly operationId: BreedingOperationId
    readonly commandKind: Kind
    readonly actor: BreedingCommandActorV1
    readonly ruleset: PokemonEggRulesetReferenceV1
    readonly scopes: readonly BreedingConflictScopeV1[]
    readonly payload: BreedingCommandPayloadByKind[Kind]
  }
}[BreedingOperationCommandKind]

export const BREEDING_OPERATION_OUTCOME_KINDS = Object.freeze([
  'previewed', 'project-created', 'consent-granted', 'consent-revoked', 'project-progressed', 'check-resolved',
  'egg-produced', 'project-cancelled', 'source-egg-created', 'egg-transferred', 'egg-transfer-consent-settled', 'egg-progressed', 'egg-pause-set',
  'egg-warmer-applied', 'egg-ready', 'hatch-started', 'hatch-special-resolved', 'hatched', 'egg-cancelled', 'clock-advanced',
  'inheritance-recorded', 'operation-recovered',
] as const)
export type BreedingOperationOutcomeKind = typeof BREEDING_OPERATION_OUTCOME_KINDS[number]
export const BREEDING_OPERATION_REJECTION_REASON_IDS = Object.freeze([
  'breeding.operation.invalid', 'breeding.operation.unauthorized', 'breeding.operation.not-found',
  'breeding.operation.stale-revision', 'breeding.operation.conflict', 'breeding.operation.unavailable',
  'breeding.operation.choice-required', 'breeding.operation.adjudication-required', 'breeding.operation.abandoned',
  'breeding.operation.internal-failure',
] as const)
export type BreedingOperationRejectionReasonId = typeof BREEDING_OPERATION_REJECTION_REASON_IDS[number]
export const BREEDING_OPERATION_AGGREGATE_KINDS = Object.freeze(['breeding-project', 'pokemon-egg', 'trainer-sheet', 'pokemon-sheet', 'campaign-clock', 'parent-consent', 'egg-transfer-consent'] as const)
export type BreedingOperationAggregateKind = typeof BREEDING_OPERATION_AGGREGATE_KINDS[number]
export interface BreedingOperationAggregateRefV1 { readonly kind: BreedingOperationAggregateKind, readonly id: string, readonly revision: number }
export interface BreedingOperationAcceptedV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly commandHash: string
  readonly commandKind: BreedingOperationCommandKind
  readonly ok: true
  readonly outcomeKind: BreedingOperationOutcomeKind
  readonly aggregateRefs: readonly BreedingOperationAggregateRefV1[]
  readonly changedScopes: readonly BreedingConflictScopeV1[]
  readonly receiptDefinitionSha256: string
  readonly committedAtCampaignMinute: number | null
  readonly resultDefinitionSha256: string
}
export interface BreedingOperationRejectedV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly commandHash: string
  readonly commandKind: BreedingOperationCommandKind
  readonly ok: false
  readonly reasonId: BreedingOperationRejectionReasonId
  readonly currentAggregateRefs: readonly BreedingOperationAggregateRefV1[]
  readonly conflictingScopes: readonly BreedingConflictScopeV1[]
  readonly retryable: boolean
  readonly resultDefinitionSha256: string
}
export type BreedingOperationResultV1 = BreedingOperationAcceptedV1 | BreedingOperationRejectedV1

export type BreedingOperationContractValidationCode =
  | 'breeding.operation.invalid-document'
  | 'breeding.operation.unknown-field'
  | 'breeding.operation.invalid-id'
  | 'breeding.operation.invalid-scope'
  | 'breeding.operation.invalid-invariant'
export class BreedingOperationContractValidationError extends Error {
  readonly code: BreedingOperationContractValidationCode
  readonly path: string
  constructor(code: BreedingOperationContractValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingOperationContractValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const TYPED_REASON = /^breeding\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const KIND_SET = new Set<string>(BREEDING_OPERATION_COMMAND_KINDS)
const OUTCOME_SET = new Set<string>(BREEDING_OPERATION_OUTCOME_KINDS)
const REJECTION_SET = new Set<string>(BREEDING_OPERATION_REJECTION_REASON_IDS)
const AGGREGATE_SET = new Set<string>(BREEDING_OPERATION_AGGREGATE_KINDS)
const CHECKPOINT_SET = new Set<number>([20, 30, 40, 50, 60, 70, 80, 90, 100])
const fail = (code: BreedingOperationContractValidationCode, path: string, message: string): never => { throw new BreedingOperationContractValidationError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.operation.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.operation.invalid-document', path, 'must be a plain data object without symbols.')
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.operation.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path); const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail('breeding.operation.unknown-field', path, 'must contain exactly the declared fields.')
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.operation.invalid-document', path, `must be an array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.operation.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
  }
  if (Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail('breeding.operation.unknown-field', path, 'cannot contain enriched fields.')
  return value
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail('breeding.operation.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  return value as number
}
const nullableInteger = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.operation.invalid-document', path, 'must be a lowercase SHA-256 value.')
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value) ? value : fail('breeding.operation.invalid-id', path, 'must be a bounded stable identifier.')
const reason = (value: unknown, path: string): string => typeof value === 'string' && value.length <= 160 && TYPED_REASON.test(value) ? value : fail('breeding.operation.invalid-id', path, 'must be a typed breeding reason ID.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160 ? value : fail('breeding.operation.invalid-id', path, 'must be a canonical sheet slug.')
const operationId = (value: unknown, path: string): BreedingOperationId => parseBreedingOperationIdSyntax(value) ?? fail('breeding.operation.invalid-id', path, 'must be a breeding operation ID.')
const projectId = (value: unknown, path: string): BreedingProjectId => parseBreedingProjectIdSyntax(value) ?? fail('breeding.operation.invalid-id', path, 'must be a breeding project ID.')
const eggId = (value: unknown, path: string): PokemonEggId => parsePokemonEggIdSyntax(value) ?? fail('breeding.operation.invalid-id', path, 'must be a Pokémon Egg ID.')
const consentId = (value: unknown, path: string): BreedingConsentId => parseBreedingConsentIdSyntax(value) ?? fail('breeding.operation.invalid-id', path, 'must be a breeding consent ID.')
const transferConsentId = (value: unknown, path: string): PokemonEggTransferConsentId => parsePokemonEggTransferConsentIdSyntax(value) ?? fail('breeding.operation.invalid-id', path, 'must be an Egg-transfer consent ID.')
const optionId = (value: unknown, path: string): BreedingOfferOptionId => parseBreedingOfferOptionIdSyntax(value) ?? fail('breeding.operation.invalid-id', path, 'must be a server-issued offer option ID.')
const originId = (value: unknown, path: string): PokemonBreedingOriginId => parsePokemonBreedingOriginIdSyntax(value) ?? fail('breeding.operation.invalid-id', path, 'must be a breeding origin ID.')
const sortedUniqueStrings = <Value extends string>(values: readonly Value[], path: string): readonly Value[] => {
  for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) fail('breeding.operation.invalid-invariant', path, 'must be unique in strict code-point order.')
  return Object.freeze([...values])
}
const parseFields = <Value extends string>(value: unknown, allowedValues: readonly Value[], path: string): readonly Value[] => {
  const allowed = new Set<string>(allowedValues)
  const values = array(value, path, allowedValues.length).map((entry, index) => typeof entry === 'string' && allowed.has(entry) ? entry as Value : fail('breeding.operation.invalid-scope', `${path}[${index}]`, 'is not an allowed scope field.'))
  if (values.length < 1) fail('breeding.operation.invalid-scope', path, 'cannot be empty.')
  return sortedUniqueStrings(values, path)
}
export const breedingConflictScopeKey = (scope: BreedingConflictScopeV1): string => {
  if (scope.kind === 'campaign-clock') return '0:campaign-clock'
  if (scope.kind === 'breeding-project') return `1:${scope.projectId}`
  if (scope.kind === 'pokemon-egg') return `2:${scope.eggId}`
  if (scope.kind === 'parent-consent') return `3:${scope.consentId}`
  if (scope.kind === 'trainer-sheet') return `4:${scope.sheetSlug}`
  if (scope.kind === 'pokemon-sheet') return `5:${scope.sheetSlug}`
  if (scope.kind === 'pokemon-sheet-allocation') return '6:pokemon'
  if (scope.kind === 'species-acquisition') return `7:${scope.trainerSheetSlug}:${scope.speciesId}`
  if (scope.kind === 'breeding-operation') return `8:${scope.targetOperationId}`
  return `9:${scope.consentId}`
}
export const parseBreedingConflictScopeV1 = (value: unknown, path = 'scope'): BreedingConflictScopeV1 => {
  const row = record(value, path)
  if (row.kind === 'campaign-clock') { const x = exact(row, ['kind', 'expectedRevision'], path); return Object.freeze({ kind: 'campaign-clock', expectedRevision: integer(x.expectedRevision, `${path}.expectedRevision`) }) }
  if (row.kind === 'breeding-project') { const x = exact(row, ['kind', 'projectId', 'expectedRevision'], path); return Object.freeze({ kind: 'breeding-project', projectId: projectId(x.projectId, `${path}.projectId`), expectedRevision: nullableInteger(x.expectedRevision, `${path}.expectedRevision`) }) }
  if (row.kind === 'pokemon-egg') { const x = exact(row, ['kind', 'eggId', 'expectedRevision'], path); return Object.freeze({ kind: 'pokemon-egg', eggId: eggId(x.eggId, `${path}.eggId`), expectedRevision: nullableInteger(x.expectedRevision, `${path}.expectedRevision`) }) }
  if (row.kind === 'parent-consent') { const x = exact(row, ['kind', 'consentId', 'expectedRevision'], path); return Object.freeze({ kind: 'parent-consent', consentId: consentId(x.consentId, `${path}.consentId`), expectedRevision: nullableInteger(x.expectedRevision, `${path}.expectedRevision`) }) }
  if (row.kind === 'trainer-sheet') { const x = exact(row, ['kind', 'sheetSlug', 'expectedRevision', 'fields'], path); return Object.freeze({ kind: 'trainer-sheet', sheetSlug: slug(x.sheetSlug, `${path}.sheetSlug`), expectedRevision: integer(x.expectedRevision, `${path}.expectedRevision`), fields: parseFields(x.fields, BREEDING_TRAINER_SHEET_SCOPE_FIELDS, `${path}.fields`) }) }
  if (row.kind === 'pokemon-sheet') { const x = exact(row, ['kind', 'sheetSlug', 'expectedRevision', 'fields'], path); return Object.freeze({ kind: 'pokemon-sheet', sheetSlug: slug(x.sheetSlug, `${path}.sheetSlug`), expectedRevision: integer(x.expectedRevision, `${path}.expectedRevision`), fields: parseFields(x.fields, BREEDING_POKEMON_SHEET_SCOPE_FIELDS, `${path}.fields`) }) }
  if (row.kind === 'pokemon-sheet-allocation') { const x = exact(row, ['kind', 'namespace'], path); if (x.namespace !== 'pokemon') fail('breeding.operation.invalid-scope', `${path}.namespace`, 'must be pokemon.'); return Object.freeze({ kind: 'pokemon-sheet-allocation', namespace: 'pokemon' }) }
  if (row.kind === 'species-acquisition') { const x = exact(row, ['kind', 'trainerSheetSlug', 'speciesId'], path); return Object.freeze({ kind: 'species-acquisition', trainerSheetSlug: slug(x.trainerSheetSlug, `${path}.trainerSheetSlug`), speciesId: parseBreedingSpeciesIdSyntax(x.speciesId) ?? fail('breeding.operation.invalid-id', `${path}.speciesId`, 'must be canonical Species ID syntax.') }) }
  if (row.kind === 'breeding-operation') { const x = exact(row, ['kind', 'targetOperationId'], path); return Object.freeze({ kind: 'breeding-operation', targetOperationId: operationId(x.targetOperationId, `${path}.targetOperationId`) }) }
  if (row.kind === 'egg-transfer-consent') { const x = exact(row, ['kind', 'consentId', 'expectedRevision'], path); return Object.freeze({ kind: 'egg-transfer-consent', consentId: transferConsentId(x.consentId, `${path}.consentId`), expectedRevision: integer(x.expectedRevision, `${path}.expectedRevision`, 0, 1) }) }
  return fail('breeding.operation.invalid-scope', `${path}.kind`, 'must be a v1 breeding scope kind.')
}
const parseScopes = (value: unknown, path: string): readonly BreedingConflictScopeV1[] => {
  const scopes = array(value, path, 128).map((entry, index) => parseBreedingConflictScopeV1(entry, `${path}[${index}]`))
  const keys = scopes.map(breedingConflictScopeKey)
  sortedUniqueStrings(keys, path)
  return Object.freeze(scopes)
}
const parseRuleset = (value: unknown, path: string): PokemonEggRulesetReferenceV1 => {
  try { return parsePokemonEggRulesetReferenceV1(value, path) }
  catch { return fail('breeding.operation.invalid-document', path, 'must be a strict breeding ruleset reference.') }
}
const parseSource = (value: unknown, path: string): PokemonEggSourceV1 => {
  try { return parsePokemonEggSourceV1(value, path) }
  catch { return fail('breeding.operation.invalid-document', path, 'must be a strict Egg source.') }
}
const parseActor = (value: unknown, path: string): BreedingCommandActorV1 => {
  const row = exact(value, ['profileId', 'selectedTrainerSlug'], path)
  return Object.freeze({ profileId: identifier(row.profileId, `${path}.profileId`), selectedTrainerSlug: row.selectedTrainerSlug === null ? null : slug(row.selectedTrainerSlug, `${path}.selectedTrainerSlug`) })
}
const parseParentRefs = (value: unknown, path: string): readonly [BreedingParentCommandRefV1, BreedingParentCommandRefV1] => {
  const rows = array(value, path, 2)
  if (rows.length !== 2) fail('breeding.operation.invalid-invariant', path, 'must contain exactly two parent references.')
  const parsed = rows.map((entry, index) => { const row = exact(entry, ['pokemonSheetSlug', 'expectedSheetRevision'], `${path}[${index}]`); return Object.freeze({ pokemonSheetSlug: slug(row.pokemonSheetSlug, `${path}[${index}].pokemonSheetSlug`), expectedSheetRevision: integer(row.expectedSheetRevision, `${path}[${index}].expectedSheetRevision`) }) })
  if (parsed[0]!.pokemonSheetSlug === parsed[1]!.pokemonSheetSlug) fail('breeding.operation.invalid-invariant', path, 'must identify distinct parent sheets.')
  return Object.freeze(parsed) as readonly [BreedingParentCommandRefV1, BreedingParentCommandRefV1]
}
const parseDestination = (value: unknown, path: string): BreedingHatchDestinationV1 => { const row = exact(value, ['kind', 'trainerSheetSlug'], path); if (row.kind !== 'box' && row.kind !== 'team') fail('breeding.operation.invalid-document', `${path}.kind`, 'must be box or team.'); return Object.freeze({ kind: row.kind, trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`) }) as BreedingHatchDestinationV1 }
const parseResolutions = (value: unknown, path: string): BreedingOfferResolutionRequestV1 => {
  const row = exact(value, ['selectedOptionIds', 'requestedRollKinds'], path)
  const options = array(row.selectedOptionIds, `${path}.selectedOptionIds`, 32).map((entry, index) => optionId(entry, `${path}.selectedOptionIds[${index}]`))
  sortedUniqueStrings(options, `${path}.selectedOptionIds`)
  const rolls = array(row.requestedRollKinds, `${path}.requestedRollKinds`, BREEDING_ROLL_REQUEST_KINDS.length).map((entry, index) => typeof entry === 'string' && (BREEDING_ROLL_REQUEST_KINDS as readonly string[]).includes(entry) ? entry as BreedingRollRequestKind : fail('breeding.operation.invalid-document', `${path}.requestedRollKinds[${index}]`, 'must be a v1 roll request kind.'))
  for (let index = 1; index < rolls.length; index += 1) if (BREEDING_ROLL_REQUEST_KINDS.indexOf(rolls[index - 1]!) >= BREEDING_ROLL_REQUEST_KINDS.indexOf(rolls[index]!)) fail('breeding.operation.invalid-invariant', `${path}.requestedRollKinds`, 'must be unique in declared order.')
  return Object.freeze({ selectedOptionIds: Object.freeze(options), requestedRollKinds: Object.freeze(rolls) })
}
const parseOptionList = (value: unknown, path: string, maximum: number): readonly BreedingOfferOptionId[] => sortedUniqueStrings(array(value, path, maximum).map((entry, index) => optionId(entry, `${path}[${index}]`)), path)
const parseProjectPayload = (value: unknown, path: string, create: boolean): PreviewBreedingPayloadV1 | CreateBreedingProjectPayloadV1 => {
  const fields = create ? ['projectId', 'ownerTrainerSlug', 'breederTrainerSlug', 'parentRefs', 'optionSnapshotDefinitionSha256', 'consentPolicy'] : ['ownerTrainerSlug', 'breederTrainerSlug', 'parentRefs', 'optionSnapshotDefinitionSha256']
  const row = exact(value, fields, path)
  const common = { ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`), breederTrainerSlug: slug(row.breederTrainerSlug, `${path}.breederTrainerSlug`), parentRefs: parseParentRefs(row.parentRefs, `${path}.parentRefs`), optionSnapshotDefinitionSha256: hash(row.optionSnapshotDefinitionSha256, `${path}.optionSnapshotDefinitionSha256`) }
  if (!create) return Object.freeze(common)
  if (row.consentPolicy !== 'same-owner-control' && row.consentPolicy !== 'cross-owner-current-revision-consent') fail('breeding.operation.invalid-document', `${path}.consentPolicy`, 'must be a v1 consent policy.')
  return Object.freeze({ projectId: projectId(row.projectId, `${path}.projectId`), ...common, consentPolicy: row.consentPolicy }) as CreateBreedingProjectPayloadV1
}
const parsePayload = (kind: BreedingOperationCommandKind, value: unknown, path: string): BreedingCommandPayloadByKind[BreedingOperationCommandKind] => {
  if (kind === 'preview-breeding') return parseProjectPayload(value, path, false) as PreviewBreedingPayloadV1
  if (kind === 'create-breeding-project') return parseProjectPayload(value, path, true) as CreateBreedingProjectPayloadV1
  const row = record(value, path)
  if (kind === 'grant-breeding-consent') { const x = exact(row, ['projectId', 'consentId', 'parentSheetSlug', 'parentSheetRevision', 'consentScopes', 'expiresAtCampaignMinute'], path); const scopes = parseFields(x.consentScopes, BREEDING_CONSENT_SCOPES, `${path}.consentScopes`); return Object.freeze({ projectId: projectId(x.projectId, `${path}.projectId`), consentId: consentId(x.consentId, `${path}.consentId`), parentSheetSlug: slug(x.parentSheetSlug, `${path}.parentSheetSlug`), parentSheetRevision: integer(x.parentSheetRevision, `${path}.parentSheetRevision`), consentScopes: scopes, expiresAtCampaignMinute: nullableInteger(x.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`) }) }
  if (kind === 'revoke-breeding-consent') { const x = exact(row, ['projectId', 'consentId', 'reasonId'], path); return Object.freeze({ projectId: projectId(x.projectId, `${path}.projectId`), consentId: consentId(x.consentId, `${path}.consentId`), reasonId: reason(x.reasonId, `${path}.reasonId`) }) }
  if (kind === 'advance-breeding-project-time') { const x = exact(row, ['projectId', 'throughClockRevision', 'throughCampaignMinute'], path); return Object.freeze({ projectId: projectId(x.projectId, `${path}.projectId`), throughClockRevision: integer(x.throughClockRevision, `${path}.throughClockRevision`), throughCampaignMinute: integer(x.throughCampaignMinute, `${path}.throughCampaignMinute`) }) }
  if (kind === 'resolve-breeding-check') { const x = exact(row, ['projectId', 'checkRecordId'], path); return Object.freeze({ projectId: projectId(x.projectId, `${path}.projectId`), checkRecordId: parseBreedingCheckRecordIdSyntax(x.checkRecordId) ?? fail('breeding.operation.invalid-id', `${path}.checkRecordId`, 'must be a breeding check record ID.') }) }
  if (kind === 'produce-egg') { const x = exact(row, ['projectId', 'eggId', 'resolutions'], path); return Object.freeze({ projectId: projectId(x.projectId, `${path}.projectId`), eggId: eggId(x.eggId, `${path}.eggId`), resolutions: parseResolutions(x.resolutions, `${path}.resolutions`) }) }
  if (kind === 'cancel-breeding-project') { const x = exact(row, ['projectId', 'reasonId'], path); return Object.freeze({ projectId: projectId(x.projectId, `${path}.projectId`), reasonId: reason(x.reasonId, `${path}.reasonId`) }) }
  if (kind === 'create-source-egg') { const x = exact(row, ['eggId', 'ownerTrainerSlug', 'source', 'speciesOptionId', 'resolutions'], path); const source = parseSource(x.source, `${path}.source`); if (source.kind === 'breeding') fail('breeding.operation.invalid-invariant', `${path}.source`, 'must be a parentless Egg source.'); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), ownerTrainerSlug: slug(x.ownerTrainerSlug, `${path}.ownerTrainerSlug`), source, speciesOptionId: optionId(x.speciesOptionId, `${path}.speciesOptionId`), resolutions: parseResolutions(x.resolutions, `${path}.resolutions`) }) as CreateSourceEggPayloadV1 }
  if (kind === 'transfer-egg') { const x = exact(row, ['eggId', 'destinationTrainerSlug', 'consentEvidenceIds'], path); const consentEvidenceIds = array(x.consentEvidenceIds, `${path}.consentEvidenceIds`, 2).map((value, index) => transferConsentId(value, `${path}.consentEvidenceIds[${index}]`)); if (consentEvidenceIds.length !== 2) fail('breeding.operation.invalid-invariant', `${path}.consentEvidenceIds`, 'must contain exactly the source gift and recipient acceptance IDs.'); sortedUniqueStrings(consentEvidenceIds, `${path}.consentEvidenceIds`); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), destinationTrainerSlug: slug(x.destinationTrainerSlug, `${path}.destinationTrainerSlug`), consentEvidenceIds: Object.freeze(consentEvidenceIds) as readonly [PokemonEggTransferConsentId, PokemonEggTransferConsentId] }) }
  if (kind === 'settle-egg-transfer-consent') { const x = exact(row, ['consentId', 'reasonId'], path); if (x.reasonId !== 'breeding.egg-transfer-consent.revoked' && x.reasonId !== 'breeding.egg-transfer-consent.expired') fail('breeding.operation.invalid-document', `${path}.reasonId`, 'must be a closed Egg-transfer consent settlement reason.'); return Object.freeze({ consentId: transferConsentId(x.consentId, `${path}.consentId`), reasonId: x.reasonId }) as SettleEggTransferConsentPayloadV1 }
  if (kind === 'advance-egg-incubation') { const x = exact(row, ['eggId', 'throughClockRevision', 'throughCampaignMinute'], path); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), throughClockRevision: integer(x.throughClockRevision, `${path}.throughClockRevision`), throughCampaignMinute: integer(x.throughCampaignMinute, `${path}.throughCampaignMinute`) }) }
  if (kind === 'set-egg-incubation-pause') { const x = exact(row, ['eggId', 'paused', 'reasonId'], path); if (typeof x.paused !== 'boolean' || (x.paused !== (x.reasonId !== null))) fail('breeding.operation.invalid-invariant', path, 'pause reason must exist exactly when pausing.'); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), paused: x.paused, reasonId: x.reasonId === null ? null : reason(x.reasonId, `${path}.reasonId`) }) as SetEggIncubationPausePayloadV1 }
  if (kind === 'apply-egg-warmer-capability') { const x = exact(row, ['eggId', 'sourcePokemonSheetSlug', 'expectedSourcePokemonSheetRevision', 'requestReductionRoll'], path); if (x.requestReductionRoll !== true) fail('breeding.operation.invalid-invariant', `${path}.requestReductionRoll`, 'must request exactly one server-owned d10 reduction roll.'); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), sourcePokemonSheetSlug: slug(x.sourcePokemonSheetSlug, `${path}.sourcePokemonSheetSlug`), expectedSourcePokemonSheetRevision: integer(x.expectedSourcePokemonSheetRevision, `${path}.expectedSourcePokemonSheetRevision`, 0, 2_147_483_647), requestReductionRoll: true }) as ApplyEggWarmerCapabilityPayloadV1 }
  if (kind === 'mark-egg-ready') { const x = exact(row, ['eggId', 'reasonId'], path); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), reasonId: reason(x.reasonId, `${path}.reasonId`) }) }
  if (kind === 'begin-hatch') { const x = exact(row, ['eggId', 'destination', 'requestSpecialRoll'], path); if (x.requestSpecialRoll !== true) fail('breeding.operation.invalid-invariant', `${path}.requestSpecialRoll`, 'must request the one server-owned special roll.'); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), destination: parseDestination(x.destination, `${path}.destination`), requestSpecialRoll: true }) }
  if (kind === 'resolve-hatch-special') { const x = exact(row, ['eggId', 'adjudicationOptionId'], path); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), adjudicationOptionId: optionId(x.adjudicationOptionId, `${path}.adjudicationOptionId`) }) }
  if (kind === 'complete-hatch') { const x = exact(row, ['eggId', 'originId', 'destination'], path); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), originId: originId(x.originId, `${path}.originId`), destination: parseDestination(x.destination, `${path}.destination`) }) }
  if (kind === 'cancel-egg') { const x = exact(row, ['eggId', 'reasonId'], path); return Object.freeze({ eggId: eggId(x.eggId, `${path}.eggId`), reasonId: reason(x.reasonId, `${path}.reasonId`) }) }
  if (kind === 'advance-campaign-clock') { const x = exact(row, ['targetCampaignMinute'], path); return Object.freeze({ targetCampaignMinute: integer(x.targetCampaignMinute, `${path}.targetCampaignMinute`) }) }
  if (kind === 'record-inheritance-learning') { const x = exact(row, ['originId', 'eggId', 'childSheetSlug', 'checkpointLevels', 'selectedOptionIds'], path); const levels = array(x.checkpointLevels, `${path}.checkpointLevels`, 9).map((entry, index) => { const level = integer(entry, `${path}.checkpointLevels[${index}]`, 20, 100); if (!CHECKPOINT_SET.has(level)) fail('breeding.operation.invalid-document', `${path}.checkpointLevels[${index}]`, 'must be a canonical inheritance checkpoint.'); return level }); if (levels.length < 1) fail('breeding.operation.invalid-invariant', `${path}.checkpointLevels`, 'cannot be empty.'); for (let i = 1; i < levels.length; i += 1) if (levels[i - 1]! >= levels[i]!) fail('breeding.operation.invalid-invariant', `${path}.checkpointLevels`, 'must be unique in increasing order.'); return Object.freeze({ originId: originId(x.originId, `${path}.originId`), eggId: eggId(x.eggId, `${path}.eggId`), childSheetSlug: slug(x.childSheetSlug, `${path}.childSheetSlug`), checkpointLevels: Object.freeze(levels), selectedOptionIds: parseOptionList(x.selectedOptionIds, `${path}.selectedOptionIds`, 9) }) }
  const x = exact(row, ['targetOperationId', 'action', 'reasonId'], path); if (x.action !== 'inspect' && x.action !== 'resume' && x.action !== 'abandon' && x.action !== 'retry-publication') fail('breeding.operation.invalid-document', `${path}.action`, 'must be a v1 recovery action.'); return Object.freeze({ targetOperationId: operationId(x.targetOperationId, `${path}.targetOperationId`), action: x.action, reasonId: reason(x.reasonId, `${path}.reasonId`) }) as RecoverBreedingOperationPayloadV1
}
const hasScope = (scopes: readonly BreedingConflictScopeV1[], predicate: (scope: BreedingConflictScopeV1) => boolean): boolean => scopes.some(predicate)
const requireScope = (condition: boolean, path: string, message: string): void => { if (!condition) fail('breeding.operation.invalid-scope', path, message) }
const validateScopeCoverage = (kind: BreedingOperationCommandKind, payload: BreedingCommandPayloadByKind[BreedingOperationCommandKind], scopes: readonly BreedingConflictScopeV1[], operation: BreedingOperationId): void => {
  if (kind === 'preview-breeding') return requireScope(scopes.length === 0, 'command.scopes', 'preview must not claim write scopes.')
  if (kind === 'create-breeding-project') {
    const p = payload as CreateBreedingProjectPayloadV1
    requireScope(scopes.length === 1, 'command.scopes', 'project creation must declare exactly one write scope.')
    return requireScope(hasScope(scopes, s => s.kind === 'breeding-project' && s.projectId === p.projectId && s.expectedRevision === null), 'command.scopes', 'must include the new project scope.')
  }
  if (kind === 'grant-breeding-consent' || kind === 'revoke-breeding-consent') {
    const p = payload as GrantBreedingConsentPayloadV1 | RevokeBreedingConsentPayloadV1
    requireScope(scopes.length === 2, 'command.scopes', 'consent mutation must declare exactly project and consent scopes.')
    requireScope(hasScope(scopes, s => s.kind === 'breeding-project' && s.projectId === p.projectId && s.expectedRevision !== null), 'command.scopes', 'must include the current project scope.')
    return requireScope(hasScope(scopes, s => s.kind === 'parent-consent' && s.consentId === p.consentId), 'command.scopes', 'must include the consent scope.')
  }
  if (['advance-breeding-project-time', 'resolve-breeding-check', 'cancel-breeding-project'].includes(kind)) {
    const p = payload as AdvanceBreedingProjectTimePayloadV1 | ResolveBreedingCheckPayloadV1 | CancelBreedingProjectPayloadV1
    requireScope(scopes.length === 1, 'command.scopes', 'project mutation must declare exactly one project scope.')
    return requireScope(hasScope(scopes, s => s.kind === 'breeding-project' && s.projectId === p.projectId && s.expectedRevision !== null), 'command.scopes', 'must include the current project scope.')
  }
  if (kind === 'produce-egg') {
    const p = payload as ProduceEggPayloadV1
    requireScope(scopes.length === 2, 'command.scopes', 'Egg production must declare exactly project and new Egg scopes.')
    requireScope(hasScope(scopes, s => s.kind === 'breeding-project' && s.projectId === p.projectId && s.expectedRevision !== null), 'command.scopes', 'must include the project scope.')
    return requireScope(hasScope(scopes, s => s.kind === 'pokemon-egg' && s.eggId === p.eggId && s.expectedRevision === null), 'command.scopes', 'must include the new Egg scope.')
  }
  if (kind === 'create-source-egg') {
    const p = payload as CreateSourceEggPayloadV1
    const fossil = p.source.kind === 'fossil'
    const artificial = p.source.kind === 'feature-artificial'
    requireScope(scopes.length === (fossil || artificial ? 2 : 1), 'command.scopes', fossil
      ? 'fossil Egg creation must declare exactly one new Egg scope and the current source-owner Trainer inventory scope.'
      : artificial
        ? 'artificial Egg creation must declare exactly one new Egg scope and the current source-owner Trainer inventory and money scope.'
        : 'source Egg creation must declare exactly one new Egg scope.')
    requireScope(hasScope(scopes, s => s.kind === 'pokemon-egg' && s.eggId === p.eggId && s.expectedRevision === null), 'command.scopes', 'must include the new Egg scope.')
    if (fossil) {
      return requireScope(hasScope(scopes, s => s.kind === 'trainer-sheet' && s.sheetSlug === p.ownerTrainerSlug
        && s.expectedRevision !== null && s.fields.length === 1 && s.fields[0] === 'inventory'), 'command.scopes', 'fossil creation must include exactly the current source-owner Trainer inventory write scope.')
    }
    if (artificial) {
      return requireScope(hasScope(scopes, s => s.kind === 'trainer-sheet' && s.sheetSlug === p.ownerTrainerSlug
        && s.expectedRevision !== null && s.fields.length === 2 && s.fields[0] === 'inventory' && s.fields[1] === 'money'), 'command.scopes', 'artificial creation must include exactly the current source-owner Trainer inventory and money write scope.')
    }
    return
  }
  if (kind === 'transfer-egg') {
    const p = payload as TransferEggPayloadV1
    requireScope(scopes.length === 3, 'command.scopes', 'Egg transfer must declare exactly one Egg and two consent scopes.')
    requireScope(hasScope(scopes, s => s.kind === 'pokemon-egg' && s.eggId === p.eggId && s.expectedRevision !== null), 'command.scopes', 'must include the current Egg scope.')
    for (const consent of p.consentEvidenceIds) {
      requireScope(hasScope(scopes, s => s.kind === 'egg-transfer-consent' && s.consentId === consent && s.expectedRevision === 0), 'command.scopes', 'must include both active transfer-consent scopes at revision zero.')
    }
    return
  }
  if (kind === 'settle-egg-transfer-consent') {
    const p = payload as SettleEggTransferConsentPayloadV1
    requireScope(scopes.length === 1, 'command.scopes', 'Egg-transfer consent settlement must declare exactly one consent scope.')
    return requireScope(hasScope(scopes, scope => scope.kind === 'egg-transfer-consent' && scope.consentId === p.consentId && scope.expectedRevision === 0), 'command.scopes', 'must include the active transfer consent scope at revision zero.')
  }
  if (['advance-egg-incubation', 'set-egg-incubation-pause', 'apply-egg-warmer-capability', 'mark-egg-ready', 'begin-hatch', 'resolve-hatch-special', 'cancel-egg'].includes(kind)) {
    const p = payload as AdvanceEggIncubationPayloadV1 | SetEggIncubationPausePayloadV1 | ApplyEggWarmerCapabilityPayloadV1 | MarkEggReadyPayloadV1 | BeginHatchPayloadV1 | ResolveHatchSpecialPayloadV1 | CancelEggPayloadV1
    requireScope(scopes.length === 1, 'command.scopes', 'Egg mutation must declare exactly one Egg scope.')
    return requireScope(hasScope(scopes, s => s.kind === 'pokemon-egg' && s.eggId === p.eggId && s.expectedRevision !== null), 'command.scopes', 'must include the current Egg scope.')
  }
  if (kind === 'complete-hatch') {
    const p = payload as CompleteHatchPayloadV1
    requireScope(scopes.length === 4 || scopes.length === 5, 'command.scopes', 'hatch completion must declare Egg, Trainer, allocation, acquisition, and only when required one Marsupial mother-pouch scope.')
    requireScope(hasScope(scopes, s => s.kind === 'pokemon-egg' && s.eggId === p.eggId && s.expectedRevision !== null), 'command.scopes', 'must include the current Egg scope.')
    requireScope(hasScope(scopes, s => s.kind === 'trainer-sheet' && s.sheetSlug === p.destination.trainerSheetSlug && s.fields.length === 2 && s.fields.includes('roster') && s.fields.includes('experience')), 'command.scopes', 'must include exactly destination Trainer roster and Experience fields.')
    requireScope(hasScope(scopes, s => s.kind === 'pokemon-sheet-allocation'), 'command.scopes', 'must include Pokémon slug allocation.')
    requireScope(hasScope(scopes, s => s.kind === 'species-acquisition' && s.trainerSheetSlug === p.destination.trainerSheetSlug), 'command.scopes', 'must include species acquisition.')
    if (scopes.length === 5) requireScope(hasScope(scopes, s => s.kind === 'pokemon-sheet' && s.fields.length === 1 && s.fields[0] === 'marsupial-pouch'), 'command.scopes', 'the optional fifth scope must identify exactly one Marsupial mother pouch write.')
    return
  }
  if (kind === 'advance-campaign-clock') {
    requireScope(scopes.length >= 1 && scopes.every(scope => scope.kind === 'campaign-clock' || scope.kind === 'breeding-project' || scope.kind === 'pokemon-egg'), 'command.scopes', 'clock advancement may declare only the clock and affected project or Egg scopes.')
    return requireScope(scopes[0]?.kind === 'campaign-clock', 'command.scopes', 'must begin with campaign clock.')
  }
  if (kind === 'record-inheritance-learning') {
    const p = payload as RecordInheritanceLearningPayloadV1
    requireScope(scopes.length === 1, 'command.scopes', 'inheritance learning must declare exactly one child-sheet scope.')
    return requireScope(hasScope(scopes, s => s.kind === 'pokemon-sheet' && s.sheetSlug === p.childSheetSlug && s.fields.length === 2 && s.fields.includes('lineage') && s.fields.includes('moves')), 'command.scopes', 'must include exactly child lineage and Move fields.')
  }
  const p = payload as RecoverBreedingOperationPayloadV1
  requireScope(p.targetOperationId !== operation, 'command.payload.targetOperationId', 'cannot recover itself.')
  requireScope(scopes.length === 1, 'command.scopes', 'recovery must declare exactly one target operation scope.')
  requireScope(hasScope(scopes, s => s.kind === 'breeding-operation' && s.targetOperationId === p.targetOperationId), 'command.scopes', 'must include the target operation scope.')
}
export const parseBreedingOperationCommandV1 = (value: unknown, path = 'command'): BreedingOperationCommandV1 => {
  const row = exact(value, ['schemaVersion', 'operationId', 'commandKind', 'actor', 'ruleset', 'scopes', 'payload'], path)
  if (row.schemaVersion !== 1 || typeof row.commandKind !== 'string' || !KIND_SET.has(row.commandKind)) fail('breeding.operation.invalid-document', path, 'must be a v1 breeding command kind.')
  const kind = row.commandKind as BreedingOperationCommandKind
  const operation = operationId(row.operationId, `${path}.operationId`)
  const scopes = parseScopes(row.scopes, `${path}.scopes`)
  const payload = parsePayload(kind, row.payload, `${path}.payload`)
  validateScopeCoverage(kind, payload, scopes, operation)
  return Object.freeze({ schemaVersion: 1, operationId: operation, commandKind: kind, actor: parseActor(row.actor, `${path}.actor`), ruleset: parseRuleset(row.ruleset, `${path}.ruleset`), scopes, payload }) as BreedingOperationCommandV1
}
const parseAggregateId = (kind: BreedingOperationAggregateKind, value: unknown, path: string): string => {
  if (kind === 'breeding-project') return projectId(value, path)
  if (kind === 'pokemon-egg') return eggId(value, path)
  if (kind === 'parent-consent') return consentId(value, path)
  if (kind === 'egg-transfer-consent') return transferConsentId(value, path)
  if (kind === 'trainer-sheet' || kind === 'pokemon-sheet') return slug(value, path)
  if (value !== 'campaign-clock') fail('breeding.operation.invalid-id', path, 'campaign clock aggregate ID must be campaign-clock.')
  return 'campaign-clock'
}
const parseAggregateRefs = (value: unknown, path: string): readonly BreedingOperationAggregateRefV1[] => {
  const refs = array(value, path, 128).map((entry, index) => {
    const row = exact(entry, ['kind', 'id', 'revision'], `${path}[${index}]`)
    if (typeof row.kind !== 'string' || !AGGREGATE_SET.has(row.kind)) fail('breeding.operation.invalid-document', `${path}[${index}].kind`, 'must be a v1 aggregate kind.')
    const kind = row.kind as BreedingOperationAggregateKind
    return Object.freeze({ kind, id: parseAggregateId(kind, row.id, `${path}[${index}].id`), revision: integer(row.revision, `${path}[${index}].revision`) })
  })
  for (let index = 1; index < refs.length; index += 1) { const before = `${refs[index - 1]!.kind}:${refs[index - 1]!.id}`; const after = `${refs[index]!.kind}:${refs[index]!.id}`; if (before >= after) fail('breeding.operation.invalid-invariant', path, 'must be unique in aggregate identity order.') }
  return Object.freeze(refs)
}
const OUTCOME_BY_COMMAND: Readonly<Record<BreedingOperationCommandKind, BreedingOperationOutcomeKind>> = Object.freeze({
  'preview-breeding': 'previewed', 'create-breeding-project': 'project-created', 'grant-breeding-consent': 'consent-granted', 'revoke-breeding-consent': 'consent-revoked', 'advance-breeding-project-time': 'project-progressed', 'resolve-breeding-check': 'check-resolved', 'produce-egg': 'egg-produced', 'cancel-breeding-project': 'project-cancelled', 'create-source-egg': 'source-egg-created', 'transfer-egg': 'egg-transferred', 'settle-egg-transfer-consent': 'egg-transfer-consent-settled', 'advance-egg-incubation': 'egg-progressed', 'set-egg-incubation-pause': 'egg-pause-set', 'apply-egg-warmer-capability': 'egg-warmer-applied', 'mark-egg-ready': 'egg-ready', 'begin-hatch': 'hatch-started', 'resolve-hatch-special': 'hatch-special-resolved', 'complete-hatch': 'hatched', 'cancel-egg': 'egg-cancelled', 'advance-campaign-clock': 'clock-advanced', 'record-inheritance-learning': 'inheritance-recorded', 'recover-breeding-operation': 'operation-recovered',
})
export const parseBreedingOperationResultV1 = (value: unknown, path = 'result'): BreedingOperationResultV1 => {
  const root = record(value, path)
  if (root.ok === true) {
    const row = exact(root, ['schemaVersion', 'operationId', 'commandHash', 'commandKind', 'ok', 'outcomeKind', 'aggregateRefs', 'changedScopes', 'receiptDefinitionSha256', 'committedAtCampaignMinute', 'resultDefinitionSha256'], path)
    if (row.schemaVersion !== 1 || typeof row.commandKind !== 'string' || !KIND_SET.has(row.commandKind) || typeof row.outcomeKind !== 'string' || !OUTCOME_SET.has(row.outcomeKind)) fail('breeding.operation.invalid-document', path, 'must be an accepted v1 operation result.')
    const commandKind = row.commandKind as BreedingOperationCommandKind
    if (OUTCOME_BY_COMMAND[commandKind] !== row.outcomeKind) fail('breeding.operation.invalid-invariant', `${path}.outcomeKind`, 'must match the command kind.')
    const committed = nullableInteger(row.committedAtCampaignMinute, `${path}.committedAtCampaignMinute`)
    if ((commandKind === 'preview-breeding') !== (committed === null)) fail('breeding.operation.invalid-invariant', `${path}.committedAtCampaignMinute`, 'must be null exactly for previews.')
    const changedScopes = parseScopes(row.changedScopes, `${path}.changedScopes`)
    if (commandKind === 'preview-breeding' && changedScopes.length !== 0) fail('breeding.operation.invalid-invariant', `${path}.changedScopes`, 'preview cannot report writes.')
    return Object.freeze({ schemaVersion: 1, operationId: operationId(row.operationId, `${path}.operationId`), commandHash: hash(row.commandHash, `${path}.commandHash`), commandKind, ok: true, outcomeKind: row.outcomeKind as BreedingOperationOutcomeKind, aggregateRefs: parseAggregateRefs(row.aggregateRefs, `${path}.aggregateRefs`), changedScopes, receiptDefinitionSha256: hash(row.receiptDefinitionSha256, `${path}.receiptDefinitionSha256`), committedAtCampaignMinute: committed, resultDefinitionSha256: hash(row.resultDefinitionSha256, `${path}.resultDefinitionSha256`) })
  }
  if (root.ok === false) {
    const row = exact(root, ['schemaVersion', 'operationId', 'commandHash', 'commandKind', 'ok', 'reasonId', 'currentAggregateRefs', 'conflictingScopes', 'retryable', 'resultDefinitionSha256'], path)
    if (row.schemaVersion !== 1 || typeof row.commandKind !== 'string' || !KIND_SET.has(row.commandKind) || typeof row.reasonId !== 'string' || !REJECTION_SET.has(row.reasonId) || typeof row.retryable !== 'boolean') fail('breeding.operation.invalid-document', path, 'must be a rejected v1 operation result.')
    const retryableReasons = new Set(['breeding.operation.stale-revision', 'breeding.operation.conflict', 'breeding.operation.unavailable', 'breeding.operation.choice-required', 'breeding.operation.adjudication-required', 'breeding.operation.internal-failure'])
    if (row.retryable !== retryableReasons.has(row.reasonId as string)) fail('breeding.operation.invalid-invariant', `${path}.retryable`, 'must match the closed rejection policy.')
    return Object.freeze({ schemaVersion: 1, operationId: operationId(row.operationId, `${path}.operationId`), commandHash: hash(row.commandHash, `${path}.commandHash`), commandKind: row.commandKind as BreedingOperationCommandKind, ok: false, reasonId: row.reasonId as BreedingOperationRejectionReasonId, currentAggregateRefs: parseAggregateRefs(row.currentAggregateRefs, `${path}.currentAggregateRefs`), conflictingScopes: parseScopes(row.conflictingScopes, `${path}.conflictingScopes`), retryable: row.retryable as boolean, resultDefinitionSha256: hash(row.resultDefinitionSha256, `${path}.resultDefinitionSha256`) })
  }
  return fail('breeding.operation.invalid-document', `${path}.ok`, 'must be boolean.')
}
export const breedingScopesConflict = (left: BreedingConflictScopeV1, right: BreedingConflictScopeV1): boolean => breedingConflictScopeKey(left) === breedingConflictScopeKey(right)
