import {
  EncounterEffectValidationError,
  parseEncounterEffectDuration,
  type EncounterEffectDuration,
} from './encounterEffects'
import type { EncounterSideId } from './encounterState'

/** Closed durable zone families. Each family owns one exact payload shape. */
export const ENCOUNTER_ZONE_KINDS = [
  'hazard',
  'weather',
  'terrain',
  'room',
  'smoke',
  'barrier',
  'pledge',
  'vortex',
  'side-condition',
] as const

export const ENCOUNTER_ZONE_SOURCE_KINDS = ['operation', 'legacy-map'] as const
export const ENCOUNTER_ZONE_LEGACY_LANES = [
  'hazards',
  'weather',
  'terrain',
  'room',
] as const
export const ENCOUNTER_ZONE_GEOMETRY_KINDS = [
  'battlefield',
  'cells',
  'placement',
  'side',
] as const
export const ENCOUNTER_ZONE_STACKING_KINDS = [
  'replace',
  'refresh',
  'add-layer',
  'independent',
] as const
export const ENCOUNTER_ZONE_NUMERIC_OPERATIONS = ['add', 'multiply', 'set'] as const
export const ENCOUNTER_ZONE_MODIFIER_OPERATIONS = [
  ...ENCOUNTER_ZONE_NUMERIC_OPERATIONS,
  'block',
] as const
export const ENCOUNTER_ZONE_TARGETING_ATTRIBUTES = [
  'accuracy',
  'evasion',
  'cover',
  'line-of-sight',
] as const
export const ENCOUNTER_ZONE_DAMAGE_ATTRIBUTES = [
  'damage-base',
  'damage',
  'damage-reduction',
] as const
export const ENCOUNTER_ZONE_MOVEMENT_ATTRIBUTES = [
  'cost',
  'budget',
  'traversal',
] as const

export const ENCOUNTER_ZONE_LIMITS = Object.freeze({
  count: 256,
  identifierChars: 160,
  cells: 512,
  hooksPerTiming: 16,
  modifiersPerCategory: 32,
  tags: 32,
  layer: 64,
  charges: 10_000,
  coordinate: 1_000_000,
  numericMagnitude: 1_000_000,
})

export type EncounterZoneId = string
export type EncounterZoneKind = (typeof ENCOUNTER_ZONE_KINDS)[number]
export type EncounterZoneSourceKind = (typeof ENCOUNTER_ZONE_SOURCE_KINDS)[number]
export type EncounterZoneLegacyLane = (typeof ENCOUNTER_ZONE_LEGACY_LANES)[number]
export type EncounterZoneGeometryKind = (typeof ENCOUNTER_ZONE_GEOMETRY_KINDS)[number]
export type EncounterZoneStackingKind = (typeof ENCOUNTER_ZONE_STACKING_KINDS)[number]
export type EncounterZoneNumericOperation = (typeof ENCOUNTER_ZONE_NUMERIC_OPERATIONS)[number]
export type EncounterZoneModifierOperation = (typeof ENCOUNTER_ZONE_MODIFIER_OPERATIONS)[number]
export type EncounterZoneTargetingAttribute =
  (typeof ENCOUNTER_ZONE_TARGETING_ATTRIBUTES)[number]
export type EncounterZoneDamageAttribute =
  (typeof ENCOUNTER_ZONE_DAMAGE_ATTRIBUTES)[number]
export type EncounterZoneMovementAttribute =
  (typeof ENCOUNTER_ZONE_MOVEMENT_ATTRIBUTES)[number]
export type EncounterZoneDuration = EncounterEffectDuration

/** Source for a native accepted operation. Null move/placement IDs support audited GM field work. */
export interface EncounterZoneOperationSource {
  readonly kind: 'operation'
  readonly operationId: string
  readonly moveId: string | null
  readonly placementId: string | null
}

/** Query-only or lazily migrated identity for an existing map lane entry. */
export interface EncounterZoneLegacyMapSource {
  readonly kind: 'legacy-map'
  readonly lane: EncounterZoneLegacyLane
  readonly key: string
}

export type EncounterZoneSource =
  | EncounterZoneOperationSource
  | EncounterZoneLegacyMapSource

