export const MOVE_AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION = 1 as const

export const MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS = Object.freeze({
  evidenceClasses: 64,
  requirements: 64,
  requiredEvidenceClasses: 32,
  identifierLength: 160,
  summaryLength: 500,
})

export interface MoveAutomationEvidenceClassDefinition {
  readonly code: string
  readonly summary: string
}

export interface MoveAutomationScenarioRequirementDefinition {
  readonly tag: string
  readonly summary: string
  readonly requiredEvidenceClasses: readonly string[]
}

export interface MoveAutomationScenarioRequirementCatalog {
  readonly schemaVersion: typeof MOVE_AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION
  readonly evidenceClasses: readonly MoveAutomationEvidenceClassDefinition[]
  readonly requirements: readonly MoveAutomationScenarioRequirementDefinition[]
}

export type MoveAutomationScenarioRequirementValidationCode =
  | 'invalid-scenario-requirements'
  | 'limit-exceeded'
  | 'duplicate-evidence-class'
  | 'duplicate-requirement-tag'
  | 'unknown-evidence-class'
  | 'unused-evidence-class'

export class MoveAutomationScenarioRequirementValidationError extends Error {
  readonly code: MoveAutomationScenarioRequirementValidationCode
  readonly path: string

  constructor(
    code: MoveAutomationScenarioRequirementValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'MoveAutomationScenarioRequirementValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = ['schemaVersion', 'evidenceClasses', 'requirements'] as const
const EVIDENCE_CLASS_FIELDS = ['code', 'summary'] as const
const REQUIREMENT_FIELDS = ['tag', 'summary', 'requiredEvidenceClasses'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: MoveAutomationScenarioRequirementValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveAutomationScenarioRequirementValidationError(code, path, message)
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) {
    return fail('invalid-scenario-requirements', path, 'must be an object.')
  }
  return value
}

const assertExactKeys = (
  record: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
): void => {
  const expected = new Set(expectedKeys)
  const missing = expectedKeys.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  const unknown = Object.keys(record).filter(key => !expected.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-scenario-requirements',
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
    return fail(
      'invalid-scenario-requirements',
      path,
      'must be a non-empty, trimmed, single-line string.',
    )
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const identifier = parseBoundedText(
    value,
    path,
    MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.identifierLength,
  )
  if (!STABLE_ID_PATTERN.test(identifier)) {
    fail('invalid-scenario-requirements', path, 'must be a lowercase stable identifier.')
  }
  return identifier
}

const parseBoundedArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-scenario-requirements', path, 'must be an array.')
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  return value
}

const assertUnique = (
  values: readonly string[],
  code: MoveAutomationScenarioRequirementValidationCode,
  path: string,
  message: string,
): void => {
  if (new Set(values).size !== values.length) fail(code, path, message)
}

/** Parse the reviewed mapping from mechanic/branch tags to scenario evidence classes. */
export const parseMoveAutomationScenarioRequirementCatalog = (
  value: unknown,
): MoveAutomationScenarioRequirementCatalog => {
  const root = parseRecord(value, 'scenarioRequirements')
  assertExactKeys(root, ROOT_FIELDS, 'scenarioRequirements')
  if (root.schemaVersion !== MOVE_AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION) {
    fail(
      'invalid-scenario-requirements',
      'scenarioRequirements.schemaVersion',
      `must be ${MOVE_AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION}.`,
    )
  }

  const evidenceClasses = parseBoundedArray(
    root.evidenceClasses,
    'scenarioRequirements.evidenceClasses',
    MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.evidenceClasses,
  ).map((value, index): MoveAutomationEvidenceClassDefinition => {
    const path = `scenarioRequirements.evidenceClasses[${index}]`
    const input = parseRecord(value, path)
    assertExactKeys(input, EVIDENCE_CLASS_FIELDS, path)
    return {
      code: parseStableId(input.code, `${path}.code`),
      summary: parseBoundedText(
        input.summary,
        `${path}.summary`,
        MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.summaryLength,
      ),
    }
  })
  assertUnique(
    evidenceClasses.map(entry => entry.code),
    'duplicate-evidence-class',
    'scenarioRequirements.evidenceClasses',
    'must contain at most one definition per evidence class.',
  )
  const knownEvidenceClasses = new Set(evidenceClasses.map(entry => entry.code))

  const requirements = parseBoundedArray(
    root.requirements,
    'scenarioRequirements.requirements',
    MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.requirements,
  ).map((value, index): MoveAutomationScenarioRequirementDefinition => {
    const path = `scenarioRequirements.requirements[${index}]`
    const input = parseRecord(value, path)
    assertExactKeys(input, REQUIREMENT_FIELDS, path)
    const requiredEvidenceClasses = parseBoundedArray(
      input.requiredEvidenceClasses,
      `${path}.requiredEvidenceClasses`,
      MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.requiredEvidenceClasses,
    ).map((entry, evidenceIndex) =>
      parseStableId(entry, `${path}.requiredEvidenceClasses[${evidenceIndex}]`),
    )
    if (requiredEvidenceClasses.length === 0) {
      fail(
        'invalid-scenario-requirements',
        `${path}.requiredEvidenceClasses`,
        'must identify at least one evidence class.',
      )
    }
    assertUnique(
      requiredEvidenceClasses,
      'invalid-scenario-requirements',
      `${path}.requiredEvidenceClasses`,
      'must not contain duplicates.',
    )
    requiredEvidenceClasses.forEach((evidenceClass, evidenceIndex) => {
      if (!knownEvidenceClasses.has(evidenceClass)) {
        fail(
          'unknown-evidence-class',
          `${path}.requiredEvidenceClasses[${evidenceIndex}]`,
          `${evidenceClass} does not resolve to an evidence class.`,
        )
      }
    })
    return {
      tag: parseStableId(input.tag, `${path}.tag`),
      summary: parseBoundedText(
        input.summary,
        `${path}.summary`,
        MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.summaryLength,
      ),
      requiredEvidenceClasses,
    }
  })
  assertUnique(
    requirements.map(entry => entry.tag),
    'duplicate-requirement-tag',
    'scenarioRequirements.requirements',
    'must contain at most one mapping per requirement tag.',
  )

  const usedEvidenceClasses = new Set(
    requirements.flatMap(requirement => requirement.requiredEvidenceClasses),
  )
  evidenceClasses.forEach((evidenceClass, index) => {
    if (!usedEvidenceClasses.has(evidenceClass.code)) {
      fail(
        'unused-evidence-class',
        `scenarioRequirements.evidenceClasses[${index}].code`,
        `${evidenceClass.code} is not required by any mechanic or branch tag.`,
      )
    }
  })

  return {
    schemaVersion: MOVE_AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION,
    evidenceClasses,
    requirements,
  }
}
