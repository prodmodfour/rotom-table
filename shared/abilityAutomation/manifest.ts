import capabilityCatalogJson from '../../data/ability-automation/capabilities.json'
import scenarioRequirementsJson from '../../data/ability-automation/scenario-requirements.json'
import {
  parseAbilityAutomationCapabilityCatalog,
  type AbilityAutomationCapabilityCatalog,
} from './capabilities'
import {
  parseAbilityAutomationScenarioRequirementCatalog,
  type AbilityAutomationScenarioRequirementCatalog,
} from './scenarioRequirements'
import type { CanonicalAbilityCatalog } from './ruleset'

export const ABILITY_AUTOMATION_MANIFEST_SCHEMA_VERSION = 1 as const

export const ABILITY_AUTOMATION_BASE_STATUSES = ['complete', 'assisted', 'blocked'] as const
export const ABILITY_AUTOMATION_INTERACTION_STATUSES = ['unassessed', 'partial', 'complete'] as const
export const ABILITY_AUTOMATION_RUNTIME_KINDS = ['unimplemented', 'abilityspec-v1'] as const

export type AbilityAutomationBaseStatus = (typeof ABILITY_AUTOMATION_BASE_STATUSES)[number]
export type AbilityAutomationInteractionStatus =
  (typeof ABILITY_AUTOMATION_INTERACTION_STATUSES)[number]
export type AbilityAutomationRuntimeKind = (typeof ABILITY_AUTOMATION_RUNTIME_KINDS)[number]
export type AbilityAutomationImplementedRuntimeKind = Exclude<
  AbilityAutomationRuntimeKind,
  'unimplemented'
>

export const ABILITY_AUTOMATION_MANIFEST_LIMITS = Object.freeze({
  records: 1_024,
  identifierLength: 160,
  sourceModuleLength: 240,
  summaryLength: 500,
  capabilityTags: 64,
  suggestedCapabilityTags: 64,
  blockerCodes: 32,
  limitations: 32,
  manualSteps: 32,
  scenarioIds: 96,
  evidenceRequirementTags: 48,
  evidenceScenarios: 96,
  evidenceClassesPerScenario: 48,
  notApplicableEvidence: 48,
  unsupportedInteractionIds: 128,
  runtimeRegistrations: 1_024,
})

export interface AbilityAutomationRuntimeReference {
  readonly kind: AbilityAutomationRuntimeKind
  readonly version: number | null
  readonly definitionHash: string | null
  readonly sourceModule: string | null
}

/** Evaluated native registration metadata checked against manifest selection. */
export interface AbilityAutomationRuntimeRegistrationReference {
  readonly canonicalId: string
  readonly kind: AbilityAutomationImplementedRuntimeKind
  readonly version: number
  readonly definitionHash: string
  readonly sourceModule: string
}

export interface AbilityAutomationRulesProvenanceReference {
  readonly rulesetId: string
  readonly canonicalizationVersion: number
  readonly sourceDataSha256: string
}

export interface AbilityAutomationManifestDebt {
  readonly code: string
  readonly summary: string
}

