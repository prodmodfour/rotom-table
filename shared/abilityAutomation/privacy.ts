export const ABILITY_AUTOMATION_PRIVACY_SCHEMA_VERSION = 1 as const

export const ABILITY_AUTOMATION_PRIVACY_AUDIENCES = [
  'server-authority',
  'authorized-gm',
  'source-controller',
  'eligible-responder',
  'map-participant',
  'authorized-operator',
  'unauthenticated',
] as const

export const ABILITY_AUTOMATION_DISCLOSURE_LEVELS = [
  'full',
  'authorized-projection',
  'public-summary',
  'aggregate-only',
  'existence-only',
  'none',
] as const

export const ABILITY_AUTOMATION_PRIVACY_SENSITIVITIES = [
  'secret',
  'restricted',
  'public',
  'aggregate',
] as const

export const ABILITY_AUTOMATION_THREAT_IDS = [
  'copied-ability-disclosure',
  'hidden-ability-disclosure',
  'private-option-disclosure',
  'responder-ownership-disclosure',
  'roll-and-state-disclosure',
  'suppression-state-disclosure',
  'telemetry-log-disclosure',
  'trigger-eligibility-oracle',
] as const

export const ABILITY_AUTOMATION_PRIVACY_CONTROL_IDS = [
  'authority-derived-effective-projection',
  'authority-only-source',
  'authorization-before-window-projection',
  'causal-idempotency',
  'copy-snapshot-provenance-private',
  'generic-denial-reasons',
  'gm-access-audited',
  'opaque-option-identifiers',
  'private-pending-state',
  'public-log-allowlist',
  'public-summary-allowlist',
  'roll-ledger-private',
  'sheet-readset-private',
  'suppression-before-routing',
  'telemetry-label-allowlist',
  'terminal-outcome-redaction',
  'unauthenticated-deny',
] as const

export type AbilityAutomationPrivacyAudience =
  (typeof ABILITY_AUTOMATION_PRIVACY_AUDIENCES)[number]
export type AbilityAutomationDisclosureLevel =
  (typeof ABILITY_AUTOMATION_DISCLOSURE_LEVELS)[number]
export type AbilityAutomationPrivacySensitivity =
  (typeof ABILITY_AUTOMATION_PRIVACY_SENSITIVITIES)[number]
export type AbilityAutomationThreatId = (typeof ABILITY_AUTOMATION_THREAT_IDS)[number]
export type AbilityAutomationPrivacyControlId =
  (typeof ABILITY_AUTOMATION_PRIVACY_CONTROL_IDS)[number]

export type AbilityAutomationDisclosures = Readonly<Record<
  AbilityAutomationPrivacyAudience,
  AbilityAutomationDisclosureLevel
>>

export interface AbilityAutomationPrivacyThreat {
  readonly id: AbilityAutomationThreatId
  readonly assetIds: readonly string[]
  readonly controlIds: readonly AbilityAutomationPrivacyControlId[]
}

export interface AbilityAutomationPrivacyAsset {
  readonly id: string
  readonly sensitivity: AbilityAutomationPrivacySensitivity
  readonly threatIds: readonly AbilityAutomationThreatId[]
  readonly disclosures: AbilityAutomationDisclosures
}

export interface AbilityAutomationPrivacyMatrix {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_PRIVACY_SCHEMA_VERSION
  readonly defaultDecision: 'deny'
  readonly threats: readonly AbilityAutomationPrivacyThreat[]
  readonly assets: readonly AbilityAutomationPrivacyAsset[]
}

export type AbilityAutomationPrivacyValidationCode =
  | 'invalid-privacy-matrix'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'order-mismatch'
  | 'unknown-reference'
  | 'inconsistent-reference'
  | 'unsafe-disclosure'

export class AbilityAutomationPrivacyValidationError extends Error {
  readonly code: AbilityAutomationPrivacyValidationCode
  readonly path: string

  constructor(code: AbilityAutomationPrivacyValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityAutomationPrivacyValidationError'
    this.code = code
    this.path = path
  }
}

