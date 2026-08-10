import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonObject } from '../automation/strictJson'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'
import { isSlug } from '../paths'
import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import {
  parseBreedingConsentIdSyntax,
  parseBreedingProjectIdSyntax,
  parsePokemonEggIdSyntax,
  parsePokemonEggTransferConsentIdSyntax,
  type BreedingConsentId,
  type BreedingProjectId,
  type PokemonEggId,
  type PokemonEggTransferConsentId,
} from './ids'
import { BREEDING_CONSENT_SCOPES, type BreedingConsentScope } from './operations'
import type { PokemonEggTransferProjectionStateV1 } from './eggTransfer'

export const BREEDING_CONSENT_WORKFLOW_API_PATH = '/api/breeding/consent' as const
export const BREEDING_CONSENT_WORKFLOW_CARD_LIMIT = 50 as const
export const BREEDING_CONSENT_WORKFLOW_CONSENT_DURATION = 43_200 as const
export const BREEDING_CONSENT_WORKFLOW_INTENTS = Object.freeze([
  'view',
  'grant-project-consent',
  'revoke-project-consent',
  'offer-egg-transfer',
  'accept-egg-transfer',
  'revoke-egg-transfer-consent',
  'complete-egg-transfer',
  'gm-cancel-project',
] as const)
export type BreedingConsentWorkflowIntent = typeof BREEDING_CONSENT_WORKFLOW_INTENTS[number]
export const BREEDING_CONSENT_WORKFLOW_TRANSITIONS = Object.freeze([
  'none',
  'project-consent-granted',
  'project-consent-revoked',
  'egg-transfer-offered',
  'egg-transfer-accepted',
  'egg-transfer-consent-revoked',
  'egg-transferred',
  'project-cancelled-by-gm',
  'exact-replay',
] as const)
export type BreedingConsentWorkflowTransition = typeof BREEDING_CONSENT_WORKFLOW_TRANSITIONS[number]
export type BreedingProjectConsentPresentationStatus = 'active' | 'expired' | 'revoked' | 'stale' | 'waiting'

export interface BreedingConsentWorkflowRequestV1 {
  readonly schemaVersion: 1
  readonly profileId: PlayerProfileId | null
  readonly trainerSheetSlug: string
  readonly intent: BreedingConsentWorkflowIntent
  readonly projectId: BreedingProjectId | null
  readonly expectedProjectRevision: number | null
  readonly parentSheetSlug: string | null
  readonly consentId: BreedingConsentId | null
  readonly eggId: PokemonEggId | null
  readonly expectedEggRevision: number | null
  readonly destinationTrainerSlug: string | null
  readonly transferConsentId: PokemonEggTransferConsentId | null
  readonly confirmed: boolean
}
export interface BreedingConsentWorkflowContextV1 {
  readonly trainerSheetSlug: string
  readonly trainerRevision: number
  readonly displayName: string
}
export interface BreedingConsentWorkflowProjectRequestV1 {
  readonly projectId: BreedingProjectId
  readonly projectRevision: number
  readonly coarseStatus: 'awaiting-consent' | 'in-progress' | 'ready' | 'ended'
  readonly ownParent: {
    readonly pokemonSheetSlug: string
    readonly expectedSheetRevision: number
    readonly displayName: string
    readonly current: boolean
  }
  readonly breederDisplayName: string
  readonly consent: {
    readonly consentId: BreedingConsentId | null
    readonly status: BreedingProjectConsentPresentationStatus
    readonly scopes: readonly BreedingConsentScope[]
    readonly expiresAtCampaignMinute: number | null
  }
  readonly canGrant: boolean
  readonly canRevoke: boolean
  readonly ownerTrainerSlug: string | null
  readonly participantTrainerSlug: string | null
  readonly recovery: {
    readonly state: 'none' | 'pending'
    readonly pendingSinceCampaignMinute: number | null
  }
  readonly gmReview: {
    readonly setupOverrideKind: 'cross-owner-consent'
    readonly setupOverrideOnly: true
    readonly consentSubstitutionAllowed: false
    readonly canCancelProject: boolean
  } | null
}
export interface BreedingConsentWorkflowEggTransferV1 {
  readonly offerConsentId: PokemonEggTransferConsentId
  readonly ownConsentId: PokemonEggTransferConsentId
  readonly eggId: PokemonEggId
  readonly eggRevision: number
  readonly audience: 'recipient' | 'source-owner'
  readonly state: PokemonEggTransferProjectionStateV1
  readonly expiresAtCampaignMinute: number
  readonly canAccept: boolean
  readonly canTransfer: boolean
  readonly canRevoke: boolean
  readonly ownConsentActive: boolean
  readonly recovery: {
    readonly state: 'none' | 'pending'
    readonly pendingSinceCampaignMinute: number | null
  }
}
export interface BreedingConsentWorkflowProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'player'
  readonly context: BreedingConsentWorkflowContextV1
  readonly generatedAtCampaignMinute: number
  readonly notifications: {
    readonly projectRequests: number
    readonly transferInvitations: number
    readonly readyTransfers: number
    readonly total: number
  }
  readonly projectRequestsTruncated: boolean
  readonly eggTransfersTruncated: boolean
  readonly projectRequests: readonly BreedingConsentWorkflowProjectRequestV1[]
  readonly eggTransfers: readonly BreedingConsentWorkflowEggTransferV1[]
  readonly gmPolicy: {
    readonly setupOverrideOnly: true
    readonly positiveConsentSubstitutionAllowed: false
    readonly transferRequiresTwoPositiveConsents: true
  } | null
  readonly transition: BreedingConsentWorkflowTransition
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}