export interface EncounterZoneCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type EncounterZoneGeometry =
  | { readonly kind: 'battlefield' }
  | { readonly kind: 'cells'; readonly cells: readonly EncounterZoneCell[] }
  | { readonly kind: 'placement'; readonly placementId: string }
  | { readonly kind: 'side'; readonly sideId: EncounterSideId }

export type EncounterZoneStacking =
  | {
      readonly kind: Exclude<EncounterZoneStackingKind, 'add-layer'>
      readonly maxLayers: null
    }
  | {
      readonly kind: 'add-layer'
      readonly maxLayers: number
    }

/** Hooks identify audited server handlers; no callback or effect program is persisted. */
export interface EncounterZoneHook {
  readonly id: string
  readonly handlerId: string
  readonly oncePerMovement: boolean
}

export interface EncounterZoneHooks {
  readonly entry: readonly EncounterZoneHook[]
  readonly exit: readonly EncounterZoneHook[]
}

interface EncounterZoneNumericModifier<Attribute extends string> {
  readonly id: string
  readonly attribute: Attribute
  readonly operation: EncounterZoneNumericOperation
  readonly value: number
  readonly reasonCode: string
}

interface EncounterZoneBlockingModifier<Attribute extends string> {
  readonly id: string
  readonly attribute: Attribute
  readonly operation: 'block'
  readonly value: null
  readonly reasonCode: string
}

export type EncounterZoneTargetingModifier =
  | EncounterZoneNumericModifier<Exclude<EncounterZoneTargetingAttribute, 'line-of-sight'>>
  | EncounterZoneBlockingModifier<'line-of-sight'>

export type EncounterZoneDamageModifier =
  EncounterZoneNumericModifier<EncounterZoneDamageAttribute>

export type EncounterZoneMovementModifier =
  | EncounterZoneNumericModifier<Exclude<EncounterZoneMovementAttribute, 'traversal'>>
  | EncounterZoneBlockingModifier<'traversal'>

export interface EncounterZoneModifiers {
  readonly targeting: readonly EncounterZoneTargetingModifier[]
  readonly damage: readonly EncounterZoneDamageModifier[]
  readonly movement: readonly EncounterZoneMovementModifier[]
}

export interface EncounterLayeredZonePayload {
  /** Stable stacking/removal family; concrete zone IDs are server-derived. */
  readonly familyId: string
  /** Null means the zone is not charge-limited. Zero is retained until lifecycle cleanup. */
  readonly charges: number | null
  readonly maxCharges: number | null
}

export interface EncounterHazardZonePayload extends EncounterLayeredZonePayload {
  readonly hazardId: string
}

export interface EncounterWeatherZonePayload {
  readonly weatherId: string
}

export interface EncounterTerrainZonePayload {
  readonly terrainId: string
}

export interface EncounterRoomZonePayload {
  readonly roomId: string
  readonly startsNextRound: boolean
}

export interface EncounterSmokeZonePayload {
  readonly smokeId: string
}

export interface EncounterBarrierZonePayload {
  readonly barrierId: string
}

export interface EncounterPledgeZonePayload extends EncounterLayeredZonePayload {
  readonly pledgeId: string
}

export interface EncounterVortexZonePayload {
  readonly vortexId: string
}

export interface EncounterSideConditionZonePayload {
  readonly conditionId: string
}

export type EncounterZonePayload =
  | EncounterHazardZonePayload
  | EncounterWeatherZonePayload
  | EncounterTerrainZonePayload
  | EncounterRoomZonePayload
  | EncounterSmokeZonePayload
  | EncounterBarrierZonePayload
  | EncounterPledgeZonePayload
  | EncounterVortexZonePayload
  | EncounterSideConditionZonePayload

interface EncounterZoneEnvelope<Kind extends EncounterZoneKind, Payload> {
  readonly id: EncounterZoneId
  readonly kind: Kind
  readonly source: EncounterZoneSource
  /** Owning side. Null is neutral or unknown; legacy owner labels never infer this value. */
  readonly sideId: EncounterSideId | null
  readonly geometry: EncounterZoneGeometry
  readonly layer: number
  readonly duration: EncounterZoneDuration
  readonly stacking: EncounterZoneStacking
  readonly hooks: EncounterZoneHooks
  readonly modifiers: EncounterZoneModifiers
  readonly tags: readonly string[]
  readonly payload: Payload
}

