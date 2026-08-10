import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonObject } from '../automation/strictJson'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'
import { isSlug } from '../paths'
import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import {
  parseBreedingOfferOptionIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOfferOptionId,
  type PokemonEggId,
} from './ids'
import {
  POKEMON_EGG_STATUSES,
  type PokemonEggGenderId,
  type PokemonEggSpecialStateId,
  type PokemonEggStatus,
} from './egg'
import {
  BREEDING_HATCH_SPECIAL_OUTCOME_IDS,
  type BreedingHatchSpecialOutcomeId,
} from './hatchSpecial'

export const BREEDING_HATCH_WORKFLOW_API_PATH = '/api/breeding/hatch' as const
export const BREEDING_HATCH_WORKFLOW_INTENTS = Object.freeze([
  'inspect', 'begin', 'resolve-special', 'complete',
] as const)
export type BreedingHatchWorkflowIntent = typeof BREEDING_HATCH_WORKFLOW_INTENTS[number]
export const BREEDING_HATCH_WORKFLOW_STAGES = Object.freeze([
  'not-ready', 'ready', 'awaiting-gm', 'ready-to-complete', 'hatched', 'ended', 'recovery',
] as const)
export type BreedingHatchWorkflowStage = typeof BREEDING_HATCH_WORKFLOW_STAGES[number]
export const BREEDING_HATCH_WORKFLOW_DECISIONS = Object.freeze([
  'none', 'begin-hatch', 'resolve-special', 'complete-hatch',
] as const)
export type BreedingHatchWorkflowDecisionKind = typeof BREEDING_HATCH_WORKFLOW_DECISIONS[number]
export const BREEDING_HATCH_WORKFLOW_TRANSITIONS = Object.freeze([
  'none', 'hatch-started', 'special-review-required', 'special-resolved', 'child-revealed', 'exact-replay',
] as const)
export type BreedingHatchWorkflowTransitionKind = typeof BREEDING_HATCH_WORKFLOW_TRANSITIONS[number]
export const BREEDING_HATCH_WORKFLOW_REASON_IDS = Object.freeze([
  'breeding.hatch.awaiting-gm',
  'breeding.hatch.current-authority-unavailable',
  'breeding.hatch.lifecycle-ended',
  'breeding.hatch.not-ready',
  'breeding.hatch.recovery-required',
] as const)
export type BreedingHatchWorkflowReasonId = typeof BREEDING_HATCH_WORKFLOW_REASON_IDS[number]

export interface BreedingHatchWorkflowRequestV1 {
  readonly schemaVersion: 1
  readonly profileId: PlayerProfileId | null
  readonly trainerSheetSlug: string
  readonly eggId: PokemonEggId
  readonly expectedEggRevision: number
  readonly intent: BreedingHatchWorkflowIntent
  readonly selectedOptionId: BreedingOfferOptionId | null
  readonly confirmed: boolean
}
export interface BreedingHatchWorkflowEggV1 {
  readonly eggId: PokemonEggId
  readonly revision: number
  readonly status: PokemonEggStatus
  readonly speciesName: string
  readonly updatedAtCampaignMinute: number
}
export interface BreedingHatchWorkflowDecisionV1 {
  readonly kind: BreedingHatchWorkflowDecisionKind
  readonly canSubmit: boolean
  readonly requiresConfirmation: boolean
  readonly reasonId: BreedingHatchWorkflowReasonId | null
}
export interface BreedingHatchWorkflowSpecialOptionV1 {
  readonly optionId: BreedingOfferOptionId
  readonly outcomeId: BreedingHatchSpecialOutcomeId
  readonly label: string
  readonly description: string
}
export interface BreedingHatchWorkflowGmReviewV1 {
  readonly rollTotal: number
  readonly triggerIds: readonly ('roll-1' | 'roll-100' | 'provider-force')[]
  readonly options: readonly BreedingHatchWorkflowSpecialOptionV1[]
}
export interface BreedingHatchWorkflowSpecialV1 {
  readonly state: PokemonEggSpecialStateId
  readonly outcomeId: BreedingHatchSpecialOutcomeId | null
  readonly gmReview: BreedingHatchWorkflowGmReviewV1 | null
}
export interface BreedingHatchWorkflowChildRevealV1 {
  readonly childSheetSlug: string
  readonly speciesName: string
  readonly natureName: string
  readonly abilityName: string
  readonly genderId: PokemonEggGenderId
  readonly startingLevel: number
  readonly destinationKind: 'box' | 'team'
  readonly hatchedAtCampaignMinute: number
}
export interface BreedingHatchWorkflowRecoveryV1 {
  readonly state: 'none' | 'pending'
  readonly pendingSinceCampaignMinute: number | null
}
export interface BreedingHatchWorkflowProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly trainerSheetSlug: string
  readonly stage: BreedingHatchWorkflowStage
  readonly egg: BreedingHatchWorkflowEggV1
  readonly decision: BreedingHatchWorkflowDecisionV1
  readonly special: BreedingHatchWorkflowSpecialV1
  readonly childReveal: BreedingHatchWorkflowChildRevealV1 | null
  readonly recovery: BreedingHatchWorkflowRecoveryV1
  readonly transition: BreedingHatchWorkflowTransitionKind
  readonly generatedAtCampaignMinute: number
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}