export class BreedingConsentWorkflowContractError extends Error {
  readonly code:
    | 'breeding.consent-workflow.hash-mismatch'
    | 'breeding.consent-workflow.invalid-document'
    | 'breeding.consent-workflow.invalid-id'
    | 'breeding.consent-workflow.invalid-invariant'
    | 'breeding.consent-workflow.security-policy-mismatch'
  readonly path: string
  constructor(code: BreedingConsentWorkflowContractError['code'], path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingConsentWorkflowContractError'
    this.code = code
    this.path = path
  }
}

const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL = /[\u0000-\u001f\u007f]/u
const INTENTS = new Set<string>(BREEDING_CONSENT_WORKFLOW_INTENTS)
const TRANSITIONS = new Set<string>(BREEDING_CONSENT_WORKFLOW_TRANSITIONS)
const PROJECT_CONSENT_STATUSES = new Set<string>(['active', 'expired', 'revoked', 'stale', 'waiting'])
const TRANSFER_STATES = new Set<string>(['offered', 'accepted', 'transferred', 'revoked', 'expired'])
const fail = (code: BreedingConsentWorkflowContractError['code'], path: string, message: string): never => {
  throw new BreedingConsentWorkflowContractError(code, path, message)
}
const clone = (value: unknown, path: string): StrictJsonObject => {
  const result = cloneStrictJson(value, path, {
    limits: {
      depth: 9,
      nodes: 8_000,
      objectFields: 24,
      arrayEntries: BREEDING_CONSENT_WORKFLOW_CARD_LIMIT,
      stringLength: 240,
      objectKeyLength: 80,
    },
    rootLabel: path,
    valueLabel: 'Breeding consent workflow',
    failNotJson: (field, detail) => fail('breeding.consent-workflow.invalid-document', field, detail),
    failLimit: (field, detail) => fail('breeding.consent-workflow.invalid-document', field, detail),
  })
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return fail('breeding.consent-workflow.invalid-document', path, 'must be one plain object.')
  }
  return result as StrictJsonObject
}
const exact = (value: unknown, fields: readonly string[], path: string): StrictJsonObject => {
  const row = clone(value, path)
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.consent-workflow.invalid-document', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string, maximum = 2_147_483_647): number => (
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
    ? Number(value)
    : fail('breeding.consent-workflow.invalid-document', path, 'must be a bounded nonnegative safe integer.')
)
const nullableInteger = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)
const text = (value: unknown, path: string): string => (
  typeof value === 'string' && value.length > 0 && value.length <= 120
    && value.trim() === value && !CONTROL.test(value)
    ? value
    : fail('breeding.consent-workflow.invalid-document', path, 'must be bounded safe display text.')
)
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.consent-workflow.invalid-id', path, 'must be a bounded canonical slug.')
const nullableSlug = (value: unknown, path: string): string | null => value === null ? null : slug(value, path)
const bool = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value
  : fail('breeding.consent-workflow.invalid-document', path, 'must be boolean.')
