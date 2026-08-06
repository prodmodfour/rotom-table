import { isSlug } from '../paths'
import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import {
  BREEDING_CONSENT_SCOPES,
  BREEDING_OPERATION_COMMAND_KINDS,
  type BreedingConsentScope,
  type BreedingOperationCommandKind,
} from './operations'
import {
  parseBreedingConsentIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingOverrideIdSyntax,
  parseBreedingProjectIdSyntax,
  type BreedingConsentId,
  type BreedingOperationId,
  type BreedingOverrideId,
  type BreedingProjectId,
} from './ids'
import type { PokemonEducationRank } from './ledgers'

export const BREEDING_AUTHORIZATION_SCHEMA_VERSION = 1 as const
export const BREEDING_BREEDER_ACCESS_MODES = Object.freeze(['campaign-shared-service', 'gm-authority', 'profile-control'] as const)
export type BreedingBreederAccessMode = typeof BREEDING_BREEDER_ACCESS_MODES[number]
export const BREEDING_BREEDER_MANDATED_SKILL_IDS = Object.freeze(['pokemon-education','general-education','perception'] as const)
export type BreedingBreederMandatedSkillId = typeof BREEDING_BREEDER_MANDATED_SKILL_IDS[number]
export const BREEDING_GM_OVERRIDE_KINDS = Object.freeze([
  'breeder-access', 'breeder-permission', 'cross-owner-consent', 'operation-recovery', 'owner-control', 'parent-control',
] as const)
export type BreedingGmOverrideKind = typeof BREEDING_GM_OVERRIDE_KINDS[number]
export const BREEDING_AUTHORIZATION_REASON_IDS = Object.freeze([
  'breeding.authorization.actor-mismatch',
  'breeding.authorization.authorized',
  'breeding.authorization.breeder-access-required',
  'breeding.authorization.breeder-edge-required',
  'breeding.authorization.consent-required',
  'breeding.authorization.consent-scope-missing',
  'breeding.authorization.consent-stale',
  'breeding.authorization.gm-override-invalid',
  'breeding.authorization.owner-control-required',
  'breeding.authorization.parent-control-required',
  'breeding.authorization.parent-link-stale',
  'breeding.authorization.profile-stale',
  'breeding.authorization.unauthenticated',
] as const)
export type BreedingAuthorizationReasonId = typeof BREEDING_AUTHORIZATION_REASON_IDS[number]

