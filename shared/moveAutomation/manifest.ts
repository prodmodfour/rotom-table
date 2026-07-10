import capabilityCatalogJson from '../../data/move-automation/capabilities.json'
import scenarioRequirementsJson from '../../data/move-automation/scenario-requirements.json'
import { parseMoveAutomationCapabilityCatalog } from './capabilities'
import type { CanonicalMoveCatalog, CanonicalMoveRecord } from './ruleset'
import {
  parseMoveAutomationScenarioRequirementCatalog,
  type MoveAutomationScenarioRequirementCatalog,
} from './scenarioRequirements'

export const MOVE_AUTOMATION_MANIFEST_SCHEMA_VERSION = 2 as const

export const MOVE_AUTOMATION_BASE_STATUSES = ['complete', 'assisted', 'blocked'] as const
export const MOVE_AUTOMATION_INTERACTION_STATUSES = ['unassessed', 'partial', 'complete'] as const
export const MOVE_AUTOMATION_RUNTIME_KINDS = ['unimplemented', 'legacy-v1', 'movespec-v2'] as const

export type MoveAutomationBaseStatus = (typeof MOVE_AUTOMATION_BASE_STATUSES)[number]
export type MoveAutomationInteractionStatus = (typeof MOVE_AUTOMATION_INTERACTION_STATUSES)[number]
export type MoveAutomationRuntimeKind = (typeof MOVE_AUTOMATION_RUNTIME_KINDS)[number]

export const MOVE_AUTOMATION_MANIFEST_LIMITS = Object.freeze({
  records: 1024,
  identifierLength: 160,
  sourceModuleLength: 240,
  summaryLength: 500,
  capabilityTags: 64,
  suggestedCapabilityTags: 64,
  blockerCodes: 32,
  limitations: 32,
  manualSteps: 32,
  scenarioIds: 64,
  evidenceRequirementTags: 32,
  evidenceScenarios: 64,
  evidenceClassesPerScenario: 32,
  notApplicableEvidence: 32,
  unsupportedInteractionIds: 64,
})

export interface MoveAutomationRuntimeReference {
  readonly kind: MoveAutomationRuntimeKind
  /** Reviewed runtime contract version. Null only for an unimplemented runtime. */
  readonly version: number | null
  /** SHA-256 of the reviewed runtime definition. Null only for an unimplemented runtime. */
  readonly definitionHash: string | null
  /** Repository-relative implementation module. Null only for an unimplemented runtime. */
  readonly sourceModule: string | null
}

export interface MoveAutomationRulesProvenanceReference {
  readonly rulesetId: string
  readonly canonicalizationVersion: number
  readonly sourceDataSha256: string
}

export interface MoveAutomationManifestDebt {
  /** Stable machine-readable limitation or manual-step code. */
  readonly code: string
  /** Bounded reviewer-facing explanation; never interpreted as executable rules. */
  readonly summary: string
}

export interface MoveAutomationScenarioEvidenceReference {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

export interface MoveAutomationNotApplicableEvidence {
  readonly evidenceClass: string
  /** Reviewed rules reason why this evidence class cannot apply to the move. */
  readonly reason: string
}

export interface MoveAutomationConformanceEvidence {
  /** Reviewed mechanic/branch tags resolved through scenario-requirements.json. */
  readonly requirementTags: readonly string[]
  readonly scenarios: readonly MoveAutomationScenarioEvidenceReference[]
  readonly notApplicable: readonly MoveAutomationNotApplicableEvidence[]
}

export interface MoveAutomationManifestRecord {
  readonly canonicalId: string
  readonly displayName: string
  readonly baseStatus: MoveAutomationBaseStatus
  readonly interactionStatus: MoveAutomationInteractionStatus
  readonly runtime: MoveAutomationRuntimeReference
  readonly rulesProvenance: MoveAutomationRulesProvenanceReference
  readonly capabilityTags: readonly string[]
  /** Informational bootstrap hints which do not claim reviewed capability coverage. */
  readonly suggestedCapabilityTags: readonly string[]
  readonly blockerCodes: readonly string[]
  readonly limitations: readonly MoveAutomationManifestDebt[]
  readonly manualSteps: readonly MoveAutomationManifestDebt[]
  readonly scenarioIds: readonly string[]
  readonly conformanceEvidence: MoveAutomationConformanceEvidence
  /** ISO calendar date of the latest semantic review, or null when unreviewed. */
  readonly reviewedAt: string | null
  /** Stable IDs for ability, item, or feature interactions outside base-move completeness. */
  readonly unsupportedInteractionIds: readonly string[]
  readonly rolloutCohortId: string | null
}

export interface MoveAutomationManifest {
  readonly schemaVersion: typeof MOVE_AUTOMATION_MANIFEST_SCHEMA_VERSION
  /** Canonically sorted inventory materialized by the deterministic seed/update script. */
  readonly moves: readonly MoveAutomationManifestRecord[]
}

export type MoveAutomationManifestValidationCode =
  | 'invalid-manifest'
  | 'limit-exceeded'
  | 'duplicate-move'
  | 'unknown-move'
  | 'unknown-capability'
  | 'unknown-evidence-requirement'
  | 'unknown-evidence-class'
  | 'invalid-conformance-evidence'
  | 'missing-conformance-evidence'
  | 'provenance-mismatch'
  | 'invalid-status-combination'

export class MoveAutomationManifestValidationError extends Error {
  readonly code: MoveAutomationManifestValidationCode
  readonly path: string