export type EncounterHazardZone = EncounterZoneEnvelope<'hazard', EncounterHazardZonePayload>
export type EncounterWeatherZone = EncounterZoneEnvelope<'weather', EncounterWeatherZonePayload>
export type EncounterTerrainZone = EncounterZoneEnvelope<'terrain', EncounterTerrainZonePayload>
export type EncounterRoomZone = EncounterZoneEnvelope<'room', EncounterRoomZonePayload>
export type EncounterSmokeZone = EncounterZoneEnvelope<'smoke', EncounterSmokeZonePayload>
export type EncounterBarrierZone = EncounterZoneEnvelope<'barrier', EncounterBarrierZonePayload>
export type EncounterPledgeZone = EncounterZoneEnvelope<'pledge', EncounterPledgeZonePayload>
export type EncounterVortexZone = EncounterZoneEnvelope<'vortex', EncounterVortexZonePayload>
export type EncounterSideConditionZone = EncounterZoneEnvelope<
  'side-condition',
  EncounterSideConditionZonePayload
>

/** Generalized battlefield state with no arbitrary payload or executable browser data. */
export type EncounterZone =
  | EncounterHazardZone
  | EncounterWeatherZone
  | EncounterTerrainZone
  | EncounterRoomZone
  | EncounterSmokeZone
  | EncounterBarrierZone
  | EncounterPledgeZone
  | EncounterVortexZone
  | EncounterSideConditionZone

export type EncounterZoneValidationCode =
  | 'invalid-encounter-zone'
  | 'unknown-zone-kind'
  | 'limit-exceeded'
  | 'duplicate-id'

export class EncounterZoneValidationError extends Error {
  readonly code: EncounterZoneValidationCode
  readonly path: string
  readonly detail: string

  constructor(code: EncounterZoneValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EncounterZoneValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>
type ParsedZoneCommon = Omit<
  EncounterZoneEnvelope<EncounterZoneKind, never>,
  'kind' | 'payload'
>

const ZONE_FIELDS = [
  'id',
  'kind',
  'source',
  'sideId',
  'geometry',
  'layer',
  'duration',
  'stacking',
  'hooks',
  'modifiers',
  'tags',
  'payload',
] as const
const OPERATION_SOURCE_FIELDS = ['kind', 'operationId', 'moveId', 'placementId'] as const
const LEGACY_SOURCE_FIELDS = ['kind', 'lane', 'key'] as const
const BATTLEFIELD_GEOMETRY_FIELDS = ['kind'] as const
const CELL_GEOMETRY_FIELDS = ['kind', 'cells'] as const
const PLACEMENT_GEOMETRY_FIELDS = ['kind', 'placementId'] as const
const SIDE_GEOMETRY_FIELDS = ['kind', 'sideId'] as const
const CELL_FIELDS = ['x', 'y', 'z'] as const
const STACKING_FIELDS = ['kind', 'maxLayers'] as const
const HOOKS_FIELDS = ['entry', 'exit'] as const
const HOOK_FIELDS = ['id', 'handlerId', 'oncePerMovement'] as const
const MODIFIERS_FIELDS = ['targeting', 'damage', 'movement'] as const
const MODIFIER_FIELDS = ['id', 'attribute', 'operation', 'value', 'reasonCode'] as const
const SINGLE_ID_PAYLOAD_FIELDS = Object.freeze({
  hazard: ['hazardId'],
  weather: ['weatherId'],
  terrain: ['terrainId'],
  smoke: ['smokeId'],
  barrier: ['barrierId'],
  pledge: ['pledgeId'],
  vortex: ['vortexId'],
  'side-condition': ['conditionId'],
} as const)
const LAYERED_PAYLOAD_FIELDS = ['familyId', 'charges', 'maxCharges'] as const
const ROOM_PAYLOAD_FIELDS = ['roomId', 'startsNextRound'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SIDE_ID_PATTERN = /^[a-z0-9-]+$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ZONE_KIND_SET = new Set<string>(ENCOUNTER_ZONE_KINDS)
const SOURCE_KIND_SET = new Set<string>(ENCOUNTER_ZONE_SOURCE_KINDS)
const LEGACY_LANE_SET = new Set<string>(ENCOUNTER_ZONE_LEGACY_LANES)
const GEOMETRY_KIND_SET = new Set<string>(ENCOUNTER_ZONE_GEOMETRY_KINDS)
const STACKING_KIND_SET = new Set<string>(ENCOUNTER_ZONE_STACKING_KINDS)
const MODIFIER_OPERATION_SET = new Set<string>(ENCOUNTER_ZONE_MODIFIER_OPERATIONS)
const TARGETING_ATTRIBUTE_SET = new Set<string>(ENCOUNTER_ZONE_TARGETING_ATTRIBUTES)
const DAMAGE_ATTRIBUTE_SET = new Set<string>(ENCOUNTER_ZONE_DAMAGE_ATTRIBUTES)
const MOVEMENT_ATTRIBUTE_SET = new Set<string>(ENCOUNTER_ZONE_MOVEMENT_ATTRIBUTES)

const fail = (
  code: EncounterZoneValidationCode,
  path: string,
  detail: string,
): never => {
  throw new EncounterZoneValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-zone', path, 'must be a plain object.')
  }
  return value
}

const assertExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail(
    'invalid-encounter-zone',
    path,
    `must contain exactly the supported fields (${details}).`,
  )
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  assertExactFields(record, fields, path)
  return record
}

const parseArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-encounter-zone', path, 'must be an array.')
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_ZONE_LIMITS.identifierChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail(
      'invalid-encounter-zone',
      path,
      `must be a lowercase stable identifier of at most ${ENCOUNTER_ZONE_LIMITS.identifierChars} characters.`,
    )
  }
  return value
}

