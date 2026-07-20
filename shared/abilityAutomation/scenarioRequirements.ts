import {
  AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION,
  AutomationScenarioRequirementValidationError,
  parseAutomationScenarioRequirementCatalog,
} from '../automation/scenarioRequirements'

export const ABILITY_AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION =
  AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION

export const ABILITY_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS = Object.freeze({
  evidenceClasses: 128,
  requirements: 128,
  requiredEvidenceClasses: 48,
  identifierLength: 160,
  summaryLength: 500,
})

export interface AbilityAutomationEvidenceClassDefinition {
  readonly code: string
  readonly summary: string
}

export interface AbilityAutomationScenarioRequirementDefinition {
  readonly tag: string
  readonly summary: string
  readonly requiredEvidenceClasses: readonly string[]
}

export interface AbilityAutomationScenarioRequirementCatalog {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_SCENARIO_REQUIREMENTS_SCHEMA_VERSION
  readonly evidenceClasses: readonly AbilityAutomationEvidenceClassDefinition[]
  readonly requirements: readonly AbilityAutomationScenarioRequirementDefinition[]
}

export type AbilityAutomationScenarioRequirementValidationCode =
  AutomationScenarioRequirementValidationError['code']

export class AbilityAutomationScenarioRequirementValidationError extends Error {
  readonly code: AbilityAutomationScenarioRequirementValidationCode
  readonly path: string

  constructor(
    code: AbilityAutomationScenarioRequirementValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'AbilityAutomationScenarioRequirementValidationError'
    this.code = code
    this.path = path
  }
}

const errorDetail = (error: AutomationScenarioRequirementValidationError): string => {
  const prefix = `${error.path}: `
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message
}

/** Parse the closed ability mapping from semantic tags to evidence classes. */
export const parseAbilityAutomationScenarioRequirementCatalog = (
  value: unknown,
): AbilityAutomationScenarioRequirementCatalog => {
  try {
    return parseAutomationScenarioRequirementCatalog(
      value,
      ABILITY_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS,
    )
  }
  catch (error) {
    if (!(error instanceof AutomationScenarioRequirementValidationError)) throw error
    throw new AbilityAutomationScenarioRequirementValidationError(
      error.code,
      error.path,
      errorDetail(error),
    )
  }
}
