import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../automation/stableJson'
import { deepFreezeStrictJson } from '../automation/strictJson'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'
import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import {
  parseBreedingOfferOptionIdSyntax,
  parseBreedingProjectIdSyntax,
  type BreedingOfferOptionId,
  type BreedingProjectId,
} from './ids'
import {
  parseBreedingParentSelectionV1,
  type BreedingParentSelectionRefV1,
} from './parentDiscovery'
import {
  parseBreedingProjectGuidanceProjectionV1,
  verifyBreedingProjectGuidanceProjectionV1,
  type BreedingProjectGuidanceProjectionV1,
} from './projectGuidance'

export const BREEDING_PROJECT_CHOICES_API_PATH = '/api/breeding/projects/wizard/choices' as const
export const BREEDING_PROJECT_DRAFT_ID_PATTERN = /^breeding-project-draft:v1:[0-9a-f]{32}$/u
export const BREEDING_PROJECT_CHOICE_TRAIT_KINDS = Object.freeze(['nature', 'ability', 'gender'] as const)
export const BREEDING_PROJECT_CHOICE_REQUIRED_RANKS = Object.freeze({
  nature: 'Adept',
  ability: 'Expert',
  gender: 'Master',
} as const)
export const BREEDING_PROJECT_CAMPAIGN_SETTING_IDS = Object.freeze([
  'breeding.baby-template-policy',
  'breeding.baby-template-stat-penalty',
  'breeding.check-failure-policy',
  'breeding.form-root-policy',
  'breeding.fossil-hatch-level',
  'breeding.fossil-inheritance-policy',
  'breeding.genderless-policy',
  'breeding.gm-hatch-duration-minutes',
  'breeding.hatch-duration-variation',
  'breeding.hatch-special-policy',
  'breeding.maturity-policy',
  'breeding.minimum-maturity-level',
  'breeding.missing-hatch-duration-policy',
  'breeding.parent-family-policy',
  'breeding.same-sex-policy',
] as const)

export type BreedingProjectChoiceTraitKind = typeof BREEDING_PROJECT_CHOICE_TRAIT_KINDS[number]
export type BreedingProjectChoiceRank = 'Untrained' | 'Novice' | 'Adept' | 'Expert' | 'Master'

export interface BreedingProjectChoicesRequestV1 {
  readonly schemaVersion: 1
  readonly profileId: PlayerProfileId | null
  readonly destinationTrainerSlug: string
  readonly breederTrainerSlug: string
  readonly parentRefs: readonly BreedingParentSelectionRefV1[]
  readonly draftId: string
  readonly selectedOptionIds: readonly BreedingOfferOptionId[]
  readonly confirmed: boolean
}

export interface BreedingProjectChoiceOptionV1 {
  readonly optionId: BreedingOfferOptionId
  readonly label: string
  readonly description: string
  readonly selected: boolean
}

export interface BreedingProjectSkillChoiceV1 {
  readonly status: 'not-required' | 'required' | 'selected' | 'unavailable'
  readonly options: readonly BreedingProjectChoiceOptionV1[]
}

export interface BreedingProjectTraitChoiceAuthorityV1 {
  readonly traitKind: BreedingProjectChoiceTraitKind
  readonly requiredRank: 'Adept' | 'Expert' | 'Master'
  readonly effectiveRank: BreedingProjectChoiceRank | null
  readonly status: 'choice-authorised' | 'random-only' | 'unavailable'
  readonly resolutionCheckpoint: 'egg-production'
}

export interface BreedingProjectCampaignSettingV1 {
  readonly campaignOptionId: string
  readonly label: string
  readonly valueLabel: string
}

export interface BreedingProjectMaturityChoiceV1 {
  readonly parentOrdinal: 1 | 2
  readonly parentLabel: string
  readonly status: 'confirmed' | 'confirmation-required' | 'unavailable'
  readonly option: BreedingProjectChoiceOptionV1 | null
}

