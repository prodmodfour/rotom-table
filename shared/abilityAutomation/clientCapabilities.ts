import {
  ABILITY_AUTOMATION_BASE_STATUSES,
  ABILITY_AUTOMATION_INTERACTION_STATUSES,
  type AbilityAutomationBaseStatus,
  type AbilityAutomationInteractionStatus,
} from './manifest'
import { ABILITY_SPEC_MODE_KINDS, ABILITY_SPEC_TARGETING_KINDS, type AbilitySpecModeKind, type AbilitySpecTargetingKind } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_CLIENT_CAPABILITY_SCHEMA_VERSION = 1 as const
export const ABILITY_CLIENT_CAPABILITY_STATUSES = [
  'ready', 'passive', 'blocked', 'suppressed', 'parameters-required', 'runtime-drift',
] as const
export type AbilityClientCapabilityStatus = (typeof ABILITY_CLIENT_CAPABILITY_STATUSES)[number]
export interface AbilityClientTargetingCapability {
  readonly id: string
  readonly kind: AbilitySpecTargetingKind
  readonly minSelections: number
  readonly maxSelections: number
}
export interface AbilityClientModeCapability {
  readonly modeId: string
  readonly kind: AbilitySpecModeKind
  readonly invocable: boolean
  readonly targeting: readonly AbilityClientTargetingCapability[]
}
/** Controller-only capability. It contains no predicates, option values, handler IDs, or source hashes. */
export interface AbilityClientCapability {
  readonly instanceId: string
  readonly canonicalId: string
  readonly displayName: string
  readonly effective: boolean
  readonly baseStatus: AbilityAutomationBaseStatus
  readonly interactionStatus: AbilityAutomationInteractionStatus
  readonly status: AbilityClientCapabilityStatus
  readonly statusBadgeKey: string
  readonly unavailableReasonCode: string | null
  readonly modes: readonly AbilityClientModeCapability[]
}
export interface AbilityClientPlacementCapabilities {
  readonly placementId: string
  readonly abilities: readonly AbilityClientCapability[]
}
export interface AbilityClientCapabilityBundle {
  readonly schemaVersion: typeof ABILITY_CLIENT_CAPABILITY_SCHEMA_VERSION
  readonly mapSlug: string
  readonly mapRevision: number
  readonly placements: readonly AbilityClientPlacementCapabilities[]
}
export const ABILITY_CLIENT_CAPABILITY_LIMITS = Object.freeze({
  placements: 512, abilitiesPerPlacement: 64, modes: 8, targeting: 64,
  identifier: 200, canonicalId: 160, selections: 32,
})
export class AbilityClientCapabilityValidationError extends Error {
  constructor(readonly code: 'invalid-capabilities' | 'limit-exceeded' | 'duplicate-id' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityClientCapabilityValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'mapSlug', 'mapRevision', 'placements'] as const
const PLACEMENT_FIELDS = ['placementId', 'abilities'] as const
const ABILITY_FIELDS = [
  'instanceId', 'canonicalId', 'displayName', 'effective', 'baseStatus', 'interactionStatus',
  'status', 'statusBadgeKey', 'unavailableReasonCode', 'modes',
] as const
const MODE_FIELDS = ['modeId', 'kind', 'invocable', 'targeting'] as const
const TARGETING_FIELDS = ['id', 'kind', 'minSelections', 'maxSelections'] as const
const BASE_SET = new Set<string>(ABILITY_AUTOMATION_BASE_STATUSES)
const INTERACTION_SET = new Set<string>(ABILITY_AUTOMATION_INTERACTION_STATUSES)
const STATUS_SET = new Set<string>(ABILITY_CLIENT_CAPABILITY_STATUSES)
const MODE_SET = new Set<string>(ABILITY_SPEC_MODE_KINDS)
const TARGETING_SET = new Set<string>(ABILITY_SPEC_TARGETING_KINDS)
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityClientCapabilityValidationError['code'], path: string, detail: string): never => {
  throw new AbilityClientCapabilityValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-capabilities', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail('invalid-capabilities', path, 'has invalid shape.')
}
const text = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-capabilities', path, 'must be bounded text.')
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const valueText = text(value, path, ABILITY_CLIENT_CAPABILITY_LIMITS.identifier)
  if (!ID.test(valueText)) fail('invalid-capabilities', path, 'must be a stable ID.')
  return valueText
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) fail('invalid-capabilities', path, 'must be a bounded non-negative integer.')
  return Number(value)
}
const enumValue = <Value extends string>(value: unknown, path: string, set: ReadonlySet<string>): Value => (
  typeof value === 'string' && set.has(value) ? value as Value : fail('invalid-capabilities', path, 'is unsupported.')
)
const parseTargeting = (value: unknown, path: string): AbilityClientTargetingCapability => {
  const input = record(value, path)
  exact(input, TARGETING_FIELDS, path)
  const minSelections = integer(input.minSelections, `${path}.minSelections`, ABILITY_CLIENT_CAPABILITY_LIMITS.selections)
  const maxSelections = integer(input.maxSelections, `${path}.maxSelections`, ABILITY_CLIENT_CAPABILITY_LIMITS.selections)
  if (minSelections > maxSelections) fail('invalid-capabilities', path, 'has inverted selection bounds.')
  return Object.freeze({
    id: stableId(input.id, `${path}.id`),
    kind: enumValue<AbilitySpecTargetingKind>(input.kind, `${path}.kind`, TARGETING_SET),
    minSelections, maxSelections,
  })
}
const parseMode = (value: unknown, path: string): AbilityClientModeCapability => {
  const input = record(value, path)
  exact(input, MODE_FIELDS, path)
  if (!Array.isArray(input.targeting) || input.targeting.length > ABILITY_CLIENT_CAPABILITY_LIMITS.targeting) {
    fail('limit-exceeded', `${path}.targeting`, 'must be bounded.')
  }
  const targeting = (input.targeting as unknown[]).map((entry, index) => parseTargeting(entry, `${path}.targeting[${index}]`))
  if (new Set(targeting.map(entry => entry.id)).size !== targeting.length) fail('duplicate-id', `${path}.targeting`, 'must not repeat IDs.')
  const kind = enumValue<AbilitySpecModeKind>(input.kind, `${path}.kind`, MODE_SET)
  if (typeof input.invocable !== 'boolean' || (input.invocable && kind !== 'activated')) {
    fail('invalid-capabilities', `${path}.invocable`, 'may be true only for a currently available activated mode.')
  }
  return Object.freeze({ modeId: stableId(input.modeId, `${path}.modeId`), kind, invocable: input.invocable as boolean, targeting: Object.freeze(targeting) })
}
const parseAbility = (value: unknown, path: string): AbilityClientCapability => {
  const input = record(value, path)
  exact(input, ABILITY_FIELDS, path)
  if (!Array.isArray(input.modes) || input.modes.length > ABILITY_CLIENT_CAPABILITY_LIMITS.modes) {
    fail('limit-exceeded', `${path}.modes`, 'must be bounded.')
  }
  const modes = (input.modes as unknown[]).map((entry, index) => parseMode(entry, `${path}.modes[${index}]`))
  if (new Set(modes.map(mode => mode.modeId)).size !== modes.length) fail('duplicate-id', `${path}.modes`, 'must not repeat IDs.')
  const status = enumValue<AbilityClientCapabilityStatus>(input.status, `${path}.status`, STATUS_SET)
  const effective = typeof input.effective === 'boolean'
    ? input.effective
    : fail('invalid-capabilities', `${path}.effective`, 'must be boolean.')
  if ((status === 'suppressed') !== !effective) fail('invalid-capabilities', path, 'suppression status and effective flag disagree.')
  const unavailableReasonCode = input.unavailableReasonCode === null
    ? null : stableId(input.unavailableReasonCode, `${path}.unavailableReasonCode`)
  if ((status === 'ready' || status === 'passive') !== (unavailableReasonCode === null)) {
    fail('invalid-capabilities', path, 'availability reason is inconsistent with status.')
  }
  if (status === 'ready' && !modes.some(mode => mode.invocable)) fail('invalid-capabilities', path, 'ready ability has no invocable mode.')
  if (status === 'passive' && modes.some(mode => mode.invocable)) fail('invalid-capabilities', path, 'passive ability has an invocable mode.')
  return Object.freeze({
    instanceId: stableId(input.instanceId, `${path}.instanceId`),
    canonicalId: text(input.canonicalId, `${path}.canonicalId`, ABILITY_CLIENT_CAPABILITY_LIMITS.canonicalId),
    displayName: text(input.displayName, `${path}.displayName`, ABILITY_CLIENT_CAPABILITY_LIMITS.canonicalId),
    effective,
    baseStatus: enumValue<AbilityAutomationBaseStatus>(input.baseStatus, `${path}.baseStatus`, BASE_SET),
    interactionStatus: enumValue<AbilityAutomationInteractionStatus>(input.interactionStatus, `${path}.interactionStatus`, INTERACTION_SET),
    status,
    statusBadgeKey: stableId(input.statusBadgeKey, `${path}.statusBadgeKey`),
    unavailableReasonCode,
    modes: Object.freeze(modes),
  })
}
export const parseAbilityClientCapabilityBundle = (value: unknown): AbilityClientCapabilityBundle => {
  const cloned = cloneStrictJson(value, 'abilityClientCapabilities', {
    limits: { depth: 12, nodes: 131_072, objectFields: 16, arrayEntries: 4_096, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability client capabilities', valueLabel: 'ability client capabilities',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  const input = record(cloned, 'abilityClientCapabilities')
  exact(input, ROOT_FIELDS, 'abilityClientCapabilities')
  if (input.schemaVersion !== 1 || !Array.isArray(input.placements)
    || input.placements.length > ABILITY_CLIENT_CAPABILITY_LIMITS.placements) {
    fail('invalid-capabilities', 'abilityClientCapabilities', 'has invalid version or placement count.')
  }
  const placements = (input.placements as unknown[]).map((entry, index): AbilityClientPlacementCapabilities => {
    const path = `abilityClientCapabilities.placements[${index}]`
    const item = record(entry, path)
    exact(item, PLACEMENT_FIELDS, path)
    if (!Array.isArray(item.abilities) || item.abilities.length > ABILITY_CLIENT_CAPABILITY_LIMITS.abilitiesPerPlacement) {
      fail('limit-exceeded', `${path}.abilities`, 'must be bounded.')
    }
    const abilities = (item.abilities as unknown[]).map((ability, abilityIndex) => parseAbility(ability, `${path}.abilities[${abilityIndex}]`))
    if (new Set(abilities.map(ability => ability.instanceId)).size !== abilities.length) fail('duplicate-id', `${path}.abilities`, 'must not repeat instance IDs.')
    return Object.freeze({ placementId: stableId(item.placementId, `${path}.placementId`), abilities: Object.freeze(abilities) })
  })
  if (new Set(placements.map(entry => entry.placementId)).size !== placements.length) fail('duplicate-id', 'abilityClientCapabilities.placements', 'must not repeat placements.')
  return deepFreezeStrictJson({
    schemaVersion: 1,
    mapSlug: text(input.mapSlug, 'abilityClientCapabilities.mapSlug', ABILITY_CLIENT_CAPABILITY_LIMITS.identifier),
    mapRevision: integer(input.mapRevision, 'abilityClientCapabilities.mapRevision'),
    placements: Object.freeze(placements),
  })
}

export const emptyAbilityClientCapabilityBundle = (mapSlug: string, mapRevision: number): AbilityClientCapabilityBundle => (
  parseAbilityClientCapabilityBundle({ schemaVersion: 1, mapSlug, mapRevision, placements: [] })
)
