import type { CanonicalAbilityCatalog } from './ruleset'

export const ABILITY_AUTOMATION_LEGACY_BASELINE_SCHEMA_VERSION = 1 as const

export const ABILITY_AUTOMATION_LEGACY_FRAGMENT_CATEGORIES = [
  'ability-overlay',
  'active-transaction',
  'condition-immunity',
  'critical-immunity',
  'derived-sheet',
  'move-follow-up',
  'move-interaction',
  'move-script-rewrite',
  'passive-provider',
  'reaction-definition',
  'recoil-immunity',
  'sheet-toggle',
  'weather-immunity',
] as const

export type AbilityAutomationLegacyFragmentCategory =
  (typeof ABILITY_AUTOMATION_LEGACY_FRAGMENT_CATEGORIES)[number]

export interface AbilityAutomationLegacyFragment {
  readonly category: AbilityAutomationLegacyFragmentCategory
  readonly sourceModule: string
  readonly behaviorCodes: readonly string[]
}

export interface AbilityAutomationLegacyBaselineEntry {
  readonly canonicalId: string
  readonly fragments: readonly AbilityAutomationLegacyFragment[]
}

export interface AbilityAutomationLegacyBaseline {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_LEGACY_BASELINE_SCHEMA_VERSION
  readonly capturedAt: string
  readonly canonicalSourceSha256: string
  readonly entries: readonly AbilityAutomationLegacyBaselineEntry[]
}

export type AbilityAutomationLegacyBaselineValidationCode =
  | 'invalid-legacy-baseline'
  | 'limit-exceeded'
  | 'unknown-ability'
  | 'duplicate-ability'
  | 'canonical-order-mismatch'

export class AbilityAutomationLegacyBaselineValidationError extends Error {
  readonly code: AbilityAutomationLegacyBaselineValidationCode
  readonly path: string