const parseNullableStableId = (value: unknown, path: string): string | null => (
  value === null ? null : parseStableId(value, path)
)

const parseSideId = (value: unknown, path: string): EncounterSideId => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 64
    || value.trim() !== value
    || !SIDE_ID_PATTERN.test(value)
  ) {
    return fail(
      'invalid-encounter-zone',
      path,
      'must be a lowercase alphanumeric/hyphen encounter side ID.',
    )
  }
  return value
}

const parseEnum = <Value extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  path: string,
  description: string,
): Value => {
  if (typeof value !== 'string' || !values.has(value)) {
    return fail('invalid-encounter-zone', path, `must be ${description}.`)
  }
  return value as Value
}

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value)) {
    return fail('invalid-encounter-zone', path, 'must be a safe integer.')
  }
  const parsed = Number(value)
  if (parsed < minimum || parsed > maximum) {
    fail('limit-exceeded', path, `must be from ${minimum} through ${maximum}.`)
  }
  return parsed
}

const parseFiniteNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('invalid-encounter-zone', path, 'must be a finite number.')
  }
  if (Math.abs(value) > ENCOUNTER_ZONE_LIMITS.numericMagnitude) {
    fail(
      'limit-exceeded',
      path,
      `magnitude must not exceed ${ENCOUNTER_ZONE_LIMITS.numericMagnitude}.`,
    )
  }
  return value
}

const assertUnique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) {
    fail('duplicate-id', path, 'must not contain duplicate identities.')
  }
}

const parseStableIdList = (
  value: unknown,
  path: string,
  maximum: number,
): readonly string[] => {
  const ids = parseArray(value, path, maximum)
    .map((entry, index) => parseStableId(entry, `${path}[${index}]`))
  assertUnique(ids, path)
  return ids
}

/** Deterministic identity shared by a legacy adapter and its lazily migrated native copy. */
export const legacyEncounterZoneId = (
  lane: EncounterZoneLegacyLane,
  key: string,
): EncounterZoneId => `legacy.${lane}.${key}`

const parseSource = (value: unknown, path: string): EncounterZoneSource => {
  const source = parseRecord(value, path)
  const kind = parseEnum<EncounterZoneSourceKind>(
    source.kind,
    SOURCE_KIND_SET,
    `${path}.kind`,
    'operation or legacy-map',
  )
  if (kind === 'operation') {
    assertExactFields(source, OPERATION_SOURCE_FIELDS, path)
    return {
      kind,
      operationId: parseStableId(source.operationId, `${path}.operationId`),
      moveId: parseNullableStableId(source.moveId, `${path}.moveId`),
      placementId: parseNullableStableId(source.placementId, `${path}.placementId`),
    }
  }

  assertExactFields(source, LEGACY_SOURCE_FIELDS, path)
  return {
    kind,
    lane: parseEnum<EncounterZoneLegacyLane>(
      source.lane,
      LEGACY_LANE_SET,
      `${path}.lane`,
      'hazards, weather, terrain, or room',
    ),
    key: parseStableId(source.key, `${path}.key`),
  }
}