export interface AbilityAutomationScenarioEvidenceReference {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

export interface AbilityAutomationNotApplicableEvidence {
  readonly evidenceClass: string
  readonly reason: string
}

export interface AbilityAutomationConformanceEvidence {
  readonly requirementTags: readonly string[]
  readonly scenarios: readonly AbilityAutomationScenarioEvidenceReference[]
  readonly notApplicable: readonly AbilityAutomationNotApplicableEvidence[]
}

export interface AbilityAutomationManifestRecord {
  readonly canonicalId: string
  readonly displayName: string
  readonly baseStatus: AbilityAutomationBaseStatus
  readonly interactionStatus: AbilityAutomationInteractionStatus
  readonly runtime: AbilityAutomationRuntimeReference
  readonly rulesProvenance: AbilityAutomationRulesProvenanceReference
  readonly capabilityTags: readonly string[]
  /** Bootstrap hints only; they make no implementation claim. */
  readonly suggestedCapabilityTags: readonly string[]
  readonly blockerCodes: readonly string[]
  readonly limitations: readonly AbilityAutomationManifestDebt[]
  readonly manualSteps: readonly AbilityAutomationManifestDebt[]
  readonly scenarioIds: readonly string[]
  readonly conformanceEvidence: AbilityAutomationConformanceEvidence
  readonly reviewedAt: string | null
  readonly unsupportedInteractionIds: readonly string[]
  readonly rolloutCohortId: string | null
}

export interface AbilityAutomationManifest {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_MANIFEST_SCHEMA_VERSION
  readonly abilities: readonly AbilityAutomationManifestRecord[]
}

export type AbilityAutomationManifestValidationCode =
  | 'invalid-manifest'
  | 'limit-exceeded'
  | 'duplicate-ability'
  | 'unknown-ability'
  | 'canonical-order-mismatch'
  | 'provenance-mismatch'
  | 'unknown-capability'
  | 'unknown-evidence-requirement'
  | 'unknown-evidence-class'
  | 'invalid-status-combination'
  | 'invalid-conformance-evidence'
  | 'missing-conformance-evidence'
  | 'unknown-runtime-registration'
  | 'duplicate-runtime-registration'
  | 'missing-runtime-registration'
  | 'runtime-registration-mismatch'

export class AbilityAutomationManifestValidationError extends Error {
  readonly code: AbilityAutomationManifestValidationCode
  readonly path: string

