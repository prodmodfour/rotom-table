import {
  parseBreedingDependencyEvidenceV1,
  type BreedingDependencyCheckpoint,
  type BreedingDependencyEvidenceV1,
} from './readSets'
import {
  parseBreedingProviderContributionSnapshotV1,
  type BreedingProviderContributionSnapshotV1,
} from './productionSnapshots'

export const BREEDING_MODIFIER_PROVIDER_HANDOFF_SCHEMA_VERSION = 1 as const
export const BREEDING_MODIFIER_PROVIDER_DISPOSITIONS = Object.freeze([
  'active-br-062',
  'reserved-br-065',
  'reserved-br-067',
  'active-core-rule',
] as const)
export type BreedingModifierProviderDisposition = typeof BREEDING_MODIFIER_PROVIDER_DISPOSITIONS[number]

export const BREEDING_SERPENTS_MARK_PATTERN_IDS = Object.freeze([
  'attack', 'crush', 'fear', 'life', 'speed', 'stealth',
] as const)
export type BreedingSerpentsMarkPatternId = typeof BREEDING_SERPENTS_MARK_PATTERN_IDS[number]

export const BREEDING_MODIFIER_PROVIDER_POLICIES = Object.freeze([
  Object.freeze({ inventoryEntryId: 'ability:Parental Bond', checkpoint: 'hatch-transaction', contributionIds: Object.freeze(['kangaskhan-baby-template-interaction']), disposition: 'reserved-br-067' }),
  Object.freeze({ inventoryEntryId: 'ability:Serpent’s Mark', checkpoint: 'egg-acceptance', contributionIds: Object.freeze(['arbok-pattern-inheritance']), disposition: 'active-br-062' }),
  Object.freeze({ inventoryEntryId: 'capability:Egg Warmer', checkpoint: 'incubation-operation', contributionIds: Object.freeze(['once-per-24-hours-hatch-reduction-d10']), disposition: 'active-br-062' }),
  Object.freeze({ inventoryEntryId: 'capability:Marsupial', checkpoint: 'hatch-transaction', contributionIds: Object.freeze(['kangaskhan-forced-baby-template-minus-5', 'mother-pouch-link', 'level-25-template-removal']), disposition: 'reserved-br-067' }),
  Object.freeze({ inventoryEntryId: 'item:Chemistry Set', checkpoint: 'egg-acceptance', contributionIds: Object.freeze(['artificial-egg-required-tool']), disposition: 'reserved-br-065' }),
  Object.freeze({ inventoryEntryId: 'item:Egg Warmer', checkpoint: 'campaign-clock-segment', contributionIds: Object.freeze(['egg-capacity-4', 'incubation-rate-times-2']), disposition: 'active-br-062' }),
  Object.freeze({ inventoryEntryId: 'item:Reanimation Machine', checkpoint: 'egg-acceptance', contributionIds: Object.freeze(['fossil-reanimation-tool']), disposition: 'reserved-br-065' }),
  Object.freeze({ inventoryEntryId: 'rule:Loyalty', checkpoint: 'hatch-transaction', contributionIds: Object.freeze(['bounded-starting-loyalty-offer-rank-3']), disposition: 'active-core-rule' }),
  Object.freeze({ inventoryEntryId: 'rule:Tutor Points', checkpoint: 'hatch-transaction', contributionIds: Object.freeze(['hatch-starting-tutor-point-1']), disposition: 'active-core-rule' }),
] as const)
export type BreedingModifierProviderInventoryEntryId = typeof BREEDING_MODIFIER_PROVIDER_POLICIES[number]['inventoryEntryId']

export interface BreedingModifierProviderEvidenceV1 {
  readonly schemaVersion: 1
  readonly disposition: BreedingModifierProviderDisposition
  readonly contribution: BreedingProviderContributionSnapshotV1
  readonly definitionSha256: string
}

export interface BreedingModifierProviderHandoffV1 {
  readonly schemaVersion: 1
  readonly checkpoint: BreedingDependencyCheckpoint
  readonly capturedAtCampaignMinute: number
  readonly evidence: readonly BreedingModifierProviderEvidenceV1[]
  readonly dependencyEvidence: readonly BreedingDependencyEvidenceV1[]
  readonly definitionSha256: string
}