export class BreedingHatchWorkflowContractError extends Error {
  readonly code:
    | 'breeding.hatch-workflow.hash-mismatch'
    | 'breeding.hatch-workflow.invalid-document'
    | 'breeding.hatch-workflow.invalid-id'
    | 'breeding.hatch-workflow.invalid-invariant'
    | 'breeding.hatch-workflow.security-policy-mismatch'
  readonly path: string
  constructor(code: BreedingHatchWorkflowContractError['code'], path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingHatchWorkflowContractError'
    this.code = code
    this.path = path
  }
}

const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL = /[\u0000-\u001f\u007f]/u
const INTENTS = new Set<string>(BREEDING_HATCH_WORKFLOW_INTENTS)
const STAGES = new Set<string>(BREEDING_HATCH_WORKFLOW_STAGES)
const DECISIONS = new Set<string>(BREEDING_HATCH_WORKFLOW_DECISIONS)
const TRANSITIONS = new Set<string>(BREEDING_HATCH_WORKFLOW_TRANSITIONS)
const REASONS = new Set<string>(BREEDING_HATCH_WORKFLOW_REASON_IDS)
const EGG_STATUSES = new Set<string>(POKEMON_EGG_STATUSES)
const OUTCOMES = new Set<string>(BREEDING_HATCH_SPECIAL_OUTCOME_IDS)
const SPECIAL_STATES = new Set<string>(['not-rolled', 'normal', 'pending-adjudication', 'resolved'])
const fail = (code: BreedingHatchWorkflowContractError['code'], path: string, message: string): never => {
  throw new BreedingHatchWorkflowContractError(code, path, message)
}
const clone = (value: unknown, path: string): StrictJsonObject => {
  const cloned = cloneStrictJson(value, path, {
    limits: {
      depth: 9,
      nodes: 500,
      objectFields: 16,
      arrayEntries: 3,
      stringLength: 240,
      objectKeyLength: 80,
    },
    rootLabel: path,
    valueLabel: 'Breeding hatch workflow',
    failNotJson: (field, detail) => fail('breeding.hatch-workflow.invalid-document', field, detail),
    failLimit: (field, detail) => fail('breeding.hatch-workflow.invalid-document', field, detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
    return fail('breeding.hatch-workflow.invalid-document', path, 'must be one plain object.')
  }
  return cloned as StrictJsonObject
}
const exact = (value: unknown, fields: readonly string[], path: string): StrictJsonObject => {
  const row = clone(value, path)
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.hatch-workflow.invalid-document', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string, minimum = 0, maximum = 2_147_483_647): number => (
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : fail('breeding.hatch-workflow.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
)
const text = (value: unknown, path: string, maximum = 160): string => (
  typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value.trim() === value && !CONTROL.test(value)
    ? value
    : fail('breeding.hatch-workflow.invalid-document', path, 'must be bounded safe display text.')
)
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.hatch-workflow.invalid-id', path, 'must be a bounded canonical slug.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.hatch-workflow.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const reason = (value: unknown, path: string): BreedingHatchWorkflowReasonId | null => value === null
  ? null
  : typeof value === 'string' && REASONS.has(value)
    ? value as BreedingHatchWorkflowReasonId
    : fail('breeding.hatch-workflow.invalid-id', path, 'must be a closed hatch-workflow reason ID.')
const expectedStage = (status: PokemonEggStatus, recovery: 'none' | 'pending'): BreedingHatchWorkflowStage => {
  if (recovery === 'pending') return 'recovery'
  if (status === 'incubating') return 'not-ready'
  if (status === 'ready') return 'ready'
  if (status === 'awaiting-special-adjudication') return 'awaiting-gm'
  if (status === 'hatching') return 'ready-to-complete'
  if (status === 'hatched') return 'hatched'
  return 'ended'
}

export const BREEDING_HATCH_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256 = hash(
  securityPolicyJson.definitionSha256,
  'securityPolicy.definitionSha256',
)

export const parseBreedingHatchWorkflowRequestV1 = (
  value: unknown,
  path = 'hatchWorkflowRequest',
): BreedingHatchWorkflowRequestV1 => {
  const row = exact(value, [
    'schemaVersion', 'profileId', 'trainerSheetSlug', 'eggId', 'expectedEggRevision',
    'intent', 'selectedOptionId', 'confirmed',
  ], path)
  if (row.schemaVersion !== 1 || typeof row.intent !== 'string' || !INTENTS.has(row.intent)
    || typeof row.confirmed !== 'boolean') {
    return fail('breeding.hatch-workflow.invalid-document', path, 'must be one schema-v1 hatch request.')
  }
  const intent = row.intent as BreedingHatchWorkflowIntent
  const selectedOptionId = row.selectedOptionId === null
    ? null
    : parseBreedingOfferOptionIdSyntax(row.selectedOptionId)
      ?? fail('breeding.hatch-workflow.invalid-id', `${path}.selectedOptionId`, 'must be one opaque server option ID or null.')
  if ((intent === 'resolve-special') !== (selectedOptionId !== null)
    || row.confirmed !== (intent !== 'inspect')) {
    return fail('breeding.hatch-workflow.invalid-invariant', path, 'only confirmed special resolution selects one option; inspect remains unconfirmed.')
  }
  const profileId = row.profileId === null ? null
    : isPlayerProfileId(row.profileId) ? row.profileId
      : fail('breeding.hatch-workflow.invalid-id', `${path}.profileId`, 'must be a Player Profile ID or null.')
  return deepFreezeStrictJson({
    schemaVersion: 1,
    profileId,
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    eggId: parsePokemonEggIdSyntax(row.eggId)
      ?? fail('breeding.hatch-workflow.invalid-id', `${path}.eggId`, 'must be a Pokémon Egg ID.'),
    expectedEggRevision: integer(row.expectedEggRevision, `${path}.expectedEggRevision`),
    intent,
    selectedOptionId,
    confirmed: row.confirmed,
  }) as BreedingHatchWorkflowRequestV1
}

const parseDecision = (value: unknown, path: string): BreedingHatchWorkflowDecisionV1 => {
  const row = exact(value, ['kind', 'canSubmit', 'requiresConfirmation', 'reasonId'], path)
  if (typeof row.kind !== 'string' || !DECISIONS.has(row.kind)
    || typeof row.canSubmit !== 'boolean' || typeof row.requiresConfirmation !== 'boolean') {
    return fail('breeding.hatch-workflow.invalid-document', path, 'must contain one closed hatch decision.')
  }
  const reasonId = reason(row.reasonId, `${path}.reasonId`)
  if ((row.kind === 'none') !== !row.canSubmit
    || row.requiresConfirmation !== row.canSubmit
    || row.canSubmit !== (reasonId === null)) {
    return fail('breeding.hatch-workflow.invalid-invariant', path, 'decision, availability, confirmation, and reason must agree.')
  }
  return { kind: row.kind as BreedingHatchWorkflowDecisionKind, canSubmit: row.canSubmit, requiresConfirmation: row.requiresConfirmation, reasonId }
}
const parseSpecialOption = (value: unknown, path: string): BreedingHatchWorkflowSpecialOptionV1 => {
  const row = exact(value, ['optionId', 'outcomeId', 'label', 'description'], path)
  if (typeof row.outcomeId !== 'string' || !OUTCOMES.has(row.outcomeId)) {
    return fail('breeding.hatch-workflow.invalid-id', `${path}.outcomeId`, 'must be a closed special outcome.')
  }
  return {
    optionId: parseBreedingOfferOptionIdSyntax(row.optionId)
      ?? fail('breeding.hatch-workflow.invalid-id', `${path}.optionId`, 'must be one opaque special option ID.'),
    outcomeId: row.outcomeId as BreedingHatchSpecialOutcomeId,
    label: text(row.label, `${path}.label`),
    description: text(row.description, `${path}.description`, 240),
  }
}
const parseGmReview = (value: unknown, path: string): BreedingHatchWorkflowGmReviewV1 => {
  const row = exact(value, ['rollTotal', 'triggerIds', 'options'], path)
  if (!Array.isArray(row.triggerIds) || !Array.isArray(row.options)
    || row.options.length !== BREEDING_HATCH_SPECIAL_OUTCOME_IDS.length) {
    return fail('breeding.hatch-workflow.invalid-document', path, 'must be one bounded GM special review.')
  }
  const rollTotal = integer(row.rollTotal, `${path}.rollTotal`, 1, 100)
  const triggerIds: Array<'roll-1' | 'roll-100' | 'provider-force'> = row.triggerIds.map((entry, index) => (
    entry === 'roll-1' || entry === 'roll-100' || entry === 'provider-force'
      ? entry
      : fail('breeding.hatch-workflow.invalid-id', `${path}.triggerIds[${index}]`, 'must be a closed special trigger.')
  ))
  const order = { 'roll-1': 0, 'roll-100': 1, 'provider-force': 2 } as const
  if (new Set(triggerIds).size !== triggerIds.length
    || triggerIds.some((entry, index) => index > 0 && order[triggerIds[index - 1]!] >= order[entry])
    || (rollTotal === 1) !== triggerIds.includes('roll-1')
    || (rollTotal === 100) !== triggerIds.includes('roll-100')) {
    return fail('breeding.hatch-workflow.invalid-invariant', path, 'persisted roll and canonical trigger set must agree.')
  }
  const options = row.options.map((entry, index) => parseSpecialOption(entry, `${path}.options[${index}]`))
  if (new Set(options.map(option => option.optionId)).size !== options.length
    || new Set(options.map(option => option.outcomeId)).size !== options.length) {
    return fail('breeding.hatch-workflow.invalid-invariant', `${path}.options`, 'must contain exactly one option for each closed outcome.')
  }
  return { rollTotal, triggerIds, options }
}
const parseSpecial = (value: unknown, audience: 'gm' | 'owner', path: string): BreedingHatchWorkflowSpecialV1 => {
  const row = exact(value, ['state', 'outcomeId', 'gmReview'], path)
  if (typeof row.state !== 'string' || !SPECIAL_STATES.has(row.state)) {
    return fail('breeding.hatch-workflow.invalid-document', `${path}.state`, 'must be one closed Egg special state.')
  }
  const outcomeId = row.outcomeId === null ? null
    : typeof row.outcomeId === 'string' && OUTCOMES.has(row.outcomeId)
      ? row.outcomeId as BreedingHatchSpecialOutcomeId
      : fail('breeding.hatch-workflow.invalid-id', `${path}.outcomeId`, 'must be a closed special outcome or null.')
  const gmReview = row.gmReview === null ? null : parseGmReview(row.gmReview, `${path}.gmReview`)
  if ((row.state === 'resolved') !== (outcomeId !== null)
    || (gmReview !== null) !== (audience === 'gm' && row.state === 'pending-adjudication')) {
    return fail('breeding.hatch-workflow.invalid-invariant', path, 'special state, outcome, role, and private GM review must agree.')
  }
  return { state: row.state as PokemonEggSpecialStateId, outcomeId, gmReview }
}
const parseChildReveal = (value: unknown, path: string): BreedingHatchWorkflowChildRevealV1 => {
  const row = exact(value, [
    'childSheetSlug', 'speciesName', 'natureName', 'abilityName', 'genderId', 'startingLevel',
    'destinationKind', 'hatchedAtCampaignMinute',
  ], path)
  if ((row.genderId !== 'female' && row.genderId !== 'male' && row.genderId !== 'genderless')
    || (row.destinationKind !== 'box' && row.destinationKind !== 'team')) {
    return fail('breeding.hatch-workflow.invalid-document', path, 'must contain one bounded child reveal.')
  }
  return {
    childSheetSlug: slug(row.childSheetSlug, `${path}.childSheetSlug`),
    speciesName: text(row.speciesName, `${path}.speciesName`),
    natureName: text(row.natureName, `${path}.natureName`),
    abilityName: text(row.abilityName, `${path}.abilityName`),
    genderId: row.genderId,
    startingLevel: integer(row.startingLevel, `${path}.startingLevel`, 1, 100),
    destinationKind: row.destinationKind,
    hatchedAtCampaignMinute: integer(row.hatchedAtCampaignMinute, `${path}.hatchedAtCampaignMinute`),
  }
}

export const parseBreedingHatchWorkflowProjectionV1 = (
  value: unknown,
  path = 'hatchWorkflow',
): BreedingHatchWorkflowProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'trainerSheetSlug', 'stage', 'egg', 'decision', 'special',
    'childReveal', 'recovery', 'transition', 'generatedAtCampaignMinute',
    'securityPolicyDefinitionSha256', 'projectionDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || typeof row.stage !== 'string' || !STAGES.has(row.stage)
    || typeof row.transition !== 'string' || !TRANSITIONS.has(row.transition)) {
    return fail('breeding.hatch-workflow.invalid-document', path, 'must be one schema-v1 owner or GM hatch workflow.')
  }
  const eggRow = exact(row.egg, ['eggId', 'revision', 'status', 'speciesName', 'updatedAtCampaignMinute'], `${path}.egg`)
  if (typeof eggRow.status !== 'string' || !EGG_STATUSES.has(eggRow.status)) {
    return fail('breeding.hatch-workflow.invalid-document', `${path}.egg.status`, 'must be a closed Egg status.')
  }
  const egg: BreedingHatchWorkflowEggV1 = {
    eggId: parsePokemonEggIdSyntax(eggRow.eggId)
      ?? fail('breeding.hatch-workflow.invalid-id', `${path}.egg.eggId`, 'must be a Pokémon Egg ID.'),
    revision: integer(eggRow.revision, `${path}.egg.revision`),
    status: eggRow.status as PokemonEggStatus,
    speciesName: text(eggRow.speciesName, `${path}.egg.speciesName`),
    updatedAtCampaignMinute: integer(eggRow.updatedAtCampaignMinute, `${path}.egg.updatedAtCampaignMinute`),
  }
  const recoveryRow = exact(row.recovery, ['state', 'pendingSinceCampaignMinute'], `${path}.recovery`)
  if (recoveryRow.state !== 'none' && recoveryRow.state !== 'pending') {
    return fail('breeding.hatch-workflow.invalid-document', `${path}.recovery.state`, 'must be none or pending.')
  }
  const pendingSince = recoveryRow.pendingSinceCampaignMinute === null ? null
    : integer(recoveryRow.pendingSinceCampaignMinute, `${path}.recovery.pendingSinceCampaignMinute`)
  if ((recoveryRow.state === 'pending') !== (pendingSince !== null)) {
    return fail('breeding.hatch-workflow.invalid-invariant', `${path}.recovery`, 'pending state must carry exactly one campaign minute.')
  }
  const recovery: BreedingHatchWorkflowRecoveryV1 = { state: recoveryRow.state, pendingSinceCampaignMinute: pendingSince }
  const decision = parseDecision(row.decision, `${path}.decision`)
  const special = parseSpecial(row.special, row.audience, `${path}.special`)
  const reveal = row.childReveal === null ? null : parseChildReveal(row.childReveal, `${path}.childReveal`)
  const generatedAtCampaignMinute = integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`)
  const expected = expectedStage(egg.status, recovery.state)
  const expectedDecision = expected === 'ready' ? 'begin-hatch'
    : expected === 'awaiting-gm' && row.audience === 'gm' ? 'resolve-special'
      : expected === 'ready-to-complete' ? 'complete-hatch' : 'none'
  const expectedReason: BreedingHatchWorkflowReasonId | null = expected === 'recovery' ? 'breeding.hatch.recovery-required'
    : expected === 'not-ready' ? 'breeding.hatch.not-ready'
      : expected === 'ended' ? 'breeding.hatch.lifecycle-ended'
        : expected === 'awaiting-gm' && row.audience === 'owner' ? 'breeding.hatch.awaiting-gm'
          : expectedDecision === 'none' ? 'breeding.hatch.current-authority-unavailable' : null
  const transition = row.transition as BreedingHatchWorkflowTransitionKind
  const transitionMatches = transition === 'none' || transition === 'exact-replay'
    || transition === 'hatch-started' && (egg.status === 'hatching' || egg.status === 'awaiting-special-adjudication')
    || transition === 'special-review-required' && egg.status === 'awaiting-special-adjudication'
    || transition === 'special-resolved' && egg.status === 'hatching' && special.state === 'resolved'
    || transition === 'child-revealed' && egg.status === 'hatched'
  const specialMatchesStatus = (egg.status === 'incubating' || egg.status === 'ready')
    ? special.state === 'not-rolled'
    : egg.status === 'awaiting-special-adjudication'
      ? special.state === 'pending-adjudication'
      : egg.status === 'hatching' || egg.status === 'hatched'
        ? special.state === 'normal' || special.state === 'resolved'
        : true
  if (row.stage !== expected || decision.kind !== expectedDecision
    || decision.canSubmit !== (expectedDecision !== 'none')
    || decision.reasonId !== expectedReason
    || !specialMatchesStatus
    || (reveal !== null) !== (egg.status === 'hatched')
    || reveal && reveal.hatchedAtCampaignMinute !== egg.updatedAtCampaignMinute
    || generatedAtCampaignMinute < egg.updatedAtCampaignMinute
    || pendingSince !== null && pendingSince > generatedAtCampaignMinute
    || !transitionMatches) {
    return fail('breeding.hatch-workflow.invalid-invariant', path, 'status, stage, decision, recovery, reveal, transition, and campaign time must agree.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    audience: row.audience,
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    stage: row.stage,
    egg,
    decision,
    special,
    childReveal: reveal,
    recovery,
    transition,
    generatedAtCampaignMinute,
    securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`),
    projectionDefinitionSha256: hash(row.projectionDefinitionSha256, `${path}.projectionDefinitionSha256`),
  }) as BreedingHatchWorkflowProjectionV1
}

