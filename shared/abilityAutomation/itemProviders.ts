import {
  parseMoveItemEffectPayload,
  type MoveItemEffectPayload,
} from '../moveAutomation/itemEffects'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_ITEM_PROVIDER_SCHEMA_VERSION = 1 as const
export interface AbilityItemProvider {
  readonly schemaVersion: typeof ABILITY_ITEM_PROVIDER_SCHEMA_VERSION
  readonly providerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly sourcePlacementId: string
  readonly ownerPlacementId: string
  readonly recipientPlacementIds: readonly string[]
  readonly priority: number
  readonly reasonCode: string
  readonly payload: MoveItemEffectPayload
}
export const ABILITY_ITEM_PROVIDER_LIMITS = Object.freeze({
  providers: 256, recipients: 64, identifier: 200, priority: 1_000,
})
export class AbilityItemProviderValidationError extends Error {
  constructor(readonly code: 'invalid-provider' | 'duplicate-id' | 'limit-exceeded' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityItemProviderValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const FIELDS = [
  'schemaVersion', 'providerId', 'abilityInstanceId', 'canonicalId', 'sourcePlacementId',
  'ownerPlacementId', 'recipientPlacementIds', 'priority', 'reasonCode', 'payload',
] as const
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityItemProviderValidationError['code'], path: string, detail: string): never => {
  throw new AbilityItemProviderValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-provider', path, 'must be an object.')
  return value as UnknownRecord
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_ITEM_PROVIDER_LIMITS.identifier || !ID.test(value)) {
    fail('invalid-provider', path, 'must be a bounded stable ID.')
  }
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_ITEM_PROVIDER_LIMITS.identifier
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-provider', path, 'must be bounded text.')
  return value as string
}
export const parseAbilityItemProviders = (value: unknown): readonly AbilityItemProvider[] => {
  const cloned = cloneStrictJson(value, 'abilityItemProviders', {
    limits: { depth: 14, nodes: 65_536, objectFields: 24, arrayEntries: 512, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability item providers', valueLabel: 'ability item provider values',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  if (!Array.isArray(cloned) || cloned.length > ABILITY_ITEM_PROVIDER_LIMITS.providers) fail('limit-exceeded', 'abilityItemProviders', 'must be bounded.')
  const providers = (cloned as unknown[]).map((entry, index): AbilityItemProvider => {
    const path = `abilityItemProviders[${index}]`
    const input = record(entry, path)
    const expected = new Set<string>(FIELDS)
    if (FIELDS.some(field => !Object.prototype.hasOwnProperty.call(input, field))
      || Object.keys(input).some(field => !expected.has(field))) fail('invalid-provider', path, 'has invalid shape.')
    if (input.schemaVersion !== 1 || !Number.isSafeInteger(input.priority)
      || Math.abs(Number(input.priority)) > ABILITY_ITEM_PROVIDER_LIMITS.priority) fail('invalid-provider', path, 'has invalid version or priority.')
    if (!Array.isArray(input.recipientPlacementIds)
      || input.recipientPlacementIds.length > ABILITY_ITEM_PROVIDER_LIMITS.recipients) fail('limit-exceeded', `${path}.recipientPlacementIds`, 'must be bounded.')
    const recipientPlacementIds = (input.recipientPlacementIds as unknown[]).map((id, recipientIndex) => (
      stableId(id, `${path}.recipientPlacementIds[${recipientIndex}]`)
    ))
    if (new Set(recipientPlacementIds).size !== recipientPlacementIds.length) fail('duplicate-id', `${path}.recipientPlacementIds`, 'must not repeat recipients.')
    return Object.freeze({
      schemaVersion: 1,
      providerId: stableId(input.providerId, `${path}.providerId`),
      abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
      canonicalId: text(input.canonicalId, `${path}.canonicalId`),
      sourcePlacementId: stableId(input.sourcePlacementId, `${path}.sourcePlacementId`),
      ownerPlacementId: stableId(input.ownerPlacementId, `${path}.ownerPlacementId`),
      recipientPlacementIds: Object.freeze(recipientPlacementIds),
      priority: Number(input.priority),
      reasonCode: stableId(input.reasonCode, `${path}.reasonCode`),
      payload: parseMoveItemEffectPayload(input.payload, `${path}.payload`),
    })
  })
  if (new Set(providers.map(entry => entry.providerId)).size !== providers.length) fail('duplicate-id', 'abilityItemProviders', 'must not repeat provider IDs.')
  providers.sort((left, right) => left.priority - right.priority
    || (left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)
    || (left.abilityInstanceId < right.abilityInstanceId ? -1 : left.abilityInstanceId > right.abilityInstanceId ? 1 : 0)
    || (left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0))
  return deepFreezeStrictJson(providers)
}
