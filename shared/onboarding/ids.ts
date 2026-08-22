/**
 * Stable identity for guided character creation and campaign onboarding.
 *
 * Every selectable option, decision, draft, slot, policy, submission, and
 * operation carries a bounded stable ID so the server can re-authorize any
 * client claim against canonical or policy authority (plan P9-014).
 *
 * User-facing labels are presentation only and never participate in identity.
 */

type Brand<TName extends string> = string & { readonly __brand: TName }

export type OnboardingPolicyId = Brand<'OnboardingPolicyId'>
export type OnboardingSlotId = Brand<'OnboardingSlotId'>
export type OnboardingDraftId = Brand<'OnboardingDraftId'>
export type OnboardingOperationId = Brand<'OnboardingOperationId'>
export type OnboardingDecisionId = Brand<'OnboardingDecisionId'>

export const ONBOARDING_POLICY_ID_RE = /^onbpol_[A-Za-z0-9_-]{4,64}$/
export const ONBOARDING_SLOT_ID_RE = /^onbslot_[A-Za-z0-9_-]{4,64}$/
export const ONBOARDING_DRAFT_ID_RE = /^onbdraft_[A-Za-z0-9_-]{4,64}$/
export const ONBOARDING_OPERATION_ID_RE = /^onbop_[A-Za-z0-9_-]{4,80}$/

/**
 * Decision IDs name one guided decision. They are dot-namespaced and bounded:
 * `trainer.stat-allocation`, `pokemon.2.species`, `package.trainer-items`.
 */
export const ONBOARDING_DECISION_ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){0,4}$/
export const ONBOARDING_DECISION_ID_MAX_LENGTH = 96

export class OnboardingIdError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'OnboardingIdError'
    this.field = field
  }
}

const parsePattern = <TBrand extends string>(
  value: unknown,
  re: RegExp,
  label: string,
): Brand<TBrand> => {
  if (typeof value !== 'string' || !re.test(value)) {
    throw new OnboardingIdError(label, `${label} must match ${re}`)
  }
  return value as Brand<TBrand>
}

export const isOnboardingPolicyId = (value: unknown): value is OnboardingPolicyId =>
  typeof value === 'string' && ONBOARDING_POLICY_ID_RE.test(value)
export const parseOnboardingPolicyId = (value: unknown, label = 'policyId'): OnboardingPolicyId =>
  parsePattern(value, ONBOARDING_POLICY_ID_RE, label)

export const isOnboardingSlotId = (value: unknown): value is OnboardingSlotId =>
  typeof value === 'string' && ONBOARDING_SLOT_ID_RE.test(value)
export const parseOnboardingSlotId = (value: unknown, label = 'slotId'): OnboardingSlotId =>
  parsePattern(value, ONBOARDING_SLOT_ID_RE, label)

export const isOnboardingDraftId = (value: unknown): value is OnboardingDraftId =>
  typeof value === 'string' && ONBOARDING_DRAFT_ID_RE.test(value)
export const parseOnboardingDraftId = (value: unknown, label = 'draftId'): OnboardingDraftId =>
  parsePattern(value, ONBOARDING_DRAFT_ID_RE, label)

export const isOnboardingOperationId = (value: unknown): value is OnboardingOperationId =>
  typeof value === 'string' && ONBOARDING_OPERATION_ID_RE.test(value)
export const parseOnboardingOperationId = (value: unknown, label = 'operationId'): OnboardingOperationId =>
  parsePattern(value, ONBOARDING_OPERATION_ID_RE, label)

export const isOnboardingDecisionId = (value: unknown): value is OnboardingDecisionId =>
  typeof value === 'string'
  && value.length <= ONBOARDING_DECISION_ID_MAX_LENGTH
  && ONBOARDING_DECISION_ID_RE.test(value)
export const parseOnboardingDecisionId = (value: unknown, label = 'decisionId'): OnboardingDecisionId => {
  if (!isOnboardingDecisionId(value)) {
    throw new OnboardingIdError(label, `${label} must be a bounded dot-namespaced decision ID`)
  }
  return value
}

