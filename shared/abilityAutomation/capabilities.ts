import {
  AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES,
  AutomationCapabilityValidationError,
  parseAutomationCapabilityCatalog,
} from '../automation/capabilityCatalog'
import type { CanonicalAbilityCatalog } from './ruleset'

export const ABILITY_AUTOMATION_CAPABILITY_SCHEMA_VERSION = 1 as const

export const ABILITY_AUTOMATION_CAPABILITY_PHASES = [
  'phase-1',
  'phase-2',
  'phase-3',
  'phase-4',
  'phase-5',
  'phase-6',
  'phase-7',
  'phase-8',
] as const

export const ABILITY_AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES =
  AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES

export type AbilityAutomationCapabilityPhase =
  (typeof ABILITY_AUTOMATION_CAPABILITY_PHASES)[number]
export type AbilityAutomationCapabilityImplementationStatus =
  (typeof ABILITY_AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES)[number]

export const ABILITY_AUTOMATION_CAPABILITY_LIMITS = Object.freeze({
  capabilities: 256,
  dependencies: 32,
  identifierLength: 160,
  representativeAbilityLength: 160,
})

export interface AbilityAutomationCapabilityDefinition {
  readonly code: string
  readonly owningPhase: AbilityAutomationCapabilityPhase
  readonly dependencies: readonly string[]
  readonly implementationStatus: AbilityAutomationCapabilityImplementationStatus
  readonly representativeAbility: string
}

export interface AbilityAutomationCapabilityCatalog {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_CAPABILITY_SCHEMA_VERSION
  readonly capabilities: readonly AbilityAutomationCapabilityDefinition[]
}

export type AbilityAutomationCapabilityValidationCode =
  | 'invalid-capability-catalog'
  | 'limit-exceeded'
  | 'duplicate-capability'
  | 'unknown-capability-dependency'
  | 'capability-dependency-cycle'
  | 'unknown-representative-ability'

export class AbilityAutomationCapabilityValidationError extends Error {
  readonly code: AbilityAutomationCapabilityValidationCode
  readonly path: string

  constructor(code: AbilityAutomationCapabilityValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'AbilityAutomationCapabilityValidationError'
    this.code = code
    this.path = path
  }
}

const errorDetail = (error: AutomationCapabilityValidationError): string => {
  const prefix = `${error.path}: `
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message
}

/** Parse the reviewed ability capability graph against the frozen catalog. */
export const parseAbilityAutomationCapabilityCatalog = (
  value: unknown,
  canonicalCatalog: CanonicalAbilityCatalog,
): AbilityAutomationCapabilityCatalog => {
  try {
    const capabilities = parseAutomationCapabilityCatalog(value, {
      schemaVersion: ABILITY_AUTOMATION_CAPABILITY_SCHEMA_VERSION,
      phases: new Set<string>(ABILITY_AUTOMATION_CAPABILITY_PHASES),
      canonicalIds: new Set(canonicalCatalog.abilities.map(ability => ability.canonicalId)),
      representativeField: 'representativeAbility',
      representativeLabel: 'ability',
      limits: {
        capabilities: ABILITY_AUTOMATION_CAPABILITY_LIMITS.capabilities,
        dependencies: ABILITY_AUTOMATION_CAPABILITY_LIMITS.dependencies,
        identifierLength: ABILITY_AUTOMATION_CAPABILITY_LIMITS.identifierLength,
        representativeLength: ABILITY_AUTOMATION_CAPABILITY_LIMITS.representativeAbilityLength,
      },
    }).map((capability): AbilityAutomationCapabilityDefinition => ({
      code: capability.code,
      owningPhase: capability.owningPhase as AbilityAutomationCapabilityPhase,
      dependencies: capability.dependencies,
      implementationStatus: capability.implementationStatus,
      representativeAbility: capability.representativeId,
    }))
    return {
      schemaVersion: ABILITY_AUTOMATION_CAPABILITY_SCHEMA_VERSION,
      capabilities,
    }
  }
  catch (error) {
    if (!(error instanceof AutomationCapabilityValidationError)) throw error
    throw new AbilityAutomationCapabilityValidationError(
      error.code === 'unknown-representative'
        ? 'unknown-representative-ability'
        : error.code,
      error.path,
      errorDetail(error),
    )
  }
}
