export const ABILITY_AUTOMATION_INTERACTION_MATRIX_SCHEMA_VERSION = 1 as const

export const ABILITY_AUTOMATION_INTERACTION_DOMAINS = [
  'move',
  'ability',
  'item',
  'feature',
  'condition',
  'weather',
  'terrain',
  'hazard',
  'form',
  'capability',
] as const

export type AbilityAutomationInteractionDomainId =
  (typeof ABILITY_AUTOMATION_INTERACTION_DOMAINS)[number]

export interface AbilityAutomationInteractionDomainReview {
  readonly id: AbilityAutomationInteractionDomainId
  readonly status: 'complete'
  readonly summary: string
  readonly evidenceFiles: readonly string[]
}

export interface AbilityAutomationInteractionMatrix {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_INTERACTION_MATRIX_SCHEMA_VERSION
  readonly rulesetId: string
  readonly sourceDataSha256: string
  readonly canonicalAbilityCount: number
  /** Hash of canonical ID, base status, runtime, and capability metadata for every row. */
  readonly reviewedManifestSha256: string
  readonly reviewedAt: string
  readonly reviewPolicy: 'compositional-domain-contracts'
  readonly domains: readonly AbilityAutomationInteractionDomainReview[]
  readonly crossDomainEvidenceFiles: readonly string[]
}

export class AbilityAutomationInteractionMatrixValidationError extends Error {
  readonly path: string

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityAutomationInteractionMatrixValidationError'
    this.path = path
  }
}

const fail = (path: string, detail: string): never => {
  throw new AbilityAutomationInteractionMatrixValidationError(path, detail)
}

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'must be an object.')
  }
  return value as Record<string, unknown>
}

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, 'must contain exactly the supported fields.')
  }
}

const text = (value: unknown, path: string, maximum = 500): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    return fail(path, `must be a non-empty string of at most ${maximum} characters.`)
  }
  return value
}

const sha256 = (value: unknown, path: string): string => {
  const parsed = text(value, path, 64)
  if (!/^[a-f0-9]{64}$/.test(parsed)) fail(path, 'must be a lowercase SHA-256 digest.')
  return parsed
}

const evidenceFiles = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    return fail(path, 'must contain 1 through 32 evidence file paths.')
  }
  const files = value.map((entry, index) => text(entry, `${path}[${index}]`, 240))
  if (new Set(files).size !== files.length) fail(path, 'must not contain duplicate paths.')
  if (files.some(file => !file.startsWith('tests/') || file.includes('..') || file.startsWith('/'))) {
    fail(path, 'must contain repository-relative test paths only.')
  }
  const sorted = [...files].sort()
  if (files.some((file, index) => file !== sorted[index])) {
    fail(path, 'must use deterministic code-point order.')
  }
  return Object.freeze(files)
}

export const parseAbilityAutomationInteractionMatrix = (
  value: unknown,
): AbilityAutomationInteractionMatrix => {
  const input = record(value, 'interactionMatrix')
  exactKeys(input, [
    'schemaVersion', 'rulesetId', 'sourceDataSha256', 'canonicalAbilityCount',
    'reviewedManifestSha256', 'reviewedAt', 'reviewPolicy', 'domains',
    'crossDomainEvidenceFiles',
  ], 'interactionMatrix')
  if (input.schemaVersion !== ABILITY_AUTOMATION_INTERACTION_MATRIX_SCHEMA_VERSION) {
    fail('interactionMatrix.schemaVersion', 'is unsupported.')
  }
  if (!Number.isSafeInteger(input.canonicalAbilityCount) || Number(input.canonicalAbilityCount) <= 0) {
    fail('interactionMatrix.canonicalAbilityCount', 'must be a positive safe integer.')
  }
  if (input.reviewPolicy !== 'compositional-domain-contracts') {
    fail('interactionMatrix.reviewPolicy', 'is unsupported.')
  }
  const reviewedAt = text(input.reviewedAt, 'interactionMatrix.reviewedAt', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)) {
    fail('interactionMatrix.reviewedAt', 'must be an ISO calendar date.')
  }
  const rawDomains: unknown[] = Array.isArray(input.domains)
    ? input.domains
    : fail('interactionMatrix.domains', 'must be an array.')
  if (rawDomains.length !== ABILITY_AUTOMATION_INTERACTION_DOMAINS.length) {
    fail('interactionMatrix.domains', 'must review every closed interaction domain exactly once.')
  }
  const domains = rawDomains.map((entry: unknown, index: number): AbilityAutomationInteractionDomainReview => {
    const path = `interactionMatrix.domains[${index}]`
    const domain = record(entry, path)
    exactKeys(domain, ['id', 'status', 'summary', 'evidenceFiles'], path)
    const expectedId = ABILITY_AUTOMATION_INTERACTION_DOMAINS[index]
      ?? fail(`${path}.id`, 'has no matching closed interaction domain.')
    if (domain.id !== expectedId) fail(`${path}.id`, `must be ${expectedId}.`)
    if (domain.status !== 'complete') fail(`${path}.status`, 'must be complete.')
    return Object.freeze({
      id: expectedId,
      status: 'complete' as const,
      summary: text(domain.summary, `${path}.summary`),
      evidenceFiles: evidenceFiles(domain.evidenceFiles, `${path}.evidenceFiles`),
    })
  })
  return Object.freeze({
    schemaVersion: ABILITY_AUTOMATION_INTERACTION_MATRIX_SCHEMA_VERSION,
    rulesetId: text(input.rulesetId, 'interactionMatrix.rulesetId', 160),
    sourceDataSha256: sha256(input.sourceDataSha256, 'interactionMatrix.sourceDataSha256'),
    canonicalAbilityCount: Number(input.canonicalAbilityCount),
    reviewedManifestSha256: sha256(
      input.reviewedManifestSha256,
      'interactionMatrix.reviewedManifestSha256',
    ),
    reviewedAt,
    reviewPolicy: 'compositional-domain-contracts' as const,
    domains: Object.freeze(domains),
    crossDomainEvidenceFiles: evidenceFiles(
      input.crossDomainEvidenceFiles,
      'interactionMatrix.crossDomainEvidenceFiles',
    ),
  })
}