export interface BreedingProjectParentRoleChoiceV1 {
  readonly status: 'not-required' | 'required' | 'selected' | 'unavailable'
  readonly options: readonly BreedingProjectChoiceOptionV1[]
}

export type BreedingProjectChoiceMessageId =
  | 'breeding.project-choices.breeder-choice-required'
  | 'breeding.project-choices.breeder-unavailable'
  | 'breeding.project-choices.creation-rejected'
  | 'breeding.project-choices.cross-owner-consent-required'
  | 'breeding.project-choices.current-validation-required'
  | 'breeding.project-choices.maturity-review-required'
  | 'breeding.project-choices.parent-role-review-required'
  | 'breeding.project-choices.project-awaiting-consent'
  | 'breeding.project-choices.project-created'
  | 'breeding.project-choices.ready-to-confirm'
  | 'breeding.project-choices.selection-incomplete'

export interface BreedingProjectChoiceCreatedProjectV1 {
  readonly projectId: BreedingProjectId
  readonly revision: 0
  readonly status: 'awaiting-parent-consent' | 'initial-time-in-progress'
}

export interface BreedingProjectChoiceConfirmationV1 {
  readonly status: 'blocked' | 'created' | 'incomplete' | 'ready'
  readonly setupStatus: 'awaiting-consent' | 'not-evaluated' | 'ready' | 'unavailable'
  readonly canConfirm: boolean
  readonly explicitConfirmationRequired: true
  readonly messageId: BreedingProjectChoiceMessageId
  readonly project: BreedingProjectChoiceCreatedProjectV1 | null
}

export interface BreedingProjectChoicesProjectionV1 {
  readonly schemaVersion: 1
  readonly guidance: BreedingProjectGuidanceProjectionV1
  readonly skillChoice: BreedingProjectSkillChoiceV1
  readonly traitChoices: readonly [
    BreedingProjectTraitChoiceAuthorityV1,
    BreedingProjectTraitChoiceAuthorityV1,
    BreedingProjectTraitChoiceAuthorityV1,
  ]
  readonly campaignSettings: readonly BreedingProjectCampaignSettingV1[]
  readonly maturityChoices: readonly BreedingProjectMaturityChoiceV1[]
  readonly parentRoleChoice: BreedingProjectParentRoleChoiceV1
  readonly confirmation: BreedingProjectChoiceConfirmationV1
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}