const parseCell = (value: unknown, path: string): EncounterZoneCell => {
  const cell = parseExactRecord(value, CELL_FIELDS, path)
  return {
    x: parseInteger(cell.x, `${path}.x`, 0, ENCOUNTER_ZONE_LIMITS.coordinate),
    y: parseInteger(cell.y, `${path}.y`, 0, ENCOUNTER_ZONE_LIMITS.coordinate),
    z: parseInteger(cell.z, `${path}.z`, 0, ENCOUNTER_ZONE_LIMITS.coordinate),
  }
}

const parseGeometry = (value: unknown, path: string): EncounterZoneGeometry => {
  const geometry = parseRecord(value, path)
  const kind = parseEnum<EncounterZoneGeometryKind>(
    geometry.kind,
    GEOMETRY_KIND_SET,
    `${path}.kind`,
    'battlefield, cells, placement, or side',
  )
  if (kind === 'battlefield') {
    assertExactFields(geometry, BATTLEFIELD_GEOMETRY_FIELDS, path)
    return { kind }
  }
  if (kind === 'cells') {
    assertExactFields(geometry, CELL_GEOMETRY_FIELDS, path)
    const cells = parseArray(geometry.cells, `${path}.cells`, ENCOUNTER_ZONE_LIMITS.cells)
      .map((entry, index) => parseCell(entry, `${path}.cells[${index}]`))
    if (cells.length === 0) {
      fail('invalid-encounter-zone', `${path}.cells`, 'must identify at least one cell.')
    }
    assertUnique(cells.map(cell => `${cell.x}:${cell.y}:${cell.z}`), `${path}.cells`)
    return { kind, cells }
  }
  if (kind === 'placement') {
    assertExactFields(geometry, PLACEMENT_GEOMETRY_FIELDS, path)
    return {
      kind,
      placementId: parseStableId(geometry.placementId, `${path}.placementId`),
    }
  }
  assertExactFields(geometry, SIDE_GEOMETRY_FIELDS, path)
  return { kind, sideId: parseSideId(geometry.sideId, `${path}.sideId`) }
}

const parseStacking = (
  value: unknown,
  path: string,
  layer: number,
): EncounterZoneStacking => {
  const stacking = parseExactRecord(value, STACKING_FIELDS, path)
  const kind = parseEnum<EncounterZoneStackingKind>(
    stacking.kind,
    STACKING_KIND_SET,
    `${path}.kind`,
    'replace, refresh, add-layer, or independent',
  )
  if (kind === 'add-layer') {
    const maxLayers = parseInteger(
      stacking.maxLayers,
      `${path}.maxLayers`,
      1,
      ENCOUNTER_ZONE_LIMITS.layer,
    )
    if (layer > maxLayers) {
      fail('invalid-encounter-zone', path, `layer ${layer} exceeds maxLayers ${maxLayers}.`)
    }
    return { kind, maxLayers }
  }
  if (stacking.maxLayers !== null) {
    fail('invalid-encounter-zone', `${path}.maxLayers`, 'must be null unless stacking adds layers.')
  }
  return { kind, maxLayers: null }
}

const parseHooks = (value: unknown, path: string): EncounterZoneHooks => {
  const hooks = parseExactRecord(value, HOOKS_FIELDS, path)
  const parseTiming = (timing: 'entry' | 'exit'): readonly EncounterZoneHook[] => (
    parseArray(
      hooks[timing],
      `${path}.${timing}`,
      ENCOUNTER_ZONE_LIMITS.hooksPerTiming,
    ).map((entry, index): EncounterZoneHook => {
      const hookPath = `${path}.${timing}[${index}]`
      const hook = parseExactRecord(entry, HOOK_FIELDS, hookPath)
      if (typeof hook.oncePerMovement !== 'boolean') {
        fail('invalid-encounter-zone', `${hookPath}.oncePerMovement`, 'must be a boolean.')
      }
      return {
        id: parseStableId(hook.id, `${hookPath}.id`),
        handlerId: parseStableId(hook.handlerId, `${hookPath}.handlerId`),
        oncePerMovement: hook.oncePerMovement as boolean,
      }
    })
  )
  const entry = parseTiming('entry')
  const exit = parseTiming('exit')
  assertUnique([...entry, ...exit].map(hook => hook.id), `${path}.id`)
  return { entry, exit }
}