export interface BreedingActorAuthorityV1 {
  readonly schemaVersion: 1
  readonly role: 'gm' | 'player'
  readonly commandActorProfileId: string
  readonly authenticatedProfileId: PlayerProfileId | null
  readonly selectedTrainerSlug: string | null
  readonly profileDefinitionSha256: string | null
  readonly authenticatedPrincipalSha256: string
  readonly authenticationPolicyDefinitionSha256: string
  readonly evaluatedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingTrainerControlEvidenceV1 {
  readonly schemaVersion: 1
  readonly profileId: PlayerProfileId
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly trainerSheetDefinitionSha256: string
  readonly profileDefinitionSha256: string
  readonly linkedCharacterEvidenceSha256: string
  readonly evaluatedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingParentControlEvidenceV1 {
  readonly schemaVersion: 1
  readonly parentSheetSlug: string
  readonly parentSheetRevision: number
  readonly parentSheetDefinitionSha256: string
  readonly ownerTrainerSlug: string
  readonly ownerTrainerRevision: number
  readonly ownerTrainerDefinitionSha256: string
  readonly rosterField: 'boxed-pokemon' | 'current-team'
  readonly verificationMode: 'gm-verified' | 'profile-control' | 'server-verified-link'
  readonly trainerControlEvidenceDefinitionSha256: string | null
  readonly parentLinkEvidenceSha256: string
  readonly evaluatedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingBreederAuthorityEvidenceV1 {
  readonly schemaVersion: 1
  readonly breederTrainerSlug: string
  readonly breederTrainerRevision: number
  readonly breederTrainerDefinitionSha256: string
  readonly accessMode: BreedingBreederAccessMode
  readonly accessEvidenceDefinitionSha256: string
  readonly edgeCanonicalId: 'Breeder'
  readonly edgeInstanceId: string
  readonly edgeRecordSha256: string
  readonly effectiveEdgeProjectionSha256: string
  /** Absent only on pre-BR-061 direct-Edge schema-v1 evidence and then means pokemon-education. */
  readonly mandatedSkillId?: BreedingBreederMandatedSkillId
  readonly pokemonEducationRank: PokemonEducationRank
  readonly pokemonEducationSkillTotal: number
  readonly evaluatedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingCrossOwnerConsentEvidenceV1 {
  readonly schemaVersion: 1
  readonly consentId: BreedingConsentId
  readonly consentRevision: number
  readonly consentRecordDefinitionSha256: string
  readonly projectId: BreedingProjectId
  readonly parentSheetSlug: string
  readonly parentSheetRevision: number
  readonly ownerTrainerSlug: string
  readonly consentingProfileId: PlayerProfileId
  readonly scopes: readonly BreedingConsentScope[]
  readonly expiresAtCampaignMinute: number | null
  readonly trainerControlEvidenceDefinitionSha256: string
  readonly validationOperationId: BreedingOperationId
  readonly validationCommandSha256: string
  readonly validatedAtCampaignMinute: number
  readonly definitionSha256: string
}
export type BreedingGmOverrideTargetV1 =
  | { readonly kind: 'trainer-sheet', readonly trainerSheetSlug: string }
  | { readonly kind: 'parent-sheet', readonly parentSheetSlug: string, readonly parentSheetRevision: number }
  | { readonly kind: 'breeding-operation', readonly operationId: BreedingOperationId }
export interface BreedingGmOverrideEvidenceV1 {
  readonly schemaVersion: 1
  readonly overrideId: BreedingOverrideId
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly actorAuthorityDefinitionSha256: string
  readonly overrideKind: BreedingGmOverrideKind
  readonly target: BreedingGmOverrideTargetV1
  readonly reasonId: string
  readonly createdAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
  readonly definitionSha256: string
}
export interface BreedingAuthorizationReceiptV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly commandKind: BreedingOperationCommandKind
  readonly actorAuthorityDefinitionSha256: string
  readonly readSetDefinitionSha256: string
  readonly evidenceDefinitionHashes: readonly string[]
  readonly gmOverrideIds: readonly BreedingOverrideId[]
  readonly authorized: boolean
  readonly reasonId: BreedingAuthorizationReasonId
  readonly evaluatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
  readonly definitionSha256: string
}

export type BreedingAuthorizationValidationCode =
  | 'breeding.authorization.invalid-document'
  | 'breeding.authorization.unknown-field'
  | 'breeding.authorization.invalid-id'
  | 'breeding.authorization.invalid-invariant'
export class BreedingAuthorizationValidationError extends Error {
  readonly code: BreedingAuthorizationValidationCode
  readonly path: string
  constructor(code: BreedingAuthorizationValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingAuthorizationValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const REASON = /^breeding\.override\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const RANKS = new Set<string>(['Untrained', 'Novice', 'Adept', 'Expert', 'Master'])
const ACCESS_MODES = new Set<string>(BREEDING_BREEDER_ACCESS_MODES)
const MANDATED_SKILL_IDS = new Set<string>(BREEDING_BREEDER_MANDATED_SKILL_IDS)
const OVERRIDE_KINDS = new Set<string>(BREEDING_GM_OVERRIDE_KINDS)
const COMMAND_KINDS = new Set<string>(BREEDING_OPERATION_COMMAND_KINDS)
const AUTHORIZATION_REASONS = new Set<string>(BREEDING_AUTHORIZATION_REASON_IDS)
const fail = (code: BreedingAuthorizationValidationCode, path: string, message: string): never => { throw new BreedingAuthorizationValidationError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.authorization.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.authorization.invalid-document', path, 'must be a plain data object without symbols.')
  for (const key of Object.getOwnPropertyNames(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.authorization.invalid-document', `${path}.${key}`, 'must be an enumerable data field.') }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path); const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail('breeding.authorization.unknown-field', path, 'must contain exactly the declared fields.')
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.authorization.invalid-document', path, `must be an array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.authorization.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.') }
  if (Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail('breeding.authorization.unknown-field', path, 'cannot contain enriched fields.')
  return value
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum ? value as number : fail('breeding.authorization.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.authorization.invalid-document', path, 'must be a lowercase SHA-256 value.')
const nullableHash = (value: unknown, path: string): string | null => value === null ? null : hash(value, path)
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value) ? value : fail('breeding.authorization.invalid-id', path, 'must be a bounded stable identifier.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160 ? value : fail('breeding.authorization.invalid-id', path, 'must be a canonical sheet slug.')
const profileId = (value: unknown, path: string): PlayerProfileId => isPlayerProfileId(value) ? value : fail('breeding.authorization.invalid-id', path, 'must be a stored Player Profile ID.')
const freeze = <Value>(value: Value): Value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value) } return value }
const sortedUnique = <Value extends string>(values: readonly Value[], path: string): readonly Value[] => { for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) fail('breeding.authorization.invalid-invariant', path, 'must be unique in strict code-point order.'); return Object.freeze([...values]) }

export const parseBreedingActorAuthorityV1 = (value: unknown, path = 'actorAuthority'): BreedingActorAuthorityV1 => {
  const row = exact(value, ['schemaVersion', 'role', 'commandActorProfileId', 'authenticatedProfileId', 'selectedTrainerSlug', 'profileDefinitionSha256', 'authenticatedPrincipalSha256', 'authenticationPolicyDefinitionSha256', 'evaluatedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || (row.role !== 'gm' && row.role !== 'player')) fail('breeding.authorization.invalid-document', path, 'must be schema v1 with an authenticated role.')
  const authenticatedProfileId = row.authenticatedProfileId === null ? null : profileId(row.authenticatedProfileId, `${path}.authenticatedProfileId`)
  const profileDefinition = nullableHash(row.profileDefinitionSha256, `${path}.profileDefinitionSha256`)
  if (row.role === 'player' && (!authenticatedProfileId || !profileDefinition || row.commandActorProfileId !== authenticatedProfileId)) fail('breeding.authorization.invalid-invariant', path, 'player authority requires the exact current command Profile and Profile definition.')
  if (row.role === 'gm' && (authenticatedProfileId !== null || profileDefinition !== null)) fail('breeding.authorization.invalid-invariant', path, 'GM authority is principal-bound and cannot adopt a submitted player Profile.')
  return freeze({ schemaVersion: 1, role: row.role, commandActorProfileId: identifier(row.commandActorProfileId, `${path}.commandActorProfileId`), authenticatedProfileId, selectedTrainerSlug: row.selectedTrainerSlug === null ? null : slug(row.selectedTrainerSlug, `${path}.selectedTrainerSlug`), profileDefinitionSha256: profileDefinition, authenticatedPrincipalSha256: hash(row.authenticatedPrincipalSha256, `${path}.authenticatedPrincipalSha256`), authenticationPolicyDefinitionSha256: hash(row.authenticationPolicyDefinitionSha256, `${path}.authenticationPolicyDefinitionSha256`), evaluatedAtCampaignMinute: integer(row.evaluatedAtCampaignMinute, `${path}.evaluatedAtCampaignMinute`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) }) as BreedingActorAuthorityV1
}
export const parseBreedingTrainerControlEvidenceV1 = (value: unknown, path = 'trainerControl'): BreedingTrainerControlEvidenceV1 => {
  const row = exact(value, ['schemaVersion', 'profileId', 'trainerSheetSlug', 'trainerSheetRevision', 'trainerSheetDefinitionSha256', 'profileDefinitionSha256', 'linkedCharacterEvidenceSha256', 'evaluatedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1) fail('breeding.authorization.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  return freeze({ schemaVersion: 1, profileId: profileId(row.profileId, `${path}.profileId`), trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`), trainerSheetRevision: integer(row.trainerSheetRevision, `${path}.trainerSheetRevision`), trainerSheetDefinitionSha256: hash(row.trainerSheetDefinitionSha256, `${path}.trainerSheetDefinitionSha256`), profileDefinitionSha256: hash(row.profileDefinitionSha256, `${path}.profileDefinitionSha256`), linkedCharacterEvidenceSha256: hash(row.linkedCharacterEvidenceSha256, `${path}.linkedCharacterEvidenceSha256`), evaluatedAtCampaignMinute: integer(row.evaluatedAtCampaignMinute, `${path}.evaluatedAtCampaignMinute`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
export const parseBreedingParentControlEvidenceV1 = (value: unknown, path = 'parentControl'): BreedingParentControlEvidenceV1 => {
  const row = exact(value, ['schemaVersion', 'parentSheetSlug', 'parentSheetRevision', 'parentSheetDefinitionSha256', 'ownerTrainerSlug', 'ownerTrainerRevision', 'ownerTrainerDefinitionSha256', 'rosterField', 'verificationMode', 'trainerControlEvidenceDefinitionSha256', 'parentLinkEvidenceSha256', 'evaluatedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || (row.rosterField !== 'boxed-pokemon' && row.rosterField !== 'current-team') || (row.verificationMode !== 'gm-verified' && row.verificationMode !== 'profile-control' && row.verificationMode !== 'server-verified-link')) fail('breeding.authorization.invalid-document', path, 'must be a v1 parent-control record.')
  const controlHash = nullableHash(row.trainerControlEvidenceDefinitionSha256, `${path}.trainerControlEvidenceDefinitionSha256`)
  if ((row.verificationMode === 'profile-control') !== (controlHash !== null)) fail('breeding.authorization.invalid-invariant', path, 'profile-control alone requires Trainer-control evidence.')
  return freeze({ schemaVersion: 1, parentSheetSlug: slug(row.parentSheetSlug, `${path}.parentSheetSlug`), parentSheetRevision: integer(row.parentSheetRevision, `${path}.parentSheetRevision`), parentSheetDefinitionSha256: hash(row.parentSheetDefinitionSha256, `${path}.parentSheetDefinitionSha256`), ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`), ownerTrainerRevision: integer(row.ownerTrainerRevision, `${path}.ownerTrainerRevision`), ownerTrainerDefinitionSha256: hash(row.ownerTrainerDefinitionSha256, `${path}.ownerTrainerDefinitionSha256`), rosterField: row.rosterField as 'boxed-pokemon' | 'current-team', verificationMode: row.verificationMode as 'gm-verified' | 'profile-control' | 'server-verified-link', trainerControlEvidenceDefinitionSha256: controlHash, parentLinkEvidenceSha256: hash(row.parentLinkEvidenceSha256, `${path}.parentLinkEvidenceSha256`), evaluatedAtCampaignMinute: integer(row.evaluatedAtCampaignMinute, `${path}.evaluatedAtCampaignMinute`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
export const parseBreedingBreederAuthorityEvidenceV1 = (value: unknown, path = 'breederAuthority'): BreedingBreederAuthorityEvidenceV1 => {
  const hasMandatedSkill = Boolean(value && typeof value === 'object' && Object.hasOwn(value, 'mandatedSkillId'))
  const row = exact(value, ['schemaVersion', 'breederTrainerSlug', 'breederTrainerRevision', 'breederTrainerDefinitionSha256', 'accessMode', 'accessEvidenceDefinitionSha256', 'edgeCanonicalId', 'edgeInstanceId', 'edgeRecordSha256', 'effectiveEdgeProjectionSha256', ...(hasMandatedSkill ? ['mandatedSkillId'] : []), 'pokemonEducationRank', 'pokemonEducationSkillTotal', 'evaluatedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.accessMode !== 'string' || !ACCESS_MODES.has(row.accessMode) || row.edgeCanonicalId !== 'Breeder' || typeof row.pokemonEducationRank !== 'string' || !RANKS.has(row.pokemonEducationRank) || (hasMandatedSkill && (typeof row.mandatedSkillId !== 'string' || !MANDATED_SKILL_IDS.has(row.mandatedSkillId)))) fail('breeding.authorization.invalid-document', path, 'must be canonical effective Breeder authority.')
  return freeze({ schemaVersion: 1, breederTrainerSlug: slug(row.breederTrainerSlug, `${path}.breederTrainerSlug`), breederTrainerRevision: integer(row.breederTrainerRevision, `${path}.breederTrainerRevision`), breederTrainerDefinitionSha256: hash(row.breederTrainerDefinitionSha256, `${path}.breederTrainerDefinitionSha256`), accessMode: row.accessMode as BreedingBreederAccessMode, accessEvidenceDefinitionSha256: hash(row.accessEvidenceDefinitionSha256, `${path}.accessEvidenceDefinitionSha256`), edgeCanonicalId: 'Breeder', edgeInstanceId: identifier(row.edgeInstanceId, `${path}.edgeInstanceId`), edgeRecordSha256: hash(row.edgeRecordSha256, `${path}.edgeRecordSha256`), effectiveEdgeProjectionSha256: hash(row.effectiveEdgeProjectionSha256, `${path}.effectiveEdgeProjectionSha256`), ...(hasMandatedSkill ? { mandatedSkillId: row.mandatedSkillId as BreedingBreederMandatedSkillId } : {}), pokemonEducationRank: row.pokemonEducationRank as PokemonEducationRank, pokemonEducationSkillTotal: integer(row.pokemonEducationSkillTotal, `${path}.pokemonEducationSkillTotal`, -30, 100), evaluatedAtCampaignMinute: integer(row.evaluatedAtCampaignMinute, `${path}.evaluatedAtCampaignMinute`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
export const parseBreedingCrossOwnerConsentEvidenceV1 = (value: unknown, path = 'consentEvidence'): BreedingCrossOwnerConsentEvidenceV1 => {
  const row = exact(value, ['schemaVersion', 'consentId', 'consentRevision', 'consentRecordDefinitionSha256', 'projectId', 'parentSheetSlug', 'parentSheetRevision', 'ownerTrainerSlug', 'consentingProfileId', 'scopes', 'expiresAtCampaignMinute', 'trainerControlEvidenceDefinitionSha256', 'validationOperationId', 'validationCommandSha256', 'validatedAtCampaignMinute', 'definitionSha256'], path)
  if (row.schemaVersion !== 1) fail('breeding.authorization.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  const scopes = array(row.scopes, `${path}.scopes`, BREEDING_CONSENT_SCOPES.length).map((entry, index) => typeof entry === 'string' && (BREEDING_CONSENT_SCOPES as readonly string[]).includes(entry) ? entry as BreedingConsentScope : fail('breeding.authorization.invalid-document', `${path}.scopes[${index}]`, 'must be a consent scope.'))
  sortedUnique(scopes, `${path}.scopes`)
  if (scopes.length !== BREEDING_CONSENT_SCOPES.length || BREEDING_CONSENT_SCOPES.some(scope => !scopes.includes(scope))) fail('breeding.authorization.invalid-invariant', `${path}.scopes`, 'must include all three positive cross-owner scopes.')
  const validatedAt = integer(row.validatedAtCampaignMinute, `${path}.validatedAtCampaignMinute`)
  const expiresAt = row.expiresAtCampaignMinute === null ? null : integer(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`)
  if (expiresAt !== null && validatedAt >= expiresAt) fail('breeding.authorization.invalid-invariant', `${path}.expiresAtCampaignMinute`, 'must remain active after the validation checkpoint.')
  return freeze({ schemaVersion: 1, consentId: parseBreedingConsentIdSyntax(row.consentId) ?? fail('breeding.authorization.invalid-id', `${path}.consentId`, 'must be a breeding consent ID.'), consentRevision: integer(row.consentRevision, `${path}.consentRevision`, 0, 1), consentRecordDefinitionSha256: hash(row.consentRecordDefinitionSha256, `${path}.consentRecordDefinitionSha256`), projectId: parseBreedingProjectIdSyntax(row.projectId) ?? fail('breeding.authorization.invalid-id', `${path}.projectId`, 'must be a breeding project ID.'), parentSheetSlug: slug(row.parentSheetSlug, `${path}.parentSheetSlug`), parentSheetRevision: integer(row.parentSheetRevision, `${path}.parentSheetRevision`), ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`), consentingProfileId: profileId(row.consentingProfileId, `${path}.consentingProfileId`), scopes: Object.freeze(scopes), expiresAtCampaignMinute: expiresAt, trainerControlEvidenceDefinitionSha256: hash(row.trainerControlEvidenceDefinitionSha256, `${path}.trainerControlEvidenceDefinitionSha256`), validationOperationId: parseBreedingOperationIdSyntax(row.validationOperationId) ?? fail('breeding.authorization.invalid-id', `${path}.validationOperationId`, 'must be a breeding operation ID.'), validationCommandSha256: hash(row.validationCommandSha256, `${path}.validationCommandSha256`), validatedAtCampaignMinute: validatedAt, definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
const parseOverrideTarget = (kind: BreedingGmOverrideKind, value: unknown, path: string): BreedingGmOverrideTargetV1 => {
  const expectedTarget = kind === 'owner-control' || kind === 'breeder-access' || kind === 'breeder-permission' ? 'trainer-sheet' : kind === 'parent-control' || kind === 'cross-owner-consent' ? 'parent-sheet' : 'breeding-operation'
  const root = record(value, path)
  if (root.kind !== expectedTarget) fail('breeding.authorization.invalid-invariant', `${path}.kind`, `must be ${expectedTarget} for ${kind}.`)
  if (root.kind === 'trainer-sheet') { const row = exact(root, ['kind', 'trainerSheetSlug'], path); return freeze({ kind: 'trainer-sheet', trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`) }) }
  if (root.kind === 'parent-sheet') { const row = exact(root, ['kind', 'parentSheetSlug', 'parentSheetRevision'], path); return freeze({ kind: 'parent-sheet', parentSheetSlug: slug(row.parentSheetSlug, `${path}.parentSheetSlug`), parentSheetRevision: integer(row.parentSheetRevision, `${path}.parentSheetRevision`) }) }
  const row = exact(root, ['kind', 'operationId'], path); return freeze({ kind: 'breeding-operation', operationId: parseBreedingOperationIdSyntax(row.operationId) ?? fail('breeding.authorization.invalid-id', `${path}.operationId`, 'must be a breeding operation ID.') })
}
export const parseBreedingGmOverrideEvidenceV1 = (value: unknown, path = 'gmOverride'): BreedingGmOverrideEvidenceV1 => {
  const row = exact(value, ['schemaVersion', 'overrideId', 'operationId', 'commandSha256', 'actorAuthorityDefinitionSha256', 'overrideKind', 'target', 'reasonId', 'createdAtCampaignMinute', 'securityPolicyDefinitionSha256', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.overrideKind !== 'string' || !OVERRIDE_KINDS.has(row.overrideKind)) fail('breeding.authorization.invalid-document', path, 'must be a v1 GM override kind.')
  if (typeof row.reasonId !== 'string' || !REASON.test(row.reasonId) || row.reasonId.length > 160) fail('breeding.authorization.invalid-id', `${path}.reasonId`, 'must be a typed breeding override reason ID.')
  const overrideKind = row.overrideKind as BreedingGmOverrideKind
  return freeze({ schemaVersion: 1, overrideId: parseBreedingOverrideIdSyntax(row.overrideId) ?? fail('breeding.authorization.invalid-id', `${path}.overrideId`, 'must be a breeding override ID.'), operationId: parseBreedingOperationIdSyntax(row.operationId) ?? fail('breeding.authorization.invalid-id', `${path}.operationId`, 'must be a breeding operation ID.'), commandSha256: hash(row.commandSha256, `${path}.commandSha256`), actorAuthorityDefinitionSha256: hash(row.actorAuthorityDefinitionSha256, `${path}.actorAuthorityDefinitionSha256`), overrideKind, target: parseOverrideTarget(overrideKind, row.target, `${path}.target`), reasonId: row.reasonId as string, createdAtCampaignMinute: integer(row.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`), securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
export const parseBreedingAuthorizationReceiptV1 = (value: unknown, path = 'authorizationReceipt'): BreedingAuthorizationReceiptV1 => {
  const row = exact(value, ['schemaVersion', 'operationId', 'commandSha256', 'commandKind', 'actorAuthorityDefinitionSha256', 'readSetDefinitionSha256', 'evidenceDefinitionHashes', 'gmOverrideIds', 'authorized', 'reasonId', 'evaluatedAtCampaignMinute', 'securityPolicyDefinitionSha256', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.commandKind !== 'string' || !COMMAND_KINDS.has(row.commandKind) || typeof row.authorized !== 'boolean' || typeof row.reasonId !== 'string' || !AUTHORIZATION_REASONS.has(row.reasonId)) fail('breeding.authorization.invalid-document', path, 'must be a v1 authorization receipt.')
  if (row.authorized !== (row.reasonId === 'breeding.authorization.authorized')) fail('breeding.authorization.invalid-invariant', `${path}.reasonId`, 'must match the authorization decision.')
  const evidenceHashes = array(row.evidenceDefinitionHashes, `${path}.evidenceDefinitionHashes`, 32).map((entry, index) => hash(entry, `${path}.evidenceDefinitionHashes[${index}]`))
  sortedUnique(evidenceHashes, `${path}.evidenceDefinitionHashes`)
  const overrideIds = array(row.gmOverrideIds, `${path}.gmOverrideIds`, 8).map((entry, index) => parseBreedingOverrideIdSyntax(entry) ?? fail('breeding.authorization.invalid-id', `${path}.gmOverrideIds[${index}]`, 'must be a breeding override ID.'))
  sortedUnique(overrideIds, `${path}.gmOverrideIds`)
  return freeze({ schemaVersion: 1, operationId: parseBreedingOperationIdSyntax(row.operationId) ?? fail('breeding.authorization.invalid-id', `${path}.operationId`, 'must be a breeding operation ID.'), commandSha256: hash(row.commandSha256, `${path}.commandSha256`), commandKind: row.commandKind as BreedingOperationCommandKind, actorAuthorityDefinitionSha256: hash(row.actorAuthorityDefinitionSha256, `${path}.actorAuthorityDefinitionSha256`), readSetDefinitionSha256: hash(row.readSetDefinitionSha256, `${path}.readSetDefinitionSha256`), evidenceDefinitionHashes: Object.freeze(evidenceHashes), gmOverrideIds: Object.freeze(overrideIds), authorized: row.authorized, reasonId: row.reasonId as BreedingAuthorizationReasonId, evaluatedAtCampaignMinute: integer(row.evaluatedAtCampaignMinute, `${path}.evaluatedAtCampaignMinute`), securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) }) as BreedingAuthorizationReceiptV1
}
