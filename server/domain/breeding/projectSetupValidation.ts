import { createHash } from 'node:crypto'
import compatibilityPolicyJson from '../../../data/breeding-automation/compatibility-policy.json'
import securityPolicyJson from '../../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingActorAuthorityV1,
  BreedingParentControlEvidenceV1,
} from '#shared/breeding/authorization'
import type { BreedingGmAdjudicationRecordV1 } from '#shared/breeding/ledgers'
import {
  parseBreedingOperationCommandV1,
  type BreedingOperationCommandV1,
} from '#shared/breeding/operations'
import {
  parseBreedingProjectParentFactsV1,
  parseBreedingProjectSetupValidationProjectionV1,
  parseBreedingProjectSetupValidationV1,
  type BreedingProjectParentFactsV1,
  type BreedingProjectSetupCompatibilityV1,
  type BreedingProjectSetupReasonId,
  type BreedingProjectSetupValidationChecksV1,
  type BreedingProjectSetupValidationProjectionV1,
  type BreedingProjectSetupValidationV1,
} from '#shared/breeding/projectSetupValidation'
import type {
  BreedingOperationReadSetV1,
  BreedingReadResourceV1,
} from '#shared/breeding/readSets'
import {
  authorizeBreedingProjectSetupV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingBreederAuthorityEvidenceV1,
  parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1,
  parseAuthoritativeBreedingParentControlEvidenceV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
  type BreedingProjectSetupParentAuthorityInputV1,
} from './authorization'
import {
  parseBreedingCampaignOptionSnapshotV1,
  type BreedingCampaignOptionSnapshotV1,
} from './campaignOptions'
import {
  BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
  evaluateBreedingCompatibility,
  type BreedingCompatibilityResult,
  type BreedingParentRoleOverride,
} from './compatibility'
import {
  parseAuthoritativeBreedingGmAdjudicationRecordV1,
  parseAuthoritativeBreedingOptionOfferRecordV1,
  validateBreedingAdjudicationOfferLink,
} from './ledgers'
import {
  createBreedingOperationCommandHash,
} from './operations'
import {
  COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  compiledBreedingSpeciesSpec,
} from './registry'
import {
  parseAuthoritativeBreedingOperationReadSetV1,
} from './readSets'

export interface ValidateBreedingProjectSetupResultV1 {
  readonly authority: BreedingProjectSetupValidationV1
  readonly projection: BreedingProjectSetupValidationProjectionV1
}
export interface BreedingProjectSetupValidationDependencies {
  /**
   * Recheck the persisted settlement command, complete read set, authenticated
   * GM authorization receipt, and terminal result for this adjudication.
   */
  readonly validateResolvedGmAdjudication?: (input: {
    readonly adjudication: BreedingGmAdjudicationRecordV1
    readonly offer: ReturnType<typeof parseAuthoritativeBreedingOptionOfferRecordV1> | null
  }) => boolean
}
export type BreedingProjectSetupAuthorityErrorCode =
  | 'breeding.setup.invalid-request'
  | 'breeding.setup.stale-parent-facts'
  | 'breeding.setup.stale-reference'
  | 'breeding.setup.invalid-adjudication'
  | 'breeding.setup.extraneous-evidence'
  | 'breeding.setup.hash-mismatch'