  constructor(code: MoveAutomationManifestValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveAutomationManifestValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = ['schemaVersion', 'moves'] as const
const MOVE_FIELDS = [
  'canonicalId',
  'displayName',
  'baseStatus',
  'interactionStatus',
  'runtime',
  'rulesProvenance',
  'capabilityTags',
  'suggestedCapabilityTags',
  'blockerCodes',
  'limitations',
  'manualSteps',
  'scenarioIds',
  'conformanceEvidence',
  'reviewedAt',
  'unsupportedInteractionIds',
  'rolloutCohortId',
] as const
const RUNTIME_FIELDS = ['kind', 'version', 'definitionHash', 'sourceModule'] as const
const PROVENANCE_FIELDS = ['rulesetId', 'canonicalizationVersion', 'sourceDataSha256'] as const
const DEBT_FIELDS = ['code', 'summary'] as const
const CONFORMANCE_EVIDENCE_FIELDS = ['requirementTags', 'scenarios', 'notApplicable'] as const
const SCENARIO_EVIDENCE_FIELDS = ['scenarioId', 'evidenceClasses'] as const
const NOT_APPLICABLE_EVIDENCE_FIELDS = ['evidenceClass', 'reason'] as const

const BASE_STATUS_SET = new Set<string>(MOVE_AUTOMATION_BASE_STATUSES)
const INTERACTION_STATUS_SET = new Set<string>(MOVE_AUTOMATION_INTERACTION_STATUSES)
const RUNTIME_KIND_SET = new Set<string>(MOVE_AUTOMATION_RUNTIME_KINDS)
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: MoveAutomationManifestValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveAutomationManifestValidationError(code, path, message)
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('invalid-manifest', path, 'must be an object.')
  return value
}

const assertExactKeys = (
  record: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
): void => {
  const expected = new Set(expectedKeys)
  const missing = expectedKeys.filter((key) => !hasOwn(record, key))
  const unknown = Object.keys(record).filter((key) => !expected.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-manifest',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximumLength: number,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail('invalid-manifest', path, 'must be a non-empty, trimmed, single-line string.')
  }
  if (value.length > maximumLength) {
    return fail('limit-exceeded', path, `must contain at most ${maximumLength} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const identifier = parseBoundedText(value, path, MOVE_AUTOMATION_MANIFEST_LIMITS.identifierLength)
  if (!STABLE_ID_PATTERN.test(identifier)) {
    fail('invalid-manifest', path, 'must be a lowercase stable identifier.')
  }
  return identifier
}

const parseNullableStableId = (value: unknown, path: string): string | null =>
  value === null ? null : parseStableId(value, path)

const parseSha256 = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return fail('invalid-manifest', path, 'must be a lowercase SHA-256 digest.')
  }
  return value
}

const parseNullableSha256 = (value: unknown, path: string): string | null =>
  value === null ? null : parseSha256(value, path)

const parsePositiveVersion = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return fail('invalid-manifest', path, 'must be a positive safe integer.')
  }
  return Number(value)
}

const parseNullableVersion = (value: unknown, path: string): number | null =>
  value === null ? null : parsePositiveVersion(value, path)

const parseNullableSourceModule = (value: unknown, path: string): string | null =>
  value === null
    ? null
    : parseBoundedText(value, path, MOVE_AUTOMATION_MANIFEST_LIMITS.sourceModuleLength)

const parseBoundedArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-manifest', path, 'must be an array.')
  if (value.length > maximumLength) {
    return fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  return value
}

const assertUnique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) {
    fail('invalid-manifest', path, 'must not contain duplicates.')
  }
}

const parseStableIdArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly string[] => {
  const identifiers = parseBoundedArray(value, path, maximumLength)
    .map((entry, index) => parseStableId(entry, `${path}[${index}]`))
  assertUnique(identifiers, path)
  return identifiers
}

const parseCapabilityReferenceArray = (
  value: unknown,
  path: string,
  maximumLength: number,
  knownCapabilityCodes: ReadonlySet<string>,
): readonly string[] => {
  const capabilityCodes = parseStableIdArray(value, path, maximumLength)
  capabilityCodes.forEach((code, index) => {
    if (!knownCapabilityCodes.has(code)) {
      fail(
        'unknown-capability',
        `${path}[${index}]`,
        `${code} does not resolve to the capability catalog.`,
      )
    }
  })
  return capabilityCodes
}

const parseDebt = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly MoveAutomationManifestDebt[] => {
  const entries = parseBoundedArray(value, path, maximumLength).map((entry, index) => {
    const entryPath = `${path}[${index}]`
    const record = parseRecord(entry, entryPath)
    assertExactKeys(record, DEBT_FIELDS, entryPath)
    return {
      code: parseStableId(record.code, `${entryPath}.code`),
      summary: parseBoundedText(
        record.summary,
        `${entryPath}.summary`,
        MOVE_AUTOMATION_MANIFEST_LIMITS.summaryLength,
      ),
    }
  })
  assertUnique(entries.map(({ code }) => code), `${path}.code`)
  return entries
}

const parseConformanceEvidence = (
  value: unknown,
  path: string,
  requirementCatalog: MoveAutomationScenarioRequirementCatalog,
): MoveAutomationConformanceEvidence => {
  const input = parseRecord(value, path)
  assertExactKeys(input, CONFORMANCE_EVIDENCE_FIELDS, path)
  const requirementByTag = new Map(
    requirementCatalog.requirements.map(requirement => [requirement.tag, requirement]),
  )
  const knownEvidenceClasses = new Set(
    requirementCatalog.evidenceClasses.map(evidenceClass => evidenceClass.code),
  )

  const requirementTags = parseStableIdArray(
    input.requirementTags,
    `${path}.requirementTags`,
    MOVE_AUTOMATION_MANIFEST_LIMITS.evidenceRequirementTags,
  )
  requirementTags.forEach((tag, index) => {
    if (!requirementByTag.has(tag)) {
      fail(
        'unknown-evidence-requirement',
        `${path}.requirementTags[${index}]`,
        `${tag} does not resolve to a scenario requirement.`,
      )
    }
  })

  const scenarios = parseBoundedArray(
    input.scenarios,
    `${path}.scenarios`,
    MOVE_AUTOMATION_MANIFEST_LIMITS.evidenceScenarios,
  ).map((value, index): MoveAutomationScenarioEvidenceReference => {
    const scenarioPath = `${path}.scenarios[${index}]`
    const scenario = parseRecord(value, scenarioPath)
    assertExactKeys(scenario, SCENARIO_EVIDENCE_FIELDS, scenarioPath)
    const evidenceClasses = parseStableIdArray(
      scenario.evidenceClasses,
      `${scenarioPath}.evidenceClasses`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.evidenceClassesPerScenario,
    )
    if (evidenceClasses.length === 0) {
      fail(
        'invalid-conformance-evidence',
        `${scenarioPath}.evidenceClasses`,
        'must identify at least one evidence class.',
      )
    }
    evidenceClasses.forEach((evidenceClass, evidenceIndex) => {
      if (!knownEvidenceClasses.has(evidenceClass)) {
        fail(
          'unknown-evidence-class',
          `${scenarioPath}.evidenceClasses[${evidenceIndex}]`,
          `${evidenceClass} does not resolve to an evidence class.`,
        )
      }
    })
    return {
      scenarioId: parseStableId(scenario.scenarioId, `${scenarioPath}.scenarioId`),
      evidenceClasses,
    }
  })
  assertUnique(scenarios.map(scenario => scenario.scenarioId), `${path}.scenarios.scenarioId`)

  const notApplicable = parseBoundedArray(
    input.notApplicable,
    `${path}.notApplicable`,
    MOVE_AUTOMATION_MANIFEST_LIMITS.notApplicableEvidence,
  ).map((value, index): MoveAutomationNotApplicableEvidence => {
    const exceptionPath = `${path}.notApplicable[${index}]`
    const exception = parseRecord(value, exceptionPath)
    assertExactKeys(exception, NOT_APPLICABLE_EVIDENCE_FIELDS, exceptionPath)
    const evidenceClass = parseStableId(
      exception.evidenceClass,
      `${exceptionPath}.evidenceClass`,
    )
    if (!knownEvidenceClasses.has(evidenceClass)) {
      fail(
        'unknown-evidence-class',
        `${exceptionPath}.evidenceClass`,
        `${evidenceClass} does not resolve to an evidence class.`,
      )
    }
    return {
      evidenceClass,
      reason: parseBoundedText(
        exception.reason,
        `${exceptionPath}.reason`,
        MOVE_AUTOMATION_MANIFEST_LIMITS.summaryLength,
      ),
    }
  })
  assertUnique(
    notApplicable.map(exception => exception.evidenceClass),
    `${path}.notApplicable.evidenceClass`,
  )

  return { requirementTags, scenarios, notApplicable }
}

const parseReviewedAt = (value: unknown, path: string): string | null => {
  if (value === null) return null
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return fail('invalid-manifest', path, 'must be null or an ISO date using YYYY-MM-DD.')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail('invalid-manifest', path, 'must be a real ISO calendar date.')
  }
  return value
}

const parseRuntime = (value: unknown, path: string): MoveAutomationRuntimeReference => {
  const record = parseRecord(value, path)
  assertExactKeys(record, RUNTIME_FIELDS, path)
  if (typeof record.kind !== 'string' || !RUNTIME_KIND_SET.has(record.kind)) {
    fail('invalid-manifest', `${path}.kind`, 'must be a supported runtime kind.')
  }

  const runtime: MoveAutomationRuntimeReference = {
    kind: record.kind as MoveAutomationRuntimeKind,
    version: parseNullableVersion(record.version, `${path}.version`),
    definitionHash: parseNullableSha256(record.definitionHash, `${path}.definitionHash`),
    sourceModule: parseNullableSourceModule(record.sourceModule, `${path}.sourceModule`),
  }

  const linkedFields = [runtime.version, runtime.definitionHash, runtime.sourceModule]
  if (runtime.kind === 'unimplemented' && linkedFields.some(field => field !== null)) {
    fail(
      'invalid-status-combination',
      path,
      'unimplemented runtimes cannot reference a version, definition hash, or source module.',
    )
  }
  if (runtime.kind !== 'unimplemented' && linkedFields.some(field => field === null)) {
    fail(
      'invalid-status-combination',
      path,
      'implemented runtimes require a version, definition hash, and source module.',
    )
  }
  return runtime
}

const parseProvenance = (
  value: unknown,
  path: string,
  catalog: CanonicalMoveCatalog,
): MoveAutomationRulesProvenanceReference => {
  const record = parseRecord(value, path)
  assertExactKeys(record, PROVENANCE_FIELDS, path)
  const reference: MoveAutomationRulesProvenanceReference = {
    rulesetId: parseBoundedText(
      record.rulesetId,
      `${path}.rulesetId`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.identifierLength,
    ),
    canonicalizationVersion: parsePositiveVersion(
      record.canonicalizationVersion,
      `${path}.canonicalizationVersion`,
    ),
    sourceDataSha256: parseSha256(record.sourceDataSha256, `${path}.sourceDataSha256`),
  }

  if (
    reference.rulesetId !== catalog.rulesetId
    || reference.canonicalizationVersion !== catalog.canonicalizationVersion
    || reference.sourceDataSha256 !== catalog.sourceDataSha256
  ) {
    fail('provenance-mismatch', path, 'must reference the loaded canonical catalog exactly.')
  }
  return reference
}

const parseBaseStatus = (value: unknown, path: string): MoveAutomationBaseStatus => {
  if (typeof value !== 'string' || !BASE_STATUS_SET.has(value)) {
    return fail('invalid-manifest', path, 'must be complete, assisted, or blocked.')
  }
  return value as MoveAutomationBaseStatus
}

const parseInteractionStatus = (value: unknown, path: string): MoveAutomationInteractionStatus => {
  if (typeof value !== 'string' || !INTERACTION_STATUS_SET.has(value)) {
    return fail('invalid-manifest', path, 'must be unassessed, partial, or complete.')
  }
  return value as MoveAutomationInteractionStatus
}

const hasBaseDebt = (record: MoveAutomationManifestRecord): boolean =>
  record.blockerCodes.length > 0
  || record.limitations.length > 0
  || record.manualSteps.length > 0

const assertValidConformanceEvidence = (
  record: MoveAutomationManifestRecord,
  path: string,
  requirementCatalog: MoveAutomationScenarioRequirementCatalog,
): void => {
  const evidencePath = `${path}.conformanceEvidence`
  const requirementByTag = new Map(
    requirementCatalog.requirements.map(requirement => [requirement.tag, requirement]),
  )
  const requiredClasses = new Set(
    record.conformanceEvidence.requirementTags.flatMap(tag =>
      requirementByTag.get(tag)?.requiredEvidenceClasses ?? [],
    ),
  )
  const listedScenarioIds = new Set(record.scenarioIds)
  const mappedScenarioIds = new Set(
    record.conformanceEvidence.scenarios.map(scenario => scenario.scenarioId),
  )
  const coveredClasses = new Set(
    record.conformanceEvidence.scenarios.flatMap(scenario => scenario.evidenceClasses),
  )
  const notApplicableClasses = new Set(
    record.conformanceEvidence.notApplicable.map(exception => exception.evidenceClass),
  )

  record.conformanceEvidence.scenarios.forEach((scenario, index) => {
    if (!listedScenarioIds.has(scenario.scenarioId)) {
      fail(
        'invalid-conformance-evidence',
        `${evidencePath}.scenarios[${index}].scenarioId`,
        `${scenario.scenarioId} is not listed by ${path}.scenarioIds.`,
      )
    }
  })

  for (const evidenceClass of coveredClasses) {
    if (!requiredClasses.has(evidenceClass)) {
      fail(
        'invalid-conformance-evidence',
        `${evidencePath}.scenarios`,
        `${evidenceClass} is not required by the row's requirement tags.`,
      )
    }
    if (notApplicableClasses.has(evidenceClass)) {
      fail(
        'invalid-conformance-evidence',
        evidencePath,
        `${evidenceClass} cannot be both scenario-covered and not applicable.`,
      )
    }
  }

