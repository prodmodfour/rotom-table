import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonObject } from '../automation/strictJson'
import { isSlug } from '../paths'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'

export const BREEDING_WORKSHOP_PATH = '/breeding' as const
export const BREEDING_WORKSHOP_API_PATH = '/api/breeding/workshop' as const
export const BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT = 100 as const

export type BreedingWorkshopAudience = 'gm' | 'owner'
export type BreedingWorkshopOwnershipAvailability = 'available' | 'unavailable'
export type BreedingWorkshopOwnershipReasonId = 'breeding.workshop.trainer-unavailable'
export type BreedingWorkshopEmptyState =
  | 'profile-required'
  | 'no-authorized-trainers'
  | 'selected-context-empty'
  | 'selected-context-unavailable'
  | null

export interface BreedingWorkshopOwnershipContextV1 {
  readonly trainerSheetSlug: string
  readonly trainerRevision: number | null
  readonly displayName: string
  readonly availability: BreedingWorkshopOwnershipAvailability
  readonly unavailableReasonId: BreedingWorkshopOwnershipReasonId | null
  readonly hasProjects: boolean
  readonly hasEggs: boolean
}

export interface BreedingWorkshopProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: BreedingWorkshopAudience
  readonly generatedAtCampaignMinute: number
  readonly profileSelectionRequired: boolean
  readonly ownershipCursor: string | null
  readonly nextOwnershipCursor: string | null
  readonly ownershipContexts: readonly BreedingWorkshopOwnershipContextV1[]
  readonly selectedOwnershipContext: BreedingWorkshopOwnershipContextV1 | null
  readonly emptyState: BreedingWorkshopEmptyState
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}

export interface BreedingWorkshopQueryV1 {
  readonly trainerSheetSlug: string | null
  readonly ownershipCursor: string | null
}

export class BreedingWorkshopContractError extends Error {
  readonly code:
    | 'breeding.workshop.invalid-document'
    | 'breeding.workshop.invalid-id'
    | 'breeding.workshop.invalid-invariant'
  readonly path: string

  constructor(code: BreedingWorkshopContractError['code'], path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingWorkshopContractError'
    this.code = code
    this.path = path
  }
}

