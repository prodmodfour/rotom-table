import {
  AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION,
  AutomationScenarioRequirementValidationError,
  parseAutomationScenarioRequirementCatalog,
} from '../automation/scenarioRequirements'

export const MOVE_AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION =
  AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION

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
  AutomationScenarioRequirementValidationError['code']

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

const errorDetail = (error: AutomationScenarioRequirementValidationError): string => {
  const prefix = `${error.path}: `
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message
}

/** Parse the reviewed move mapping from mechanic tags to evidence classes. */
export const parseMoveAutomationScenarioRequirementCatalog = (
  value: unknown,
): MoveAutomationScenarioRequirementCatalog => {
  try {
    return parseAutomationScenarioRequirementCatalog(
      value,
      MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS,
    )
  }
  catch (error) {
    if (!(error instanceof AutomationScenarioRequirementValidationError)) throw error
    throw new MoveAutomationScenarioRequirementValidationError(
      error.code,
      error.path,
      errorDetail(error),
    )
  }
}
