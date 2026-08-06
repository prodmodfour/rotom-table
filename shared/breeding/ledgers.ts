import { isSlug } from '../paths'
import {
  BREEDING_OFFER_OPTION_KINDS,
  parseBreedingAdjudicationIdSyntax,
  parseBreedingCheckRecordIdSyntax,
  parseBreedingConsentIdSyntax,
  parseBreedingOfferIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  parseBreedingRollRecordIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingAdjudicationId,
  type BreedingCheckRecordId,
  type BreedingConsentId,
  type BreedingOfferId,
  type BreedingOfferOptionId,
  type BreedingOfferOptionKind,
  type BreedingOperationId,
  type BreedingProjectId,
  type BreedingRollRecordId,
  type PokemonEggId,
} from './ids'
import { BREEDING_CONSENT_SCOPES, type BreedingConsentScope } from './operations'

export const BREEDING_LEDGER_SCHEMA_VERSION = 1 as const
export const BREEDING_ROLL_PURPOSES = Object.freeze([
  'breeder-check-d20', 'offspring-family-d20', 'nature-ordered-2d6', 'ability-uniform-index',
  'gender-d100', 'hatch-duration-percentage', 'hatch-special-d100', 'provider-bounded',
] as const)
export type BreedingRollPurpose = typeof BREEDING_ROLL_PURPOSES[number]
export const BREEDING_ROLL_FORMULAS = Object.freeze(['1d20', 'ordered-2d6', '1d100', 'uniform-index', 'percentage-50-to-200', 'provider-bounded'] as const)
export type BreedingRollFormula = typeof BREEDING_ROLL_FORMULAS[number]
export const BREEDING_OFFER_STATUSES = Object.freeze(['active', 'consumed', 'expired', 'revoked'] as const)
export type BreedingOfferStatus = typeof BREEDING_OFFER_STATUSES[number]
export const BREEDING_CONSENT_STATUSES = Object.freeze(['active', 'revoked', 'expired', 'superseded'] as const)
export type BreedingConsentStatus = typeof BREEDING_CONSENT_STATUSES[number]
export const BREEDING_ADJUDICATION_STATUSES = Object.freeze(['pending', 'resolved', 'cancelled'] as const)
export type BreedingAdjudicationStatus = typeof BREEDING_ADJUDICATION_STATUSES[number]
export const BREEDING_ADJUDICATION_KINDS = Object.freeze([
  'maturity-confirmation', 'parent-role-override', 'offspring-family', 'hatch-duration', 'hatch-special-result',
  'source-egg', 'mark-ready', 'correction', 'legacy-lineage', 'provider-modifier',
] as const)
export type BreedingAdjudicationKind = typeof BREEDING_ADJUDICATION_KINDS[number]
export type PokemonEducationRank = 'Untrained' | 'Novice' | 'Adept' | 'Expert' | 'Master'

export type BreedingLedgerTargetV1 =
  | { readonly kind: 'breeding-project', readonly projectId: BreedingProjectId, readonly revision: number }
  | { readonly kind: 'pokemon-egg', readonly eggId: PokemonEggId, readonly revision: number }
  | { readonly kind: 'pokemon-sheet', readonly sheetSlug: string, readonly revision: number }
  | { readonly kind: 'trainer-sheet', readonly sheetSlug: string, readonly revision: number }