type ModifierCategory = keyof EncounterZoneModifiers

const parseModifierList = (
  value: unknown,
  category: ModifierCategory,
  path: string,
): readonly (
  EncounterZoneTargetingModifier | EncounterZoneDamageModifier | EncounterZoneMovementModifier
)[] => {
  const attributeSet = category === 'targeting'
    ? TARGETING_ATTRIBUTE_SET
    : category === 'damage'
      ? DAMAGE_ATTRIBUTE_SET
      : MOVEMENT_ATTRIBUTE_SET
  const blockingAttribute = category === 'targeting'
    ? 'line-of-sight'
    : category === 'movement'
      ? 'traversal'
      : null

  const modifiers = parseArray(value, path, ENCOUNTER_ZONE_LIMITS.modifiersPerCategory)
    .map((entry, index) => {
      const modifierPath = `${path}[${index}]`
      const modifier = parseExactRecord(entry, MODIFIER_FIELDS, modifierPath)
      const attribute = parseEnum<string>(
        modifier.attribute,
        attributeSet,
        `${modifierPath}.attribute`,
        `a supported ${category} attribute`,
      )
      const operation = parseEnum<EncounterZoneModifierOperation>(
        modifier.operation,
        MODIFIER_OPERATION_SET,
        `${modifierPath}.operation`,
        'add, multiply, set, or block',
      )
      if (operation === 'block') {
        if (attribute !== blockingAttribute) {
          fail(
            'invalid-encounter-zone',
            `${modifierPath}.operation`,
            `${category} block is supported only for ${String(blockingAttribute)}.`,
          )
        }
        if (modifier.value !== null) {
          fail('invalid-encounter-zone', `${modifierPath}.value`, 'must be null for block modifiers.')
        }
      }
      else {
        if (attribute === blockingAttribute) {
          fail(
            'invalid-encounter-zone',
            `${modifierPath}.attribute`,
            `${attribute} supports only the block operation.`,
          )
        }
        parseFiniteNumber(modifier.value, `${modifierPath}.value`)
      }
      return {
        id: parseStableId(modifier.id, `${modifierPath}.id`),
        attribute,
        operation,
        value: operation === 'block'
          ? null
          : parseFiniteNumber(modifier.value, `${modifierPath}.value`),
        reasonCode: parseStableId(modifier.reasonCode, `${modifierPath}.reasonCode`),
      } as EncounterZoneTargetingModifier | EncounterZoneDamageModifier | EncounterZoneMovementModifier
    })
  assertUnique(modifiers.map(modifier => modifier.id), `${path}.id`)
  return modifiers
}

const parseModifiers = (value: unknown, path: string): EncounterZoneModifiers => {
  const modifiers = parseExactRecord(value, MODIFIERS_FIELDS, path)
  const targeting = parseModifierList(
    modifiers.targeting,
    'targeting',
    `${path}.targeting`,
  ) as readonly EncounterZoneTargetingModifier[]
  const damage = parseModifierList(
    modifiers.damage,
    'damage',
    `${path}.damage`,
  ) as readonly EncounterZoneDamageModifier[]
  const movement = parseModifierList(
    modifiers.movement,
    'movement',
    `${path}.movement`,
  ) as readonly EncounterZoneMovementModifier[]
  assertUnique(
    [...targeting, ...damage, ...movement].map(modifier => modifier.id),
    `${path}.id`,
  )
  return { targeting, damage, movement }
}

const parseSingleIdPayload = <Key extends string>(
  value: unknown,
  key: Key,
  path: string,
): Readonly<Record<Key, string>> => {
  const payload = parseExactRecord(value, [key], path)
  return { [key]: parseStableId(payload[key], `${path}.${key}`) } as Readonly<Record<Key, string>>
}

