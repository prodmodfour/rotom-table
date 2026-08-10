import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../automation/stableJson'
import { deepFreezeStrictJson } from '../automation/strictJson'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'
import { BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS } from './breederEdgeHandoff'
import {
  BREEDING_PARENT_CANDIDATE_REASON_IDS,
  BREEDING_PARENT_PREVIEW_REASON_IDS,
  type BreedingParentCandidateReasonId,
  type BreedingParentPreviewReasonId,
} from './parentDiscovery'
import {
  parseBreedingProjectWizardProjectionV1,
  verifyBreedingProjectWizardProjectionV1,
  type BreedingProjectWizardConsentStatus,
  type BreedingProjectWizardProjectionV1,
} from './projectWizard'

export const BREEDING_PROJECT_GUIDANCE_API_PATH = '/api/breeding/projects/wizard/guidance' as const
export const BREEDING_PROJECT_GUIDANCE_CUSTOM_REASON_IDS = Object.freeze([
  'breeding.project-guidance.breeder-edge-ambiguous',
  'breeding.project-guidance.breeder-edge-unavailable',
  'breeding.project-guidance.breeder-prerequisite-not-met',
  'breeding.project-guidance.breeder-provider-unavailable',
  'breeding.project-guidance.consent-review-required',
  'breeding.project-guidance.dilettante-choice-required',
  'breeding.project-guidance.maturity-confirmation-required',
  'breeding.project-guidance.pair-requires-final-validation',
  'breeding.project-guidance.parent-selection-incomplete',
] as const)
export type BreedingProjectGuidanceCustomReasonId = typeof BREEDING_PROJECT_GUIDANCE_CUSTOM_REASON_IDS[number]
export type BreedingProjectGuidanceReasonId =
  | BreedingParentCandidateReasonId
  | BreedingParentPreviewReasonId
  | BreedingProjectGuidanceCustomReasonId

export interface BreedingProjectGuidanceReasonDefinitionV1 {
  readonly reasonId: BreedingProjectGuidanceReasonId
  readonly severity: 'error' | 'info' | 'warning'
  readonly title: string
  readonly summary: string
  readonly recovery: string
}