export const verifyBreedingHatchWorkflowProjectionV1 = async (
  value: unknown,
  path = 'hatchWorkflow',
): Promise<BreedingHatchWorkflowProjectionV1> => {
  const projection = parseBreedingHatchWorkflowProjectionV1(value, path)
  if (projection.securityPolicyDefinitionSha256 !== BREEDING_HATCH_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256) {
    return fail('breeding.hatch-workflow.security-policy-mismatch', `${path}.securityPolicyDefinitionSha256`, 'does not use the current security policy.')
  }
  const { projectionDefinitionSha256, ...definition } = projection
  let actual: string
  try { actual = await computeRulesetSourceSha256(stableJsonStringify(definition)) }
  catch { return fail('breeding.hatch-workflow.hash-mismatch', `${path}.projectionDefinitionSha256`, 'cannot be verified in this browser.') }
  if (actual !== projectionDefinitionSha256) {
    return fail('breeding.hatch-workflow.hash-mismatch', `${path}.projectionDefinitionSha256`, 'does not match the exact hatch workflow.')
  }
  return projection
}

export const breedingHatchWorkflowOutcomeLabel = (outcomeId: BreedingHatchSpecialOutcomeId): string => ({
  'breeding.hatch-special.outcome.campaign-significance': 'Campaign significance',
  'breeding.hatch-special.outcome.distinctive-appearance': 'Distinctive appearance',
  'breeding.hatch-special.outcome.distinctive-temperament': 'Distinctive temperament',
})[outcomeId]

export const breedingHatchWorkflowReasonMessage = (reasonId: BreedingHatchWorkflowReasonId): string => ({
  'breeding.hatch.awaiting-gm': 'A private GM decision is required before this hatch can continue.',
  'breeding.hatch.current-authority-unavailable': 'No hatch action is available from the current authoritative state.',
  'breeding.hatch.lifecycle-ended': 'This Egg lifecycle ended without a hatch action.',
  'breeding.hatch.not-ready': 'Incubation must finish before hatching can begin.',
  'breeding.hatch.recovery-required': 'Refresh authoritative state before another hatch action.',
})[reasonId]