export type BreedingModifierProviderHandoffValidationCode =
  | 'breeding.modifier-provider-handoff.invalid-document'
  | 'breeding.modifier-provider-handoff.unknown-field'
  | 'breeding.modifier-provider-handoff.invalid-invariant'

export class BreedingModifierProviderHandoffValidationError extends Error {
  readonly code: BreedingModifierProviderHandoffValidationCode
  readonly path: string
  constructor(code: BreedingModifierProviderHandoffValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingModifierProviderHandoffValidationError'
    this.code = code
    this.path = path
  }
}

type Row = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const DISPOSITIONS = new Set<string>(BREEDING_MODIFIER_PROVIDER_DISPOSITIONS)
const POLICY_BY_ENTRY = new Map<string, typeof BREEDING_MODIFIER_PROVIDER_POLICIES[number]>(
  BREEDING_MODIFIER_PROVIDER_POLICIES.map(policy => [policy.inventoryEntryId, policy]),
)
const fail = (code: BreedingModifierProviderHandoffValidationCode, path: string, message: string): never => {
  throw new BreedingModifierProviderHandoffValidationError(code, path, message)
}
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.modifier-provider-handoff.invalid-document', path, 'must be a plain data object.')
  }
  const row = value as Row
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.modifier-provider-handoff.unknown-field', path, 'must contain exactly the declared fields.')
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.modifier-provider-handoff.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.modifier-provider-handoff.invalid-document', path, `must be one strict array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.modifier-provider-handoff.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.modifier-provider-handoff.invalid-document', path, 'must be a lowercase SHA-256 value.')
const minute = (value: unknown, path: string): number => Number.isSafeInteger(value) && (value as number) >= 0
  ? value as number
  : fail('breeding.modifier-provider-handoff.invalid-document', path, 'must be a nonnegative safe campaign minute.')
const valueFor = (contribution: BreedingProviderContributionSnapshotV1) => contribution.value
const assertTypedValue = (contribution: BreedingProviderContributionSnapshotV1, path: string): void => {
  const value = valueFor(contribution)
  const id = contribution.contributionId
  const flag = value.kind === 'flag' && value.enabled === true
  const integer = value.kind === 'integer' ? value.value : null
  const ratio = value.kind === 'ratio' ? value : null
  const canonical = value.kind === 'canonical-id-set' ? value.values : null
  if (id === 'arbok-pattern-inheritance'
    && (!canonical || canonical.length !== 1 || !BREEDING_SERPENTS_MARK_PATTERN_IDS.includes(canonical[0] as BreedingSerpentsMarkPatternId))) {
    fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'Serpent’s Mark must bind exactly one reviewed inherited pattern.')
  }
  if (id === 'egg-capacity-4' && integer !== 4) fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'Egg Warmer capacity must equal four.')
  if (id === 'incubation-rate-times-2' && (ratio?.numerator !== 2 || ratio.denominator !== 1)) fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'Egg Warmer item rate must equal 2/1.')
  if (id === 'once-per-24-hours-hatch-reduction-d10' && !flag) fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'Egg Warmer Capability must be one enabled operation flag.')
  if (id === 'hatch-starting-tutor-point-1' && integer !== 1) fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'Hatch Tutor Points must equal one.')
  if (id === 'bounded-starting-loyalty-offer-rank-3' && integer !== 3) fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'Hatch Loyalty must equal rank three.')
  if (['kangaskhan-baby-template-interaction','kangaskhan-forced-baby-template-minus-5','mother-pouch-link','level-25-template-removal','artificial-egg-required-tool','fossil-reanimation-tool'].includes(id) && !flag) {
    fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'Reserved provider flags must be enabled evidence only.')
  }
}
const evidenceKey = (entry: BreedingModifierProviderEvidenceV1): string => {
  const contribution = entry.contribution
  return `${contribution.providerKind}\u0000${contribution.providerId}\u0000${contribution.subjectKind}\u0000${contribution.subjectId}\u0000${contribution.contributionId}`
}
const dependencyKey = (entry: BreedingDependencyEvidenceV1): string => `${entry.providerKind}\u0000${entry.providerId}\u0000${entry.subjectKind}\u0000${entry.subjectId}`