const recovery = (value: unknown, path: string): { readonly state: 'none' | 'pending', readonly pendingSinceCampaignMinute: number | null } => {
  const row = exact(value, ['state', 'pendingSinceCampaignMinute'], path)
  if (row.state !== 'none' && row.state !== 'pending') {
    return fail('breeding.consent-workflow.invalid-document', `${path}.state`, 'must be none or pending.')
  }
  const pendingSinceCampaignMinute = nullableInteger(row.pendingSinceCampaignMinute, `${path}.pendingSinceCampaignMinute`)
  if ((row.state === 'pending') !== (pendingSinceCampaignMinute !== null)) {
    return fail('breeding.consent-workflow.invalid-invariant', path, 'pending state and campaign minute must agree.')
  }
  return { state: row.state, pendingSinceCampaignMinute }
}
const projectId = (value: unknown, path: string): BreedingProjectId | null => value === null
  ? null
  : parseBreedingProjectIdSyntax(value) ?? fail('breeding.consent-workflow.invalid-id', path, 'must be a Project ID or null.')
const consentId = (value: unknown, path: string): BreedingConsentId | null => value === null
  ? null
  : parseBreedingConsentIdSyntax(value) ?? fail('breeding.consent-workflow.invalid-id', path, 'must be a Project consent ID or null.')
const eggId = (value: unknown, path: string): PokemonEggId | null => value === null
  ? null
  : parsePokemonEggIdSyntax(value) ?? fail('breeding.consent-workflow.invalid-id', path, 'must be an Egg ID or null.')
const transferConsentId = (value: unknown, path: string): PokemonEggTransferConsentId | null => value === null
  ? null
  : parsePokemonEggTransferConsentIdSyntax(value) ?? fail('breeding.consent-workflow.invalid-id', path, 'must be an Egg-transfer consent ID or null.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.consent-workflow.invalid-document', path, 'must be a lowercase SHA-256 digest.')

export const BREEDING_CONSENT_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256 = hash(
  securityPolicyJson.definitionSha256,
  'securityPolicy.definitionSha256',
)

export const parseBreedingConsentWorkflowRequestV1 = (
  value: unknown,
  path = 'consentWorkflowRequest',
): BreedingConsentWorkflowRequestV1 => {
  const row = exact(value, [
    'schemaVersion', 'profileId', 'trainerSheetSlug', 'intent', 'projectId',
    'expectedProjectRevision', 'parentSheetSlug', 'consentId', 'eggId',
    'expectedEggRevision', 'destinationTrainerSlug', 'transferConsentId', 'confirmed',
  ], path)
  if (row.schemaVersion !== 1 || typeof row.intent !== 'string' || !INTENTS.has(row.intent)) {
    return fail('breeding.consent-workflow.invalid-document', path, 'must be one schema-v1 closed workflow request.')
  }
  const request = {
    schemaVersion: 1 as const,
    profileId: row.profileId === null ? null : isPlayerProfileId(row.profileId)
      ? row.profileId
      : fail('breeding.consent-workflow.invalid-id', `${path}.profileId`, 'must be a Player Profile ID or null.'),
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    intent: row.intent as BreedingConsentWorkflowIntent,
    projectId: projectId(row.projectId, `${path}.projectId`),
    expectedProjectRevision: nullableInteger(row.expectedProjectRevision, `${path}.expectedProjectRevision`),
    parentSheetSlug: nullableSlug(row.parentSheetSlug, `${path}.parentSheetSlug`),
    consentId: consentId(row.consentId, `${path}.consentId`),
    eggId: eggId(row.eggId, `${path}.eggId`),
    expectedEggRevision: nullableInteger(row.expectedEggRevision, `${path}.expectedEggRevision`),
    destinationTrainerSlug: nullableSlug(row.destinationTrainerSlug, `${path}.destinationTrainerSlug`),
    transferConsentId: transferConsentId(row.transferConsentId, `${path}.transferConsentId`),
    confirmed: bool(row.confirmed, `${path}.confirmed`),
  }
  const projectSelector = request.projectId !== null || request.expectedProjectRevision !== null
    || request.parentSheetSlug !== null || request.consentId !== null
  const eggSelector = request.eggId !== null || request.expectedEggRevision !== null
    || request.destinationTrainerSlug !== null || request.transferConsentId !== null
  const valid = request.intent === 'view'
    ? !projectSelector && !eggSelector && !request.confirmed
    : request.intent === 'grant-project-consent'
      ? request.projectId !== null && request.expectedProjectRevision !== null && request.parentSheetSlug !== null
        && request.consentId === null && !eggSelector && request.confirmed
      : request.intent === 'revoke-project-consent'
        ? request.projectId !== null && request.expectedProjectRevision !== null && request.parentSheetSlug === null
          && request.consentId !== null && !eggSelector && request.confirmed
        : request.intent === 'gm-cancel-project'
          ? request.projectId !== null && request.expectedProjectRevision !== null && request.parentSheetSlug === null
            && request.consentId === null && !eggSelector && request.confirmed
          : request.intent === 'offer-egg-transfer'
            ? !projectSelector && request.eggId !== null && request.expectedEggRevision !== null
              && request.destinationTrainerSlug !== null && request.transferConsentId === null && request.confirmed
            : request.intent === 'accept-egg-transfer' || request.intent === 'complete-egg-transfer'
              ? !projectSelector && request.eggId === null && request.expectedEggRevision !== null
                && request.destinationTrainerSlug === null && request.transferConsentId !== null && request.confirmed
              : !projectSelector && request.eggId === null && request.expectedEggRevision === null
                && request.destinationTrainerSlug === null && request.transferConsentId !== null && request.confirmed
  if (!valid) return fail('breeding.consent-workflow.invalid-invariant', path, 'intent, selectors, and explicit confirmation must agree exactly.')
  return deepFreezeStrictJson(request) as BreedingConsentWorkflowRequestV1
}