export class BreedingProjectSetupAuthorityError extends Error {
  readonly code: BreedingProjectSetupAuthorityErrorCode
  constructor(code: BreedingProjectSetupAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingProjectSetupAuthorityError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>
type BreedingProjectSetupCommandV1 = Extract<
  BreedingOperationCommandV1,
  { readonly commandKind: 'preview-breeding' | 'create-breeding-project' }
>
const INPUT_FIELDS = Object.freeze([
  'command', 'readSet', 'actorAuthority', 'ownerTrainerControl', 'breederAuthority',
  'breederTrainerControl', 'parents', 'gmOverrides', 'securityPolicyDefinitionSha256',
  'campaignOptions', 'parentFacts', 'maturityAdjudications', 'roleAdjudication', 'roleOffer',
] as const)
const ROLE_VALUES = Object.freeze({
  'first-female-second-male': ['female-parent', 'male-parent'],
  'first-male-second-female': ['male-parent', 'female-parent'],
} as const)
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const fail = (code: BreedingProjectSetupAuthorityErrorCode, message: string): never => {
  throw new BreedingProjectSetupAuthorityError(code, message)
}
const plain = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return null
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return null
  }
  return value as UnknownRecord
}
const exactInput = (value: unknown): UnknownRecord => {
  const row = plain(value)
  const allowed = new Set<string>(INPUT_FIELDS)
  if (!row || INPUT_FIELDS.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !allowed.has(field))) {
    return fail('breeding.setup.invalid-request', 'Project setup validation requires exactly the declared server authority fields.')
  }
  return row
}
const strictArray = (value: unknown, length: number | { readonly maximum: number }, label: string): unknown[] => {
  const maximum = typeof length === 'number' ? length : length.maximum
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || (typeof length === 'number' ? value.length !== length : value.length > maximum)
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.setup.invalid-request', `${label} must be a bounded plain non-enriched array.`)
  }
  const output: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.setup.invalid-request', `${label} must contain enumerable data entries only.`)
    }
    output.push(descriptor.value)
  }
  return output
}
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _hash, ...definition } = value
  return definition
}
const parseAuthoritativeParentFacts = (value: unknown, label: string): BreedingProjectParentFactsV1 => {
  const facts = parseBreedingProjectParentFactsV1(value, label)
  if (sha256(withoutHash(facts)) !== facts.definitionSha256) {
    return fail('breeding.setup.hash-mismatch', 'Parent facts do not match their exact stable-JSON definition hash.')
  }
  return facts
}
export type BreedingProjectParentFactsDefinitionV1 = Omit<BreedingProjectParentFactsV1, 'definitionSha256'>
export const createBreedingProjectParentFactsV1 = (
  value: BreedingProjectParentFactsDefinitionV1,
): BreedingProjectParentFactsV1 => parseAuthoritativeParentFacts({
  ...value,
  definitionSha256: sha256(value),
}, 'parentFacts')
const readResource = (
  readSet: BreedingOperationReadSetV1,
  kind: BreedingReadResourceV1['resourceKind'],
  id: string,
): BreedingReadResourceV1 | null => readSet.resources.find(value => (
  value.resourceKind === kind && value.resourceId === id
)) ?? null
const exactPresentResource = (input: {
  readonly readSet: BreedingOperationReadSetV1
  readonly kind: BreedingReadResourceV1['resourceKind']
  readonly id: string
  readonly revision: number
  readonly definitionSha256: string
  readonly purpose: BreedingReadResourceV1['purposes'][number]
}): boolean => {
  const resource = readResource(input.readSet, input.kind, input.id)
  return resource?.existence === 'present'
    && resource.revision === input.revision
    && resource.definitionSha256 === input.definitionSha256
    && resource.purposes.includes(input.purpose)
}
const validateParentFacts = (input: {
  readonly factsValue: unknown
  readonly parentControl: BreedingParentControlEvidenceV1
  readonly command: BreedingProjectSetupCommandV1
  readonly parentIndex: 0 | 1
  readonly readSet: BreedingOperationReadSetV1
  readonly options: BreedingCampaignOptionSnapshotV1
}): BreedingProjectParentFactsV1 => {
  const facts = parseAuthoritativeParentFacts(input.factsValue, `parentFacts[${input.parentIndex}]`)
  const commandParent = input.command.payload.parentRefs[input.parentIndex]
  const spec = compiledBreedingSpeciesSpec(facts.speciesId)
  if (!spec
    || facts.parentSheetSlug !== commandParent.pokemonSheetSlug
    || facts.parentSheetRevision !== commandParent.expectedSheetRevision
    || facts.parentSheetSlug !== input.parentControl.parentSheetSlug
    || facts.parentSheetRevision !== input.parentControl.parentSheetRevision
    || facts.parentSheetDefinitionSha256 !== input.parentControl.parentSheetDefinitionSha256
    || facts.capturedAtCampaignMinute !== input.readSet.capturedAtCampaignMinute
    || facts.speciesSpecDefinitionSha256 !== spec.definitionSha256
    || stableJsonStringify(facts.eggGroupIds) !== stableJsonStringify(spec.eggGroupIds)
    || !exactPresentResource({
      readSet: input.readSet,
      kind: 'pokemon-sheet',
      id: facts.parentSheetSlug,
      revision: facts.parentSheetRevision,
      definitionSha256: facts.parentSheetDefinitionSha256,
      purpose: 'snapshot',
    })
    || input.options.definitionSha256 !== input.readSet.referenceVersions.campaignOptionSnapshotDefinitionSha256) {
    return fail('breeding.setup.stale-parent-facts', 'Parent facts, controls, command revisions, compiled Species, and read set must match exactly.')
  }
  return facts
}
const authorityHashes = (
  facts: BreedingProjectParentFactsV1,
  options: BreedingCampaignOptionSnapshotV1,
): readonly string[] => Object.freeze([
  BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
  options.definitionSha256,
  facts.definitionSha256,
  options.rulesetDefinitionSha256,
].sort(compare))
const pairAuthorityHashes = (
  facts: readonly [BreedingProjectParentFactsV1, BreedingProjectParentFactsV1],
  options: BreedingCampaignOptionSnapshotV1,
): readonly string[] => Object.freeze([
  BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
  options.definitionSha256,
  options.rulesetDefinitionSha256,
  facts[0].definitionSha256,
  facts[1].definitionSha256,
].sort(compare))
const exactStrings = (left: readonly string[], right: readonly string[]): boolean => (
  stableJsonStringify(left) === stableJsonStringify(right)
)
const validatesPersistedGmSettlement = (
  validator: BreedingProjectSetupValidationDependencies['validateResolvedGmAdjudication'],
  input: Parameters<NonNullable<BreedingProjectSetupValidationDependencies['validateResolvedGmAdjudication']>>[0],
): boolean => {
  try { return validator?.(input) === true }
  catch { return false }
}
const validateMaturityAdjudication = (input: {
  readonly value: unknown
  readonly facts: BreedingProjectParentFactsV1
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly readSet: BreedingOperationReadSetV1
  readonly validateResolvedGmAdjudication: BreedingProjectSetupValidationDependencies['validateResolvedGmAdjudication']
}): BreedingGmAdjudicationRecordV1 => {
  const adjudication = (() => {
    try { return parseAuthoritativeBreedingGmAdjudicationRecordV1(input.value) }
    catch { return fail('breeding.setup.invalid-adjudication', 'Maturity evidence is malformed or hash-invalid.') }
  })()
  if (adjudication.revision !== 1 || adjudication.status !== 'resolved'
    || adjudication.adjudicationKind !== 'maturity-confirmation'
    || adjudication.decisionMode !== 'audited-confirmation'
    || adjudication.offerId !== null || adjudication.decision?.kind !== 'confirmation'
    || adjudication.decision.evidenceDefinitionSha256 !== input.facts.definitionSha256
    || adjudication.target.kind !== 'pokemon-sheet'
    || adjudication.target.sheetSlug !== input.facts.parentSheetSlug
    || adjudication.target.revision !== input.facts.parentSheetRevision
    || adjudication.createdAtCampaignMinute > adjudication.settledAtCampaignMinute!
    || adjudication.settledAtCampaignMinute! > input.readSet.capturedAtCampaignMinute
    || !exactStrings(adjudication.authorityDefinitionHashes, authorityHashes(input.facts, input.options))
    || !exactPresentResource({
      readSet: input.readSet,
      kind: 'breeding-adjudication',
      id: adjudication.adjudicationId,
      revision: adjudication.revision,
      definitionSha256: adjudication.definitionSha256,
      purpose: 'mechanics',
    })
    || !validatesPersistedGmSettlement(input.validateResolvedGmAdjudication, { adjudication, offer: null })) {
    return fail('breeding.setup.invalid-adjudication', 'Maturity evidence must be resolved for this exact parent, authority set, and read-set checkpoint.')
  }
  return adjudication
}
const roleDefinition = (canonicalValueId: keyof typeof ROLE_VALUES) => ({
  schemaVersion: 1 as const,
  canonicalValueId,
  roles: ROLE_VALUES[canonicalValueId],
})
const validateRoleAdjudication = (input: {
  readonly adjudicationValue: unknown
  readonly offerValue: unknown
  readonly facts: readonly [BreedingProjectParentFactsV1, BreedingProjectParentFactsV1]
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly readSet: BreedingOperationReadSetV1
  readonly ownerTrainerSlug: string
  readonly ownerTrainerRevision: number
  readonly validateResolvedGmAdjudication: BreedingProjectSetupValidationDependencies['validateResolvedGmAdjudication']
}): { readonly adjudication: BreedingGmAdjudicationRecordV1, readonly override: BreedingParentRoleOverride } => {
  const adjudication = (() => {
    try { return parseAuthoritativeBreedingGmAdjudicationRecordV1(input.adjudicationValue) }
    catch { return fail('breeding.setup.invalid-adjudication', 'Parent-role adjudication is malformed or hash-invalid.') }
  })()
  const offer = (() => {
    try { return parseAuthoritativeBreedingOptionOfferRecordV1(input.offerValue) }
    catch { return fail('breeding.setup.invalid-adjudication', 'Parent-role offer is malformed or hash-invalid.') }
  })()
  try { validateBreedingAdjudicationOfferLink(adjudication, offer) }
  catch { return fail('breeding.setup.invalid-adjudication', 'Parent-role adjudication and bounded offer do not match.') }
  const decision = adjudication.decision
  if (decision?.kind !== 'option') {
    return fail('breeding.setup.invalid-adjudication', 'Parent-role evidence must select one bounded option.')
  }
  if (adjudication.revision !== 1 || adjudication.status !== 'resolved'
    || adjudication.adjudicationKind !== 'parent-role-override'
    || adjudication.target.kind !== 'trainer-sheet'
    || adjudication.target.sheetSlug !== input.ownerTrainerSlug
    || adjudication.target.revision !== input.ownerTrainerRevision
    || adjudication.createdAtCampaignMinute > adjudication.settledAtCampaignMinute!
    || adjudication.settledAtCampaignMinute! > input.readSet.capturedAtCampaignMinute
    || offer.issuedAtCampaignMinute > offer.settledAtCampaignMinute!
    || offer.settledAtCampaignMinute! > input.readSet.capturedAtCampaignMinute
    || (offer.expiresAtCampaignMinute !== null
      && offer.settledAtCampaignMinute! >= offer.expiresAtCampaignMinute)
    || !exactStrings(adjudication.authorityDefinitionHashes, pairAuthorityHashes(input.facts, input.options))
    || !exactPresentResource({
      readSet: input.readSet,
      kind: 'breeding-adjudication',
      id: adjudication.adjudicationId,
      revision: adjudication.revision,
      definitionSha256: adjudication.definitionSha256,
      purpose: 'mechanics',
    })
    || !exactPresentResource({
      readSet: input.readSet,
      kind: 'breeding-offer',
      id: offer.offerId,
      revision: offer.revision,
      definitionSha256: offer.definitionSha256,
      purpose: 'mechanics',
    })
    || !validatesPersistedGmSettlement(input.validateResolvedGmAdjudication, { adjudication, offer })) {
    return fail('breeding.setup.invalid-adjudication', 'Parent-role evidence must bind this exact pair, owner, and read-set checkpoint.')
  }
  const selected = offer.options.find(option => option.optionId === decision.optionId)
  const canonicalValueId = selected?.canonicalValueId
  if (!selected || (canonicalValueId !== 'first-female-second-male'
    && canonicalValueId !== 'first-male-second-female')) {
    return fail('breeding.setup.invalid-adjudication', 'Parent-role evidence must select one bounded complementary assignment.')
  }
  const definition = roleDefinition(canonicalValueId)
  if (selected.valueDefinitionSha256 !== sha256(definition)
    || !exactStrings(selected.authorityEvidenceIds, input.facts.map(value => value.definitionSha256).sort(compare))) {
    return fail('breeding.setup.invalid-adjudication', 'Parent-role option authority does not match the exact parent facts.')
  }
  return Object.freeze({
    adjudication,
    override: Object.freeze({
      evidenceId: adjudication.adjudicationId,
      roles: Object.freeze([...definition.roles]) as BreedingParentRoleOverride['roles'],
    }),
  })
}
const notEvaluatedCompatibility = (): BreedingProjectSetupCompatibilityV1 => Object.freeze({
  status: 'not-evaluated',
  compatibilityKind: null,
  reasonIds: Object.freeze([]),
})
const compatibilityProjection = (result: BreedingCompatibilityResult): BreedingProjectSetupCompatibilityV1 => result.status === 'compatible'
  ? Object.freeze({ status: 'compatible', compatibilityKind: result.compatibilityKind, reasonIds: Object.freeze([]) })
  : Object.freeze({
      status: 'unavailable',
      compatibilityKind: null,
      reasonIds: Object.freeze([...result.reasonIds].sort(compare)),
    })