const SHA256 = /^[0-9a-f]{64}$/
const CONTROL = /[\u0000-\u001f\u007f]/u
const fail = (
  code: BreedingWorkshopContractError['code'],
  path: string,
  message: string,
): never => {
  throw new BreedingWorkshopContractError(code, path, message)
}
const clone = (value: unknown, path: string): StrictJsonObject => {
  const cloned = cloneStrictJson(value, path, {
    limits: {
      depth: 5,
      nodes: 2_000,
      objectFields: 16,
      arrayEntries: BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT,
      stringLength: 200,
      objectKeyLength: 80,
    },
    rootLabel: path,
    valueLabel: 'Breeding Workshop projection',
    failNotJson: (field, detail) => fail('breeding.workshop.invalid-document', field, detail),
    failLimit: (field, detail) => fail('breeding.workshop.invalid-document', field, detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
    return fail('breeding.workshop.invalid-document', path, 'must be one plain object.')
  }
  return cloned as StrictJsonObject
}
const exact = (value: unknown, fields: readonly string[], path: string): StrictJsonObject => {
  const row = clone(value, path)
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.workshop.invalid-document', path, 'must contain exactly the declared fields.')
  }
  return row
}
const slug = (value: unknown, path: string): string => (
  isSlug(value) && value.length <= 160
    ? value
    : fail('breeding.workshop.invalid-id', path, 'must be a canonical bounded Trainer slug.')
)
const optionalSlug = (value: unknown, path: string): string | null => (
  value === null || value === undefined || value === '' ? null : slug(value, path)
)
const integer = (value: unknown, path: string): number => (
  Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : fail('breeding.workshop.invalid-document', path, 'must be a safe nonnegative integer.')
)
const text = (value: unknown, path: string): string => (
  typeof value === 'string'
    && value.length > 0
    && value.length <= 120
    && value.trim() === value
    && !CONTROL.test(value)
    ? value
    : fail('breeding.workshop.invalid-document', path, 'must be bounded safe display text.')
)
const hash = (value: unknown, path: string): string => (
  typeof value === 'string' && SHA256.test(value)
    ? value
    : fail('breeding.workshop.invalid-document', path, 'must be a lowercase SHA-256 digest.')
)

export const BREEDING_WORKSHOP_SECURITY_POLICY_DEFINITION_SHA256 = hash(
  securityPolicyJson.definitionSha256,
  'securityPolicy.definitionSha256',
)

export class BreedingWorkshopProjectionVerificationError extends Error {
  readonly code:
    | 'breeding.workshop.hash-mismatch'
    | 'breeding.workshop.security-policy-mismatch'
    | 'breeding.workshop.hash-unavailable'

  constructor(code: BreedingWorkshopProjectionVerificationError['code'], message: string) {
    super(message)
    this.name = 'BreedingWorkshopProjectionVerificationError'
    this.code = code
  }
}

const parseOwnershipContext = (
  value: unknown,
  path: string,
): BreedingWorkshopOwnershipContextV1 => {
  const row = exact(value, [
    'trainerSheetSlug',
    'trainerRevision',
    'displayName',
    'availability',
    'unavailableReasonId',
    'hasProjects',
    'hasEggs',
  ], path)
  if ((row.availability !== 'available' && row.availability !== 'unavailable')
    || typeof row.hasProjects !== 'boolean'
    || typeof row.hasEggs !== 'boolean') {
    return fail('breeding.workshop.invalid-document', path, 'must contain a closed availability and activity facts.')
  }
  const trainerRevision = row.trainerRevision === null
    ? null
    : integer(row.trainerRevision, `${path}.trainerRevision`)
  const unavailableReasonId = row.unavailableReasonId === null
    ? null
    : row.unavailableReasonId === 'breeding.workshop.trainer-unavailable'
      ? row.unavailableReasonId
      : fail('breeding.workshop.invalid-id', `${path}.unavailableReasonId`, 'must be a closed reason ID.')
  if ((row.availability === 'available') !== (trainerRevision !== null)
    || (row.availability === 'unavailable') !== (unavailableReasonId !== null)
    || (row.availability === 'unavailable' && (row.hasProjects || row.hasEggs))) {
    return fail('breeding.workshop.invalid-invariant', path, 'availability, revision, reason, and activity must agree.')
  }
  return deepFreezeStrictJson({
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    trainerRevision,
    displayName: text(row.displayName, `${path}.displayName`),
    availability: row.availability,
    unavailableReasonId,
    hasProjects: row.hasProjects,
    hasEggs: row.hasEggs,
  }) as BreedingWorkshopOwnershipContextV1
}

export const parseBreedingWorkshopQueryV1 = (
  value: unknown,
  path = 'query',
): BreedingWorkshopQueryV1 => {
  const row = exact(value, ['trainerSheetSlug', 'ownershipCursor'], path)
  return deepFreezeStrictJson({
    trainerSheetSlug: optionalSlug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    ownershipCursor: optionalSlug(row.ownershipCursor, `${path}.ownershipCursor`),
  })
}

export const parseBreedingWorkshopProjectionV1 = (
  value: unknown,
  path = 'workshop',
): BreedingWorkshopProjectionV1 => {
  const row = exact(value, [
    'schemaVersion',
    'audience',
    'generatedAtCampaignMinute',
    'profileSelectionRequired',
    'ownershipCursor',
    'nextOwnershipCursor',
    'ownershipContexts',
    'selectedOwnershipContext',
    'emptyState',
    'securityPolicyDefinitionSha256',
    'projectionDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1
    || (row.audience !== 'gm' && row.audience !== 'owner')
    || typeof row.profileSelectionRequired !== 'boolean'
    || !Array.isArray(row.ownershipContexts)
    || row.ownershipContexts.length > BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT) {
    return fail('breeding.workshop.invalid-document', path, 'must be a bounded v1 Workshop projection.')
  }
  const ownershipCursor = optionalSlug(row.ownershipCursor, `${path}.ownershipCursor`)
  const nextOwnershipCursor = optionalSlug(row.nextOwnershipCursor, `${path}.nextOwnershipCursor`)
  const contexts = row.ownershipContexts.map((entry, index) => (
    parseOwnershipContext(entry, `${path}.ownershipContexts[${index}]`)
  ))
  for (let index = 0; index < contexts.length; index += 1) {
    const current = contexts[index]!
    if ((index > 0 && contexts[index - 1]!.trainerSheetSlug >= current.trainerSheetSlug)
      || (ownershipCursor !== null && current.trainerSheetSlug <= ownershipCursor)) {
      return fail('breeding.workshop.invalid-invariant', `${path}.ownershipContexts`, 'must be unique and sorted after the page cursor.')
    }
  }
  if (nextOwnershipCursor !== null
    && (contexts.length !== BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT
      || contexts.at(-1)?.trainerSheetSlug !== nextOwnershipCursor)) {
    return fail('breeding.workshop.invalid-invariant', `${path}.nextOwnershipCursor`, 'must identify the full page tail exactly.')
  }
  const selected = row.selectedOwnershipContext === null
    ? null
    : parseOwnershipContext(row.selectedOwnershipContext, `${path}.selectedOwnershipContext`)
  const emptyState = row.emptyState === null
    || row.emptyState === 'profile-required'
    || row.emptyState === 'no-authorized-trainers'
    || row.emptyState === 'selected-context-empty'
    || row.emptyState === 'selected-context-unavailable'
    ? row.emptyState as BreedingWorkshopEmptyState
    : fail('breeding.workshop.invalid-id', `${path}.emptyState`, 'must be a closed empty-state ID.')

  if (row.audience === 'gm' && row.profileSelectionRequired) {
    return fail('breeding.workshop.invalid-invariant', `${path}.profileSelectionRequired`, 'GM projections never require a player Profile.')
  }
  if (row.profileSelectionRequired) {
    if (row.audience !== 'owner' || ownershipCursor !== null || nextOwnershipCursor !== null
      || contexts.length !== 0 || selected !== null || emptyState !== 'profile-required') {
      return fail('breeding.workshop.invalid-invariant', path, 'profile-required state must reveal no ownership context.')
    }
  }
  else if (selected === null) {
    if (contexts.length !== 0 || emptyState !== 'no-authorized-trainers') {
      return fail('breeding.workshop.invalid-invariant', path, 'an absent selected context requires the no-authorized-trainers state.')
    }
  }
  else {
    const expectedEmptyState: BreedingWorkshopEmptyState = selected.availability === 'unavailable'
      ? 'selected-context-unavailable'
      : !selected.hasProjects && !selected.hasEggs
        ? 'selected-context-empty'
        : null
    if (emptyState !== expectedEmptyState) {
      return fail('breeding.workshop.invalid-invariant', `${path}.emptyState`, 'must match the selected ownership context exactly.')
    }
  }

  return deepFreezeStrictJson({
    schemaVersion: 1,
    audience: row.audience,
    generatedAtCampaignMinute: integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`),
    profileSelectionRequired: row.profileSelectionRequired,
    ownershipCursor,
    nextOwnershipCursor,
    ownershipContexts: contexts,
    selectedOwnershipContext: selected,
    emptyState,
    securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`),
    projectionDefinitionSha256: hash(row.projectionDefinitionSha256, `${path}.projectionDefinitionSha256`),
  }) as BreedingWorkshopProjectionV1
}

/**
 * Revalidates both the reviewed security-policy binding and the exact
 * audience projection digest in browser-compatible runtimes. A valid digest
 * authenticates integrity of the server response shape; it never grants
 * authority to browser state.
 */
export const verifyBreedingWorkshopProjectionV1 = async (
  value: unknown,
  path = 'workshop',
): Promise<BreedingWorkshopProjectionV1> => {
  const projection = parseBreedingWorkshopProjectionV1(value, path)
  if (projection.securityPolicyDefinitionSha256
    !== BREEDING_WORKSHOP_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingWorkshopProjectionVerificationError(
      'breeding.workshop.security-policy-mismatch',
      'Breeding Workshop projection does not use the current security policy.',
    )
  }
  const { projectionDefinitionSha256, ...definition } = projection
  let actual: string
  try {
    actual = await computeRulesetSourceSha256(stableJsonStringify(definition))
  }
  catch {
    throw new BreedingWorkshopProjectionVerificationError(
      'breeding.workshop.hash-unavailable',
      'Breeding Workshop projection verification is unavailable.',
    )
  }
  if (actual !== projectionDefinitionSha256) {
    throw new BreedingWorkshopProjectionVerificationError(
      'breeding.workshop.hash-mismatch',
      'Breeding Workshop projection hash does not match its exact audience definition.',
    )
  }
  return projection
}