  for (const evidenceClass of notApplicableClasses) {
    if (!requiredClasses.has(evidenceClass)) {
      fail(
        'invalid-conformance-evidence',
        `${evidencePath}.notApplicable`,
        `${evidenceClass} is not required by the row's requirement tags.`,
      )
    }
  }
  if (record.conformanceEvidence.notApplicable.length > 0 && record.reviewedAt === null) {
    fail(
      'invalid-conformance-evidence',
      `${evidencePath}.notApplicable`,
      'not-applicable reasons require reviewedAt metadata.',
    )
  }

  if (record.baseStatus !== 'complete') return
  if (record.conformanceEvidence.requirementTags.length === 0) {
    fail(
      'missing-conformance-evidence',
      `${evidencePath}.requirementTags`,
      'complete base automation requires at least one reviewed mechanic or branch tag.',
    )
  }
  const unmappedScenarioIds = record.scenarioIds.filter(id => !mappedScenarioIds.has(id))
  if (unmappedScenarioIds.length > 0) {
    fail(
      'missing-conformance-evidence',
      `${evidencePath}.scenarios`,
      `complete base automation must classify scenario evidence: ${unmappedScenarioIds.join(', ')}.`,
    )
  }
  const missingClasses = [...requiredClasses].filter(evidenceClass =>
    !coveredClasses.has(evidenceClass) && !notApplicableClasses.has(evidenceClass),
  )
  if (missingClasses.length > 0) {
    fail(
      'missing-conformance-evidence',
      evidencePath,
      `complete base automation is missing required evidence: ${missingClasses.join(', ')}.`,
    )
  }
}

const assertValidStatusCombination = (
  record: MoveAutomationManifestRecord,
  path: string,
  requirementCatalog: MoveAutomationScenarioRequirementCatalog,
): void => {
  if (record.baseStatus === 'complete') {
    if (hasBaseDebt(record)) {
      fail(
        'invalid-status-combination',
        path,
        'complete base automation cannot contain blockers, limitations, or manual steps.',
      )
    }
    if (record.scenarioIds.length === 0) {
      fail('invalid-status-combination', `${path}.scenarioIds`, 'complete base automation requires evidence.')
    }
    if (
      record.runtime.kind === 'unimplemented'
      || record.runtime.version === null
      || record.runtime.definitionHash === null
      || record.runtime.sourceModule === null
    ) {
      fail(
        'invalid-status-combination',
        `${path}.runtime`,
        'complete base automation requires a linked, versioned, fingerprinted runtime.',
      )
    }
  }
  else if (record.baseStatus === 'assisted') {
    if (record.runtime.kind === 'unimplemented') {
      fail('invalid-status-combination', `${path}.runtime`, 'assisted automation requires an implementation.')
    }
    if (!hasBaseDebt(record)) {
      fail(
        'invalid-status-combination',
        path,
        'assisted automation must identify at least one blocker, limitation, or manual step.',
      )
    }
  }
  else if (record.blockerCodes.length === 0) {
    fail('invalid-status-combination', `${path}.blockerCodes`, 'blocked automation requires a blocker code.')
  }

  if (record.interactionStatus === 'partial' && record.unsupportedInteractionIds.length === 0) {
    fail(
      'invalid-status-combination',
      `${path}.unsupportedInteractionIds`,
      'partial interaction coverage requires at least one explicit unsupported interaction ID.',
    )
  }
  if (
    record.interactionStatus !== 'partial'
    && record.unsupportedInteractionIds.length > 0
  ) {
    fail(
      'invalid-status-combination',
      `${path}.unsupportedInteractionIds`,
      'unsupported interaction IDs are valid only when interactionStatus is partial.',
    )
  }
  if (record.interactionStatus === 'complete' && record.baseStatus !== 'complete') {
    fail(
      'invalid-status-combination',
      `${path}.interactionStatus`,
      'interaction coverage cannot be complete while base automation is incomplete.',
    )
  }

  assertValidConformanceEvidence(record, path, requirementCatalog)
}

const canonicalMoveById = (catalog: CanonicalMoveCatalog): ReadonlyMap<string, CanonicalMoveRecord> =>
  new Map(catalog.moves.map((move) => [move.canonicalId, move]))

const parseMoveRecord = (
  value: unknown,
  index: number,
  catalog: CanonicalMoveCatalog,
  knownMoves: ReadonlyMap<string, CanonicalMoveRecord>,
  knownCapabilityCodes: ReadonlySet<string>,
  requirementCatalog: MoveAutomationScenarioRequirementCatalog,
): MoveAutomationManifestRecord => {
  const path = `moves[${index}]`
  const input = parseRecord(value, path)
  assertExactKeys(input, MOVE_FIELDS, path)
  const canonicalId = parseBoundedText(
    input.canonicalId,
    `${path}.canonicalId`,
    MOVE_AUTOMATION_MANIFEST_LIMITS.identifierLength,
  )
  const canonicalMove = knownMoves.get(canonicalId)
    ?? fail('unknown-move', `${path}.canonicalId`, `${canonicalId} is not canonical.`)

  const displayName = parseBoundedText(
    input.displayName,
    `${path}.displayName`,
    MOVE_AUTOMATION_MANIFEST_LIMITS.identifierLength,
  )
  if (displayName !== canonicalMove.displayName) {
    fail('unknown-move', `${path}.displayName`, 'must match the canonical display name exactly.')
  }

  const record: MoveAutomationManifestRecord = {
    canonicalId,
    displayName,
    baseStatus: parseBaseStatus(input.baseStatus, `${path}.baseStatus`),
    interactionStatus: parseInteractionStatus(input.interactionStatus, `${path}.interactionStatus`),
    runtime: parseRuntime(input.runtime, `${path}.runtime`),
    rulesProvenance: parseProvenance(input.rulesProvenance, `${path}.rulesProvenance`, catalog),
    capabilityTags: parseCapabilityReferenceArray(
      input.capabilityTags,
      `${path}.capabilityTags`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.capabilityTags,
      knownCapabilityCodes,
    ),
    suggestedCapabilityTags: parseStableIdArray(
      input.suggestedCapabilityTags,
      `${path}.suggestedCapabilityTags`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.suggestedCapabilityTags,
    ),
    blockerCodes: parseCapabilityReferenceArray(
      input.blockerCodes,
      `${path}.blockerCodes`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.blockerCodes,
      knownCapabilityCodes,
    ),
    limitations: parseDebt(
      input.limitations,
      `${path}.limitations`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.limitations,
    ),
    manualSteps: parseDebt(
      input.manualSteps,
      `${path}.manualSteps`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.manualSteps,
    ),
    scenarioIds: parseStableIdArray(
      input.scenarioIds,
      `${path}.scenarioIds`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.scenarioIds,
    ),
    conformanceEvidence: parseConformanceEvidence(
      input.conformanceEvidence,
      `${path}.conformanceEvidence`,
      requirementCatalog,
    ),
    reviewedAt: parseReviewedAt(input.reviewedAt, `${path}.reviewedAt`),
    unsupportedInteractionIds: parseStableIdArray(
      input.unsupportedInteractionIds,
      `${path}.unsupportedInteractionIds`,
      MOVE_AUTOMATION_MANIFEST_LIMITS.unsupportedInteractionIds,
    ),
    rolloutCohortId: parseNullableStableId(input.rolloutCohortId, `${path}.rolloutCohortId`),
  }
  assertValidStatusCombination(record, path, requirementCatalog)
  return record
}

/**
 * Parse semantic manifest data against an already hash-verified canonical
 * catalog. The seed/update workflow owns exact inventory membership while this
 * contract rejects every invalid row immediately.
 */
export const parseMoveAutomationManifest = (
  value: unknown,
  catalog: CanonicalMoveCatalog,
  capabilityCatalogInput: unknown = capabilityCatalogJson,
  scenarioRequirementsInput: unknown = scenarioRequirementsJson,
): MoveAutomationManifest => {
  const root = parseRecord(value, 'manifest')
  assertExactKeys(root, ROOT_FIELDS, 'manifest')
  if (root.schemaVersion !== MOVE_AUTOMATION_MANIFEST_SCHEMA_VERSION) {
    fail(
      'invalid-manifest',
      'manifest.schemaVersion',
      `must be ${MOVE_AUTOMATION_MANIFEST_SCHEMA_VERSION}.`,
    )
  }

  const knownMoves = canonicalMoveById(catalog)
  const capabilityCatalog = parseMoveAutomationCapabilityCatalog(capabilityCatalogInput, catalog)
  const requirementCatalog = parseMoveAutomationScenarioRequirementCatalog(
    scenarioRequirementsInput,
  )
  const knownCapabilityCodes = new Set(
    capabilityCatalog.capabilities.map(capability => capability.code),
  )
  const moves = parseBoundedArray(
    root.moves,
    'manifest.moves',
    Math.min(MOVE_AUTOMATION_MANIFEST_LIMITS.records, catalog.moves.length),
  ).map((move, index) => parseMoveRecord(
    move,
    index,
    catalog,
    knownMoves,
    knownCapabilityCodes,
    requirementCatalog,
  ))

  const canonicalIds = moves.map(({ canonicalId }) => canonicalId)
  if (new Set(canonicalIds).size !== canonicalIds.length) {
    fail('duplicate-move', 'manifest.moves', 'must contain at most one record per canonical move.')
  }

  return {
    schemaVersion: MOVE_AUTOMATION_MANIFEST_SCHEMA_VERSION,
    moves,
  }
}