const parseContext = (value: unknown, path: string): BreedingConsentWorkflowContextV1 => {
  const row = exact(value, ['trainerSheetSlug', 'trainerRevision', 'displayName'], path)
  return { trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`), trainerRevision: integer(row.trainerRevision, `${path}.trainerRevision`), displayName: text(row.displayName, `${path}.displayName`) }
}
const parseScopes = (value: unknown, path: string): readonly BreedingConsentScope[] => {
  if (!Array.isArray(value) || value.length !== BREEDING_CONSENT_SCOPES.length) return fail('breeding.consent-workflow.invalid-document', path, 'must contain all positive consent scopes.')
  const scopes = value.map((entry, index) => typeof entry === 'string' && (BREEDING_CONSENT_SCOPES as readonly string[]).includes(entry)
    ? entry as BreedingConsentScope
    : fail('breeding.consent-workflow.invalid-id', `${path}[${index}]`, 'must be a positive consent scope.'))
  if (scopes.some((scope, index) => index > 0 && scopes[index - 1]! >= scope)
    || BREEDING_CONSENT_SCOPES.some(scope => !scopes.includes(scope))) {
    return fail('breeding.consent-workflow.invalid-invariant', path, 'must contain each scope once in code-point order.')
  }
  return scopes
}
const parseProjectRequest = (value: unknown, audience: 'gm' | 'player', path: string): BreedingConsentWorkflowProjectRequestV1 => {
  const row = exact(value, [
    'projectId', 'projectRevision', 'coarseStatus', 'ownParent', 'breederDisplayName',
    'consent', 'canGrant', 'canRevoke', 'ownerTrainerSlug', 'participantTrainerSlug', 'recovery', 'gmReview',
  ], path)
  const parsedProjectId = parseBreedingProjectIdSyntax(row.projectId)
    ?? fail('breeding.consent-workflow.invalid-id', `${path}.projectId`, 'must be a Project ID.')
  if (!['awaiting-consent', 'in-progress', 'ready', 'ended'].includes(row.coarseStatus as string)) {
    return fail('breeding.consent-workflow.invalid-id', `${path}.coarseStatus`, 'must be a closed coarse Project status.')
  }
  const own = exact(row.ownParent, ['pokemonSheetSlug', 'expectedSheetRevision', 'displayName', 'current'], `${path}.ownParent`)
  const consent = exact(row.consent, ['consentId', 'status', 'scopes', 'expiresAtCampaignMinute'], `${path}.consent`)
  if (typeof consent.status !== 'string' || !PROJECT_CONSENT_STATUSES.has(consent.status)) {
    return fail('breeding.consent-workflow.invalid-id', `${path}.consent.status`, 'must be a closed consent status.')
  }
  const parsedConsentId = consentId(consent.consentId, `${path}.consent.consentId`)
  const expiresAt = nullableInteger(consent.expiresAtCampaignMinute, `${path}.consent.expiresAtCampaignMinute`)
  const current = bool(own.current, `${path}.ownParent.current`)
  const canGrant = bool(row.canGrant, `${path}.canGrant`)
  const canRevoke = bool(row.canRevoke, `${path}.canRevoke`)
  const operationRecovery = recovery(row.recovery, `${path}.recovery`)
  const status = consent.status as BreedingProjectConsentPresentationStatus
  if ((status === 'waiting' && (parsedConsentId !== null || expiresAt !== null))
    || ((status === 'active' || status === 'expired' || status === 'revoked') && parsedConsentId === null)
    || (status === 'expired' && expiresAt === null)
    || (parsedConsentId === null && expiresAt !== null)
    || canGrant !== (operationRecovery.state === 'none' && audience === 'player' && current && row.coarseStatus !== 'ended' && (status === 'waiting' || status === 'revoked'))
    || canRevoke !== (operationRecovery.state === 'none' && audience === 'player' && current && row.coarseStatus !== 'ended' && status === 'active')
    || (status === 'stale') !== !current
    || (audience === 'player' && (row.ownerTrainerSlug !== null || row.participantTrainerSlug !== null || row.gmReview !== null))) {
    return fail('breeding.consent-workflow.invalid-invariant', path, 'audience, current parent, consent state, and actions must agree.')
  }
  let gmReview: BreedingConsentWorkflowProjectRequestV1['gmReview'] = null
  if (audience === 'gm') {
    const review = exact(row.gmReview, ['setupOverrideKind', 'setupOverrideOnly', 'consentSubstitutionAllowed', 'canCancelProject'], `${path}.gmReview`)
    if (review.setupOverrideKind !== 'cross-owner-consent' || review.setupOverrideOnly !== true
      || review.consentSubstitutionAllowed !== false || typeof review.canCancelProject !== 'boolean'
      || (operationRecovery.state === 'pending' && review.canCancelProject)) {
      return fail('breeding.consent-workflow.invalid-invariant', `${path}.gmReview`, 'must describe the bounded setup-only GM override policy.')
    }
    gmReview = { setupOverrideKind: 'cross-owner-consent', setupOverrideOnly: true, consentSubstitutionAllowed: false, canCancelProject: review.canCancelProject }
  }
  return {
    projectId: parsedProjectId,
    projectRevision: integer(row.projectRevision, `${path}.projectRevision`),
    coarseStatus: row.coarseStatus as BreedingConsentWorkflowProjectRequestV1['coarseStatus'],
    ownParent: {
      pokemonSheetSlug: slug(own.pokemonSheetSlug, `${path}.ownParent.pokemonSheetSlug`),
      expectedSheetRevision: integer(own.expectedSheetRevision, `${path}.ownParent.expectedSheetRevision`),
      displayName: text(own.displayName, `${path}.ownParent.displayName`),
      current,
    },
    breederDisplayName: text(row.breederDisplayName, `${path}.breederDisplayName`),
    consent: { consentId: parsedConsentId, status, scopes: parseScopes(consent.scopes, `${path}.consent.scopes`), expiresAtCampaignMinute: expiresAt },
    canGrant,
    canRevoke,
    ownerTrainerSlug: audience === 'gm' ? slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`) : null,
    participantTrainerSlug: audience === 'gm' ? slug(row.participantTrainerSlug, `${path}.participantTrainerSlug`) : null,
    recovery: operationRecovery,
    gmReview,
  }
}
const parseEggTransfer = (value: unknown, path: string): BreedingConsentWorkflowEggTransferV1 => {
  const row = exact(value, [
    'offerConsentId', 'ownConsentId', 'eggId', 'eggRevision', 'audience', 'state',
    'expiresAtCampaignMinute', 'canAccept', 'canTransfer', 'canRevoke', 'ownConsentActive', 'recovery',
  ], path)
  const offer = parsePokemonEggTransferConsentIdSyntax(row.offerConsentId)
    ?? fail('breeding.consent-workflow.invalid-id', `${path}.offerConsentId`, 'must be an Egg-transfer source consent ID.')
  const own = parsePokemonEggTransferConsentIdSyntax(row.ownConsentId)
    ?? fail('breeding.consent-workflow.invalid-id', `${path}.ownConsentId`, 'must be an Egg-transfer consent ID.')
  const parsedEgg = parsePokemonEggIdSyntax(row.eggId)
    ?? fail('breeding.consent-workflow.invalid-id', `${path}.eggId`, 'must be an Egg ID.')
  if ((row.audience !== 'recipient' && row.audience !== 'source-owner')
    || typeof row.state !== 'string' || !TRANSFER_STATES.has(row.state)) {
    return fail('breeding.consent-workflow.invalid-document', path, 'must be one closed transfer card.')
  }
  const state = row.state as PokemonEggTransferProjectionStateV1
  const canAccept = bool(row.canAccept, `${path}.canAccept`)
  const canTransfer = bool(row.canTransfer, `${path}.canTransfer`)
  const canRevoke = bool(row.canRevoke, `${path}.canRevoke`)
  const ownConsentActive = bool(row.ownConsentActive, `${path}.ownConsentActive`)
  const operationRecovery = recovery(row.recovery, `${path}.recovery`)
  if (canAccept !== (operationRecovery.state === 'none' && state === 'offered' && row.audience === 'recipient' && !ownConsentActive)
    || canTransfer !== (operationRecovery.state === 'none' && state === 'accepted' && ownConsentActive)
    || canRevoke !== (operationRecovery.state === 'none' && ownConsentActive && (state === 'offered' || state === 'accepted' || state === 'expired'))
    || (row.audience === 'source-owner' && own !== offer)
    || (row.audience === 'recipient' && ownConsentActive && own === offer)) {
    return fail('breeding.consent-workflow.invalid-invariant', path, 'transfer state, audience, identity, and actions must agree.')
  }
  return {
    offerConsentId: offer,
    ownConsentId: own,
    eggId: parsedEgg,
    eggRevision: integer(row.eggRevision, `${path}.eggRevision`),
    audience: row.audience,
    state,
    expiresAtCampaignMinute: integer(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`),
    canAccept,
    canTransfer,
    canRevoke,
    ownConsentActive,
    recovery: operationRecovery,
  }
}

export const parseBreedingConsentWorkflowProjectionV1 = (
  value: unknown,
  path = 'consentWorkflowProjection',
): BreedingConsentWorkflowProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'context', 'generatedAtCampaignMinute', 'notifications',
    'projectRequestsTruncated', 'eggTransfersTruncated', 'projectRequests', 'eggTransfers',
    'gmPolicy', 'transition', 'securityPolicyDefinitionSha256', 'projectionDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'player')
    || typeof row.transition !== 'string' || !TRANSITIONS.has(row.transition)) {
    return fail('breeding.consent-workflow.invalid-document', path, 'must be one closed schema-v1 workflow projection.')
  }
  if (!Array.isArray(row.projectRequests) || row.projectRequests.length > BREEDING_CONSENT_WORKFLOW_CARD_LIMIT
    || !Array.isArray(row.eggTransfers) || row.eggTransfers.length > BREEDING_CONSENT_WORKFLOW_CARD_LIMIT) {
    return fail('breeding.consent-workflow.invalid-document', path, 'card directories must be bounded arrays.')
  }
  const projects = row.projectRequests.map((entry, index) => parseProjectRequest(entry, row.audience as 'gm' | 'player', `${path}.projectRequests[${index}]`))
  const transfers = row.eggTransfers.map((entry, index) => parseEggTransfer(entry, `${path}.eggTransfers[${index}]`))
  const uniqueProjects = new Set(projects.map(entry => `${entry.projectId}\0${entry.ownParent.pokemonSheetSlug}`))
  const uniqueTransfers = new Set(transfers.map(entry => entry.offerConsentId))
  if (uniqueProjects.size !== projects.length || uniqueTransfers.size !== transfers.length) {
    return fail('breeding.consent-workflow.invalid-invariant', path, 'card identities must be unique.')
  }
  const notifications = exact(row.notifications, ['projectRequests', 'transferInvitations', 'readyTransfers', 'total'], `${path}.notifications`)
  const projectRequestCount = integer(notifications.projectRequests, `${path}.notifications.projectRequests`, BREEDING_CONSENT_WORKFLOW_CARD_LIMIT)
  const transferInvitationCount = integer(notifications.transferInvitations, `${path}.notifications.transferInvitations`, BREEDING_CONSENT_WORKFLOW_CARD_LIMIT)
  const readyTransferCount = integer(notifications.readyTransfers, `${path}.notifications.readyTransfers`, BREEDING_CONSENT_WORKFLOW_CARD_LIMIT)
  if (projectRequestCount !== projects.filter(entry => entry.canGrant).length
    || transferInvitationCount !== transfers.filter(entry => entry.canAccept).length
    || readyTransferCount !== transfers.filter(entry => entry.canTransfer).length
    || notifications.total !== projectRequestCount + transferInvitationCount + readyTransferCount) {
    return fail('breeding.consent-workflow.invalid-invariant', `${path}.notifications`, 'counts must derive from current actionable private cards.')
  }
  let gmPolicy: BreedingConsentWorkflowProjectionV1['gmPolicy'] = null
  if (row.audience === 'gm') {
    const policy = exact(row.gmPolicy, ['setupOverrideOnly', 'positiveConsentSubstitutionAllowed', 'transferRequiresTwoPositiveConsents'], `${path}.gmPolicy`)
    if (policy.setupOverrideOnly !== true || policy.positiveConsentSubstitutionAllowed !== false
      || policy.transferRequiresTwoPositiveConsents !== true) {
      return fail('breeding.consent-workflow.invalid-invariant', `${path}.gmPolicy`, 'must retain the no-consent-substitution policy.')
    }
    gmPolicy = { setupOverrideOnly: true, positiveConsentSubstitutionAllowed: false, transferRequiresTwoPositiveConsents: true }
  }
  else if (row.gmPolicy !== null) return fail('breeding.consent-workflow.invalid-invariant', `${path}.gmPolicy`, 'player projections cannot carry GM policy controls.')
  const securityHash = hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`)
  if (securityHash !== BREEDING_CONSENT_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256) {
    return fail('breeding.consent-workflow.security-policy-mismatch', `${path}.securityPolicyDefinitionSha256`, 'must match the current app-owned security policy.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    audience: row.audience,
    context: parseContext(row.context, `${path}.context`),
    generatedAtCampaignMinute: integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`),
    notifications: { projectRequests: projectRequestCount, transferInvitations: transferInvitationCount, readyTransfers: readyTransferCount, total: Number(notifications.total) },
    projectRequestsTruncated: bool(row.projectRequestsTruncated, `${path}.projectRequestsTruncated`),
    eggTransfersTruncated: bool(row.eggTransfersTruncated, `${path}.eggTransfersTruncated`),
    projectRequests: projects,
    eggTransfers: transfers,
    gmPolicy,
    transition: row.transition,
    securityPolicyDefinitionSha256: securityHash,
    projectionDefinitionSha256: hash(row.projectionDefinitionSha256, `${path}.projectionDefinitionSha256`),
  }) as BreedingConsentWorkflowProjectionV1
}

export const verifyBreedingConsentWorkflowProjectionV1 = async (
  value: unknown,
  path = 'consentWorkflow',
): Promise<BreedingConsentWorkflowProjectionV1> => {
  const projection = parseBreedingConsentWorkflowProjectionV1(value, path)
  const { projectionDefinitionSha256, ...definition } = projection
  let actual: string
  try { actual = await computeRulesetSourceSha256(stableJsonStringify(definition)) }
  catch { return fail('breeding.consent-workflow.hash-mismatch', `${path}.projectionDefinitionSha256`, 'cannot be verified in this browser.') }
  if (actual !== projectionDefinitionSha256) {
    return fail('breeding.consent-workflow.hash-mismatch', `${path}.projectionDefinitionSha256`, 'does not match the exact private consent workflow.')
  }
  return projection
}

export const serializeBreedingConsentWorkflowRequestV1 = (
  value: BreedingConsentWorkflowRequestV1,
): string => stableJsonStringify(parseBreedingConsentWorkflowRequestV1(value))
