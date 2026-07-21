import {
  parseMoveEffectOperation,
  type MoveFieldEffectOperation,
  type MoveHazardEffectOperation,
  type MoveTemporaryEffectOperation,
} from '../moveAutomation/effects'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_FIELD_PROVIDER_SCHEMA_VERSION = 1 as const
export type AbilityFieldProviderOperation =
  | MoveFieldEffectOperation
  | MoveHazardEffectOperation
  | MoveTemporaryEffectOperation
export interface AbilityFieldProvider {
  readonly schemaVersion: typeof ABILITY_FIELD_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly ownerPlacementId: string
  readonly recipientPlacementIds: readonly string[]
  readonly priority: number
  readonly reasonCode: string
  readonly operation: AbilityFieldProviderOperation
}
export const ABILITY_FIELD_PROVIDER_LIMITS = Object.freeze({
  providers: 256, recipients: 64, identifier: 200, priority: 1_000,
})
export class AbilityFieldProviderValidationError extends Error {
  constructor(readonly code: 'invalid-provider' | 'duplicate-id' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityFieldProviderValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId',
  'ownerPlacementId', 'recipientPlacementIds', 'priority', 'reasonCode', 'operation',
] as const
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityFieldProviderValidationError['code'], path: string, detail: string): never => {
  throw new AbilityFieldProviderValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-provider', path, 'must be an object.')
  return value as UnknownRecord
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_FIELD_PROVIDER_LIMITS.identifier || !ID.test(value)) {
    fail('invalid-provider', path, 'must be a bounded stable ID.')
  }
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_FIELD_PROVIDER_LIMITS.identifier
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-provider', path, 'must be bounded text.')
  return value as string
}
export const parseAbilityFieldProviders = (value: unknown): readonly AbilityFieldProvider[] => {
  const cloned = cloneStrictJson(value, 'abilityFieldProviders', {
    limits: { depth: 24, nodes: 131_072, objectFields: 128, arrayEntries: 512, stringLength: 1_000, objectKeyLength: 200 },
    rootLabel: 'ability field providers', valueLabel: 'ability field provider values',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  if (!Array.isArray(cloned) || cloned.length > ABILITY_FIELD_PROVIDER_LIMITS.providers) fail('limit-exceeded', 'abilityFieldProviders', 'must be bounded.')
  const providers = (cloned as unknown[]).map((entry, index): AbilityFieldProvider => {
    const path = `abilityFieldProviders[${index}]`
    const input = record(entry, path)
    const expected = new Set<string>(FIELDS)
    if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
      || Object.keys(input).some(field => !expected.has(field))) fail('invalid-provider', path, 'has invalid shape.')
    if (input.schemaVersion !== 1 || !Number.isSafeInteger(input.priority)
      || Math.abs(Number(input.priority)) > ABILITY_FIELD_PROVIDER_LIMITS.priority) fail('invalid-provider', path, 'has invalid version or priority.')
    if (!Array.isArray(input.recipientPlacementIds)
      || input.recipientPlacementIds.length > ABILITY_FIELD_PROVIDER_LIMITS.recipients) fail('limit-exceeded', `${path}.recipientPlacementIds`, 'must be bounded.')
    const recipients = (input.recipientPlacementIds as unknown[]).map((id, recipientIndex) => stableId(id, `${path}.recipientPlacementIds[${recipientIndex}]`))
    if (new Set(recipients).size !== recipients.length) fail('duplicate-id', `${path}.recipientPlacementIds`, 'must not repeat recipients.')
    const providerId = stableId(input.providerId, `${path}.providerId`)
    const operation = parseMoveEffectOperation(input.operation, `${path}.operation`)
    if (operation.kind !== 'field' && operation.kind !== 'hazard' && operation.kind !== 'temporary-effect') {
      fail('invalid-provider', `${path}.operation.kind`, 'must be field, hazard, or temporary-effect.')
    }
    if (operation.source.kind !== 'operation' || operation.source.id !== providerId) {
      fail('invalid-provider', `${path}.operation.source`, 'must bind to its provider ID.')
    }
    if ((recipients.length === 0) !== (operation.recipients.kind === 'none')
      || (recipients.length > 0 && operation.recipients.kind !== 'selected-targets')) {
      fail('invalid-provider', `${path}.operation.recipients`, 'must match explicit recipient cardinality.')
    }
    return Object.freeze({
      schemaVersion: 1, providerId,
      abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
      canonicalId: text(input.canonicalId, `${path}.canonicalId`),
      sourcePlacementId: stableId(input.sourcePlacementId, `${path}.sourcePlacementId`),
      ownerPlacementId: stableId(input.ownerPlacementId, `${path}.ownerPlacementId`),
      recipientPlacementIds: Object.freeze(recipients),
      priority: Number(input.priority), reasonCode: stableId(input.reasonCode, `${path}.reasonCode`),
      operation: operation as AbilityFieldProviderOperation,
    })
  })
  if (new Set(providers.map(entry => entry.providerId)).size !== providers.length
    || new Set(providers.map(entry => entry.operation.id)).size !== providers.length) {
    fail('duplicate-id', 'abilityFieldProviders', 'must not repeat provider or operation IDs.')
  }
  providers.sort((left, right) => left.priority - right.priority
    || (left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)
    || (left.abilityInstanceId < right.abilityInstanceId ? -1 : left.abilityInstanceId > right.abilityInstanceId ? 1 : 0)
    || (left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0))
  return deepFreezeStrictJson(providers)
}