const evaluateFactsCompatibility = (
  facts: readonly [BreedingProjectParentFactsV1, BreedingProjectParentFactsV1],
  options: BreedingCampaignOptionSnapshotV1,
  roleOverride: BreedingParentRoleOverride | null,
  gmMaturityConfirmed: boolean,
): BreedingCompatibilityResult => evaluateBreedingCompatibility({
  parents: facts.map(value => ({
    parentRef: value.parentSheetSlug,
    speciesId: value.speciesId,
    genderId: value.genderId,
    level: value.level,
    eggGroupIds: value.eggGroupIds,
    gmMaturityConfirmed,
  })) as unknown as Parameters<typeof evaluateBreedingCompatibility>[0]['parents'],
  options,
  roleOverride,
})
const parseCommand = (value: unknown): BreedingProjectSetupCommandV1 => {
  const command = (() => {
    try { return parseBreedingOperationCommandV1(value) }
    catch { return fail('breeding.setup.invalid-request', 'Project setup command is malformed.') }
  })()
  if (command.commandKind !== 'preview-breeding' && command.commandKind !== 'create-breeding-project') {
    return fail('breeding.setup.invalid-request', 'Project setup validation supports preview and create commands only.')
  }
  return command as BreedingProjectSetupCommandV1
}
const buildAuthority = (definition: Omit<BreedingProjectSetupValidationV1, 'definitionSha256'>): BreedingProjectSetupValidationV1 => {
  const parsed = parseBreedingProjectSetupValidationV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
  if (sha256(withoutHash(parsed)) !== parsed.definitionSha256) {
    return fail('breeding.setup.hash-mismatch', 'Project setup validation hash does not match its exact authority record.')
  }
  return parsed
}
export const parseAuthoritativeBreedingProjectSetupValidationV1 = (
  value: unknown,
): BreedingProjectSetupValidationV1 => {
  const parsed = parseBreedingProjectSetupValidationV1(value)
  if (sha256(withoutHash(parsed)) !== parsed.definitionSha256) {
    return fail('breeding.setup.hash-mismatch', 'Project setup validation hash does not match its exact authority record.')
  }
  return parsed
}
const project = (
  authority: BreedingProjectSetupValidationV1,
  actor: BreedingActorAuthorityV1,
): BreedingProjectSetupValidationProjectionV1 => parseBreedingProjectSetupValidationProjectionV1({
  schemaVersion: 1,
  audience: actor.role === 'gm' ? 'gm' : 'owner',
  status: authority.status,
  reasonIds: authority.reasonIds,
  checks: authority.checks,
  compatibility: authority.compatibility,
  locationPolicyId: authority.locationPolicyId,
  facilityId: null,
})
const validationResult = (
  definition: Omit<BreedingProjectSetupValidationV1, 'definitionSha256'>,
  actor: BreedingActorAuthorityV1,
): ValidateBreedingProjectSetupResultV1 => {
  const authority = buildAuthority(definition)
  return Object.freeze({ authority, projection: project(authority, actor) })
}
const statuses = (overrides: Partial<BreedingProjectSetupValidationChecksV1>): BreedingProjectSetupValidationChecksV1 => Object.freeze({
  ownership: 'not-evaluated',
  consent: 'not-evaluated',
  maturity: 'not-evaluated',
  locationFacility: 'not-evaluated',
  compatibility: 'not-evaluated',
  ...overrides,
})
const sortedReasons = (values: readonly BreedingProjectSetupReasonId[]): readonly BreedingProjectSetupReasonId[] => Object.freeze([...new Set(values)].sort(compare))