export const parseBreedingModifierProviderEvidenceV1 = (
  value: unknown,
  path = 'modifierProviderEvidence',
): BreedingModifierProviderEvidenceV1 => {
  const row = exact(value, ['schemaVersion','disposition','contribution','definitionSha256'], path)
  const contribution = parseBreedingProviderContributionSnapshotV1(row.contribution, `${path}.contribution`)
  const policy = POLICY_BY_ENTRY.get(contribution.inventoryEntryId)
  if (row.schemaVersion !== 1 || !policy || row.disposition !== policy.disposition || !DISPOSITIONS.has(String(row.disposition))
    || contribution.checkpoint !== policy.checkpoint || !policy.contributionIds.includes(contribution.contributionId as never)) {
    return fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'must match one closed modifier-provider policy.')
  }
  assertTypedValue(contribution, `${path}.contribution.value`)
  return Object.freeze({ schemaVersion: 1, disposition: policy.disposition, contribution, definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}

export const parseBreedingModifierProviderHandoffV1 = (
  value: unknown,
  path = 'modifierProviderHandoff',
): BreedingModifierProviderHandoffV1 => {
  const row = exact(value, ['schemaVersion','checkpoint','capturedAtCampaignMinute','evidence','dependencyEvidence','definitionSha256'], path)
  const evidence = array(row.evidence, `${path}.evidence`, 64).map((entry, index) => parseBreedingModifierProviderEvidenceV1(entry, `${path}.evidence[${index}]`))
  const dependencies = array(row.dependencyEvidence, `${path}.dependencyEvidence`, 64).map((entry, index) => parseBreedingDependencyEvidenceV1(entry, `${path}.dependencyEvidence[${index}]`))
  if (row.schemaVersion !== 1 || typeof row.checkpoint !== 'string'
    || evidence.some(entry => entry.contribution.checkpoint !== row.checkpoint)
    || dependencies.some(entry => entry.checkpoint !== row.checkpoint)) {
    return fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'must bind one schema-v1 checkpoint consistently.')
  }
  const evidenceKeys = evidence.map(evidenceKey)
  const dependencyKeys = dependencies.map(dependencyKey)
  if (evidenceKeys.some((key, index) => index > 0 && evidenceKeys[index - 1]! >= key)
    || dependencyKeys.some((key, index) => index > 0 && dependencyKeys[index - 1]! >= key)) {
    return fail('breeding.modifier-provider-handoff.invalid-invariant', path, 'evidence and dependencies must be unique in strict canonical order.')
  }
  for (const entry of evidence) {
    const contribution = entry.contribution
    const dependency = dependencies.find(candidate => candidate.providerKind === contribution.providerKind
      && candidate.providerId === contribution.providerId && candidate.subjectKind === contribution.subjectKind
      && candidate.subjectId === contribution.subjectId && candidate.subjectRevision === contribution.subjectRevision)
    if (!dependency || dependency.providerDefinitionSha256 !== contribution.providerDefinitionSha256
      || dependency.effectiveEvidenceSha256 !== contribution.effectiveEvidenceSha256) {
      return fail('breeding.modifier-provider-handoff.invalid-invariant', `${path}.dependencyEvidence`, 'must exactly attest every contribution once.')
    }
  }
  if (dependencies.length !== new Set(evidence.map(entry => {
    const contribution = entry.contribution
    return `${contribution.providerKind}\u0000${contribution.providerId}\u0000${contribution.subjectKind}\u0000${contribution.subjectId}`
  })).size) {
    return fail('breeding.modifier-provider-handoff.invalid-invariant', `${path}.dependencyEvidence`, 'cannot contain missing or extraneous dependencies.')
  }
  return Object.freeze({
    schemaVersion: 1,
    checkpoint: row.checkpoint as BreedingDependencyCheckpoint,
    capturedAtCampaignMinute: minute(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    evidence: Object.freeze(evidence),
    dependencyEvidence: Object.freeze(dependencies),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