const definitions = [
  ['breeding.compatibility.ditto-pair', 'error', 'Two Ditto cannot form a pair', 'A Ditto can fill one parent role, but two Ditto are not a compatible pair.', 'Choose one non-Ditto parent.'],
  ['breeding.compatibility.gender-mismatch', 'error', 'Parent roles do not match', 'The selected genders do not satisfy the current conventional parent-role policy.', 'Choose a complementary pair or ask the GM about an available reviewed role option.'],
  ['breeding.compatibility.genderless-unavailable', 'error', 'Genderless pairing is unavailable', 'The current campaign policy does not allow this genderless pairing.', 'Choose a pair allowed by the campaign policy.'],
  ['breeding.compatibility.invalid-parent-facts', 'error', 'Parent facts are unavailable', 'Current canonical facts could not establish a safe compatibility preview.', 'Refresh the parent sheets and retry.'],
  ['breeding.compatibility.maturity-level-low', 'error', 'A parent is below the maturity level', 'At least one selected parent is below the current minimum maturity Level.', 'Choose a mature parent or wait until its Level is high enough.'],
  ['breeding.compatibility.no-shared-egg-group', 'error', 'No shared Egg Group', 'The selected conventional parents do not share a canonical Egg Group.', 'Choose parents with a shared Egg Group.'],
  ['breeding.compatibility.not-breedable', 'error', 'A Species cannot breed', 'At least one selected Species is not breedable in the current compiled registry.', 'Choose a breedable Species.'],
  ['breeding.compatibility.role-override-invalid', 'error', 'Parent-role review is stale', 'The reviewed parent-role result does not match this exact current pair.', 'Ask the GM to review the current pair again.'],
  ['breeding.compatibility.role-override-not-allowed', 'error', 'Parent-role review is not enabled', 'The current campaign policy does not allow a GM parent-role option for this pair.', 'Choose a pair supported by the current policy.'],
  ['breeding.compatibility.role-override-required', 'warning', 'Parent-role review is required', 'This pair needs one bounded GM parent-role decision before final validation.', 'Ask the GM to review the selected pair.'],
  ['breeding.compatibility.same-parent', 'error', 'Choose two different parents', 'One Pokémon cannot occupy both parent positions.', 'Select two distinct current Pokémon sheets.'],
  ['breeding.compatibility.same-sex-unavailable', 'error', 'This same-sex pairing is unavailable', 'The current campaign policy does not allow this pairing without a reviewed role option.', 'Choose a supported pair or ask the GM about a reviewed role option.'],
  ['breeding.compatibility.spec-unavailable', 'error', 'Canonical Species data is unavailable', 'The current compiled Species authority cannot evaluate this pair.', 'Ask the GM to repair or refresh canonical Species authority.'],
  ['breeding.parent-discovery.gender-mismatch', 'error', 'Gender conflicts with Species data', 'The sheet Gender does not match the canonical Species gender policy.', 'Correct the source sheet through an authorised sheet workflow.'],
  ['breeding.parent-discovery.gender-unresolved', 'error', 'Gender is unresolved', 'The current Pokémon sheet does not contain one supported canonical Gender.', 'Set a supported Gender on the source sheet and retry.'],
  ['breeding.parent-discovery.sheet-invalid', 'error', 'Pokémon sheet is incomplete', 'The current sheet identity, Level, or required parent facts are malformed or missing.', 'Repair the source sheet and retry.'],
  ['breeding.parent-discovery.sheet-unavailable', 'error', 'Pokémon sheet is unavailable', 'The Trainer roster points to a Pokémon sheet that no longer exists.', 'Restore the sheet or remove the stale roster link.'],
  ['breeding.parent-discovery.species-not-breedable', 'error', 'Species is not breedable', 'The current compiled registry marks this Species as unavailable for ordinary breeding.', 'Choose another parent.'],
  ['breeding.parent-discovery.species-spec-unavailable', 'error', 'Species specification is unavailable', 'The Species identity exists, but its current compiled breeding specification is unavailable.', 'Ask the GM to repair canonical breeding authority.'],
  ['breeding.parent-discovery.species-unresolved', 'error', 'Species is unresolved', 'The sheet Species does not resolve to one current app-owned canonical identity.', 'Correct the Species on the source sheet and retry.'],
  ['breeding.parent-preview.candidate-unavailable', 'error', 'A selected parent is unavailable', 'At least one selected parent no longer has complete current candidate facts.', 'Refresh the directory and choose available parents.'],
  ['breeding.project-guidance.breeder-edge-ambiguous', 'error', 'Breeder authority is ambiguous', 'The selected Trainer has duplicate or unresolved Breeder Edge authority.', 'Resolve the Trainer Edge entries before continuing.'],
  ['breeding.project-guidance.breeder-edge-unavailable', 'error', 'Breeder Edge is unavailable', 'The selected Trainer does not have one current effective Breeder Trainer Edge.', 'Choose an authorised Breeder or acquire the Breeder Edge.'],
  ['breeding.project-guidance.breeder-prerequisite-not-met', 'error', 'Breeder prerequisite is not met', 'A directly acquired Breeder Edge requires at least Novice Pokémon Education.', 'Raise Pokémon Education or choose another Breeder.'],
  ['breeding.project-guidance.breeder-provider-unavailable', 'error', 'Breeder source could not be verified', 'Current Edge or Feature provider authority failed closed.', 'Refresh the Trainer and ask the GM to inspect provider diagnostics.'],
  ['breeding.project-guidance.consent-review-required', 'warning', 'Owner consent review is required', 'At least one selected parent belongs to another Trainer context.', 'Obtain current revision-bound owner consent before creation.'],
  ['breeding.project-guidance.dilettante-choice-required', 'warning', 'Dilettante skill choice is required', 'Dilettante currently provides Breeder, but its mandated General Education or Perception application is not selected.', 'Choose the server-offered mandated Skill during final confirmation.'],
  ['breeding.project-guidance.maturity-confirmation-required', 'warning', 'GM maturity confirmation is required', 'The current campaign policy requires one current GM maturity confirmation for each parent.', 'Ask the GM to confirm both exact parent revisions.'],
  ['breeding.project-guidance.pair-requires-final-validation', 'info', 'Pair is ready for final validation', 'The structural preview found no blocker, but ownership, consent, maturity, revisions, location, and compatibility must be rebuilt at creation.', 'Continue to current server choices and confirmation.'],
  ['breeding.project-guidance.parent-selection-incomplete', 'info', 'Choose two parents', 'Compatibility and consent cannot be reviewed until two current parents are selected.', 'Select two available Pokémon.'],
] as const satisfies ReadonlyArray<readonly [BreedingProjectGuidanceReasonId, 'error' | 'info' | 'warning', string, string, string]>

