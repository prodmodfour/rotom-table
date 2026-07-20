export const AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES = [
  'planned',
  'implemented',
] as const

export type AutomationCapabilityImplementationStatus =
  (typeof AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES)[number]

export interface AutomationCapabilityDefinition {
  readonly code: string
  readonly owningPhase: string
  readonly dependencies: readonly string[]
  readonly implementationStatus: AutomationCapabilityImplementationStatus
  readonly representativeId: string
}

export type AutomationCapabilityValidationCode =
  | 'invalid-capability-catalog'
  | 'limit-exceeded'
  | 'duplicate-capability'
  | 'unknown-capability-dependency'
  | 'capability-dependency-cycle'
  | 'unknown-representative'

export class AutomationCapabilityValidationError extends Error {
  readonly code: AutomationCapabilityValidationCode
  readonly path: string

  constructor(code: AutomationCapabilityValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'AutomationCapabilityValidationError'
    this.code = code
    this.path = path
  }
}

export interface ParseAutomationCapabilityCatalogOptions {
  readonly schemaVersion: number
  readonly phases: ReadonlySet<string>
  readonly canonicalIds: ReadonlySet<string>
  readonly representativeField: string
  readonly representativeLabel: string
  readonly limits: {
    readonly capabilities: number
    readonly dependencies: number
    readonly identifierLength: number
    readonly representativeLength: number
  }
}

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = ['schemaVersion', 'capabilities'] as const
const BASE_CAPABILITY_FIELDS = [
  'code',
  'owningPhase',
  'dependencies',
  'implementationStatus',
] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const IMPLEMENTATION_STATUS_SET = new Set<string>(
  AUTOMATION_CAPABILITY_IMPLEMENTATION_STATUSES,
)

const fail = (
  code: AutomationCapabilityValidationCode,
  path: string,
  message: string,
): never => {
  throw new AutomationCapabilityValidationError(code, path, message)
}

const isRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('invalid-capability-catalog', path, 'must be a plain object.')
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
  if (missing.length === 0 && unknown.length === 0) return
  fail(
    'invalid-capability-catalog',
    path,
    `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
  )
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

const parseStableId = (
  value: unknown,
  path: string,
  maximumLength: number,
): string => {
  const identifier = parseBoundedText(value, path, maximumLength)
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
  if (!Array.isArray(value)) return fail('invalid-capability-catalog', path, 'must be an array.')
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  return value
}

const parseCapability = (
  value: unknown,
  index: number,
  options: ParseAutomationCapabilityCatalogOptions,
): AutomationCapabilityDefinition => {
  const path = `capabilities[${index}]`
  const input = parseRecord(value, path)
  assertExactKeys(input, [...BASE_CAPABILITY_FIELDS, options.representativeField], path)
  const representativeId = parseBoundedText(
    input[options.representativeField],
    `${path}.${options.representativeField}`,
    options.limits.representativeLength,
  )
  if (!options.canonicalIds.has(representativeId)) {
    fail(
      'unknown-representative',
      `${path}.${options.representativeField}`,
      `${representativeId} is not a canonical ${options.representativeLabel}.`,
    )
  }
  if (typeof input.owningPhase !== 'string' || !options.phases.has(input.owningPhase)) {
    fail(
      'invalid-capability-catalog',
      `${path}.owningPhase`,
      'must be a supported owning phase.',
    )
  }
  if (
    typeof input.implementationStatus !== 'string'
    || !IMPLEMENTATION_STATUS_SET.has(input.implementationStatus)
  ) {
    fail(
      'invalid-capability-catalog',
      `${path}.implementationStatus`,
      'must be planned or implemented.',
    )
  }
  const dependencies = parseBoundedArray(
    input.dependencies,
    `${path}.dependencies`,
    options.limits.dependencies,
  ).map((dependency, dependencyIndex) => parseStableId(
    dependency,
    `${path}.dependencies[${dependencyIndex}]`,
    options.limits.identifierLength,
  ))
  if (new Set(dependencies).size !== dependencies.length) {
    fail('invalid-capability-catalog', `${path}.dependencies`, 'must not contain duplicates.')
  }
  return {
    code: parseStableId(input.code, `${path}.code`, options.limits.identifierLength),
    owningPhase: input.owningPhase as string,
    dependencies,
    implementationStatus: input.implementationStatus as AutomationCapabilityImplementationStatus,
    representativeId,
  }
}

const assertDependencyGraph = (
  capabilities: readonly AutomationCapabilityDefinition[],
): void => {
  const indexByCode = new Map(capabilities.map((capability, index) => [capability.code, index]))
  capabilities.forEach((capability, capabilityIndex) => {
    capability.dependencies.forEach((dependency, dependencyIndex) => {
      if (indexByCode.has(dependency)) return
      fail(
        'unknown-capability-dependency',
        `capabilities[${capabilityIndex}].dependencies[${dependencyIndex}]`,
        `${dependency} does not resolve to a capability.`,
      )
    })
  })

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (code: string): void => {
    if (visited.has(code)) return
    const capabilityIndex = indexByCode.get(code)
    if (capabilityIndex === undefined) return
    visiting.add(code)
    const capability = capabilities[capabilityIndex]!
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
  capabilities.forEach(capability => visit(capability.code))
}

/** Parse one strict capability dependency graph for a canonical automation domain. */
export const parseAutomationCapabilityCatalog = (
  value: unknown,
  options: ParseAutomationCapabilityCatalogOptions,
): readonly AutomationCapabilityDefinition[] => {
  const root = parseRecord(value, 'capabilityCatalog')
  assertExactKeys(root, ROOT_FIELDS, 'capabilityCatalog')
  if (root.schemaVersion !== options.schemaVersion) {
    fail(
      'invalid-capability-catalog',
      'capabilityCatalog.schemaVersion',
      `must be ${options.schemaVersion}.`,
    )
  }
  const capabilities = parseBoundedArray(
    root.capabilities,
    'capabilityCatalog.capabilities',
    options.limits.capabilities,
  ).map((capability, index) => parseCapability(capability, index, options))
  if (new Set(capabilities.map(capability => capability.code)).size !== capabilities.length) {
    fail(
      'duplicate-capability',
      'capabilityCatalog.capabilities',
      'must contain at most one definition per capability code.',
    )
  }
  assertDependencyGraph(capabilities)
  return capabilities
}
