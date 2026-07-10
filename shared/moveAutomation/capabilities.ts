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

export const MOVE_AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES = [
  'planned',
  'implemented',
] as const

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

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = ['schemaVersion', 'capabilities'] as const
const CAPABILITY_FIELDS = [
  'code',
  'owningPhase',
  'dependencies',
  'implementationStatus',
  'representativeMove',
] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const PHASE_SET = new Set<string>(MOVE_AUTOMATION_CAPABILITY_PHASES)
const IMPLEMENTATION_STATUS_SET = new Set<string>(
  MOVE_AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES,
)

const fail = (
  code: MoveAutomationCapabilityValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveAutomationCapabilityValidationError(code, path, message)
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) {
    return fail('invalid-capability-catalog', path, 'must be an object.')
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
      'invalid-capability-catalog',
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
      'invalid-capability-catalog',
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
    MOVE_AUTOMATION_CAPABILITY_LIMITS.identifierLength,
  )
  if (!STABLE_ID_PATTERN.test(identifier)) {
    fail('invalid-capability-catalog', path, 'must be a lowercase stable identifier.')
  }
  return identifier
}

const parseBoundedArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-capability-catalog', path, 'must be an array.')
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  return value
}

const parseDependencies = (value: unknown, path: string): readonly string[] => {
  const dependencies = parseBoundedArray(
    value,
    path,
    MOVE_AUTOMATION_CAPABILITY_LIMITS.dependencies,
  ).map((dependency, index) => parseStableId(dependency, `${path}[${index}]`))
  if (new Set(dependencies).size !== dependencies.length) {
    fail('invalid-capability-catalog', path, 'must not contain duplicates.')
  }
  return dependencies
}

const parsePhase = (value: unknown, path: string): MoveAutomationCapabilityPhase => {
  if (typeof value !== 'string' || !PHASE_SET.has(value)) {
    return fail('invalid-capability-catalog', path, 'must be a supported owning phase.')
  }
  return value as MoveAutomationCapabilityPhase
}

const parseImplementationStatus = (
  value: unknown,
  path: string,
): MoveAutomationCapabilityImplementationStatus => {
  if (typeof value !== 'string' || !IMPLEMENTATION_STATUS_SET.has(value)) {
    return fail(
      'invalid-capability-catalog',
      path,
      'must be planned or implemented.',
    )
  }
  return value as MoveAutomationCapabilityImplementationStatus
}

const parseCapability = (
  value: unknown,
  index: number,
  canonicalMoveIds: ReadonlySet<string>,
): MoveAutomationCapabilityDefinition => {
  const path = `capabilities[${index}]`
  const input = parseRecord(value, path)
  assertExactKeys(input, CAPABILITY_FIELDS, path)

  const representativeMove = parseBoundedText(
    input.representativeMove,
    `${path}.representativeMove`,
    MOVE_AUTOMATION_CAPABILITY_LIMITS.representativeMoveLength,
  )
  if (!canonicalMoveIds.has(representativeMove)) {
    fail(
      'unknown-representative-move',
      `${path}.representativeMove`,
      `${representativeMove} is not canonical.`,
    )
  }

  return {
    code: parseStableId(input.code, `${path}.code`),
    owningPhase: parsePhase(input.owningPhase, `${path}.owningPhase`),
    dependencies: parseDependencies(input.dependencies, `${path}.dependencies`),
    implementationStatus: parseImplementationStatus(
      input.implementationStatus,
      `${path}.implementationStatus`,
    ),
    representativeMove,
  }
}

const assertDependencyGraph = (
  capabilities: readonly MoveAutomationCapabilityDefinition[],
): void => {
  const indexByCode = new Map(capabilities.map((capability, index) => [capability.code, index]))

  capabilities.forEach((capability, capabilityIndex) => {
    capability.dependencies.forEach((dependency, dependencyIndex) => {
      if (!indexByCode.has(dependency)) {
        fail(
          'unknown-capability-dependency',
          `capabilities[${capabilityIndex}].dependencies[${dependencyIndex}]`,
          `${dependency} does not resolve to a capability.`,
        )
      }
    })
  })

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (code: string): void => {
    if (visited.has(code)) return
    const capabilityIndex = indexByCode.get(code)
    if (capabilityIndex === undefined) return

    visiting.add(code)
    const capability = capabilities[capabilityIndex]
    capability.dependencies.forEach((dependency, dependencyIndex) => {
      if (visiting.has(dependency)) {
        fail(
          'capability-dependency-cycle',
          `capabilities[${capabilityIndex}].dependencies[${dependencyIndex}]`,
          `${code} introduces a dependency cycle through ${dependency}.`,
        )
      }
      visit(dependency)
    })
    visiting.delete(code)
    visited.add(code)
  }

  capabilities.forEach(({ code }) => visit(code))
}

/** Parse the reviewed capability graph against the frozen canonical move catalog. */
export const parseMoveAutomationCapabilityCatalog = (
  value: unknown,
  canonicalCatalog: CanonicalMoveCatalog,
): MoveAutomationCapabilityCatalog => {
  const root = parseRecord(value, 'capabilityCatalog')
  assertExactKeys(root, ROOT_FIELDS, 'capabilityCatalog')
  if (root.schemaVersion !== MOVE_AUTOMATION_CAPABILITY_SCHEMA_VERSION) {
    fail(
      'invalid-capability-catalog',
      'capabilityCatalog.schemaVersion',
      `must be ${MOVE_AUTOMATION_CAPABILITY_SCHEMA_VERSION}.`,
    )
  }

  const canonicalMoveIds = new Set(canonicalCatalog.moves.map(move => move.canonicalId))
  const capabilities = parseBoundedArray(
    root.capabilities,
    'capabilityCatalog.capabilities',
    MOVE_AUTOMATION_CAPABILITY_LIMITS.capabilities,
  ).map((capability, index) => parseCapability(capability, index, canonicalMoveIds))

  const codes = capabilities.map(capability => capability.code)
  if (new Set(codes).size !== codes.length) {
    fail(
      'duplicate-capability',
      'capabilityCatalog.capabilities',
      'must contain at most one definition per capability code.',
    )
  }
  assertDependencyGraph(capabilities)

  return {
    schemaVersion: MOVE_AUTOMATION_CAPABILITY_SCHEMA_VERSION,
    capabilities,
  }
}