const expectedReasonIds = [...new Set<string>([
  ...BREEDING_PARENT_CANDIDATE_REASON_IDS,
  ...BREEDING_PARENT_PREVIEW_REASON_IDS,
  ...BREEDING_PROJECT_GUIDANCE_CUSTOM_REASON_IDS,
])].sort()
const actualReasonIds = definitions.map(row => row[0]).sort()
if (stableJsonStringify(actualReasonIds) !== stableJsonStringify(expectedReasonIds)) {
  throw new Error('Breeding Project guidance reason catalog is not closed over current parent and wizard reasons.')
}

export const BREEDING_PROJECT_GUIDANCE_REASON_CATALOG: readonly BreedingProjectGuidanceReasonDefinitionV1[] = Object.freeze(
  definitions.map(([reasonId, severity, title, summary, recovery]) => Object.freeze({
    reasonId,
    severity,
    title,
    summary,
    recovery,
  })).sort((left, right) => left.reasonId < right.reasonId ? -1 : left.reasonId > right.reasonId ? 1 : 0),
)
const reasonById = new Map(BREEDING_PROJECT_GUIDANCE_REASON_CATALOG.map(row => [row.reasonId, row]))
export const breedingProjectGuidanceReason = (
  reasonId: BreedingProjectGuidanceReasonId,
): BreedingProjectGuidanceReasonDefinitionV1 => reasonById.get(reasonId)
  ?? (() => { throw new Error(`Unknown Breeding Project guidance reason: ${reasonId}`) })()

export type BreedingProjectGuidanceSourceStatus = 'active' | 'choice-required' | 'unavailable'
export interface BreedingProjectGuidanceSkillApplicationV1 {
  readonly skillId: 'general-education' | 'perception' | 'pokemon-education'
  readonly rank: 'Adept' | 'Expert' | 'Master' | 'Novice' | 'Pathetic' | 'Untrained'
  readonly skillTotal: number
}
export interface BreedingProjectGuidanceSourceContributionV1 {
  readonly sourceKind: 'trainer-edge' | 'trainer-feature'
  readonly sourceCanonicalId: 'Breeder' | 'Dilettante'
  readonly status: BreedingProjectGuidanceSourceStatus
  readonly contributionIds: readonly string[]
  readonly skillApplication: BreedingProjectGuidanceSkillApplicationV1 | null
  readonly reasonId: BreedingProjectGuidanceCustomReasonId | null
}
export interface BreedingProjectGuidanceGmDiagnosticsV1 {
  readonly candidateCount: number
  readonly selectableCandidateCount: number
  readonly unavailableCandidateCount: number
  readonly selectedParentCount: number
  readonly ownershipTopology: 'cross-owner' | 'incomplete' | 'same-owner'
  readonly breederAuthorityStatus: BreedingProjectGuidanceSourceStatus
  readonly maturityPolicy: 'gm-confirmed-per-parent' | 'minimum-level'
  readonly minimumMaturityLevel: number | null
  readonly consentStatus: BreedingProjectWizardConsentStatus
  readonly compatibilityPreviewStatus: 'not-evaluated' | 'requires-validation' | 'unavailable'
  readonly locationPolicyId: 'campaign-workshop-off-map-v1'
  readonly facilityRegistryState: 'empty-no-authority'
  readonly finalValidationStatus: 'required-before-creation'
}
export interface BreedingProjectGuidanceProjectionV1 {
  readonly schemaVersion: 1
  readonly wizard: BreedingProjectWizardProjectionV1
  readonly applicableReasonIds: readonly BreedingProjectGuidanceReasonId[]
  readonly sourceContributions: readonly BreedingProjectGuidanceSourceContributionV1[]
  readonly gmDiagnostics: BreedingProjectGuidanceGmDiagnosticsV1 | null
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}