export interface BreedingRollRecordV1 {
  readonly schemaVersion: 1
  readonly rollRecordId: BreedingRollRecordId
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly operationRollOrdinal: number
  readonly purpose: BreedingRollPurpose
  readonly target: BreedingLedgerTargetV1
  readonly formula: BreedingRollFormula
  readonly dieCount: number
  readonly dieSides: number
  readonly ordered: boolean
  readonly modifier: number
  readonly values: readonly number[]
  readonly total: number
  readonly generatorId: 'server-rng-v1' | 'reviewed-import-v1'
  readonly sourceDefinitionHashes: readonly string[]
  readonly generatedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingCheckRecordV1 {
  readonly schemaVersion: 1
  readonly checkRecordId: BreedingCheckRecordId
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly projectId: BreedingProjectId
  readonly projectRevision: number
  readonly breederSnapshotDefinitionSha256: string
  readonly skillId: 'pokemon-education'
  readonly difficultyClass: 12
  readonly authoritativeSkillTotal: number
  readonly rollRecordId: BreedingRollRecordId
  readonly dieTotal: number
  readonly finalTotal: number
  readonly outcome: 'success' | 'failure'
  readonly rulesetDefinitionSha256: string
  readonly resolvedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingOfferOptionV1 {
  readonly optionId: BreedingOfferOptionId
  readonly kind: BreedingOfferOptionKind
  readonly canonicalValueId: string
  readonly valueDefinitionSha256: string
  readonly authorityEvidenceIds: readonly string[]
}
export interface BreedingOptionOfferRecordV1 {
  readonly schemaVersion: 1
  readonly offerId: BreedingOfferId
  readonly revision: number
  readonly status: BreedingOfferStatus
  readonly choiceKind: BreedingOfferOptionKind
  readonly target: BreedingLedgerTargetV1
  readonly chooserProfileId: string
  readonly minimumPokemonEducationRank: PokemonEducationRank | null
  readonly options: readonly BreedingOfferOptionV1[]
  readonly issuedOperationId: BreedingOperationId
  readonly issuedCommandSha256: string
  readonly issuedAtCampaignMinute: number
  readonly expiresAtCampaignMinute: number | null
  readonly selectedOptionId: BreedingOfferOptionId | null
  readonly settlementOperationId: BreedingOperationId | null
  readonly settlementCommandSha256: string | null
  readonly settledAtCampaignMinute: number | null
  readonly settlementReasonId: string | null
  readonly definitionSha256: string
}
export interface BreedingConsentRecordV1 {
  readonly schemaVersion: 1
  readonly consentId: BreedingConsentId
  readonly revision: number
  readonly status: BreedingConsentStatus
  readonly projectId: BreedingProjectId
  readonly parentSheetSlug: string
  readonly parentSheetRevision: number
  readonly ownerTrainerSlug: string
  readonly consentingProfileId: string
  readonly scopes: readonly BreedingConsentScope[]
  readonly grantedAtCampaignMinute: number
  readonly expiresAtCampaignMinute: number | null
  readonly grantOperationId: BreedingOperationId
  readonly grantCommandSha256: string
  readonly settledAtCampaignMinute: number | null
  readonly settlementOperationId: BreedingOperationId | null
  readonly settlementCommandSha256: string | null
  readonly settlementReasonId: string | null
  readonly definitionSha256: string
}
export type BreedingAdjudicationDecisionV1 =
  | { readonly kind: 'option', readonly optionId: BreedingOfferOptionId }
  | { readonly kind: 'confirmation', readonly confirmed: boolean, readonly evidenceDefinitionSha256: string }
export interface BreedingGmAdjudicationRecordV1 {
  readonly schemaVersion: 1
  readonly adjudicationId: BreedingAdjudicationId
  readonly revision: number
  readonly status: BreedingAdjudicationStatus
  readonly adjudicationKind: BreedingAdjudicationKind
  readonly decisionMode: 'bounded-option' | 'audited-confirmation'
  readonly target: BreedingLedgerTargetV1
  readonly createdByProfileId: string
  readonly reasonId: string
  readonly offerId: BreedingOfferId | null
  readonly decision: BreedingAdjudicationDecisionV1 | null
  readonly createdOperationId: BreedingOperationId
  readonly createdCommandSha256: string
  readonly createdAtCampaignMinute: number
  readonly resolvedByProfileId: string | null
  readonly settlementOperationId: BreedingOperationId | null
  readonly settlementCommandSha256: string | null
  readonly settledAtCampaignMinute: number | null
  readonly settlementReasonId: string | null
  readonly authorityDefinitionHashes: readonly string[]
  readonly definitionSha256: string
}

export type BreedingLedgerValidationCode =
  | 'breeding.ledger.invalid-document'
  | 'breeding.ledger.unknown-field'
  | 'breeding.ledger.invalid-id'
  | 'breeding.ledger.invalid-invariant'
export class BreedingLedgerValidationError extends Error {
  readonly code: BreedingLedgerValidationCode
  readonly path: string
  constructor(code: BreedingLedgerValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingLedgerValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const REASON = /^breeding\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const PURPOSE_SET = new Set<string>(BREEDING_ROLL_PURPOSES)
const FORMULA_SET = new Set<string>(BREEDING_ROLL_FORMULAS)
const OFFER_STATUS_SET = new Set<string>(BREEDING_OFFER_STATUSES)
const CONSENT_STATUS_SET = new Set<string>(BREEDING_CONSENT_STATUSES)
const ADJUDICATION_STATUS_SET = new Set<string>(BREEDING_ADJUDICATION_STATUSES)
const ADJUDICATION_KIND_SET = new Set<string>(BREEDING_ADJUDICATION_KINDS)
const OPTION_KIND_SET = new Set<string>(BREEDING_OFFER_OPTION_KINDS)
const RANK_SET = new Set<string>(['Untrained', 'Novice', 'Adept', 'Expert', 'Master'])
const fail = (code: BreedingLedgerValidationCode, path: string, message: string): never => { throw new BreedingLedgerValidationError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.ledger.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.ledger.invalid-document', path, 'must be a plain data object without symbols.')
  for (const key of Object.getOwnPropertyNames(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.ledger.invalid-document', `${path}.${key}`, 'must be an enumerable data field.') }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path); const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail('breeding.ledger.unknown-field', path, 'must contain exactly the declared fields.')
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.ledger.invalid-document', path, `must be an array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.ledger.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.') }
  if (Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail('breeding.ledger.unknown-field', path, 'cannot contain enriched fields.')
  return value
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail('breeding.ledger.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  return value as number
}
const nullableInteger = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)
const boundedSignedInteger = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail('breeding.ledger.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  return value as number
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.ledger.invalid-document', path, 'must be a lowercase SHA-256 value.')
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value) ? value : fail('breeding.ledger.invalid-id', path, 'must be a bounded stable identifier.')
const reason = (value: unknown, path: string): string => typeof value === 'string' && value.length <= 160 && REASON.test(value) ? value : fail('breeding.ledger.invalid-id', path, 'must be a typed breeding reason ID.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160 ? value : fail('breeding.ledger.invalid-id', path, 'must be a canonical sheet slug.')
const operationId = (value: unknown, path: string): BreedingOperationId => parseBreedingOperationIdSyntax(value) ?? fail('breeding.ledger.invalid-id', path, 'must be a breeding operation ID.')
const nullableOperationId = (value: unknown, path: string): BreedingOperationId | null => value === null ? null : operationId(value, path)
const optionId = (value: unknown, path: string): BreedingOfferOptionId => parseBreedingOfferOptionIdSyntax(value) ?? fail('breeding.ledger.invalid-id', path, 'must be a server-issued option ID.')
const nullableOptionId = (value: unknown, path: string): BreedingOfferOptionId | null => value === null ? null : optionId(value, path)
const offerId = (value: unknown, path: string): BreedingOfferId => parseBreedingOfferIdSyntax(value) ?? fail('breeding.ledger.invalid-id', path, 'must be a breeding offer ID.')
const nullableOfferId = (value: unknown, path: string): BreedingOfferId | null => value === null ? null : offerId(value, path)
const sortedUnique = <Value extends string>(values: readonly Value[], path: string): readonly Value[] => {
  for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) fail('breeding.ledger.invalid-invariant', path, 'must be unique in strict code-point order.')
  return Object.freeze([...values])
}
const hashes = (value: unknown, path: string, maximum = 256): readonly string[] => {
  const parsed = array(value, path, maximum).map((entry, index) => hash(entry, `${path}[${index}]`))
  if (parsed.length < 1) fail('breeding.ledger.invalid-invariant', path, 'cannot be empty.')
  return sortedUnique(parsed, path)
}
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
export const parseBreedingLedgerTargetV1 = (value: unknown, path = 'target'): BreedingLedgerTargetV1 => {
  const row = record(value, path)
  if (row.kind === 'breeding-project') { const x = exact(row, ['kind', 'projectId', 'revision'], path); return Object.freeze({ kind: 'breeding-project', projectId: parseBreedingProjectIdSyntax(x.projectId) ?? fail('breeding.ledger.invalid-id', `${path}.projectId`, 'must be a breeding project ID.'), revision: integer(x.revision, `${path}.revision`) }) }
  if (row.kind === 'pokemon-egg') { const x = exact(row, ['kind', 'eggId', 'revision'], path); return Object.freeze({ kind: 'pokemon-egg', eggId: parsePokemonEggIdSyntax(x.eggId) ?? fail('breeding.ledger.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.'), revision: integer(x.revision, `${path}.revision`) }) }
  if (row.kind === 'pokemon-sheet' || row.kind === 'trainer-sheet') { const x = exact(row, ['kind', 'sheetSlug', 'revision'], path); return Object.freeze({ kind: row.kind, sheetSlug: slug(x.sheetSlug, `${path}.sheetSlug`), revision: integer(x.revision, `${path}.revision`) }) as BreedingLedgerTargetV1 }
  return fail('breeding.ledger.invalid-document', `${path}.kind`, 'must be a v1 ledger target kind.')
}
const rollFormulaExpected = (purpose: BreedingRollPurpose): BreedingRollFormula => {
  if (purpose === 'breeder-check-d20' || purpose === 'offspring-family-d20') return '1d20'
  if (purpose === 'nature-ordered-2d6') return 'ordered-2d6'
  if (purpose === 'ability-uniform-index') return 'uniform-index'
  if (purpose === 'gender-d100' || purpose === 'hatch-special-d100') return '1d100'
  if (purpose === 'hatch-duration-percentage') return 'percentage-50-to-200'
  return 'provider-bounded'
}
export const parseBreedingRollRecordV1 = (value: unknown, path = 'rollRecord'): BreedingRollRecordV1 => {
  const row = exact(value, ['schemaVersion', 'rollRecordId', 'operationId', 'commandSha256', 'operationRollOrdinal', 'purpose', 'target', 'formula', 'dieCount', 'dieSides', 'ordered', 'modifier', 'values', 'total', 'generatorId', 'sourceDefinitionHashes', 'generatedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.purpose !== 'string' || !PURPOSE_SET.has(row.purpose) || typeof row.formula !== 'string' || !FORMULA_SET.has(row.formula)) fail('breeding.ledger.invalid-document', path, 'must be a v1 roll record.')
  const purpose = row.purpose as BreedingRollPurpose
  const formula = row.formula as BreedingRollFormula
  if (formula !== rollFormulaExpected(purpose)) fail('breeding.ledger.invalid-invariant', `${path}.formula`, 'must match the closed purpose formula.')
  const dieCount = integer(row.dieCount, `${path}.dieCount`, 1, 16)
  const dieSides = integer(row.dieSides, `${path}.dieSides`, 2, 1000)
  if (typeof row.ordered !== 'boolean') fail('breeding.ledger.invalid-document', `${path}.ordered`, 'must be boolean.')
  const modifier = boundedSignedInteger(row.modifier, `${path}.modifier`, -1000, 1000)
  const values = array(row.values, `${path}.values`, 16).map((entry, index) => integer(entry, `${path}.values[${index}]`, 1, dieSides))
  if (values.length !== dieCount) fail('breeding.ledger.invalid-invariant', `${path}.values`, 'must contain exactly one value per die.')
  const expected = formula === '1d20' ? [1, 20, false, 0] : formula === 'ordered-2d6' ? [2, 6, true, 0] : formula === '1d100' ? [1, 100, false, 0] : formula === 'percentage-50-to-200' ? [1, 151, false, 49] : null
  if (expected && (dieCount !== expected[0] || dieSides !== expected[1] || row.ordered !== expected[2] || modifier !== expected[3])) fail('breeding.ledger.invalid-invariant', path, 'dice parameters must match the closed formula.')
  if (formula === 'uniform-index' && (dieCount !== 1 || row.ordered !== false || modifier !== 0 || dieSides > 64)) fail('breeding.ledger.invalid-invariant', path, 'uniform-index must be one unmodified die bounded by option count.')
  if (formula === 'provider-bounded' && (dieCount > 16 || dieSides > 1000)) fail('breeding.ledger.invalid-invariant', path, 'provider-bounded dice exceed v1 bounds.')
  const total = boundedSignedInteger(row.total, `${path}.total`, -16_000, 17_000)
  if (total !== values.reduce((sum, entry) => sum + entry, modifier)) fail('breeding.ledger.invalid-invariant', `${path}.total`, 'must equal persisted dice plus modifier.')
  if (row.generatorId !== 'server-rng-v1' && row.generatorId !== 'reviewed-import-v1') fail('breeding.ledger.invalid-document', `${path}.generatorId`, 'must be a v1 generator ID.')
  return deepFreeze({ schemaVersion: 1, rollRecordId: parseBreedingRollRecordIdSyntax(row.rollRecordId) ?? fail('breeding.ledger.invalid-id', `${path}.rollRecordId`, 'must be a breeding roll record ID.'), operationId: operationId(row.operationId, `${path}.operationId`), commandSha256: hash(row.commandSha256, `${path}.commandSha256`), operationRollOrdinal: integer(row.operationRollOrdinal, `${path}.operationRollOrdinal`, 0, 31), purpose, target: parseBreedingLedgerTargetV1(row.target, `${path}.target`), formula, dieCount, dieSides, ordered: row.ordered, modifier, values: Object.freeze(values), total, generatorId: row.generatorId, sourceDefinitionHashes: hashes(row.sourceDefinitionHashes, `${path}.sourceDefinitionHashes`), generatedAtCampaignMinute: integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) }) as BreedingRollRecordV1
}
export const parseBreedingCheckRecordV1 = (value: unknown, path = 'checkRecord'): BreedingCheckRecordV1 => {
  const row = exact(value, ['schemaVersion', 'checkRecordId', 'operationId', 'commandSha256', 'projectId', 'projectRevision', 'breederSnapshotDefinitionSha256', 'skillId', 'difficultyClass', 'authoritativeSkillTotal', 'rollRecordId', 'dieTotal', 'finalTotal', 'outcome', 'rulesetDefinitionSha256', 'resolvedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || row.skillId !== 'pokemon-education' || row.difficultyClass !== 12 || (row.outcome !== 'success' && row.outcome !== 'failure')) fail('breeding.ledger.invalid-document', path, 'must be the v1 Pokémon Education DC 12 check.')
  const skillTotal = boundedSignedInteger(row.authoritativeSkillTotal, `${path}.authoritativeSkillTotal`, -100, 100)
  const dieTotal = integer(row.dieTotal, `${path}.dieTotal`, 1, 20)
  const finalTotal = boundedSignedInteger(row.finalTotal, `${path}.finalTotal`, -99, 120)
  if (finalTotal !== dieTotal + skillTotal || (row.outcome === 'success') !== (finalTotal >= 12)) fail('breeding.ledger.invalid-invariant', path, 'final total and outcome must exactly follow the frozen check inputs.')
  return deepFreeze({ schemaVersion: 1, checkRecordId: parseBreedingCheckRecordIdSyntax(row.checkRecordId) ?? fail('breeding.ledger.invalid-id', `${path}.checkRecordId`, 'must be a breeding check record ID.'), operationId: operationId(row.operationId, `${path}.operationId`), commandSha256: hash(row.commandSha256, `${path}.commandSha256`), projectId: parseBreedingProjectIdSyntax(row.projectId) ?? fail('breeding.ledger.invalid-id', `${path}.projectId`, 'must be a breeding project ID.'), projectRevision: integer(row.projectRevision, `${path}.projectRevision`), breederSnapshotDefinitionSha256: hash(row.breederSnapshotDefinitionSha256, `${path}.breederSnapshotDefinitionSha256`), skillId: 'pokemon-education', difficultyClass: 12, authoritativeSkillTotal: skillTotal, rollRecordId: parseBreedingRollRecordIdSyntax(row.rollRecordId) ?? fail('breeding.ledger.invalid-id', `${path}.rollRecordId`, 'must be a breeding roll record ID.'), dieTotal, finalTotal, outcome: row.outcome, rulesetDefinitionSha256: hash(row.rulesetDefinitionSha256, `${path}.rulesetDefinitionSha256`), resolvedAtCampaignMinute: integer(row.resolvedAtCampaignMinute, `${path}.resolvedAtCampaignMinute`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) }) as BreedingCheckRecordV1
}
const parseOfferOption = (value: unknown, choiceKind: BreedingOfferOptionKind, path: string): BreedingOfferOptionV1 => {
  const row = exact(value, ['optionId', 'kind', 'canonicalValueId', 'valueDefinitionSha256', 'authorityEvidenceIds'], path)
  if (row.kind !== choiceKind) fail('breeding.ledger.invalid-invariant', `${path}.kind`, 'must match the offer choice kind.')
  const evidence = array(row.authorityEvidenceIds, `${path}.authorityEvidenceIds`, 32).map((entry, index) => identifier(entry, `${path}.authorityEvidenceIds[${index}]`))
  if (evidence.length < 1) fail('breeding.ledger.invalid-invariant', `${path}.authorityEvidenceIds`, 'cannot be empty.')
  return Object.freeze({ optionId: optionId(row.optionId, `${path}.optionId`), kind: choiceKind, canonicalValueId: identifier(row.canonicalValueId, `${path}.canonicalValueId`), valueDefinitionSha256: hash(row.valueDefinitionSha256, `${path}.valueDefinitionSha256`), authorityEvidenceIds: sortedUnique(evidence, `${path}.authorityEvidenceIds`) })
}
export const parseBreedingOptionOfferRecordV1 = (value: unknown, path = 'offerRecord'): BreedingOptionOfferRecordV1 => {
  const row = exact(value, ['schemaVersion', 'offerId', 'revision', 'status', 'choiceKind', 'target', 'chooserProfileId', 'minimumPokemonEducationRank', 'options', 'issuedOperationId', 'issuedCommandSha256', 'issuedAtCampaignMinute', 'expiresAtCampaignMinute', 'selectedOptionId', 'settlementOperationId', 'settlementCommandSha256', 'settledAtCampaignMinute', 'settlementReasonId', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.status !== 'string' || !OFFER_STATUS_SET.has(row.status) || typeof row.choiceKind !== 'string' || !OPTION_KIND_SET.has(row.choiceKind)) fail('breeding.ledger.invalid-document', path, 'must be a v1 option offer record.')
  const status = row.status as BreedingOfferStatus
  const revision = integer(row.revision, `${path}.revision`, 0, 1)
  if ((status === 'active') !== (revision === 0)) fail('breeding.ledger.invalid-invariant', `${path}.revision`, 'active offer is revision 0 and settled offer is revision 1.')
  const choiceKind = row.choiceKind as BreedingOfferOptionKind
  if (row.minimumPokemonEducationRank !== null && (typeof row.minimumPokemonEducationRank !== 'string' || !RANK_SET.has(row.minimumPokemonEducationRank))) fail('breeding.ledger.invalid-document', `${path}.minimumPokemonEducationRank`, 'must be a v1 rank or null.')
  const options = array(row.options, `${path}.options`, 64).map((entry, index) => parseOfferOption(entry, choiceKind, `${path}.options[${index}]`))
  if (options.length < 1) fail('breeding.ledger.invalid-invariant', `${path}.options`, 'cannot be empty.')
  sortedUnique(options.map(option => option.optionId), `${path}.options`)
  const issuedAt = integer(row.issuedAtCampaignMinute, `${path}.issuedAtCampaignMinute`)
  const expiresAt = nullableInteger(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`)
  if (expiresAt !== null && (expiresAt < issuedAt || expiresAt > issuedAt + 525_600)) fail('breeding.ledger.invalid-invariant', `${path}.expiresAtCampaignMinute`, 'must be within the configured consent/offer horizon.')
  const selected = nullableOptionId(row.selectedOptionId, `${path}.selectedOptionId`)
  const settlementOperation = nullableOperationId(row.settlementOperationId, `${path}.settlementOperationId`)
  const settlementCommand = row.settlementCommandSha256 === null ? null : hash(row.settlementCommandSha256, `${path}.settlementCommandSha256`)
  const settledAt = nullableInteger(row.settledAtCampaignMinute, `${path}.settledAtCampaignMinute`)
  const settlementReason = row.settlementReasonId === null ? null : reason(row.settlementReasonId, `${path}.settlementReasonId`)
  if (status === 'active' && (selected || settlementOperation || settlementCommand || settledAt !== null || settlementReason)
    || status === 'consumed' && (!selected || !settlementOperation || !settlementCommand || settledAt === null || settlementReason)
    || (status === 'expired' || status === 'revoked') && (selected || !settlementOperation || !settlementCommand || settledAt === null || !settlementReason)) fail('breeding.ledger.invalid-invariant', path, 'offer settlement fields do not match status.')
  if (selected && !options.some(option => option.optionId === selected)) fail('breeding.ledger.invalid-invariant', `${path}.selectedOptionId`, 'must belong to this immutable offer.')
  return deepFreeze({ schemaVersion: 1, offerId: offerId(row.offerId, `${path}.offerId`), revision, status, choiceKind, target: parseBreedingLedgerTargetV1(row.target, `${path}.target`), chooserProfileId: identifier(row.chooserProfileId, `${path}.chooserProfileId`), minimumPokemonEducationRank: row.minimumPokemonEducationRank, options: Object.freeze(options), issuedOperationId: operationId(row.issuedOperationId, `${path}.issuedOperationId`), issuedCommandSha256: hash(row.issuedCommandSha256, `${path}.issuedCommandSha256`), issuedAtCampaignMinute: issuedAt, expiresAtCampaignMinute: expiresAt, selectedOptionId: selected, settlementOperationId: settlementOperation, settlementCommandSha256: settlementCommand, settledAtCampaignMinute: settledAt, settlementReasonId: settlementReason, definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) }) as BreedingOptionOfferRecordV1
}
const parseConsentScopes = (value: unknown, path: string): readonly BreedingConsentScope[] => {
  const scopes = array(value, path, BREEDING_CONSENT_SCOPES.length).map((entry, index) => typeof entry === 'string' && (BREEDING_CONSENT_SCOPES as readonly string[]).includes(entry) ? entry as BreedingConsentScope : fail('breeding.ledger.invalid-document', `${path}[${index}]`, 'must be a v1 consent scope.'))
  if (scopes.length < 1) fail('breeding.ledger.invalid-invariant', path, 'cannot be empty.')
  return sortedUnique(scopes, path)
}
export const parseBreedingConsentRecordV1 = (value: unknown, path = 'consentRecord'): BreedingConsentRecordV1 => {
  const row = exact(value, ['schemaVersion', 'consentId', 'revision', 'status', 'projectId', 'parentSheetSlug', 'parentSheetRevision', 'ownerTrainerSlug', 'consentingProfileId', 'scopes', 'grantedAtCampaignMinute', 'expiresAtCampaignMinute', 'grantOperationId', 'grantCommandSha256', 'settledAtCampaignMinute', 'settlementOperationId', 'settlementCommandSha256', 'settlementReasonId', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.status !== 'string' || !CONSENT_STATUS_SET.has(row.status)) fail('breeding.ledger.invalid-document', path, 'must be a v1 consent record.')
  const status = row.status as BreedingConsentStatus
  const revision = integer(row.revision, `${path}.revision`, 0, 1)
  if ((status === 'active') !== (revision === 0)) fail('breeding.ledger.invalid-invariant', `${path}.revision`, 'active consent is revision 0 and settled consent is revision 1.')
  const grantedAt = integer(row.grantedAtCampaignMinute, `${path}.grantedAtCampaignMinute`)
  const expiresAt = nullableInteger(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`)
  if (expiresAt !== null && (expiresAt < grantedAt || expiresAt > grantedAt + 525_600)) fail('breeding.ledger.invalid-invariant', `${path}.expiresAtCampaignMinute`, 'must be within the configured consent horizon.')
  const settledAt = nullableInteger(row.settledAtCampaignMinute, `${path}.settledAtCampaignMinute`)
  const settlementOperationId = nullableOperationId(row.settlementOperationId, `${path}.settlementOperationId`)
  const settlementCommandSha256 = row.settlementCommandSha256 === null ? null : hash(row.settlementCommandSha256, `${path}.settlementCommandSha256`)
  const settlementReasonId = row.settlementReasonId === null ? null : reason(row.settlementReasonId, `${path}.settlementReasonId`)
  if (status === 'active' && (settledAt !== null || settlementOperationId || settlementCommandSha256 || settlementReasonId)
    || status !== 'active' && (settledAt === null || !settlementOperationId || !settlementCommandSha256 || !settlementReasonId || settledAt < grantedAt)) fail('breeding.ledger.invalid-invariant', path, 'consent settlement fields do not match status.')
  return deepFreeze({ schemaVersion: 1, consentId: parseBreedingConsentIdSyntax(row.consentId) ?? fail('breeding.ledger.invalid-id', `${path}.consentId`, 'must be a breeding consent ID.'), revision, status, projectId: parseBreedingProjectIdSyntax(row.projectId) ?? fail('breeding.ledger.invalid-id', `${path}.projectId`, 'must be a breeding project ID.'), parentSheetSlug: slug(row.parentSheetSlug, `${path}.parentSheetSlug`), parentSheetRevision: integer(row.parentSheetRevision, `${path}.parentSheetRevision`), ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`), consentingProfileId: identifier(row.consentingProfileId, `${path}.consentingProfileId`), scopes: parseConsentScopes(row.scopes, `${path}.scopes`), grantedAtCampaignMinute: grantedAt, expiresAtCampaignMinute: expiresAt, grantOperationId: operationId(row.grantOperationId, `${path}.grantOperationId`), grantCommandSha256: hash(row.grantCommandSha256, `${path}.grantCommandSha256`), settledAtCampaignMinute: settledAt, settlementOperationId, settlementCommandSha256, settlementReasonId, definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
const parseDecision = (value: unknown, path: string): BreedingAdjudicationDecisionV1 | null => {
  if (value === null) return null
  const row = record(value, path)
  if (row.kind === 'option') { const x = exact(row, ['kind', 'optionId'], path); return Object.freeze({ kind: 'option', optionId: optionId(x.optionId, `${path}.optionId`) }) }
  if (row.kind === 'confirmation') { const x = exact(row, ['kind', 'confirmed', 'evidenceDefinitionSha256'], path); if (typeof x.confirmed !== 'boolean') fail('breeding.ledger.invalid-document', `${path}.confirmed`, 'must be boolean.'); return Object.freeze({ kind: 'confirmation', confirmed: x.confirmed, evidenceDefinitionSha256: hash(x.evidenceDefinitionSha256, `${path}.evidenceDefinitionSha256`) }) as BreedingAdjudicationDecisionV1 }
  return fail('breeding.ledger.invalid-document', `${path}.kind`, 'must be a v1 adjudication decision.')
}
export const parseBreedingGmAdjudicationRecordV1 = (value: unknown, path = 'adjudicationRecord'): BreedingGmAdjudicationRecordV1 => {
  const row = exact(value, ['schemaVersion', 'adjudicationId', 'revision', 'status', 'adjudicationKind', 'decisionMode', 'target', 'createdByProfileId', 'reasonId', 'offerId', 'decision', 'createdOperationId', 'createdCommandSha256', 'createdAtCampaignMinute', 'resolvedByProfileId', 'settlementOperationId', 'settlementCommandSha256', 'settledAtCampaignMinute', 'settlementReasonId', 'authorityDefinitionHashes', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.status !== 'string' || !ADJUDICATION_STATUS_SET.has(row.status) || typeof row.adjudicationKind !== 'string' || !ADJUDICATION_KIND_SET.has(row.adjudicationKind) || (row.decisionMode !== 'bounded-option' && row.decisionMode !== 'audited-confirmation')) fail('breeding.ledger.invalid-document', path, 'must be a v1 GM adjudication record.')
  const status = row.status as BreedingAdjudicationStatus
  const revision = integer(row.revision, `${path}.revision`, 0, 1)
  if ((status === 'pending') !== (revision === 0)) fail('breeding.ledger.invalid-invariant', `${path}.revision`, 'pending adjudication is revision 0 and settled adjudication is revision 1.')
  const offer = nullableOfferId(row.offerId, `${path}.offerId`)
  const decision = parseDecision(row.decision, `${path}.decision`)
  if ((row.decisionMode === 'bounded-option') !== (offer !== null) || decision?.kind === 'option' && row.decisionMode !== 'bounded-option' || decision?.kind === 'confirmation' && row.decisionMode !== 'audited-confirmation') fail('breeding.ledger.invalid-invariant', path, 'decision mode, offer, and decision kind must agree.')
  const resolvedBy = row.resolvedByProfileId === null ? null : identifier(row.resolvedByProfileId, `${path}.resolvedByProfileId`)
  const settlementOperation = nullableOperationId(row.settlementOperationId, `${path}.settlementOperationId`)
  const settlementCommand = row.settlementCommandSha256 === null ? null : hash(row.settlementCommandSha256, `${path}.settlementCommandSha256`)
  const settledAt = nullableInteger(row.settledAtCampaignMinute, `${path}.settledAtCampaignMinute`)
  const settlementReason = row.settlementReasonId === null ? null : reason(row.settlementReasonId, `${path}.settlementReasonId`)
  if (status === 'pending' && (decision || resolvedBy || settlementOperation || settlementCommand || settledAt !== null || settlementReason)
    || status === 'resolved' && (!decision || !resolvedBy || !settlementOperation || !settlementCommand || settledAt === null || settlementReason)
    || status === 'cancelled' && (decision || !resolvedBy || !settlementOperation || !settlementCommand || settledAt === null || !settlementReason)) fail('breeding.ledger.invalid-invariant', path, 'adjudication settlement fields do not match status.')
  const createdAt = integer(row.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`)
  if (settledAt !== null && settledAt < createdAt) fail('breeding.ledger.invalid-invariant', `${path}.settledAtCampaignMinute`, 'cannot predate creation.')
  return deepFreeze({ schemaVersion: 1, adjudicationId: parseBreedingAdjudicationIdSyntax(row.adjudicationId) ?? fail('breeding.ledger.invalid-id', `${path}.adjudicationId`, 'must be a breeding adjudication ID.'), revision, status, adjudicationKind: row.adjudicationKind, decisionMode: row.decisionMode, target: parseBreedingLedgerTargetV1(row.target, `${path}.target`), createdByProfileId: identifier(row.createdByProfileId, `${path}.createdByProfileId`), reasonId: reason(row.reasonId, `${path}.reasonId`), offerId: offer, decision, createdOperationId: operationId(row.createdOperationId, `${path}.createdOperationId`), createdCommandSha256: hash(row.createdCommandSha256, `${path}.createdCommandSha256`), createdAtCampaignMinute: createdAt, resolvedByProfileId: resolvedBy, settlementOperationId: settlementOperation, settlementCommandSha256: settlementCommand, settledAtCampaignMinute: settledAt, settlementReasonId: settlementReason, authorityDefinitionHashes: hashes(row.authorityDefinitionHashes, `${path}.authorityDefinitionHashes`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) }) as BreedingGmAdjudicationRecordV1
}