export const ABILITY_AUTOMATION_PRIVACY_LIMITS = Object.freeze({
  threats: 32,
  assets: 128,
  references: 32,
  identifierLength: 160,
})

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = ['schemaVersion', 'defaultDecision', 'threats', 'assets'] as const
const THREAT_FIELDS = ['id', 'assetIds', 'controlIds'] as const
const ASSET_FIELDS = ['id', 'sensitivity', 'threatIds', 'disclosures'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const THREAT_SET = new Set<string>(ABILITY_AUTOMATION_THREAT_IDS)
const CONTROL_SET = new Set<string>(ABILITY_AUTOMATION_PRIVACY_CONTROL_IDS)
const DISCLOSURE_SET = new Set<string>(ABILITY_AUTOMATION_DISCLOSURE_LEVELS)
const SENSITIVITY_SET = new Set<string>(ABILITY_AUTOMATION_PRIVACY_SENSITIVITIES)

const fail = (
  code: AbilityAutomationPrivacyValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityAutomationPrivacyValidationError(code, path, detail)
}

const isRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('invalid-privacy-matrix', path, 'must be a plain object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) {
    fail(
      'invalid-privacy-matrix',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_AUTOMATION_PRIVACY_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail('invalid-privacy-matrix', path, 'must be a bounded lowercase stable identifier.')
  }
  return value
}

const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-privacy-matrix', path, 'must be an array.')
  if (value.length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  return value
}

const sortedUnique = (
  values: readonly string[],
  path: string,
): void => {
  if (new Set(values).size !== values.length) fail('duplicate-id', path, 'must contain unique IDs.')
  const sorted = [...values].sort()
  if (values.some((value, index) => value !== sorted[index])) {
    fail('order-mismatch', path, 'must use code-point order.')
  }
}

const disclosures = (value: unknown, path: string): AbilityAutomationDisclosures => {
  const input = record(value, path)
  exact(input, ABILITY_AUTOMATION_PRIVACY_AUDIENCES, path)
  const output = {} as Record<AbilityAutomationPrivacyAudience, AbilityAutomationDisclosureLevel>
  for (const audience of ABILITY_AUTOMATION_PRIVACY_AUDIENCES) {
    const level = input[audience]
    if (typeof level !== 'string' || !DISCLOSURE_SET.has(level)) {
      fail('invalid-privacy-matrix', `${path}.${audience}`, 'is not a supported disclosure level.')
    }
    output[audience] = level as AbilityAutomationDisclosureLevel
  }
  if (output['server-authority'] !== 'full') {
    fail('unsafe-disclosure', `${path}.server-authority`, 'must retain full authority access.')
  }
  if (output.unauthenticated !== 'none') {
    fail('unsafe-disclosure', `${path}.unauthenticated`, 'must be none.')
  }
  if (!['none', 'aggregate-only'].includes(output['authorized-operator'])) {
    fail('unsafe-disclosure', `${path}.authorized-operator`, 'must be none or aggregate-only.')
  }
  return Object.freeze(output)
}

/** Strictly parse the default-deny ability privacy threat and disclosure matrix. */
export const parseAbilityAutomationPrivacyMatrix = (
  value: unknown,
): AbilityAutomationPrivacyMatrix => {
  const root = record(value, 'privacyMatrix')
  exact(root, ROOT_FIELDS, 'privacyMatrix')
  if (root.schemaVersion !== ABILITY_AUTOMATION_PRIVACY_SCHEMA_VERSION) {
    fail('invalid-privacy-matrix', 'privacyMatrix.schemaVersion', 'is unsupported.')
  }
  if (root.defaultDecision !== 'deny') {
    fail('unsafe-disclosure', 'privacyMatrix.defaultDecision', 'must be deny.')
  }

  const threats = array(
    root.threats,
    'privacyMatrix.threats',
    ABILITY_AUTOMATION_PRIVACY_LIMITS.threats,
  ).map((value, index): AbilityAutomationPrivacyThreat => {
    const path = `privacyMatrix.threats[${index}]`
    const input = record(value, path)
    exact(input, THREAT_FIELDS, path)
    const id = stableId(input.id, `${path}.id`)
    if (!THREAT_SET.has(id)) fail('unknown-reference', `${path}.id`, 'is not a required threat ID.')
    const assetIds = array(
      input.assetIds,
      `${path}.assetIds`,
      ABILITY_AUTOMATION_PRIVACY_LIMITS.references,
    ).map((assetId, assetIndex) => stableId(assetId, `${path}.assetIds[${assetIndex}]`))
    const controlIds = array(
      input.controlIds,
      `${path}.controlIds`,
      ABILITY_AUTOMATION_PRIVACY_LIMITS.references,
    ).map((controlId, controlIndex) => {
      const parsed = stableId(controlId, `${path}.controlIds[${controlIndex}]`)
      if (!CONTROL_SET.has(parsed)) {
        fail('unknown-reference', `${path}.controlIds[${controlIndex}]`, 'is not a supported control.')
      }
      return parsed as AbilityAutomationPrivacyControlId
    })
    if (assetIds.length === 0 || controlIds.length === 0 || !controlIds.includes('unauthenticated-deny')) {
      fail('invalid-privacy-matrix', path, 'must bind assets, controls, and unauthenticated denial.')
    }
    sortedUnique(assetIds, `${path}.assetIds`)
    sortedUnique(controlIds, `${path}.controlIds`)
    return Object.freeze({
      id: id as AbilityAutomationThreatId,
      assetIds: Object.freeze(assetIds),
      controlIds: Object.freeze(controlIds),
    })
  })
  const threatIds = threats.map(threat => threat.id)
  sortedUnique(threatIds, 'privacyMatrix.threats')
  if (
    threatIds.length !== ABILITY_AUTOMATION_THREAT_IDS.length
    || threatIds.some((id, index) => id !== ABILITY_AUTOMATION_THREAT_IDS[index])
  ) {
    fail('invalid-privacy-matrix', 'privacyMatrix.threats', 'must cover every required threat exactly once.')
  }

  const assets = array(
    root.assets,
    'privacyMatrix.assets',
    ABILITY_AUTOMATION_PRIVACY_LIMITS.assets,
  ).map((value, index): AbilityAutomationPrivacyAsset => {
    const path = `privacyMatrix.assets[${index}]`
    const input = record(value, path)
    exact(input, ASSET_FIELDS, path)
    const id = stableId(input.id, `${path}.id`)
    if (typeof input.sensitivity !== 'string' || !SENSITIVITY_SET.has(input.sensitivity)) {
      fail('invalid-privacy-matrix', `${path}.sensitivity`, 'is unsupported.')
    }
    const threatIds = array(
      input.threatIds,
      `${path}.threatIds`,
      ABILITY_AUTOMATION_PRIVACY_LIMITS.references,
    ).map((threatId, threatIndex) => {
      const parsed = stableId(threatId, `${path}.threatIds[${threatIndex}]`)
      if (!THREAT_SET.has(parsed)) {
        fail('unknown-reference', `${path}.threatIds[${threatIndex}]`, 'is not a required threat ID.')
      }
      return parsed as AbilityAutomationThreatId
    })
    sortedUnique(threatIds, `${path}.threatIds`)
    const parsedDisclosures = disclosures(input.disclosures, `${path}.disclosures`)
    if (
      input.sensitivity === 'secret'
      && parsedDisclosures['map-participant'] !== 'none'
    ) {
      fail('unsafe-disclosure', `${path}.disclosures.map-participant`, 'must hide secret assets.')
    }
    if (
      input.sensitivity === 'public'
      && parsedDisclosures['map-participant'] !== 'public-summary'
    ) {
      fail('unsafe-disclosure', `${path}.disclosures.map-participant`, 'must expose only a public summary.')
    }
    return Object.freeze({
      id,
      sensitivity: input.sensitivity as AbilityAutomationPrivacySensitivity,
      threatIds: Object.freeze(threatIds),
      disclosures: parsedDisclosures,
    })
  })
  const assetIds = assets.map(asset => asset.id)
  sortedUnique(assetIds, 'privacyMatrix.assets')

  const assetById = new Map(assets.map(asset => [asset.id, asset]))
  const threatById = new Map(threats.map(threat => [threat.id, threat]))
  for (const threat of threats) {
    for (const assetId of threat.assetIds) {
      const asset = assetById.get(assetId) ?? fail(
        'unknown-reference',
        `privacyMatrix.threats.${threat.id}`,
        `references unknown asset ${assetId}.`,
      )
      if (!asset.threatIds.includes(threat.id)) {
        fail('inconsistent-reference', `privacyMatrix.threats.${threat.id}`, `is not reciprocated by ${assetId}.`)
      }
    }
  }
  for (const asset of assets) {
    for (const threatId of asset.threatIds) {
      const threat = threatById.get(threatId)!
      if (!threat.assetIds.includes(asset.id)) {
        fail('inconsistent-reference', `privacyMatrix.assets.${asset.id}`, `is not reciprocated by ${threatId}.`)
      }
    }
  }

  return Object.freeze({
    schemaVersion: ABILITY_AUTOMATION_PRIVACY_SCHEMA_VERSION,
    defaultDecision: 'deny',
    threats: Object.freeze(threats),
    assets: Object.freeze(assets),
  })
}
