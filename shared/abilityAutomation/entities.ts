import {
  parseAbilityEffectDuration,
  type AbilityEffectDuration,
} from './durations'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_ENTITY_STATE_SCHEMA_VERSION = 1 as const
export const ABILITY_ENTITY_KINDS = ['anchor', 'decoy', 'object', 'subordinate'] as const
export const ABILITY_ENTITY_OCCUPANCY = ['blocking', 'non-blocking'] as const
export const ABILITY_ENTITY_TARGETABILITY = ['targetable', 'untargetable'] as const
export const ABILITY_ENTITY_MOVEMENT_MODES = ['fixed', 'controlled', 'source-linked'] as const
export const ABILITY_ENTITY_CONTROLLER_KINDS = ['source-controller', 'placement', 'side', 'gm'] as const
export const ABILITY_ENTITY_LIMITS = Object.freeze({
  entries: 256, receipts: 2_048, identifierLength: 200, tags: 32,
  footprintExtent: 32, hitPoints: 1_000_000, version: 1_000_000,
})

export type AbilityEntityKind = (typeof ABILITY_ENTITY_KINDS)[number]
export type AbilityEntityOccupancy = (typeof ABILITY_ENTITY_OCCUPANCY)[number]
export type AbilityEntityTargetability = (typeof ABILITY_ENTITY_TARGETABILITY)[number]
export type AbilityEntityMovementMode = (typeof ABILITY_ENTITY_MOVEMENT_MODES)[number]
export type AbilityEntityControllerKind = (typeof ABILITY_ENTITY_CONTROLLER_KINDS)[number]
export interface AbilityEntityCell { readonly x: number; readonly y: number; readonly z: number }
export interface AbilityEntityController { readonly kind: AbilityEntityControllerKind; readonly id: string | null }
export type AbilityEntityPayload =
  | {
      readonly kind: 'anchor'
      readonly anchorKind: string
      readonly anchoredPlacementIds: readonly string[]
      readonly preventedMovementModes: readonly ('voluntary' | 'forced' | 'teleport' | 'swap')[]
    }
  | { readonly kind: 'decoy'; readonly mimicsPlacementId: string | null }
  | { readonly kind: 'object'; readonly objectKind: string }
  | { readonly kind: 'subordinate'; readonly templateId: string; readonly initiativePolicy: 'none' | 'after-source' | 'independent' }

export interface AbilityEntityEntry {
  readonly entityId: string
  readonly version: number
  readonly kind: AbilityEntityKind
  readonly labelKey: string
  readonly ownerPlacementId: string
  readonly sourceAbilityInstanceId: string
  readonly canonicalId: string
  readonly sourceOperationId: string
  readonly controller: AbilityEntityController
  readonly sideId: string | null
  readonly position: AbilityEntityCell
  readonly base: number
  readonly clearance: number
  readonly occupancy: AbilityEntityOccupancy
  readonly targetability: AbilityEntityTargetability
  readonly movementMode: AbilityEntityMovementMode
  readonly movementSpeed: number
  readonly maximumHp: number | null
  readonly currentHp: number | null
  readonly damageReduction: number | null
  readonly duration: AbilityEffectDuration
  readonly tags: readonly string[]
  readonly payload: AbilityEntityPayload
  readonly createdOperationId: string
  readonly lastOperationId: string
}
export interface AbilityEntityReceipt {
  readonly operationId: string
  readonly entityId: string
  readonly requestSha256: string
  readonly outcome: 'created' | 'moved' | 'damaged' | 'control-transferred' | 'removed'
  readonly resultVersion: number | null
}
export interface AbilityEntityState {
  readonly schemaVersion: typeof ABILITY_ENTITY_STATE_SCHEMA_VERSION
  readonly entries: readonly AbilityEntityEntry[]
  readonly receipts: readonly AbilityEntityReceipt[]
}