/**
 * Canonical option references. `kind` names the authority namespace and
 * `canonicalId` is the stable identity inside it. Labels live elsewhere.
 *
 * `policy-package` and `milestone-option` are policy/rules namespaces whose
 * IDs come from the bound policy version or structured rules mechanics.
 */
export const ONBOARDING_OPTION_KINDS = Object.freeze([
  'species',
  'move',
  'ability',
  'nature',
  'gender',
  'feature',
  'edge',
  'class',
  'skill',
  'background-rank',
  'item',
  'policy-package',
  'milestone-option',
] as const)
export type OnboardingOptionKind = typeof ONBOARDING_OPTION_KINDS[number]

const OPTION_KIND_SET = new Set<unknown>(ONBOARDING_OPTION_KINDS)

export const ONBOARDING_OPTION_CANONICAL_ID_MAX_LENGTH = 120

export interface OnboardingOptionRef {
  readonly kind: OnboardingOptionKind
  readonly canonicalId: string
}

export const isOnboardingOptionKind = (value: unknown): value is OnboardingOptionKind =>
  OPTION_KIND_SET.has(value)

export const parseOnboardingOptionRef = (value: unknown, label = 'optionRef'): OnboardingOptionRef => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OnboardingIdError(label, `${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  if (!isOnboardingOptionKind(record.kind)) {
    throw new OnboardingIdError(`${label}.kind`, `${label}.kind must be one of ${ONBOARDING_OPTION_KINDS.join(', ')}`)
  }
  const canonicalId = record.canonicalId
  if (
    typeof canonicalId !== 'string'
    || canonicalId.trim() !== canonicalId
    || canonicalId.length === 0
    || canonicalId.length > ONBOARDING_OPTION_CANONICAL_ID_MAX_LENGTH
  ) {
    throw new OnboardingIdError(
      `${label}.canonicalId`,
      `${label}.canonicalId must be a trimmed non-empty string of at most ${ONBOARDING_OPTION_CANONICAL_ID_MAX_LENGTH} characters`,
    )
  }
  return { kind: record.kind, canonicalId }
}

export const onboardingOptionRefKey = (ref: OnboardingOptionRef): string =>
  `${ref.kind}:${ref.canonicalId}`

/**
 * Source fingerprints bind a draft/submission/catalog to the exact reviewed
 * data it was built from. 16 lowercase hex chars of sha256.
 */
export const ONBOARDING_FINGERPRINT_RE = /^[0-9a-f]{16}$/

export interface OnboardingSourceFingerprint {
  readonly source: string
  readonly sha256_16: string
}

export const parseOnboardingSourceFingerprint = (
  value: unknown,
  label = 'fingerprint',
): OnboardingSourceFingerprint => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OnboardingIdError(label, `${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  if (typeof record.source !== 'string' || record.source.trim() === '' || record.source.length > 200) {
    throw new OnboardingIdError(`${label}.source`, `${label}.source must be a bounded non-empty string`)
  }
  if (typeof record.sha256_16 !== 'string' || !ONBOARDING_FINGERPRINT_RE.test(record.sha256_16)) {
    throw new OnboardingIdError(`${label}.sha256_16`, `${label}.sha256_16 must be 16 lowercase hex characters`)
  }
  return { source: record.source, sha256_16: record.sha256_16 }
}

/** Allocation helpers keep generated IDs inside the accepted grammar. */
const ID_BODY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export const allocateOnboardingIdBody = (random: () => number = Math.random): string => {
  let body = ''
  for (let index = 0; index < 16; index += 1) {
    body += ID_BODY_ALPHABET[Math.floor(random() * ID_BODY_ALPHABET.length)]!
  }
  return body
}

export const allocateOnboardingPolicyId = (random?: () => number): OnboardingPolicyId =>
  `onbpol_${allocateOnboardingIdBody(random)}` as OnboardingPolicyId
export const allocateOnboardingSlotId = (random?: () => number): OnboardingSlotId =>
  `onbslot_${allocateOnboardingIdBody(random)}` as OnboardingSlotId
export const allocateOnboardingDraftId = (random?: () => number): OnboardingDraftId =>
  `onbdraft_${allocateOnboardingIdBody(random)}` as OnboardingDraftId