export class BreedingProjectGuidanceContractError extends Error {
  readonly code:
    | 'breeding.project-guidance.invalid-document'
    | 'breeding.project-guidance.invalid-invariant'
  readonly path: string
  constructor(code: BreedingProjectGuidanceContractError['code'], path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProjectGuidanceContractError'
    this.code = code
    this.path = path
  }
}
export class BreedingProjectGuidanceVerificationError extends Error {
  readonly code:
    | 'breeding.project-guidance.hash-mismatch'
    | 'breeding.project-guidance.hash-unavailable'
    | 'breeding.project-guidance.security-policy-mismatch'
  constructor(code: BreedingProjectGuidanceVerificationError['code'], message: string) {
    super(message)
    this.name = 'BreedingProjectGuidanceVerificationError'
    this.code = code
  }
}
const SHA256 = /^[0-9a-f]{64}$/u
const REASON_IDS = new Set<string>(expectedReasonIds)
const CUSTOM_REASON_IDS = new Set<string>(BREEDING_PROJECT_GUIDANCE_CUSTOM_REASON_IDS)
const RANKS = new Set<string>(['Adept', 'Expert', 'Master', 'Novice', 'Pathetic', 'Untrained'])
const SKILLS = new Set<string>(['general-education', 'perception', 'pokemon-education'])
const fail = (code: BreedingProjectGuidanceContractError['code'], path: string, message: string): never => {
  throw new BreedingProjectGuidanceContractError(code, path, message)
}
const exact = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.project-guidance.invalid-document', path, 'must be one plain data object.')
  }
  const row = value as Record<string, unknown>
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.project-guidance.invalid-document', path, 'must contain exactly the declared fields.')
  }
  for (const field of Object.getOwnPropertyNames(row)) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.project-guidance.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}