export class AbilityEntityValidationError extends Error {
  constructor(readonly code: 'invalid-entity-state' | 'limit-exceeded' | 'duplicate-id' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityEntityValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'entries', 'receipts'] as const
const ENTRY_FIELDS = [
  'entityId', 'version', 'kind', 'labelKey', 'ownerPlacementId', 'sourceAbilityInstanceId',
  'canonicalId', 'sourceOperationId', 'controller', 'sideId', 'position', 'base', 'clearance',
  'occupancy', 'targetability', 'movementMode', 'movementSpeed', 'maximumHp', 'currentHp',
  'damageReduction', 'duration', 'tags', 'payload', 'createdOperationId', 'lastOperationId',
] as const
const CONTROLLER_FIELDS = ['kind', 'id'] as const
const CELL_FIELDS = ['x', 'y', 'z'] as const
const RECEIPT_FIELDS = ['operationId', 'entityId', 'requestSha256', 'outcome', 'resultVersion'] as const
const PAYLOAD_FIELDS: Readonly<Record<AbilityEntityKind, readonly string[]>> = {
  anchor: ['kind', 'anchorKind', 'anchoredPlacementIds', 'preventedMovementModes'], decoy: ['kind', 'mimicsPlacementId'],
  object: ['kind', 'objectKind'], subordinate: ['kind', 'templateId', 'initiativePolicy'],
}
const ENTITY_KIND_SET = new Set<string>(ABILITY_ENTITY_KINDS)
const OCCUPANCY_SET = new Set<string>(ABILITY_ENTITY_OCCUPANCY)
const TARGETABILITY_SET = new Set<string>(ABILITY_ENTITY_TARGETABILITY)
const MOVEMENT_SET = new Set<string>(ABILITY_ENTITY_MOVEMENT_MODES)
const CONTROLLER_SET = new Set<string>(ABILITY_ENTITY_CONTROLLER_KINDS)
const RECEIPT_OUTCOMES = new Set<string>(['created', 'moved', 'damaged', 'control-transferred', 'removed'])
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const fail = (code: AbilityEntityValidationError['code'], path: string, detail: string): never => {
  throw new AbilityEntityValidationError(code, path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-entity-state', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail('invalid-entity-state', path, 'has invalid shape.')
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > ABILITY_ENTITY_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)) fail('invalid-entity-state', path, 'must be a stable ID.')
  return value as string
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('invalid-entity-state', path, 'must be bounded text.')
  }
  return value as string
}
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail('invalid-entity-state', path, `must be an integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}
const oneOf = <Value extends string>(value: unknown, path: string, supported: ReadonlySet<string>): Value => (
  typeof value === 'string' && supported.has(value) ? value as Value : fail('invalid-entity-state', path, 'is unsupported.')
)
const optionalId = (value: unknown, path: string): string | null => value === null ? null : stableId(value, path)
const parseCell = (value: unknown, path: string): AbilityEntityCell => {
  const input = record(value, path)
  exact(input, CELL_FIELDS, path)
  return Object.freeze({
    x: integer(input.x, `${path}.x`, 0, 1_000_000),
    y: integer(input.y, `${path}.y`, 0, 1_000_000),
    z: integer(input.z, `${path}.z`, 0, 1_000_000),
  })
}
const parsePayload = (value: unknown, expectedKind: AbilityEntityKind, path: string): AbilityEntityPayload => {
  const input = record(value, path)
  exact(input, PAYLOAD_FIELDS[expectedKind], path)
  if (input.kind !== expectedKind) fail('invalid-entity-state', `${path}.kind`, 'must match entity kind.')
  if (expectedKind === 'anchor') {
    if (!Array.isArray(input.anchoredPlacementIds) || input.anchoredPlacementIds.length > 64
      || !Array.isArray(input.preventedMovementModes) || input.preventedMovementModes.length > 4) {
      fail('limit-exceeded', path, 'anchor movement locks must be bounded arrays.')
    }
    const rawAnchoredPlacementIds = input.anchoredPlacementIds as unknown[]
    const rawPreventedMovementModes = input.preventedMovementModes as unknown[]
    const anchoredPlacementIds = rawAnchoredPlacementIds.map((id, index) => (
      stableId(id, `${path}.anchoredPlacementIds[${index}]`)
    ))
    const supportedModes = new Set(['voluntary', 'forced', 'teleport', 'swap'])
    const preventedMovementModes = rawPreventedMovementModes.map((mode, index) => (
      oneOf<'voluntary' | 'forced' | 'teleport' | 'swap'>(mode, `${path}.preventedMovementModes[${index}]`, supportedModes)
    ))
    if (new Set(anchoredPlacementIds).size !== anchoredPlacementIds.length
      || anchoredPlacementIds.some((id, index) => index > 0 && id <= anchoredPlacementIds[index - 1]!)
      || new Set(preventedMovementModes).size !== preventedMovementModes.length
      || preventedMovementModes.some((mode, index) => index > 0 && mode <= preventedMovementModes[index - 1]!)) {
      fail('duplicate-id', path, 'anchor movement locks must be unique in code-point order.')
    }
    return Object.freeze({
      kind: 'anchor', anchorKind: stableId(input.anchorKind, `${path}.anchorKind`),
      anchoredPlacementIds: Object.freeze(anchoredPlacementIds),
      preventedMovementModes: Object.freeze(preventedMovementModes),
    })
  }
  if (expectedKind === 'decoy') return Object.freeze({ kind: 'decoy', mimicsPlacementId: optionalId(input.mimicsPlacementId, `${path}.mimicsPlacementId`) })
  if (expectedKind === 'object') return Object.freeze({ kind: 'object', objectKind: stableId(input.objectKind, `${path}.objectKind`) })
  if (!['none', 'after-source', 'independent'].includes(input.initiativePolicy as string)) {
    fail('invalid-entity-state', `${path}.initiativePolicy`, 'is unsupported.')
  }
  return Object.freeze({
    kind: 'subordinate', templateId: stableId(input.templateId, `${path}.templateId`),
    initiativePolicy: input.initiativePolicy as 'none' | 'after-source' | 'independent',
  })
}

export const createEmptyAbilityEntityState = (): AbilityEntityState => deepFreezeStrictJson({
  schemaVersion: ABILITY_ENTITY_STATE_SCHEMA_VERSION, entries: [], receipts: [],
})

export const parseAbilityEntityState = (
  value: unknown,
  path = 'abilityEntities',
): AbilityEntityState => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 12, nodes: 65_536, objectFields: 32, arrayEntries: ABILITY_ENTITY_LIMITS.receipts, stringLength: 500, objectKeyLength: 200 },
    rootLabel: 'ability entity state', valueLabel: 'ability entity values',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  const input = record(cloned, path)
  exact(input, ROOT_FIELDS, path)
  if (input.schemaVersion !== ABILITY_ENTITY_STATE_SCHEMA_VERSION) fail('invalid-entity-state', `${path}.schemaVersion`, 'is unsupported.')
  if (!Array.isArray(input.entries) || input.entries.length > ABILITY_ENTITY_LIMITS.entries) {
    fail('limit-exceeded', `${path}.entries`, 'must be bounded.')
  }
  const entries = (input.entries as readonly unknown[]).map((entry, index): AbilityEntityEntry => {
    const entryPath = `${path}.entries[${index}]`
    const item = record(entry, entryPath)
    exact(item, ENTRY_FIELDS, entryPath)
    const kind = oneOf<AbilityEntityKind>(item.kind, `${entryPath}.kind`, ENTITY_KIND_SET)
    const controllerInput = record(item.controller, `${entryPath}.controller`)
    exact(controllerInput, CONTROLLER_FIELDS, `${entryPath}.controller`)
    const controllerKind = oneOf<AbilityEntityControllerKind>(
      controllerInput.kind,
      `${entryPath}.controller.kind`,
      CONTROLLER_SET,
    )
    const controllerId = optionalId(controllerInput.id, `${entryPath}.controller.id`)
    if ((controllerKind === 'gm') !== (controllerId === null)) {
      fail('invalid-entity-state', `${entryPath}.controller`, 'only GM control has a null ID.')
    }
    const maximumHp = item.maximumHp === null ? null : integer(item.maximumHp, `${entryPath}.maximumHp`, 1, ABILITY_ENTITY_LIMITS.hitPoints)
    const currentHp = item.currentHp === null ? null : integer(item.currentHp, `${entryPath}.currentHp`, 0, maximumHp ?? ABILITY_ENTITY_LIMITS.hitPoints)
    const damageReduction = item.damageReduction === null ? null : integer(item.damageReduction, `${entryPath}.damageReduction`, 0, ABILITY_ENTITY_LIMITS.hitPoints)
    if ((maximumHp === null) !== (currentHp === null) || (maximumHp === null) !== (damageReduction === null)) {
      fail('invalid-entity-state', entryPath, 'HP and damage reduction must be jointly present.')
    }
    if (!Array.isArray(item.tags) || item.tags.length > ABILITY_ENTITY_LIMITS.tags) {
      fail('limit-exceeded', `${entryPath}.tags`, 'must be bounded.')
    }
    const tags = (item.tags as readonly unknown[]).map((tag, tagIndex) => stableId(tag, `${entryPath}.tags[${tagIndex}]`))
    if (new Set(tags).size !== tags.length || tags.some((tag, tagIndex) => tagIndex > 0 && tag <= tags[tagIndex - 1]!)) {
      fail('duplicate-id', `${entryPath}.tags`, 'must be unique in code-point order.')
    }
    return Object.freeze({
      entityId: stableId(item.entityId, `${entryPath}.entityId`),
      version: integer(item.version, `${entryPath}.version`, 1, ABILITY_ENTITY_LIMITS.version),
      kind,
      labelKey: stableId(item.labelKey, `${entryPath}.labelKey`),
      ownerPlacementId: stableId(item.ownerPlacementId, `${entryPath}.ownerPlacementId`),
      sourceAbilityInstanceId: stableId(item.sourceAbilityInstanceId, `${entryPath}.sourceAbilityInstanceId`),
      canonicalId: text(item.canonicalId, `${entryPath}.canonicalId`),
      sourceOperationId: stableId(item.sourceOperationId, `${entryPath}.sourceOperationId`),
      controller: Object.freeze({ kind: controllerKind, id: controllerId }),
      sideId: optionalId(item.sideId, `${entryPath}.sideId`),
      position: parseCell(item.position, `${entryPath}.position`),
      base: integer(item.base, `${entryPath}.base`, 1, ABILITY_ENTITY_LIMITS.footprintExtent),
      clearance: integer(item.clearance, `${entryPath}.clearance`, 1, ABILITY_ENTITY_LIMITS.footprintExtent),
      occupancy: oneOf<AbilityEntityOccupancy>(item.occupancy, `${entryPath}.occupancy`, OCCUPANCY_SET),
      targetability: oneOf<AbilityEntityTargetability>(item.targetability, `${entryPath}.targetability`, TARGETABILITY_SET),
      movementMode: oneOf<AbilityEntityMovementMode>(item.movementMode, `${entryPath}.movementMode`, MOVEMENT_SET),
      movementSpeed: integer(item.movementSpeed, `${entryPath}.movementSpeed`, 0, 10_000),
      maximumHp,
      currentHp,
      damageReduction,
      duration: parseAbilityEffectDuration(item.duration, `${entryPath}.duration`),
      tags: Object.freeze(tags),
      payload: parsePayload(item.payload, kind, `${entryPath}.payload`),
      createdOperationId: stableId(item.createdOperationId, `${entryPath}.createdOperationId`),
      lastOperationId: stableId(item.lastOperationId, `${entryPath}.lastOperationId`),
    })
  })
  if (new Set(entries.map(entry => entry.entityId)).size !== entries.length) {
    fail('duplicate-id', `${path}.entries`, 'must not repeat entity IDs.')
  }
  if (!Array.isArray(input.receipts) || input.receipts.length > ABILITY_ENTITY_LIMITS.receipts) {
    fail('limit-exceeded', `${path}.receipts`, 'must be bounded.')
  }
  const receipts = (input.receipts as readonly unknown[]).map((entry, index): AbilityEntityReceipt => {
    const receiptPath = `${path}.receipts[${index}]`
    const item = record(entry, receiptPath)
    exact(item, RECEIPT_FIELDS, receiptPath)
    if (typeof item.requestSha256 !== 'string' || !SHA256_PATTERN.test(item.requestSha256)
      || typeof item.outcome !== 'string' || !RECEIPT_OUTCOMES.has(item.outcome)) {
      fail('invalid-entity-state', receiptPath, 'has invalid hash or outcome.')
    }
    return Object.freeze({
      operationId: stableId(item.operationId, `${receiptPath}.operationId`),
      entityId: stableId(item.entityId, `${receiptPath}.entityId`),
      requestSha256: item.requestSha256 as string,
      outcome: item.outcome as AbilityEntityReceipt['outcome'],
      resultVersion: item.resultVersion === null ? null : integer(item.resultVersion, `${receiptPath}.resultVersion`, 1, ABILITY_ENTITY_LIMITS.version),
    })
  })
  if (new Set(receipts.map(receipt => receipt.operationId)).size !== receipts.length) {
    fail('duplicate-id', `${path}.receipts`, 'must not repeat operation IDs.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_ENTITY_STATE_SCHEMA_VERSION,
    entries: Object.freeze(entries), receipts: Object.freeze(receipts),
  })
}