  constructor(
    code: AbilityAutomationLegacyBaselineValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'AbilityAutomationLegacyBaselineValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = ['schemaVersion', 'capturedAt', 'canonicalSourceSha256', 'entries'] as const
const ENTRY_FIELDS = ['canonicalId', 'fragments'] as const
const FRAGMENT_FIELDS = ['category', 'sourceModule', 'behaviorCodes'] as const
const CATEGORY_SET = new Set<string>(ABILITY_AUTOMATION_LEGACY_FRAGMENT_CATEGORIES)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SOURCE_MODULE_PATTERN = /^(?:src\/utils|server\/domain\/moveAutomation)\/[A-Za-z0-9_./-]+\.ts$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export const ABILITY_AUTOMATION_LEGACY_BASELINE_LIMITS = Object.freeze({
  entries: 483,
  fragmentsPerAbility: 16,
  behaviorCodesPerFragment: 32,
  identifierLength: 160,
  sourceModuleLength: 240,
})

const fail = (
  code: AbilityAutomationLegacyBaselineValidationCode,
  path: string,
  message: string,
): never => {
  throw new AbilityAutomationLegacyBaselineValidationError(code, path, message)
}

const isRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('invalid-legacy-baseline', path, 'must be a plain object.')
  return value
}

const assertExactKeys = (
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  fail(
    'invalid-legacy-baseline',
    path,
    `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
  )
}

const parseText = (value: unknown, path: string, maximum: number): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail('invalid-legacy-baseline', path, 'must be a bounded non-empty trimmed string.')
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseText(value, path, ABILITY_AUTOMATION_LEGACY_BASELINE_LIMITS.identifierLength)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-legacy-baseline', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parseArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-legacy-baseline', path, 'must be an array.')
  if (value.length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  return value
}

/** Parse the reviewed snapshot of pre-AbilitySpec behavior fragments. */
export const parseAbilityAutomationLegacyBaseline = (
  value: unknown,
  canonicalCatalog: CanonicalAbilityCatalog,
): AbilityAutomationLegacyBaseline => {
  const root = parseRecord(value, 'legacyBaseline')
  assertExactKeys(root, ROOT_FIELDS, 'legacyBaseline')
  if (root.schemaVersion !== ABILITY_AUTOMATION_LEGACY_BASELINE_SCHEMA_VERSION) {
    fail(
      'invalid-legacy-baseline',
      'legacyBaseline.schemaVersion',
      `must be ${ABILITY_AUTOMATION_LEGACY_BASELINE_SCHEMA_VERSION}.`,
    )
  }
  const capturedAt = parseText(root.capturedAt, 'legacyBaseline.capturedAt', 10)
  if (!ISO_DATE_PATTERN.test(capturedAt)) {
    fail('invalid-legacy-baseline', 'legacyBaseline.capturedAt', 'must use YYYY-MM-DD.')
  }
  const canonicalSourceSha256 = parseText(
    root.canonicalSourceSha256,
    'legacyBaseline.canonicalSourceSha256',
    64,
  )
  if (
    !SHA256_PATTERN.test(canonicalSourceSha256)
    || canonicalSourceSha256 !== canonicalCatalog.sourceDataSha256
  ) {
    fail(
      'invalid-legacy-baseline',
      'legacyBaseline.canonicalSourceSha256',
      'must match the frozen canonical ability catalog.',
    )
  }
  const canonicalOrder = new Map(
    canonicalCatalog.abilities.map((ability, index) => [ability.canonicalId, index]),
  )
  const entries = parseArray(
    root.entries,
    'legacyBaseline.entries',
    ABILITY_AUTOMATION_LEGACY_BASELINE_LIMITS.entries,
  ).map((value, entryIndex): AbilityAutomationLegacyBaselineEntry => {
    const path = `legacyBaseline.entries[${entryIndex}]`
    const input = parseRecord(value, path)
    assertExactKeys(input, ENTRY_FIELDS, path)
    const canonicalId = parseText(
      input.canonicalId,
      `${path}.canonicalId`,
      ABILITY_AUTOMATION_LEGACY_BASELINE_LIMITS.identifierLength,
    )
    if (!canonicalOrder.has(canonicalId)) {
      fail('unknown-ability', `${path}.canonicalId`, 'does not resolve to a canonical ability.')
    }
    const fragments = parseArray(
      input.fragments,
      `${path}.fragments`,
      ABILITY_AUTOMATION_LEGACY_BASELINE_LIMITS.fragmentsPerAbility,
    ).map((value, fragmentIndex): AbilityAutomationLegacyFragment => {
      const fragmentPath = `${path}.fragments[${fragmentIndex}]`
      const fragment = parseRecord(value, fragmentPath)
      assertExactKeys(fragment, FRAGMENT_FIELDS, fragmentPath)
      if (typeof fragment.category !== 'string' || !CATEGORY_SET.has(fragment.category)) {
        fail('invalid-legacy-baseline', `${fragmentPath}.category`, 'is not a supported fragment category.')
      }
      const sourceModule = parseText(
        fragment.sourceModule,
        `${fragmentPath}.sourceModule`,
        ABILITY_AUTOMATION_LEGACY_BASELINE_LIMITS.sourceModuleLength,
      )
      if (!SOURCE_MODULE_PATTERN.test(sourceModule) || sourceModule.includes('..')) {
        fail(
          'invalid-legacy-baseline',
          `${fragmentPath}.sourceModule`,
          'must identify an existing-source namespace used by the migration audit.',
        )
      }
      const behaviorCodes = parseArray(
        fragment.behaviorCodes,
        `${fragmentPath}.behaviorCodes`,
        ABILITY_AUTOMATION_LEGACY_BASELINE_LIMITS.behaviorCodesPerFragment,
      ).map((code, codeIndex) => parseStableId(
        code,
        `${fragmentPath}.behaviorCodes[${codeIndex}]`,
      ))
      if (behaviorCodes.length === 0 || new Set(behaviorCodes).size !== behaviorCodes.length) {
        fail(
          'invalid-legacy-baseline',
          `${fragmentPath}.behaviorCodes`,
          'must contain unique reviewed behavior codes.',
        )
      }
      return {
        category: fragment.category as AbilityAutomationLegacyFragmentCategory,
        sourceModule,
        behaviorCodes,
      }
    })
    if (fragments.length === 0) {
      fail('invalid-legacy-baseline', `${path}.fragments`, 'must not be empty.')
    }
    const fragmentIdentities = fragments.map(fragment => (
      `${fragment.category}\u0000${fragment.sourceModule}\u0000${fragment.behaviorCodes.join(',')}`
    ))
    if (new Set(fragmentIdentities).size !== fragmentIdentities.length) {
      fail('invalid-legacy-baseline', `${path}.fragments`, 'must not repeat identical fragments.')
    }
    return { canonicalId, fragments }
  })

  const identities = entries.map(entry => entry.canonicalId)
  if (new Set(identities).size !== identities.length) {
    fail('duplicate-ability', 'legacyBaseline.entries', 'must not repeat canonical abilities.')
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (canonicalOrder.get(entries[index - 1]!.canonicalId)! < canonicalOrder.get(entries[index]!.canonicalId)!) {
      continue
    }
    fail('canonical-order-mismatch', 'legacyBaseline.entries', 'must use canonical ability order.')
  }
  return {
    schemaVersion: ABILITY_AUTOMATION_LEGACY_BASELINE_SCHEMA_VERSION,
    capturedAt,
    canonicalSourceSha256,
    entries,
  }
}
