import {
  AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES,
  AutomationCapabilityValidationError,
  parseAutomationCapabilityCatalog,
} from '../automation/capabilityCatalog'
import type { CanonicalMoveCatalog } from './ruleset'

export const MOVE_AUTOMATION_CAPABILITY_SCHEMA_VERSION = 1 as const

export const MOVE_AUTOMATION_CAPABILITY_PHASES = [
  'phase-0',
  'phase-1',
  'phase-2',
  'phase-3',
  'phase-4',
  'phase-5',
  'phase-6',
  'phase-7',
  'phase-8',
  'phase-8b',
  'phase-9',
  'phase-10',
] as const

export const MOVE_AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES =
  AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES

export type MoveAutomationCapabilityPhase =
  (typeof MOVE_AUTOMATION_CAPABILITY_PHASES)[number]
export type MoveAutomationCapabilityImplementationStatus =
  (typeof MOVE_AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES)[number]

export const MOVE_AUTOMATION_CAPABILITY_LIMITS = Object.freeze({
  capabilities: 256,
  dependencies: 32,
  identifierLength: 160,
  representativeMoveLength: 160,
})

export interface MoveAutomationCapabilityDefinition {
  readonly code: string
  readonly owningPhase: MoveAutomationCapabilityPhase
  readonly dependencies: readonly string[]
  readonly implementationStatus: MoveAutomationCapabilityImplementationStatus
  readonly representativeMove: string
}

export interface MoveAutomationCapabilityCatalog {
  readonly schemaVersion: typeof MOVE_AUTOMATION_CAPABILITY_SCHEMA_VERSION
  readonly capabilities: readonly MoveAutomationCapabilityDefinition[]
}

export type MoveAutomationCapabilityValidationCode =
  | 'invalid-capability-catalog'
  | 'limit-exceeded'
  | 'duplicate-capability'
  | 'unknown-capability-dependency'
  | 'capability-dependency-cycle'
  | 'unknown-representative-move'

export class MoveAutomationCapabilityValidationError extends Error {
  readonly code: MoveAutomationCapabilityValidationCode
  readonly path: string

  constructor(code: MoveAutomationCapabilityValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveAutomationCapabilityValidationError'
    this.code = code
    this.path = path
  }
}

const translatedCode = (
  code: AutomationCapabilityValidationError['code'],
): MoveAutomationCapabilityValidationCode => code === 'unknown-representative'
  ? 'unknown-representative-move'
  : code

const errorDetail = (error: AutomationCapabilityValidationError): string => {
  const prefix = `${error.path}: `
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message
}

/** Parse the reviewed capability graph against the frozen canonical move catalog. */
export const parseMoveAutomationCapabilityCatalog = (
  value: unknown,
  canonicalCatalog: CanonicalMoveCatalog,
): MoveAutomationCapabilityCatalog => {
  try {
    const capabilities = parseAutomationCapabilityCatalog(value, {
      schemaVersion: MOVE_AUTOMATION_CAPABILITY_SCHEMA_VERSION,
      phases: new Set<string>(MOVE_AUTOMATION_CAPABILITY_PHASES),
      canonicalIds: new Set(canonicalCatalog.moves.map(move => move.canonicalId)),
      representativeField: 'representativeMove',
      representativeLabel: 'move',
      limits: {
        capabilities: MOVE_AUTOMATION_CAPABILITY_LIMITS.capabilities,
        dependencies: MOVE_AUTOMATION_CAPABILITY_LIMITS.dependencies,
        identifierLength: MOVE_AUTOMATION_CAPABILITY_LIMITS.identifierLength,
        representativeLength: MOVE_AUTOMATION_CAPABILITY_LIMITS.representativeMoveLength,
      },
    }).map((capability): MoveAutomationCapabilityDefinition => ({
      code: capability.code,
      owningPhase: capability.owningPhase as MoveAutomationCapabilityPhase,
      dependencies: capability.dependencies,
      implementationStatus: capability.implementationStatus,
      representativeMove: capability.representativeId,
    }))
    return {
      schemaVersion: MOVE_AUTOMATION_CAPABILITY_SCHEMA_VERSION,
      capabilities,
    }
  }
  catch (error) {
    if (!(error instanceof AutomationCapabilityValidationError)) throw error
    throw new MoveAutomationCapabilityValidationError(
      translatedCode(error.code),
      error.path,
      errorDetail(error),
    )
  }
}