const array = (value: unknown, maximum: number, path: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.project-guidance.invalid-document', path, `must be a dense plain array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.project-guidance.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const integer = (value: unknown, maximum: number, path: string): number => Number.isSafeInteger(value)
  && Number(value) >= 0 && Number(value) <= maximum
  ? Number(value)
  : fail('breeding.project-guidance.invalid-document', path, 'must be a bounded nonnegative integer.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.project-guidance.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const parseReasonIds = (value: unknown, path: string): readonly BreedingProjectGuidanceReasonId[] => {
  const values = array(value, expectedReasonIds.length, path).map((entry, index) => (
    typeof entry === 'string' && REASON_IDS.has(entry)
      ? entry as BreedingProjectGuidanceReasonId
      : fail('breeding.project-guidance.invalid-document', `${path}[${index}]`, 'must be a closed guidance reason ID.')
  ))
  if (values.some((entry, index) => index > 0 && values[index - 1]! >= entry)) {
    return fail('breeding.project-guidance.invalid-invariant', path, 'must be unique in code-point order.')
  }
  return Object.freeze(values)
}
const parseSkill = (value: unknown, path: string): BreedingProjectGuidanceSkillApplicationV1 | null => {
  if (value === null) return null
  const row = exact(value, ['skillId', 'rank', 'skillTotal'], path)
  if (typeof row.skillId !== 'string' || !SKILLS.has(row.skillId)
    || typeof row.rank !== 'string' || !RANKS.has(row.rank)
    || !Number.isSafeInteger(row.skillTotal) || Number(row.skillTotal) < -30
    || Number(row.skillTotal) > 100) {
    return fail('breeding.project-guidance.invalid-document', path, 'must be one bounded Breeder Skill application.')
  }
  return Object.freeze({
    skillId: row.skillId as BreedingProjectGuidanceSkillApplicationV1['skillId'],
    rank: row.rank as BreedingProjectGuidanceSkillApplicationV1['rank'],
    skillTotal: Number(row.skillTotal),
  })
}
const parseSource = (value: unknown, path: string): BreedingProjectGuidanceSourceContributionV1 => {
  const row = exact(value, [
    'sourceKind', 'sourceCanonicalId', 'status', 'contributionIds', 'skillApplication', 'reasonId',
  ], path)
  if ((row.sourceKind !== 'trainer-edge' && row.sourceKind !== 'trainer-feature')
    || (row.sourceCanonicalId !== 'Breeder' && row.sourceCanonicalId !== 'Dilettante')
    || (row.status !== 'active' && row.status !== 'choice-required' && row.status !== 'unavailable')) {
    return fail('breeding.project-guidance.invalid-document', path, 'must identify one closed source contribution and status.')
  }
  const expectedContributions = row.sourceCanonicalId === 'Breeder'
    ? BREEDING_BREEDER_EDGE_CONTRIBUTION_IDS
    : ['effective-breeder-edge-grant'] as const
  const contributionIds = array(row.contributionIds, 2, `${path}.contributionIds`)
  if (stableJsonStringify(contributionIds) !== stableJsonStringify(expectedContributions)
    || (row.sourceCanonicalId === 'Breeder') !== (row.sourceKind === 'trainer-edge')
    || (row.sourceCanonicalId === 'Dilettante' && row.status !== 'active')) {
    return fail('breeding.project-guidance.invalid-invariant', path, 'must retain the exact reviewed source contribution inventory.')
  }
  const skillApplication = parseSkill(row.skillApplication, `${path}.skillApplication`)
  const reasonId = row.reasonId === null ? null
    : typeof row.reasonId === 'string' && CUSTOM_REASON_IDS.has(row.reasonId)
      ? row.reasonId as BreedingProjectGuidanceCustomReasonId
      : fail('breeding.project-guidance.invalid-document', `${path}.reasonId`, 'must be a closed source reason or null.')
  const unavailableReasons = new Set<BreedingProjectGuidanceCustomReasonId>([
    'breeding.project-guidance.breeder-edge-ambiguous',
    'breeding.project-guidance.breeder-edge-unavailable',
    'breeding.project-guidance.breeder-prerequisite-not-met',
    'breeding.project-guidance.breeder-provider-unavailable',
  ])
  if (row.status === 'active' && row.sourceCanonicalId === 'Breeder' && (!skillApplication || reasonId !== null)
    || row.sourceCanonicalId === 'Dilettante' && (skillApplication !== null || reasonId !== null)
    || row.status !== 'active' && (skillApplication !== null || reasonId === null)
    || row.status === 'choice-required'
      && reasonId !== 'breeding.project-guidance.dilettante-choice-required'
    || row.status === 'unavailable' && (!reasonId || !unavailableReasons.has(reasonId))) {
    return fail('breeding.project-guidance.invalid-invariant', path, 'source status, Skill application, and reason must agree.')
  }
  return Object.freeze({
    sourceKind: row.sourceKind,
    sourceCanonicalId: row.sourceCanonicalId,
    status: row.status,
    contributionIds: Object.freeze([...contributionIds]) as readonly string[],
    skillApplication,
    reasonId,
  }) as BreedingProjectGuidanceSourceContributionV1
}
const parseDiagnostics = (
  value: unknown,
  path: string,
): BreedingProjectGuidanceGmDiagnosticsV1 | null => {
  if (value === null) return null
  const row = exact(value, [
    'candidateCount', 'selectableCandidateCount', 'unavailableCandidateCount', 'selectedParentCount',
    'ownershipTopology', 'breederAuthorityStatus', 'maturityPolicy', 'minimumMaturityLevel',
    'consentStatus', 'compatibilityPreviewStatus', 'locationPolicyId', 'facilityRegistryState',
    'finalValidationStatus',
  ], path)
  const candidateCount = integer(row.candidateCount, 2048, `${path}.candidateCount`)
  const selectableCandidateCount = integer(row.selectableCandidateCount, 2048, `${path}.selectableCandidateCount`)
  const unavailableCandidateCount = integer(row.unavailableCandidateCount, 2048, `${path}.unavailableCandidateCount`)
  const selectedParentCount = integer(row.selectedParentCount, 2, `${path}.selectedParentCount`)
  if (candidateCount !== selectableCandidateCount + unavailableCandidateCount
    || !['cross-owner', 'incomplete', 'same-owner'].includes(row.ownershipTopology as string)
    || !['active', 'choice-required', 'unavailable'].includes(row.breederAuthorityStatus as string)
    || !['gm-confirmed-per-parent', 'minimum-level'].includes(row.maturityPolicy as string)
    || !['selection-incomplete', 'not-required', 'review-required'].includes(row.consentStatus as string)
    || !['not-evaluated', 'requires-validation', 'unavailable'].includes(row.compatibilityPreviewStatus as string)
    || row.locationPolicyId !== 'campaign-workshop-off-map-v1'
    || row.facilityRegistryState !== 'empty-no-authority'
    || row.finalValidationStatus !== 'required-before-creation') {
    return fail('breeding.project-guidance.invalid-invariant', path, 'must contain one internally consistent bounded GM diagnostic summary.')
  }
  const minimumMaturityLevel = row.minimumMaturityLevel === null
    ? null
    : integer(row.minimumMaturityLevel, 100, `${path}.minimumMaturityLevel`)
  if ((row.maturityPolicy === 'minimum-level') !== (minimumMaturityLevel !== null)
    || (minimumMaturityLevel !== null && minimumMaturityLevel < 1)) {
    return fail('breeding.project-guidance.invalid-invariant', path, 'minimum maturity Level must exist only for the minimum-Level policy.')
  }
  return Object.freeze({
    candidateCount,
    selectableCandidateCount,
    unavailableCandidateCount,
    selectedParentCount,
    ownershipTopology: row.ownershipTopology,
    breederAuthorityStatus: row.breederAuthorityStatus,
    maturityPolicy: row.maturityPolicy,
    minimumMaturityLevel,
    consentStatus: row.consentStatus,
    compatibilityPreviewStatus: row.compatibilityPreviewStatus,
    locationPolicyId: 'campaign-workshop-off-map-v1',
    facilityRegistryState: 'empty-no-authority',
    finalValidationStatus: 'required-before-creation',
  }) as BreedingProjectGuidanceGmDiagnosticsV1
}

export const BREEDING_PROJECT_GUIDANCE_SECURITY_POLICY_DEFINITION_SHA256 = hash(
  securityPolicyJson.definitionSha256,
  'securityPolicy.definitionSha256',
)

export const parseBreedingProjectGuidanceProjectionV1 = (
  value: unknown,
  path = 'projectGuidance',
): BreedingProjectGuidanceProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'wizard', 'applicableReasonIds', 'sourceContributions', 'gmDiagnostics',
    'securityPolicyDefinitionSha256', 'projectionDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1) {
    return fail('breeding.project-guidance.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  }
  const wizard = parseBreedingProjectWizardProjectionV1(row.wizard, `${path}.wizard`)
  const applicableReasonIds = parseReasonIds(row.applicableReasonIds, `${path}.applicableReasonIds`)
  const sourceContributions = array(row.sourceContributions, 2, `${path}.sourceContributions`)
    .map((entry, index) => parseSource(entry, `${path}.sourceContributions[${index}]`))
  if (sourceContributions.length < 1
    || sourceContributions.some((entry, index) => index > 0
      && `${sourceContributions[index - 1]!.sourceKind}\u0000${sourceContributions[index - 1]!.sourceCanonicalId}`
      >= `${entry.sourceKind}\u0000${entry.sourceCanonicalId}`)
    || sourceContributions.filter(entry => entry.sourceCanonicalId === 'Breeder').length !== 1) {
    return fail('breeding.project-guidance.invalid-invariant', `${path}.sourceContributions`, 'must be a canonical source list with exactly one Breeder row.')
  }
  const breederSource = sourceContributions.find(entry => entry.sourceCanonicalId === 'Breeder')!
  const dilettanteSource = sourceContributions.find(entry => entry.sourceCanonicalId === 'Dilettante')
  if ((dilettanteSource !== undefined) !== (breederSource.status === 'choice-required'
    && breederSource.reasonId === 'breeding.project-guidance.dilettante-choice-required')
    || sourceContributions.some(source => source.reasonId !== null
      && !applicableReasonIds.includes(source.reasonId))) {
    return fail('breeding.project-guidance.invalid-invariant', `${path}.sourceContributions`, 'source rows and applicable source reasons must agree.')
  }
  const selectedParentCount = wizard.parentDiscovery.selectedParentRefs.length
  const compatibilityPreview = wizard.parentDiscovery.compatibilityPreview
  const hasIncompleteReason = applicableReasonIds.includes('breeding.project-guidance.parent-selection-incomplete')
  const hasFinalValidationReason = applicableReasonIds.includes('breeding.project-guidance.pair-requires-final-validation')
  const hasConsentReason = applicableReasonIds.includes('breeding.project-guidance.consent-review-required')
  if ((selectedParentCount !== 2) !== hasIncompleteReason
    || (selectedParentCount === 2 && compatibilityPreview?.status === 'requires-validation') !== hasFinalValidationReason
    || (wizard.consentStatus === 'review-required') !== hasConsentReason
    || compatibilityPreview?.status === 'unavailable'
      && compatibilityPreview.reasonIds.some(reasonId => !applicableReasonIds.includes(reasonId))) {
    return fail('breeding.project-guidance.invalid-invariant', `${path}.applicableReasonIds`, 'must agree with parent selection, compatibility, and consent status.')
  }
  const gmDiagnostics = parseDiagnostics(row.gmDiagnostics, `${path}.gmDiagnostics`)
  if ((wizard.audience === 'gm') !== (gmDiagnostics !== null)) {
    return fail('breeding.project-guidance.invalid-invariant', `${path}.gmDiagnostics`, 'must exist for GM projections only.')
  }
  const candidates = wizard.parentDiscovery.trainerSheets.flatMap(trainer => trainer.candidates)
  if (gmDiagnostics && (gmDiagnostics.candidateCount !== candidates.length
    || gmDiagnostics.selectableCandidateCount !== candidates.filter(candidate => candidate.availability.status === 'selectable').length
    || gmDiagnostics.unavailableCandidateCount !== candidates.filter(candidate => candidate.availability.status === 'unavailable').length
    || gmDiagnostics.selectedParentCount !== wizard.parentDiscovery.selectedParentRefs.length
    || gmDiagnostics.consentStatus !== wizard.consentStatus
    || gmDiagnostics.breederAuthorityStatus !== sourceContributions.find(entry => entry.sourceCanonicalId === 'Breeder')!.status)) {
    return fail('breeding.project-guidance.invalid-invariant', `${path}.gmDiagnostics`, 'must agree with the exact nested wizard and source projection.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    wizard,
    applicableReasonIds,
    sourceContributions,
    gmDiagnostics,
    securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`),
    projectionDefinitionSha256: hash(row.projectionDefinitionSha256, `${path}.projectionDefinitionSha256`),
  }) as BreedingProjectGuidanceProjectionV1
}

export const verifyBreedingProjectGuidanceProjectionV1 = async (
  value: unknown,
  path = 'projectGuidance',
): Promise<BreedingProjectGuidanceProjectionV1> => {
  const projection = parseBreedingProjectGuidanceProjectionV1(value, path)
  await verifyBreedingProjectWizardProjectionV1(projection.wizard, `${path}.wizard`)
  if (projection.securityPolicyDefinitionSha256 !== BREEDING_PROJECT_GUIDANCE_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingProjectGuidanceVerificationError(
      'breeding.project-guidance.security-policy-mismatch',
      'Breeding Project guidance does not use the current security policy.',
    )
  }
  const { projectionDefinitionSha256, ...definition } = projection
  let actual: string
  try { actual = await computeRulesetSourceSha256(stableJsonStringify(definition)) }
  catch {
    throw new BreedingProjectGuidanceVerificationError(
      'breeding.project-guidance.hash-unavailable',
      'Breeding Project guidance verification is unavailable.',
    )
  }
  if (actual !== projectionDefinitionSha256) {
    throw new BreedingProjectGuidanceVerificationError(
      'breeding.project-guidance.hash-mismatch',
      'Breeding Project guidance hash does not match its exact audience definition.',
    )
  }
  return projection
}