  constructor(
    code: AbilityAutomationManifestValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'AbilityAutomationManifestValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = ['schemaVersion', 'abilities'] as const
const ABILITY_FIELDS = [
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
const EVIDENCE_FIELDS = ['requirementTags', 'scenarios', 'notApplicable'] as const
const SCENARIO_EVIDENCE_FIELDS = ['scenarioId', 'evidenceClasses'] as const
const NOT_APPLICABLE_FIELDS = ['evidenceClass', 'reason'] as const
const RUNTIME_REGISTRATION_FIELDS = [
  'canonicalId',
  'kind',
  'version',
  'definitionHash',
  'sourceModule',
] as const

const BASE_STATUS_SET = new Set<string>(ABILITY_AUTOMATION_BASE_STATUSES)
const INTERACTION_STATUS_SET = new Set<string>(ABILITY_AUTOMATION_INTERACTION_STATUSES)
const RUNTIME_KIND_SET = new Set<string>(ABILITY_AUTOMATION_RUNTIME_KINDS)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SOURCE_MODULE_PATTERN = /^[A-Za-z0-9_./-]+\.ts$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: AbilityAutomationManifestValidationCode,
  path: string,
  message: string,
): never => {
  throw new AbilityAutomationManifestValidationError(code, path, message)
}

const isRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('invalid-manifest', path, 'must be a plain object.')
  return value
}

const assertExactKeys = (
  value: UnknownRecord,
  expectedFields: readonly string[],
  path: string,
): void => {
  const expected = new Set(expectedFields)
  const missing = expectedFields.filter(field => !hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  fail(
    'invalid-manifest',
    path,
    `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
  )
}

const parseText = (
  value: unknown,
  path: string,
  maximumLength: number = ABILITY_AUTOMATION_MANIFEST_LIMITS.identifierLength,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximumLength
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-manifest',
      path,
      `must be a non-empty trimmed string of at most ${maximumLength} characters.`,
    )
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseText(value, path)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-manifest', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parseBoundedArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-manifest', path, 'must be an array.')
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  return value
}

const parseStableIdArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly string[] => {
  const ids = parseBoundedArray(value, path, maximumLength)
    .map((entry, index) => parseStableId(entry, `${path}[${index}]`))
  if (new Set(ids).size !== ids.length) {
    fail('invalid-manifest', path, 'must not contain duplicates.')
  }
  return ids
}

const assertKnownReferences = (
  ids: readonly string[],
  path: string,
  knownIds: ReadonlySet<string>,
  code: 'unknown-capability' | 'unknown-evidence-requirement' | 'unknown-evidence-class',
  label: string,
): void => {
  ids.forEach((id, index) => {
    if (knownIds.has(id)) return
    fail(code, `${path}[${index}]`, `${id} does not resolve to the ${label} catalog.`)
  })
}

const parseRuntime = (value: unknown, path: string): AbilityAutomationRuntimeReference => {
  const runtime = parseRecord(value, path)
  assertExactKeys(runtime, RUNTIME_FIELDS, path)
  if (typeof runtime.kind !== 'string' || !RUNTIME_KIND_SET.has(runtime.kind)) {
    fail('invalid-manifest', `${path}.kind`, 'must be a supported ability runtime kind.')
  }

  if (runtime.kind === 'unimplemented') {
    if (
      runtime.version !== null
      || runtime.definitionHash !== null
      || runtime.sourceModule !== null
    ) {
      fail(
        'invalid-status-combination',
        path,
        'an unimplemented runtime must have null version, hash, and source module.',
      )
    }
    return {
      kind: 'unimplemented',
      version: null,
      definitionHash: null,
      sourceModule: null,
    }
  }

  if (!Number.isSafeInteger(runtime.version) || Number(runtime.version) < 1) {
    fail('invalid-manifest', `${path}.version`, 'must be a positive safe integer.')
  }
  const definitionHash = typeof runtime.definitionHash === 'string'
    && SHA256_PATTERN.test(runtime.definitionHash)
    ? runtime.definitionHash
    : fail('invalid-manifest', `${path}.definitionHash`, 'must be a lowercase SHA-256 digest.')
  const sourceModule = parseText(
    runtime.sourceModule,
    `${path}.sourceModule`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.sourceModuleLength,
  )
  if (
    !SOURCE_MODULE_PATTERN.test(sourceModule)
    || sourceModule.includes('..')
    || !sourceModule.startsWith('server/domain/abilityAutomation/')
  ) {
    fail(
      'invalid-manifest',
      `${path}.sourceModule`,
      'must identify a TypeScript module under server/domain/abilityAutomation/.',
    )
  }
  return {
    kind: 'abilityspec-v1',
    version: Number(runtime.version),
    definitionHash,
    sourceModule,
  }
}

const parseProvenance = (
  value: unknown,
  path: string,
  catalog: CanonicalAbilityCatalog,
): AbilityAutomationRulesProvenanceReference => {
  const provenance = parseRecord(value, path)
  assertExactKeys(provenance, PROVENANCE_FIELDS, path)
  const parsed: AbilityAutomationRulesProvenanceReference = {
    rulesetId: parseText(provenance.rulesetId, `${path}.rulesetId`),
    canonicalizationVersion: Number(provenance.canonicalizationVersion),
    sourceDataSha256: typeof provenance.sourceDataSha256 === 'string'
      ? provenance.sourceDataSha256
      : '',
  }
  if (
    !Number.isSafeInteger(provenance.canonicalizationVersion)
    || parsed.rulesetId !== catalog.rulesetId
    || parsed.canonicalizationVersion !== catalog.canonicalizationVersion
    || parsed.sourceDataSha256 !== catalog.sourceDataSha256
  ) {
    fail('provenance-mismatch', path, 'must exactly reference the loaded canonical ability ruleset.')
  }
  return parsed
}

const parseDebt = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly AbilityAutomationManifestDebt[] => {
  const entries = parseBoundedArray(value, path, maximumLength)
  const debts = entries.map((entry, index): AbilityAutomationManifestDebt => {
    const entryPath = `${path}[${index}]`
    const debt = parseRecord(entry, entryPath)
    assertExactKeys(debt, DEBT_FIELDS, entryPath)
    return {
      code: parseStableId(debt.code, `${entryPath}.code`),
      summary: parseText(
        debt.summary,
        `${entryPath}.summary`,
        ABILITY_AUTOMATION_MANIFEST_LIMITS.summaryLength,
      ),
    }
  })
  if (new Set(debts.map(debt => debt.code)).size !== debts.length) {
    fail('invalid-manifest', path, 'must not repeat debt codes.')
  }
  return debts
}

interface EvidenceCatalogIndex {
  readonly requirementTags: ReadonlySet<string>
  readonly evidenceClasses: ReadonlySet<string>
  readonly requiredClassesByTag: ReadonlyMap<string, readonly string[]>
}

const parseEvidence = (
  value: unknown,
  path: string,
  scenarioIds: readonly string[],
  reviewedAt: string | null,
  catalogIndex: EvidenceCatalogIndex,
): AbilityAutomationConformanceEvidence => {
  const evidence = parseRecord(value, path)
  assertExactKeys(evidence, EVIDENCE_FIELDS, path)
  const requirementTags = parseStableIdArray(
    evidence.requirementTags,
    `${path}.requirementTags`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.evidenceRequirementTags,
  )
  assertKnownReferences(
    requirementTags,
    `${path}.requirementTags`,
    catalogIndex.requirementTags,
    'unknown-evidence-requirement',
    'ability evidence-requirement',
  )

  const scenarios = parseBoundedArray(
    evidence.scenarios,
    `${path}.scenarios`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.evidenceScenarios,
  ).map((entry, index): AbilityAutomationScenarioEvidenceReference => {
    const entryPath = `${path}.scenarios[${index}]`
    const scenario = parseRecord(entry, entryPath)
    assertExactKeys(scenario, SCENARIO_EVIDENCE_FIELDS, entryPath)
    const scenarioId = parseStableId(scenario.scenarioId, `${entryPath}.scenarioId`)
    if (!scenarioIds.includes(scenarioId)) {
      fail(
        'invalid-conformance-evidence',
        `${entryPath}.scenarioId`,
        'must reference a scenario declared by the same manifest row.',
      )
    }
    const evidenceClasses = parseStableIdArray(
      scenario.evidenceClasses,
      `${entryPath}.evidenceClasses`,
      ABILITY_AUTOMATION_MANIFEST_LIMITS.evidenceClassesPerScenario,
    )
    if (evidenceClasses.length === 0) {
      fail('invalid-conformance-evidence', `${entryPath}.evidenceClasses`, 'must not be empty.')
    }
    assertKnownReferences(
      evidenceClasses,
      `${entryPath}.evidenceClasses`,
      catalogIndex.evidenceClasses,
      'unknown-evidence-class',
      'ability evidence-class',
    )
    return { scenarioId, evidenceClasses }
  })
  if (new Set(scenarios.map(scenario => scenario.scenarioId)).size !== scenarios.length) {
    fail('invalid-conformance-evidence', `${path}.scenarios`, 'must not repeat scenario IDs.')
  }

  const notApplicable = parseBoundedArray(
    evidence.notApplicable,
    `${path}.notApplicable`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.notApplicableEvidence,
  ).map((entry, index): AbilityAutomationNotApplicableEvidence => {
    const entryPath = `${path}.notApplicable[${index}]`
    const exception = parseRecord(entry, entryPath)
    assertExactKeys(exception, NOT_APPLICABLE_FIELDS, entryPath)
    const evidenceClass = parseStableId(exception.evidenceClass, `${entryPath}.evidenceClass`)
    if (!catalogIndex.evidenceClasses.has(evidenceClass)) {
      fail(
        'unknown-evidence-class',
        `${entryPath}.evidenceClass`,
        `${evidenceClass} does not resolve to the ability evidence-class catalog.`,
      )
    }
    return {
      evidenceClass,
      reason: parseText(
        exception.reason,
        `${entryPath}.reason`,
        ABILITY_AUTOMATION_MANIFEST_LIMITS.summaryLength,
      ),
    }
  })
  if (new Set(notApplicable.map(entry => entry.evidenceClass)).size !== notApplicable.length) {
    fail('invalid-conformance-evidence', `${path}.notApplicable`, 'must not repeat evidence classes.')
  }
  if (notApplicable.length > 0 && reviewedAt === null) {
    fail(
      'invalid-conformance-evidence',
      `${path}.notApplicable`,
      'requires a semantic review date.',
    )
  }
  const coveredClasses = new Set(scenarios.flatMap(scenario => scenario.evidenceClasses))
  const notApplicableClasses = new Set(notApplicable.map(entry => entry.evidenceClass))
  if (notApplicable.some(entry => coveredClasses.has(entry.evidenceClass))) {
    fail(
      'invalid-conformance-evidence',
      path,
      'an evidence class cannot be both covered and not applicable.',
    )
  }
  for (const tag of requirementTags) {
    for (const requiredClass of catalogIndex.requiredClassesByTag.get(tag) ?? []) {
      if (coveredClasses.has(requiredClass) || notApplicableClasses.has(requiredClass)) continue
      fail(
        'missing-conformance-evidence',
        path,
        `${tag} requires evidence class ${requiredClass} or a reviewed not-applicable reason.`,
      )
    }
  }

  return { requirementTags, scenarios, notApplicable }
}

const parseReviewDate = (value: unknown, path: string): string | null => {
  if (value === null) return null
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return fail('invalid-manifest', path, 'must be null or an ISO date in YYYY-MM-DD form.')
  }
  return value
}

const assertStatusConsistency = (
  record: AbilityAutomationManifestRecord,
  path: string,
): void => {
  const hasDebt = record.limitations.length > 0 || record.manualSteps.length > 0
  if (record.runtime.kind === 'unimplemented') {
    if (
      record.baseStatus !== 'blocked'
      || !record.blockerCodes.includes('runtime.unimplemented')
      || record.capabilityTags.length > 0
    ) {
      fail(
        'invalid-status-combination',
        `${path}.runtime`,
        'unimplemented rows must be blocked by runtime.unimplemented and claim no capabilities.',
      )
    }
  }

  if (record.baseStatus === 'complete') {
    if (
      record.runtime.kind === 'unimplemented'
      || record.blockerCodes.length > 0
      || hasDebt
      || record.scenarioIds.length === 0
      || record.reviewedAt === null
    ) {
      fail(
        'invalid-status-combination',
        path,
        'complete rows require an implemented runtime, executable evidence, review date, and no debt.',
      )
    }
    if (record.conformanceEvidence.requirementTags.length === 0) {
      fail(
        'missing-conformance-evidence',
        `${path}.conformanceEvidence.requirementTags`,
        'complete rows require reviewed requirement tags.',
      )
    }
    const mapped = new Set(record.conformanceEvidence.scenarios.map(scenario => scenario.scenarioId))
    if (record.scenarioIds.some(scenarioId => !mapped.has(scenarioId))) {
      fail(
        'missing-conformance-evidence',
        `${path}.conformanceEvidence.scenarios`,
        'every declared scenario must have an evidence mapping.',
      )
    }
  }
  else if (record.baseStatus === 'assisted') {
    if (record.runtime.kind === 'unimplemented' || record.blockerCodes.length > 0 || !hasDebt) {
      fail(
        'invalid-status-combination',
        path,
        'assisted rows require an implemented runtime, explicit debt, and no blockers.',
      )
    }
  }
  else if (record.blockerCodes.length === 0) {
    fail(
      'invalid-status-combination',
      `${path}.blockerCodes`,
      'blocked rows require at least one stable blocker code.',
    )
  }

  if (record.interactionStatus === 'unassessed') {
    if (record.unsupportedInteractionIds.length > 0) {
      fail(
        'invalid-status-combination',
        `${path}.unsupportedInteractionIds`,
        'unassessed interaction status cannot claim a reviewed unsupported list.',
      )
    }
  }
  else if (record.interactionStatus === 'partial') {
    if (record.unsupportedInteractionIds.length === 0) {
      fail(
        'invalid-status-combination',
        `${path}.unsupportedInteractionIds`,
        'partial interaction status requires explicit unsupported interaction IDs.',
      )
    }
  }
  else if (record.baseStatus !== 'complete' || record.unsupportedInteractionIds.length > 0) {
    fail(
      'invalid-status-combination',
      `${path}.interactionStatus`,
      'complete interaction status requires a complete base row and no unsupported IDs.',
    )
  }
}

const parseManifestRecord = (
  value: unknown,
  index: number,
  catalog: CanonicalAbilityCatalog,
  canonicalById: ReadonlyMap<string, number>,
  capabilityCodes: ReadonlySet<string>,
  evidenceCatalogIndex: EvidenceCatalogIndex,
): AbilityAutomationManifestRecord => {
  const path = `abilities[${index}]`
  const input = parseRecord(value, path)
  assertExactKeys(input, ABILITY_FIELDS, path)
  const canonicalId = parseText(input.canonicalId, `${path}.canonicalId`)
  if (!canonicalById.has(canonicalId)) {
    fail('unknown-ability', `${path}.canonicalId`, 'does not resolve to the canonical ability catalog.')
  }
  const displayName = parseText(input.displayName, `${path}.displayName`)
  if (displayName !== canonicalId) {
    fail('unknown-ability', `${path}.displayName`, 'must equal the canonical ability identity.')
  }
  if (typeof input.baseStatus !== 'string' || !BASE_STATUS_SET.has(input.baseStatus)) {
    fail('invalid-manifest', `${path}.baseStatus`, 'must be complete, assisted, or blocked.')
  }
  if (
    typeof input.interactionStatus !== 'string'
    || !INTERACTION_STATUS_SET.has(input.interactionStatus)
  ) {
    fail(
      'invalid-manifest',
      `${path}.interactionStatus`,
      'must be unassessed, partial, or complete.',
    )
  }
  const reviewedAt = parseReviewDate(input.reviewedAt, `${path}.reviewedAt`)
  const scenarioIds = parseStableIdArray(
    input.scenarioIds,
    `${path}.scenarioIds`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.scenarioIds,
  )
  const rolloutCohortId = input.rolloutCohortId === null
    ? null
    : parseStableId(input.rolloutCohortId, `${path}.rolloutCohortId`)
  const capabilityTags = parseStableIdArray(
    input.capabilityTags,
    `${path}.capabilityTags`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.capabilityTags,
  )
  const suggestedCapabilityTags = parseStableIdArray(
    input.suggestedCapabilityTags,
    `${path}.suggestedCapabilityTags`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.suggestedCapabilityTags,
  )
  const blockerCodes = parseStableIdArray(
    input.blockerCodes,
    `${path}.blockerCodes`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.blockerCodes,
  )
  assertKnownReferences(
    capabilityTags,
    `${path}.capabilityTags`,
    capabilityCodes,
    'unknown-capability',
    'ability capability',
  )
  assertKnownReferences(
    suggestedCapabilityTags,
    `${path}.suggestedCapabilityTags`,
    capabilityCodes,
    'unknown-capability',
    'ability capability',
  )
  assertKnownReferences(
    blockerCodes,
    `${path}.blockerCodes`,
    capabilityCodes,
    'unknown-capability',
    'ability capability',
  )

  const record: AbilityAutomationManifestRecord = {
    canonicalId,
    displayName,
    baseStatus: input.baseStatus as AbilityAutomationBaseStatus,
    interactionStatus: input.interactionStatus as AbilityAutomationInteractionStatus,
    runtime: parseRuntime(input.runtime, `${path}.runtime`),
    rulesProvenance: parseProvenance(input.rulesProvenance, `${path}.rulesProvenance`, catalog),
    capabilityTags,
    suggestedCapabilityTags,
    blockerCodes,
    limitations: parseDebt(
      input.limitations,
      `${path}.limitations`,
      ABILITY_AUTOMATION_MANIFEST_LIMITS.limitations,
    ),
    manualSteps: parseDebt(
      input.manualSteps,
      `${path}.manualSteps`,
      ABILITY_AUTOMATION_MANIFEST_LIMITS.manualSteps,
    ),
    scenarioIds,
    conformanceEvidence: parseEvidence(
      input.conformanceEvidence,
      `${path}.conformanceEvidence`,
      scenarioIds,
      reviewedAt,
      evidenceCatalogIndex,
    ),
    reviewedAt,
    unsupportedInteractionIds: parseStableIdArray(
      input.unsupportedInteractionIds,
      `${path}.unsupportedInteractionIds`,
      ABILITY_AUTOMATION_MANIFEST_LIMITS.unsupportedInteractionIds,
    ),
    rolloutCohortId,
  }
  assertStatusConsistency(record, path)
  return record
}

/** Parse a strict semantic manifest against one already hash-verified catalog. */
export const parseAbilityAutomationManifest = (
  value: unknown,
  catalog: CanonicalAbilityCatalog,
  capabilityCatalogInput: unknown = capabilityCatalogJson,
  scenarioRequirementsInput: unknown = scenarioRequirementsJson,
): AbilityAutomationManifest => {
  const capabilityCatalog: AbilityAutomationCapabilityCatalog =
    parseAbilityAutomationCapabilityCatalog(capabilityCatalogInput, catalog)
  const scenarioCatalog: AbilityAutomationScenarioRequirementCatalog =
    parseAbilityAutomationScenarioRequirementCatalog(scenarioRequirementsInput)
  const capabilityCodes = new Set(
    capabilityCatalog.capabilities.map(capability => capability.code),
  )
  const evidenceCatalogIndex: EvidenceCatalogIndex = {
    requirementTags: new Set(scenarioCatalog.requirements.map(requirement => requirement.tag)),
    evidenceClasses: new Set(scenarioCatalog.evidenceClasses.map(evidence => evidence.code)),
    requiredClassesByTag: new Map(scenarioCatalog.requirements.map(requirement => [
      requirement.tag,
      requirement.requiredEvidenceClasses,
    ])),
  }

  const root = parseRecord(value, 'manifest')
  assertExactKeys(root, ROOT_FIELDS, 'manifest')
  if (root.schemaVersion !== ABILITY_AUTOMATION_MANIFEST_SCHEMA_VERSION) {
    fail(
      'invalid-manifest',
      'manifest.schemaVersion',
      `must be ${ABILITY_AUTOMATION_MANIFEST_SCHEMA_VERSION}.`,
    )
  }
  const values = parseBoundedArray(
    root.abilities,
    'manifest.abilities',
    ABILITY_AUTOMATION_MANIFEST_LIMITS.records,
  )
  const canonicalById = new Map(
    catalog.abilities.map((ability, index) => [ability.canonicalId, index]),
  )
  const abilities = values.map((entry, index) => parseManifestRecord(
    entry,
    index,
    catalog,
    canonicalById,
    capabilityCodes,
    evidenceCatalogIndex,
  ))
  const identities = abilities.map(ability => ability.canonicalId)
  if (new Set(identities).size !== identities.length) {
    fail('duplicate-ability', 'manifest.abilities', 'must not repeat canonical abilities.')
  }
  for (let index = 1; index < identities.length; index += 1) {
    const previousOrder = canonicalById.get(identities[index - 1]!)!
    const currentOrder = canonicalById.get(identities[index]!)!
    if (previousOrder < currentOrder) continue
    fail(
      'canonical-order-mismatch',
      'manifest.abilities',
      'must follow canonical ability catalog order.',
    )
  }
  return {
    schemaVersion: ABILITY_AUTOMATION_MANIFEST_SCHEMA_VERSION,
    abilities,
  }
}

const parseRuntimeRegistration = (
  value: unknown,
  index: number,
): AbilityAutomationRuntimeRegistrationReference => {
  const path = `runtimeRegistrations[${index}]`
  const input = parseRecord(value, path)
  assertExactKeys(input, RUNTIME_REGISTRATION_FIELDS, path)
  if (input.kind !== 'abilityspec-v1') {
    fail('invalid-manifest', `${path}.kind`, 'must identify the native AbilitySpec v1 runtime.')
  }
  const version = Number.isSafeInteger(input.version) && Number(input.version) >= 1
    ? Number(input.version)
    : fail('invalid-manifest', `${path}.version`, 'must be a positive safe integer.')
  const definitionHash = typeof input.definitionHash === 'string'
    && SHA256_PATTERN.test(input.definitionHash)
    ? input.definitionHash
    : fail('invalid-manifest', `${path}.definitionHash`, 'must be a lowercase SHA-256 digest.')
  const sourceModule = parseText(
    input.sourceModule,
    `${path}.sourceModule`,
    ABILITY_AUTOMATION_MANIFEST_LIMITS.sourceModuleLength,
  )
  if (
    !SOURCE_MODULE_PATTERN.test(sourceModule)
    || sourceModule.includes('..')
    || !sourceModule.startsWith('server/domain/abilityAutomation/')
  ) {
    fail(
      'invalid-manifest',
      `${path}.sourceModule`,
      'must identify a TypeScript module under server/domain/abilityAutomation/.',
    )
  }
  return {
    canonicalId: parseText(input.canonicalId, `${path}.canonicalId`),
    kind: 'abilityspec-v1',
    version,
    definitionHash,
    sourceModule,
  }
}

/**
 * Validate evaluated native registrations against manifest-owned selection.
 * Unimplemented rows select nothing; registration presence alone grants no authority.
 */
export const validateAbilityAutomationRuntimeRegistrations = (
  manifest: AbilityAutomationManifest,
  value: unknown,
): readonly AbilityAutomationRuntimeRegistrationReference[] => {
  const registrations = parseBoundedArray(
    value,
    'runtimeRegistrations',
    ABILITY_AUTOMATION_MANIFEST_LIMITS.runtimeRegistrations,
  ).map(parseRuntimeRegistration)
  const manifestByCanonicalId = new Map<string, AbilityAutomationManifestRecord>()
  for (const record of manifest.abilities) {
    if (manifestByCanonicalId.has(record.canonicalId)) {
      fail('duplicate-ability', 'manifest.abilities', `contains duplicate ${record.canonicalId}.`)
    }
    manifestByCanonicalId.set(record.canonicalId, record)
  }

  const registrationByCanonicalId = new Map<string, AbilityAutomationRuntimeRegistrationReference>()
  registrations.forEach((registration, index) => {
    const path = `runtimeRegistrations[${index}]`
    if (!manifestByCanonicalId.has(registration.canonicalId)) {
      fail(
        'unknown-runtime-registration',
        `${path}.canonicalId`,
        `${registration.canonicalId} has no semantic manifest row.`,
      )
    }
    if (registrationByCanonicalId.has(registration.canonicalId)) {
      fail(
        'duplicate-runtime-registration',
        `${path}.canonicalId`,
        `AbilitySpec v1 is registered more than once for ${registration.canonicalId}.`,
      )
    }
    registrationByCanonicalId.set(registration.canonicalId, registration)
  })

  manifest.abilities.forEach((record, index) => {
    if (record.runtime.kind === 'unimplemented') return
    const path = `manifest.abilities[${index}].runtime`
    const registration = registrationByCanonicalId.get(record.canonicalId) ?? fail(
      'missing-runtime-registration',
      path,
      `${record.canonicalId} has no reviewed AbilitySpec v1 registration.`,
    )
    if (
      registration.version !== record.runtime.version
      || registration.definitionHash !== record.runtime.definitionHash
      || registration.sourceModule !== record.runtime.sourceModule
    ) {
      fail(
        'runtime-registration-mismatch',
        path,
        `${record.canonicalId} must match the registered version, hash, and source module exactly.`,
      )
    }
  })

  return Object.freeze(registrations)
}