/**
 * Compose the BR-026 authorization receipt with exact current parent mechanics,
 * maturity adjudications, the closed no-facility policy, and canonical
 * compatibility. This validator performs no writes and confers no project state.
 */
export const validateBreedingProjectSetupV1 = (
  inputValue: unknown,
  dependencies: BreedingProjectSetupValidationDependencies = {},
): ValidateBreedingProjectSetupResultV1 => {
  const input = exactInput(inputValue)
  const parentInputs = strictArray(input.parents, 2, 'parents')
  const parentFactsValues = strictArray(input.parentFacts, { maximum: 2 }, 'parentFacts')
  const maturityValues = strictArray(input.maturityAdjudications, { maximum: 2 }, 'maturityAdjudications')
  const gmOverrides = strictArray(input.gmOverrides, { maximum: 32 }, 'gmOverrides')
  const parents = parentInputs.map((entry, index) => {
    const row = plain(entry)
    if (!row || Object.keys(row).length !== 3
      || !['parentControl', 'ownerTrainerControl', 'consentEvidence'].every(field => Object.hasOwn(row, field))) {
      return fail('breeding.setup.invalid-request', 'Parent authority inputs must contain exactly control and consent evidence.')
    }
    return Object.freeze({
      parentControl: parseAuthoritativeBreedingParentControlEvidenceV1(row.parentControl, `parents[${index}].parentControl`),
      ownerTrainerControl: row.ownerTrainerControl === null ? null
        : parseAuthoritativeBreedingTrainerControlEvidenceV1(row.ownerTrainerControl, `parents[${index}].ownerTrainerControl`),
      consentEvidence: row.consentEvidence === null ? null
        : parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1(row.consentEvidence, `parents[${index}].consentEvidence`),
    })
  }) as unknown as readonly [BreedingProjectSetupParentAuthorityInputV1, BreedingProjectSetupParentAuthorityInputV1]

  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const command = parseCommand(input.command)
  const readSet = parseAuthoritativeBreedingOperationReadSetV1(input.readSet)
  const ownerTrainerControl = input.ownerTrainerControl === null ? null
    : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.ownerTrainerControl, 'ownerTrainerControl')
  const breederAuthority = input.breederAuthority === null ? null
    : parseAuthoritativeBreedingBreederAuthorityEvidenceV1(input.breederAuthority, 'breederAuthority')
  const breederTrainerControl = input.breederTrainerControl === null ? null
    : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.breederTrainerControl, 'breederTrainerControl')
  if (input.securityPolicyDefinitionSha256 !== securityPolicyJson.definitionSha256) {
    return fail('breeding.setup.stale-reference', 'Setup validation requires the exact current security policy.')
  }
  const authorizationReceipt = authorizeBreedingProjectSetupV1({
    command,
    readSet,
    actorAuthority: actor,
    ownerTrainerControl,
    breederAuthority,
    breederTrainerControl,
    parents,
    gmOverrides,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const options = parseBreedingCampaignOptionSnapshotV1(input.campaignOptions)
  const commandSha256 = createBreedingOperationCommandHash(command)
  if (command.operationId !== authorizationReceipt.operationId
    || commandSha256 !== authorizationReceipt.commandSha256
    || readSet.definitionSha256 !== authorizationReceipt.readSetDefinitionSha256
    || options.definitionSha256 !== command.payload.optionSnapshotDefinitionSha256
    || options.definitionSha256 !== readSet.referenceVersions.campaignOptionSnapshotDefinitionSha256
    || readSet.referenceVersions.compiledRegistryDefinitionSha256 !== COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256
    || options.rulesetDefinitionSha256 !== command.ruleset.definitionSha256) {
    return fail('breeding.setup.stale-reference', 'Setup validation requires exact current security, command, read-set, option, and compiled-registry versions.')
  }
  const base = {
    schemaVersion: 1 as const,
    operationId: command.operationId,
    commandSha256,
    commandKind: command.commandKind,
    authorizationReceiptDefinitionSha256: authorizationReceipt.definitionSha256,
    campaignOptionSnapshotDefinitionSha256: options.definitionSha256,
    compatibilityPolicyDefinitionSha256: BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
    locationPolicyId: 'campaign-workshop-off-map-v1' as const,
    facilityId: null,
    evaluatedAtCampaignMinute: readSet.capturedAtCampaignMinute,
  }
  if (!authorizationReceipt.authorized) {
    if (parentFactsValues.length > 0 || maturityValues.length > 0
      || input.roleAdjudication !== null || input.roleOffer !== null) {
      return fail('breeding.setup.extraneous-evidence', 'Unauthorized setup rejects private mechanics and adjudication evidence.')
    }
    return validationResult({
      ...base,
      status: 'unavailable',
      reasonIds: sortedReasons([authorizationReceipt.reasonId as BreedingProjectSetupReasonId]),
      checks: statuses({ ownership: 'unavailable' }),
      compatibility: notEvaluatedCompatibility(),
      parentFactsDefinitionHashes: Object.freeze([]),
      maturityAdjudicationIds: Object.freeze([]),
      roleAdjudicationId: null,
    }, actor)
  }

  const parentControls = parents.map(value => value.parentControl) as unknown as readonly [BreedingParentControlEvidenceV1, BreedingParentControlEvidenceV1]
  const crossOwner = parentControls.some(value => value.ownerTrainerSlug !== command.payload.ownerTrainerSlug)
  if (command.commandKind === 'create-breeding-project' && crossOwner) {
    if (parentFactsValues.length > 0 || maturityValues.length > 0
      || input.roleAdjudication !== null || input.roleOffer !== null) {
      return fail('breeding.setup.extraneous-evidence', 'Awaiting-consent setup rejects private mechanics adjudications before consent, including for an audited GM setup override.')
    }
    return validationResult({
      ...base,
      status: 'awaiting-consent',
      reasonIds: Object.freeze(['breeding.setup.awaiting-consent']),
      checks: statuses({ ownership: 'satisfied', consent: 'awaiting' }),
      compatibility: notEvaluatedCompatibility(),
      parentFactsDefinitionHashes: Object.freeze([]),
      maturityAdjudicationIds: Object.freeze([]),
      roleAdjudicationId: null,
    }, actor)
  }

  if (readSet.dependencyEvidence.some(value => value.providerKind === 'facility')) {
    if (parentFactsValues.length > 0 || maturityValues.length > 0
      || input.roleAdjudication !== null || input.roleOffer !== null) {
      return fail('breeding.setup.extraneous-evidence', 'Unsupported facility authority rejects downstream private mechanics evidence.')
    }
    return validationResult({
      ...base,
      status: 'unavailable',
      reasonIds: Object.freeze(['breeding.setup.facility-unsupported']),
      checks: statuses({ ownership: 'satisfied', consent: 'satisfied', locationFacility: 'unavailable' }),
      compatibility: notEvaluatedCompatibility(),
      parentFactsDefinitionHashes: Object.freeze([]),
      maturityAdjudicationIds: Object.freeze([]),
      roleAdjudicationId: null,
    }, actor)
  }

  if (parentFactsValues.length !== 2) {
    return fail('breeding.setup.invalid-request', 'Authorized setup requires both exact current parent fact records.')
  }
  const facts = parentFactsValues.map((value, index) => validateParentFacts({
    factsValue: value,
    parentControl: parentControls[index]!,
    command,
    parentIndex: index as 0 | 1,
    readSet,
    options,
  })) as unknown as readonly [BreedingProjectParentFactsV1, BreedingProjectParentFactsV1]
  const commonChecks = { ownership: 'satisfied' as const, consent: 'satisfied' as const, locationFacility: 'satisfied' as const }
  let maturityAdjudications: readonly BreedingGmAdjudicationRecordV1[] = Object.freeze([])
  if (options.values['breeding.maturity-policy'] === 'gm-confirmed-per-parent') {
    if (maturityValues.length !== 2) {
      return validationResult({
        ...base,
        status: 'unavailable',
        reasonIds: Object.freeze(['breeding.setup.maturity-unconfirmed']),
        checks: statuses({ ...commonChecks, maturity: 'unavailable' }),
        compatibility: notEvaluatedCompatibility(),
        parentFactsDefinitionHashes: Object.freeze(facts.map(value => value.definitionSha256)),
        maturityAdjudicationIds: Object.freeze([]),
        roleAdjudicationId: null,
      }, actor)
    }
    maturityAdjudications = Object.freeze(maturityValues.map((value, index) => validateMaturityAdjudication({
      value,
      facts: facts[index]!,
      options,
      readSet,
      validateResolvedGmAdjudication: dependencies.validateResolvedGmAdjudication,
    })).sort((left, right) => compare(left.adjudicationId, right.adjudicationId)))
    if (maturityAdjudications.some(value => value.decision?.kind !== 'confirmation' || value.decision.confirmed !== true)) {
      return validationResult({
        ...base,
        status: 'unavailable',
        reasonIds: Object.freeze(['breeding.setup.maturity-unconfirmed']),
        checks: statuses({ ...commonChecks, maturity: 'unavailable' }),
        compatibility: notEvaluatedCompatibility(),
        parentFactsDefinitionHashes: Object.freeze(facts.map(value => value.definitionSha256)),
        maturityAdjudicationIds: Object.freeze(maturityAdjudications.map(value => value.adjudicationId)),
        roleAdjudicationId: null,
      }, actor)
    }
  }
  else if (maturityValues.length > 0) {
    return fail('breeding.setup.extraneous-evidence', 'Minimum-Level maturity rejects extraneous GM confirmation evidence.')
  }

  if (options.values['breeding.maturity-policy'] === 'minimum-level'
    && facts.some(value => value.level < options.values['breeding.minimum-maturity-level'])) {
    const maturityResult = evaluateFactsCompatibility(facts, options, null, false)
    return validationResult({
      ...base,
      status: 'unavailable',
      reasonIds: Object.freeze(['breeding.setup.maturity-level-low']),
      checks: statuses({ ...commonChecks, maturity: 'unavailable', compatibility: 'unavailable' }),
      compatibility: compatibilityProjection(maturityResult),
      parentFactsDefinitionHashes: Object.freeze(facts.map(value => value.definitionSha256)),
      maturityAdjudicationIds: Object.freeze([]),
      roleAdjudicationId: null,
    }, actor)
  }

  let compatibilityResult = evaluateFactsCompatibility(facts, options, null, true)
  const requiresRole = compatibilityResult.status === 'unavailable'
    && compatibilityResult.reasonIds.includes('breeding.compatibility.role-override-required')
  const hasRoleEvidence = input.roleAdjudication !== null || input.roleOffer !== null
  let roleAdjudicationId: BreedingGmAdjudicationRecordV1['adjudicationId'] | null = null
  if (requiresRole && !hasRoleEvidence) {
    return validationResult({
      ...base,
      status: 'unavailable',
      reasonIds: Object.freeze(['breeding.setup.role-adjudication-required']),
      checks: statuses({ ...commonChecks, maturity: 'satisfied', compatibility: 'unavailable' }),
      compatibility: compatibilityProjection(compatibilityResult),
      parentFactsDefinitionHashes: Object.freeze(facts.map(value => value.definitionSha256)),
      maturityAdjudicationIds: Object.freeze(maturityAdjudications.map(value => value.adjudicationId)),
      roleAdjudicationId: null,
    }, actor)
  }
  if (requiresRole) {
    if (input.roleAdjudication === null || input.roleOffer === null) {
      return fail('breeding.setup.invalid-adjudication', 'Parent-role evidence requires both adjudication and bounded offer records.')
    }
    const ownerResource = readResource(readSet, 'trainer-sheet', command.payload.ownerTrainerSlug)
    if (!ownerResource || ownerResource.revision === null) {
      return fail('breeding.setup.stale-reference', 'Owner Trainer read-set evidence is missing.')
    }
    const role = validateRoleAdjudication({
      adjudicationValue: input.roleAdjudication,
      offerValue: input.roleOffer,
      facts,
      options,
      readSet,
      ownerTrainerSlug: command.payload.ownerTrainerSlug,
      ownerTrainerRevision: ownerResource.revision,
      validateResolvedGmAdjudication: dependencies.validateResolvedGmAdjudication,
    })
    roleAdjudicationId = role.adjudication.adjudicationId
    compatibilityResult = evaluateFactsCompatibility(facts, options, role.override, true)
  }
  else if (hasRoleEvidence) {
    return fail('breeding.setup.extraneous-evidence', 'Parent-role adjudication is accepted only when the canonical compatibility result requires it.')
  }

  if (compatibilityResult.status === 'unavailable') {
    return validationResult({
      ...base,
      status: 'unavailable',
      reasonIds: Object.freeze(['breeding.setup.compatibility-unavailable']),
      checks: statuses({ ...commonChecks, maturity: 'satisfied', compatibility: 'unavailable' }),
      compatibility: compatibilityProjection(compatibilityResult),
      parentFactsDefinitionHashes: Object.freeze(facts.map(value => value.definitionSha256)),
      maturityAdjudicationIds: Object.freeze(maturityAdjudications.map(value => value.adjudicationId)),
      roleAdjudicationId,
    }, actor)
  }
  return validationResult({
    ...base,
    status: 'ready',
    reasonIds: Object.freeze([]),
    checks: statuses({ ...commonChecks, maturity: 'satisfied', compatibility: 'satisfied' }),
    compatibility: compatibilityProjection(compatibilityResult),
    parentFactsDefinitionHashes: Object.freeze(facts.map(value => value.definitionSha256)),
    maturityAdjudicationIds: Object.freeze(maturityAdjudications.map(value => value.adjudicationId)),
    roleAdjudicationId,
  }, actor)
}

export const projectBreedingProjectSetupValidationV1 = (
  value: unknown,
  actorValue: unknown,
): BreedingProjectSetupValidationProjectionV1 => project(
  parseAuthoritativeBreedingProjectSetupValidationV1(value),
  parseAuthoritativeBreedingActorAuthorityV1(actorValue),
)

export const BREEDING_PROJECT_SETUP_COMPATIBILITY_POLICY_DEFINITION_SHA256 = compatibilityPolicyJson.definitionSha256