const parseLayeredPayload = <Key extends 'hazardId' | 'pledgeId'>(
  value: unknown,
  key: Key,
  path: string,
): Readonly<Record<Key, string>> & EncounterLayeredZonePayload => {
  const payload = parseRecord(value, path)
  const legacyFields = [key] as const
  const canonicalFields = [key, ...LAYERED_PAYLOAD_FIELDS] as const
  const isLegacy = Object.keys(payload).length === 1
    && Object.prototype.hasOwnProperty.call(payload, key)
  assertExactFields(payload, isLegacy ? legacyFields : canonicalFields, path)
  const effectId = parseStableId(payload[key], `${path}.${key}`)
  if (isLegacy) {
    return {
      [key]: effectId,
      familyId: effectId,
      charges: null,
      maxCharges: null,
    } as unknown as Readonly<Record<Key, string>> & EncounterLayeredZonePayload
  }

  const familyId = parseStableId(payload.familyId, `${path}.familyId`)
  const charges = payload.charges === null
    ? null
    : parseInteger(payload.charges, `${path}.charges`, 0, ENCOUNTER_ZONE_LIMITS.charges)
  const maxCharges = payload.maxCharges === null
    ? null
    : parseInteger(payload.maxCharges, `${path}.maxCharges`, 1, ENCOUNTER_ZONE_LIMITS.charges)
  if ((charges === null) !== (maxCharges === null)) {
    fail(
      'invalid-encounter-zone',
      path,
      'charges and maxCharges must both be null or both be integers.',
    )
  }
  if (charges !== null && maxCharges !== null && charges > maxCharges) {
    fail('invalid-encounter-zone', `${path}.charges`, 'cannot exceed maxCharges.')
  }
  return {
    [key]: effectId,
    familyId,
    charges,
    maxCharges,
  } as unknown as Readonly<Record<Key, string>> & EncounterLayeredZonePayload
}

const parsePayload = (
  kind: EncounterZoneKind,
  value: unknown,
  path: string,
): EncounterZonePayload => {
  if (kind === 'room') {
    const payload = parseExactRecord(value, ROOM_PAYLOAD_FIELDS, path)
    if (typeof payload.startsNextRound !== 'boolean') {
      fail('invalid-encounter-zone', `${path}.startsNextRound`, 'must be a boolean.')
    }
    return {
      roomId: parseStableId(payload.roomId, `${path}.roomId`),
      startsNextRound: payload.startsNextRound as boolean,
    }
  }
  if (kind === 'hazard') return parseLayeredPayload(value, 'hazardId', path)
  if (kind === 'pledge') return parseLayeredPayload(value, 'pledgeId', path)
  const key = SINGLE_ID_PAYLOAD_FIELDS[kind][0]
  return parseSingleIdPayload(value, key, path) as EncounterZonePayload
}

const assertGeometrySupportsKind = (
  kind: EncounterZoneKind,
  geometry: EncounterZoneGeometry,
  path: string,
): void => {
  const allowed: Readonly<Record<EncounterZoneKind, readonly EncounterZoneGeometryKind[]>> = {
    hazard: ['cells'],
    weather: ['battlefield'],
    terrain: ['battlefield', 'cells'],
    room: ['battlefield'],
    smoke: ['cells'],
    barrier: ['cells'],
    pledge: ['cells'],
    vortex: ['placement'],
    'side-condition': ['side'],
  }
  if (!allowed[kind].includes(geometry.kind)) {
    fail(
      'invalid-encounter-zone',
      path,
      `${kind} zones require ${allowed[kind].join(' or ')} geometry.`,
    )
  }
}

const zoneWithPayload = <Kind extends EncounterZoneKind, Payload>(
  common: ParsedZoneCommon,
  kind: Kind,
  payload: Payload,
): EncounterZoneEnvelope<Kind, Payload> => ({
  id: common.id,
  kind,
  source: common.source,
  sideId: common.sideId,
  geometry: common.geometry,
  layer: common.layer,
  duration: common.duration,
  stacking: common.stacking,
  hooks: common.hooks,
  modifiers: common.modifiers,
  tags: common.tags,
  payload,
})