export class BreedingProjectChoicesContractError extends Error {
  readonly code: 'breeding.project-choices.invalid-document' | 'breeding.project-choices.invalid-invariant'
  readonly path: string
  constructor(code: BreedingProjectChoicesContractError['code'], path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProjectChoicesContractError'
    this.code = code
    this.path = path
  }
}
export class BreedingProjectChoicesVerificationError extends Error {
  readonly code:
    | 'breeding.project-choices.hash-mismatch'
    | 'breeding.project-choices.hash-unavailable'
    | 'breeding.project-choices.security-policy-mismatch'
  constructor(code: BreedingProjectChoicesVerificationError['code'], message: string) {
    super(message)
    this.name = 'BreedingProjectChoicesVerificationError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u
const RANK_ORDER = Object.freeze(['Untrained', 'Novice', 'Adept', 'Expert', 'Master'] as const)
const RANKS = new Set<string>(RANK_ORDER)
const MESSAGE_IDS = new Set<BreedingProjectChoiceMessageId>([
  'breeding.project-choices.breeder-choice-required',
  'breeding.project-choices.breeder-unavailable',
  'breeding.project-choices.creation-rejected',
  'breeding.project-choices.cross-owner-consent-required',
  'breeding.project-choices.current-validation-required',
  'breeding.project-choices.maturity-review-required',
  'breeding.project-choices.parent-role-review-required',
  'breeding.project-choices.project-awaiting-consent',
  'breeding.project-choices.project-created',
  'breeding.project-choices.ready-to-confirm',
  'breeding.project-choices.selection-incomplete',
])
const fail = (code: BreedingProjectChoicesContractError['code'], path: string, message: string): never => {
  throw new BreedingProjectChoicesContractError(code, path, message)
}
export const createBreedingProjectDraftId = (
  randomBytes: (length: number) => Uint8Array,
): string => {
  let bytes: Uint8Array
  try { bytes = randomBytes(16) }
  catch { return fail('breeding.project-choices.invalid-document', 'randomBytes', 'must synchronously provide 16 random bytes.') }
  if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype
    || bytes.byteLength !== 16 || bytes.byteOffset !== 0 || bytes.buffer.byteLength !== 16) {
    return fail('breeding.project-choices.invalid-document', 'randomBytes', 'must synchronously provide exactly 16 owned random bytes.')
  }
  return `breeding-project-draft:v1:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.project-choices.invalid-document', path, 'must be one plain data object.')
  }
  const row = value as UnknownRecord
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.project-choices.invalid-document', path, 'must contain exactly the declared fields.')
  }
  for (const field of Object.getOwnPropertyNames(row)) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.project-choices.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}
const array = (value: unknown, maximum: number, path: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.project-choices.invalid-document', path, `must be one dense plain array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.project-choices.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const safeText = (value: unknown, path: string, maximum = 180): string => typeof value === 'string'
  && value.length > 0 && Array.from(value).length <= maximum && value === value.trim()
  && value === value.normalize('NFKC') && !CONTROL.test(value)
  ? value
  : fail('breeding.project-choices.invalid-document', path, 'must be bounded normalized safe text.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.project-choices.invalid-document', path, 'must be one lowercase SHA-256 digest.')
const parseOption = (value: unknown, path: string): BreedingProjectChoiceOptionV1 => {
  const row = exact(value, ['optionId', 'label', 'description', 'selected'], path)
  if (typeof row.selected !== 'boolean') {
    return fail('breeding.project-choices.invalid-document', `${path}.selected`, 'must be boolean.')
  }
  return Object.freeze({
    optionId: parseBreedingOfferOptionIdSyntax(row.optionId)
      ?? fail('breeding.project-choices.invalid-document', `${path}.optionId`, 'must be a server-issued option ID.'),
    label: safeText(row.label, `${path}.label`, 100),
    description: safeText(row.description, `${path}.description`, 240),
    selected: row.selected,
  })
}
const parseOptionList = (value: unknown, path: string, maximum: number): readonly BreedingProjectChoiceOptionV1[] => {
  const options = array(value, maximum, path).map((entry, index) => parseOption(entry, `${path}[${index}]`))
  if (options.some((entry, index) => index > 0 && options[index - 1]!.optionId >= entry.optionId)) {
    return fail('breeding.project-choices.invalid-invariant', path, 'must be unique in option-ID order.')
  }
  return Object.freeze(options)
}

export const parseBreedingProjectChoicesRequestV1 = (
  value: unknown,
  path = 'projectChoicesRequest',
): BreedingProjectChoicesRequestV1 => {
  const row = exact(value, [
    'schemaVersion', 'profileId', 'destinationTrainerSlug', 'breederTrainerSlug', 'parentRefs',
    'draftId', 'selectedOptionIds', 'confirmed',
  ], path)
  if (row.schemaVersion !== 1 || typeof row.confirmed !== 'boolean'
    || typeof row.draftId !== 'string' || !BREEDING_PROJECT_DRAFT_ID_PATTERN.test(row.draftId)) {
    return fail('breeding.project-choices.invalid-document', path, 'must be one schema-v1 Project choice request.')
  }
  const selection = parseBreedingParentSelectionV1({ schemaVersion: 1, parentRefs: row.parentRefs })
  const optionIds = array(row.selectedOptionIds, 8, `${path}.selectedOptionIds`).map((entry, index) => (
    parseBreedingOfferOptionIdSyntax(entry)
      ?? fail('breeding.project-choices.invalid-document', `${path}.selectedOptionIds[${index}]`, 'must be a server-issued option ID.')
  ))
  if (optionIds.some((entry, index) => index > 0 && optionIds[index - 1]! >= entry)) {
    return fail('breeding.project-choices.invalid-invariant', `${path}.selectedOptionIds`, 'must be unique in code-point order.')
  }
  const wizardRequest = exact({
    schemaVersion: 1,
    profileId: row.profileId,
    destinationTrainerSlug: row.destinationTrainerSlug,
    breederTrainerSlug: row.breederTrainerSlug,
    parentRefs: selection.parentRefs,
  }, ['schemaVersion', 'profileId', 'destinationTrainerSlug', 'breederTrainerSlug', 'parentRefs'], `${path}.wizard`)
  if ((wizardRequest.profileId !== null && !isPlayerProfileId(wizardRequest.profileId))
    || typeof wizardRequest.destinationTrainerSlug !== 'string'
    || typeof wizardRequest.breederTrainerSlug !== 'string') {
    return fail('breeding.project-choices.invalid-document', path, 'must contain valid Profile and Trainer selectors.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    profileId: wizardRequest.profileId as PlayerProfileId | null,
    destinationTrainerSlug: wizardRequest.destinationTrainerSlug,
    breederTrainerSlug: wizardRequest.breederTrainerSlug,
    parentRefs: selection.parentRefs,
    draftId: row.draftId,
    selectedOptionIds: optionIds,
    confirmed: row.confirmed,
  }) as BreedingProjectChoicesRequestV1
}

const parseSkillChoice = (value: unknown, path: string): BreedingProjectSkillChoiceV1 => {
  const row = exact(value, ['status', 'options'], path)
  if (!['not-required', 'required', 'selected', 'unavailable'].includes(row.status as string)) {
    return fail('breeding.project-choices.invalid-document', `${path}.status`, 'must be a closed Skill-choice status.')
  }
  const options = parseOptionList(row.options, `${path}.options`, 2)
  const selected = options.filter(option => option.selected).length
  if ((row.status === 'not-required' || row.status === 'unavailable') !== (options.length === 0)
    || row.status === 'required' && (options.length !== 2 || selected !== 0)
    || row.status === 'selected' && (options.length !== 2 || selected !== 1)) {
    return fail('breeding.project-choices.invalid-invariant', path, 'Skill status and its two bounded options must agree.')
  }
  return Object.freeze({ status: row.status, options }) as BreedingProjectSkillChoiceV1
}
const parseTrait = (value: unknown, path: string): BreedingProjectTraitChoiceAuthorityV1 => {
  const row = exact(value, ['traitKind', 'requiredRank', 'effectiveRank', 'status', 'resolutionCheckpoint'], path)
  if (!BREEDING_PROJECT_CHOICE_TRAIT_KINDS.includes(row.traitKind as BreedingProjectChoiceTraitKind)
    || row.requiredRank !== BREEDING_PROJECT_CHOICE_REQUIRED_RANKS[row.traitKind as BreedingProjectChoiceTraitKind]
    || (row.effectiveRank !== null && (typeof row.effectiveRank !== 'string' || !RANKS.has(row.effectiveRank)))
    || !['choice-authorised', 'random-only', 'unavailable'].includes(row.status as string)
    || row.resolutionCheckpoint !== 'egg-production') {
    return fail('breeding.project-choices.invalid-invariant', path, 'must be one exact rank-gated trait authority row.')
  }
  if ((row.effectiveRank === null) !== (row.status === 'unavailable')) {
    return fail('breeding.project-choices.invalid-invariant', path, 'trait authority requires an effective rank exactly when available.')
  }
  if (row.effectiveRank !== null) {
    const expected = RANK_ORDER.indexOf(row.effectiveRank as BreedingProjectChoiceRank)
      >= RANK_ORDER.indexOf(row.requiredRank as BreedingProjectChoiceRank)
      ? 'choice-authorised'
      : 'random-only'
    if (row.status !== expected) {
      return fail('breeding.project-choices.invalid-invariant', path, 'trait status must exactly follow its current rank gate.')
    }
  }
  return Object.freeze({
    traitKind: row.traitKind,
    requiredRank: row.requiredRank,
    effectiveRank: row.effectiveRank,
    status: row.status,
    resolutionCheckpoint: 'egg-production',
  }) as BreedingProjectTraitChoiceAuthorityV1
}
const parseCampaignSetting = (value: unknown, path: string): BreedingProjectCampaignSettingV1 => {
  const row = exact(value, ['campaignOptionId', 'label', 'valueLabel'], path)
  if (typeof row.campaignOptionId !== 'string' || !/^breeding\.[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(row.campaignOptionId)) {
    return fail('breeding.project-choices.invalid-document', `${path}.campaignOptionId`, 'must be a canonical campaign-option ID.')
  }
  return Object.freeze({
    campaignOptionId: row.campaignOptionId,
    label: safeText(row.label, `${path}.label`, 120),
    valueLabel: safeText(row.valueLabel, `${path}.valueLabel`, 120),
  })
}
const parseMaturity = (value: unknown, path: string): BreedingProjectMaturityChoiceV1 => {
  const row = exact(value, ['parentOrdinal', 'parentLabel', 'status', 'option'], path)
  if ((row.parentOrdinal !== 1 && row.parentOrdinal !== 2)
    || !['confirmed', 'confirmation-required', 'unavailable'].includes(row.status as string)) {
    return fail('breeding.project-choices.invalid-document', path, 'must be one bounded parent maturity choice.')
  }
  const option = row.option === null ? null : parseOption(row.option, `${path}.option`)
  if ((row.status === 'confirmation-required') !== (option !== null)
    || option && option.selected && row.status !== 'confirmation-required') {
    return fail('breeding.project-choices.invalid-invariant', path, 'maturity status and option must agree.')
  }
  return Object.freeze({
    parentOrdinal: row.parentOrdinal,
    parentLabel: safeText(row.parentLabel, `${path}.parentLabel`, 100),
    status: row.status,
    option,
  }) as BreedingProjectMaturityChoiceV1
}
const parseRoleChoice = (value: unknown, path: string): BreedingProjectParentRoleChoiceV1 => {
  const row = exact(value, ['status', 'options'], path)
  if (!['not-required', 'required', 'selected', 'unavailable'].includes(row.status as string)) {
    return fail('breeding.project-choices.invalid-document', `${path}.status`, 'must be a closed role-choice status.')
  }
  const options = parseOptionList(row.options, `${path}.options`, 2)
  const selected = options.filter(option => option.selected).length
  if ((row.status === 'not-required' || row.status === 'unavailable') !== (options.length === 0)
    || row.status === 'required' && (options.length !== 2 || selected !== 0)
    || row.status === 'selected' && (options.length !== 2 || selected !== 1)) {
    return fail('breeding.project-choices.invalid-invariant', path, 'role status and bounded options must agree.')
  }
  return Object.freeze({ status: row.status, options }) as BreedingProjectParentRoleChoiceV1
}
const parseConfirmation = (value: unknown, path: string): BreedingProjectChoiceConfirmationV1 => {
  const row = exact(value, [
    'status', 'setupStatus', 'canConfirm', 'explicitConfirmationRequired', 'messageId', 'project',
  ], path)
  if (!['blocked', 'created', 'incomplete', 'ready'].includes(row.status as string)
    || !['awaiting-consent', 'not-evaluated', 'ready', 'unavailable'].includes(row.setupStatus as string)
    || typeof row.canConfirm !== 'boolean' || row.explicitConfirmationRequired !== true
    || typeof row.messageId !== 'string' || !MESSAGE_IDS.has(row.messageId as BreedingProjectChoiceMessageId)) {
    return fail('breeding.project-choices.invalid-document', path, 'must be one closed confirmation state.')
  }
  let project: BreedingProjectChoiceCreatedProjectV1 | null = null
  if (row.project !== null) {
    const projectRow = exact(row.project, ['projectId', 'revision', 'status'], `${path}.project`)
    if (projectRow.revision !== 0 || (projectRow.status !== 'awaiting-parent-consent'
      && projectRow.status !== 'initial-time-in-progress')) {
      return fail('breeding.project-choices.invalid-invariant', `${path}.project`, 'must be one revision-zero created Project summary.')
    }
    project = Object.freeze({
      projectId: parseBreedingProjectIdSyntax(projectRow.projectId)
        ?? fail('breeding.project-choices.invalid-document', `${path}.project.projectId`, 'must be a Breeding Project ID.'),
      revision: 0,
      status: projectRow.status,
    })
  }
  const expectedCreatedMessage = project?.status === 'awaiting-parent-consent'
    ? 'breeding.project-choices.project-awaiting-consent'
    : 'breeding.project-choices.project-created'
  if ((row.status === 'created') !== (project !== null)
    || (row.status === 'ready') !== row.canConfirm
    || row.status === 'created' && (row.setupStatus !== (project?.status === 'awaiting-parent-consent' ? 'awaiting-consent' : 'ready')
      || row.messageId !== expectedCreatedMessage)
    || row.status === 'ready' && (row.setupStatus !== 'ready'
      || row.messageId !== 'breeding.project-choices.ready-to-confirm')
    || row.status === 'incomplete' && (row.setupStatus !== 'not-evaluated'
      || row.messageId !== 'breeding.project-choices.selection-incomplete')
    || row.status === 'blocked' && (row.messageId === 'breeding.project-choices.ready-to-confirm'
      || row.messageId === 'breeding.project-choices.selection-incomplete'
      || row.messageId === 'breeding.project-choices.project-created'
      || row.messageId === 'breeding.project-choices.project-awaiting-consent')) {
    return fail('breeding.project-choices.invalid-invariant', path, 'confirmation status, capability, message, setup, and Project summary must agree.')
  }
  return Object.freeze({
    status: row.status,
    setupStatus: row.setupStatus,
    canConfirm: row.canConfirm,
    explicitConfirmationRequired: true,
    messageId: row.messageId,
    project,
  }) as BreedingProjectChoiceConfirmationV1
}

export const BREEDING_PROJECT_CHOICES_SECURITY_POLICY_DEFINITION_SHA256 = hash(
  securityPolicyJson.definitionSha256,
  'securityPolicy.definitionSha256',
)

export const parseBreedingProjectChoicesProjectionV1 = (
  value: unknown,
  path = 'projectChoices',
): BreedingProjectChoicesProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'guidance', 'skillChoice', 'traitChoices', 'campaignSettings',
    'maturityChoices', 'parentRoleChoice', 'confirmation',
    'securityPolicyDefinitionSha256', 'projectionDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1) {
    return fail('breeding.project-choices.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  }
  const guidance = parseBreedingProjectGuidanceProjectionV1(row.guidance, `${path}.guidance`)
  const skillChoice = parseSkillChoice(row.skillChoice, `${path}.skillChoice`)
  const traitRows = array(row.traitChoices, 3, `${path}.traitChoices`)
  if (traitRows.length !== 3) return fail('breeding.project-choices.invalid-invariant', `${path}.traitChoices`, 'must contain Nature, Ability, and Gender exactly once.')
  const traitChoices = traitRows.map((entry, index) => parseTrait(entry, `${path}.traitChoices[${index}]`))
  if (traitChoices.some((entry, index) => entry.traitKind !== BREEDING_PROJECT_CHOICE_TRAIT_KINDS[index])) {
    return fail('breeding.project-choices.invalid-invariant', `${path}.traitChoices`, 'must use canonical trait order.')
  }
  const campaignSettings = array(row.campaignSettings, 15, `${path}.campaignSettings`)
    .map((entry, index) => parseCampaignSetting(entry, `${path}.campaignSettings[${index}]`))
  if (campaignSettings.length !== BREEDING_PROJECT_CAMPAIGN_SETTING_IDS.length
    || campaignSettings.some((entry, index) => (
      entry.campaignOptionId !== BREEDING_PROJECT_CAMPAIGN_SETTING_IDS[index]
    ))) {
    return fail('breeding.project-choices.invalid-invariant', `${path}.campaignSettings`, 'must contain the exact current campaign settings in canonical order.')
  }
  const maturityChoices = array(row.maturityChoices, 2, `${path}.maturityChoices`)
    .map((entry, index) => parseMaturity(entry, `${path}.maturityChoices[${index}]`))
  if (maturityChoices.some((entry, index) => entry.parentOrdinal !== index + 1)) {
    return fail('breeding.project-choices.invalid-invariant', `${path}.maturityChoices`, 'must use exact parent order.')
  }
  const parentRoleChoice = parseRoleChoice(row.parentRoleChoice, `${path}.parentRoleChoice`)
  const confirmation = parseConfirmation(row.confirmation, `${path}.confirmation`)
  const breederSource = guidance.sourceContributions.find(source => source.sourceCanonicalId === 'Breeder')
  const expectedSkillStatuses = breederSource?.status === 'active'
    ? new Set(['not-required'])
    : breederSource?.status === 'choice-required'
      ? new Set(['required', 'selected'])
      : new Set(['unavailable'])
  if (!expectedSkillStatuses.has(skillChoice.status)
    || breederSource?.status === 'active' && traitChoices.some(choice => choice.effectiveRank !== breederSource.skillApplication?.rank)
    || breederSource?.status === 'unavailable' && traitChoices.some(choice => choice.status !== 'unavailable')) {
    return fail('breeding.project-choices.invalid-invariant', path, 'Skill and trait choices must match the nested current Breeder source authority.')
  }
  const allOptions = [
    ...skillChoice.options,
    ...maturityChoices.flatMap(choice => choice.option ? [choice.option] : []),
    ...parentRoleChoice.options,
  ]
  if (new Set(allOptions.map(option => option.optionId)).size !== allOptions.length) {
    return fail('breeding.project-choices.invalid-invariant', path, 'all projected option IDs must be globally unique.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    guidance,
    skillChoice,
    traitChoices,
    campaignSettings,
    maturityChoices,
    parentRoleChoice,
    confirmation,
    securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`),
    projectionDefinitionSha256: hash(row.projectionDefinitionSha256, `${path}.projectionDefinitionSha256`),
  }) as unknown as BreedingProjectChoicesProjectionV1
}

export const verifyBreedingProjectChoicesProjectionV1 = async (
  value: unknown,
  path = 'projectChoices',
): Promise<BreedingProjectChoicesProjectionV1> => {
  const projection = parseBreedingProjectChoicesProjectionV1(value, path)
  await verifyBreedingProjectGuidanceProjectionV1(projection.guidance, `${path}.guidance`)
  if (projection.securityPolicyDefinitionSha256 !== BREEDING_PROJECT_CHOICES_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingProjectChoicesVerificationError(
      'breeding.project-choices.security-policy-mismatch',
      'Breeding Project choices do not use the current security policy.',
    )
  }
  const { projectionDefinitionSha256, ...definition } = projection
  let actual: string
  try { actual = await computeRulesetSourceSha256(stableJsonStringify(definition)) }
  catch {
    throw new BreedingProjectChoicesVerificationError(
      'breeding.project-choices.hash-unavailable',
      'Breeding Project choice verification is unavailable.',
    )
  }
  if (actual !== projectionDefinitionSha256) {
    throw new BreedingProjectChoicesVerificationError(
      'breeding.project-choices.hash-mismatch',
      'Breeding Project choice hash does not match its exact audience definition.',
    )
  }
  return projection
}