/** Strictly parse and detach one generalized battlefield zone. */
export const parseEncounterZone = (
  value: unknown,
  path = 'encounterZone',
): EncounterZone => {
  const zone = parseExactRecord(value, ZONE_FIELDS, path)
  const rawKind = zone.kind
  if (typeof rawKind !== 'string' || !ZONE_KIND_SET.has(rawKind)) {
    fail('unknown-zone-kind', `${path}.kind`, 'must be a supported encounter zone kind.')
  }
  const kind = rawKind as EncounterZoneKind
  const id = parseStableId(zone.id, `${path}.id`)
  const source = parseSource(zone.source, `${path}.source`)
  if (source.kind === 'legacy-map') {
    const expectedId = legacyEncounterZoneId(source.lane, source.key)
    if (id !== expectedId) {
      fail(
        'invalid-encounter-zone',
        `${path}.id`,
        `must be ${expectedId} for its legacy map source.`,
      )
    }
  }
  else if (id.startsWith('legacy.')) {
    fail(
      'invalid-encounter-zone',
      `${path}.id`,
      'the legacy namespace is reserved for deterministic map-lane adapters.',
    )
  }

  const layer = parseInteger(zone.layer, `${path}.layer`, 1, ENCOUNTER_ZONE_LIMITS.layer)
  const geometry = parseGeometry(zone.geometry, `${path}.geometry`)
  assertGeometrySupportsKind(kind, geometry, `${path}.geometry`)
  let duration: EncounterZoneDuration
  try {
    duration = parseEncounterEffectDuration(zone.duration, `${path}.duration`)
  }
  catch (error) {
    if (error instanceof EncounterEffectValidationError) {
      fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-encounter-zone',
        error.path,
        error.detail,
      )
    }
    throw error
  }

  const sideId = zone.sideId === null
    ? null
    : parseSideId(zone.sideId, `${path}.sideId`)
  const hooks = parseHooks(zone.hooks, `${path}.hooks`)
  const modifiers = parseModifiers(zone.modifiers, `${path}.modifiers`)
  assertUnique(
    [
      ...hooks.entry.map(hook => hook.id),
      ...hooks.exit.map(hook => hook.id),
      ...modifiers.targeting.map(modifier => modifier.id),
      ...modifiers.damage.map(modifier => modifier.id),
      ...modifiers.movement.map(modifier => modifier.id),
    ],
    `${path}.componentIds`,
  )

  const common: ParsedZoneCommon = {
    id,
    source,
    sideId,
    geometry,
    layer,
    duration,
    stacking: parseStacking(zone.stacking, `${path}.stacking`, layer),
    hooks,
    modifiers,
    tags: parseStableIdList(zone.tags, `${path}.tags`, ENCOUNTER_ZONE_LIMITS.tags),
  }
  const payload = parsePayload(kind, zone.payload, `${path}.payload`)

  switch (kind) {
    case 'hazard': return zoneWithPayload(common, kind, payload as EncounterHazardZonePayload)
    case 'weather': return zoneWithPayload(common, kind, payload as EncounterWeatherZonePayload)
    case 'terrain': return zoneWithPayload(common, kind, payload as EncounterTerrainZonePayload)
    case 'room': return zoneWithPayload(common, kind, payload as EncounterRoomZonePayload)
    case 'smoke': return zoneWithPayload(common, kind, payload as EncounterSmokeZonePayload)
    case 'barrier': return zoneWithPayload(common, kind, payload as EncounterBarrierZonePayload)
    case 'pledge': return zoneWithPayload(common, kind, payload as EncounterPledgeZonePayload)
    case 'vortex': return zoneWithPayload(common, kind, payload as EncounterVortexZonePayload)
    case 'side-condition': return zoneWithPayload(
      common,
      kind,
      payload as EncounterSideConditionZonePayload,
    )
  }
}

/** Parse a bounded zone collection and reject duplicate durable identities. */
export const parseEncounterZones = (
  value: unknown,
  path = 'encounterZones',
): readonly EncounterZone[] => {
  const zones = parseArray(value, path, ENCOUNTER_ZONE_LIMITS.count)
    .map((zone, index) => parseEncounterZone(zone, `${path}[${index}]`))
  assertUnique(zones.map(zone => zone.id), `${path}.id`)
  return zones
}
