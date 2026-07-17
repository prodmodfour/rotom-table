import type { EncounterSideId } from './encounterState'

/** Closed storage-level effect kinds. New mechanic families must add a typed payload here. */
export const ENCOUNTER_EFFECT_KINDS = [
  'condition',
  'numeric-modifier',
  'capability',
  'item-suppression',
  'move-list-overlay',
] as const

export const ENCOUNTER_EFFECT_DURATION_KINDS = [
  'turns',
  'rounds',
  'scene',
  'until-triggered',
  'permanent',
] as const

export const ENCOUNTER_EFFECT_TURN_SUBJECTS = ['source', 'target'] as const
export const ENCOUNTER_EFFECT_BOUNDARIES = ['start', 'end'] as const
export const ENCOUNTER_EFFECT_STACK_POLICY_KINDS = [
  'replace',
  'refresh',
  'add-stack',
  'independent-instance',
] as const
export const ENCOUNTER_EFFECT_CHARGE_POLICY_KINDS = [
  'none',
  'consume-on-trigger',
] as const

export const ENCOUNTER_EFFECT_CONDITION_ACTIONS = [
  'apply',
  'prevent',
  'suppress',
] as const

/** Resolved game-event boundary for a source-linked condition save. */
export const ENCOUNTER_EFFECT_CONDITION_SAVE_TIMINGS = [
  'start-turn',
  'end-turn',
] as const

export const ENCOUNTER_EFFECT_NUMERIC_ATTRIBUTES = [
  'accuracy',
  'evasion',
  'damage-base',
  'damage',
  'damage-reduction',
  'initiative',
  'movement',
] as const

export const ENCOUNTER_EFFECT_NUMERIC_OPERATIONS = ['add', 'multiply', 'set'] as const
export const ENCOUNTER_EFFECT_ROUNDING_POLICIES = ['none', 'floor', 'round', 'ceil'] as const
export const ENCOUNTER_EFFECT_CAPABILITY_ACTIONS = ['grant', 'suppress'] as const
export const ENCOUNTER_EFFECT_ITEM_SUPPRESSION_SCOPES = [
  'all-equipped',
  'item-bindings',
] as const
export const ENCOUNTER_EFFECT_MOVE_LIST_ACTIONS = [
  'add',
  'replace',
  'disable',
  'restrict',
] as const
export const ENCOUNTER_EFFECT_DISPEL_POLICIES = ['none', 'matching-tags'] as const
/**
 * Switch behavior is explicit per durable effect. Retained effects keep their
 * existing identity, expiring effects leave with a recalled source/recipient,
 * and Baton Pass effects rebind every reference to the selected replacement.
 */
export const ENCOUNTER_EFFECT_TRANSFER_POLICIES = [
  'retain',
  'expire',
  'baton-pass',
] as const

export const ENCOUNTER_EFFECT_LIMITS = Object.freeze({
  count: 256,
  identifierChars: 160,
  affectedPlacements: 64,
  affectedSides: 32,
  affectedCells: 256,
  tags: 32,
  suppressionSources: 32,
  moveListMoves: 64,
  canonicalMoveChars: 160,
  stacks: 64,
  charges: 10_000,
  round: 1_000_000,
  turn: 1_000_000,
  coordinate: 1_000_000,
  numericMagnitude: 1_000_000,
})

export type EncounterEffectId = string
export type EncounterEffectKind = (typeof ENCOUNTER_EFFECT_KINDS)[number]
export type EncounterEffectDurationKind = (typeof ENCOUNTER_EFFECT_DURATION_KINDS)[number]
export type EncounterEffectTurnSubject = (typeof ENCOUNTER_EFFECT_TURN_SUBJECTS)[number]
export type EncounterEffectBoundary = (typeof ENCOUNTER_EFFECT_BOUNDARIES)[number]
export type EncounterEffectStackPolicyKind = (typeof ENCOUNTER_EFFECT_STACK_POLICY_KINDS)[number]
export type EncounterEffectChargePolicyKind = (typeof ENCOUNTER_EFFECT_CHARGE_POLICY_KINDS)[number]
export type EncounterEffectConditionAction = (typeof ENCOUNTER_EFFECT_CONDITION_ACTIONS)[number]
export type EncounterEffectConditionSaveTiming =
  (typeof ENCOUNTER_EFFECT_CONDITION_SAVE_TIMINGS)[number]
export type EncounterEffectNumericAttribute = (typeof ENCOUNTER_EFFECT_NUMERIC_ATTRIBUTES)[number]
export type EncounterEffectNumericOperation = (typeof ENCOUNTER_EFFECT_NUMERIC_OPERATIONS)[number]
export type EncounterEffectRoundingPolicy = (typeof ENCOUNTER_EFFECT_ROUNDING_POLICIES)[number]
export type EncounterEffectCapabilityAction = (typeof ENCOUNTER_EFFECT_CAPABILITY_ACTIONS)[number]
export type EncounterEffectItemSuppressionScope =
  (typeof ENCOUNTER_EFFECT_ITEM_SUPPRESSION_SCOPES)[number]
export type EncounterEffectMoveListAction =
  (typeof ENCOUNTER_EFFECT_MOVE_LIST_ACTIONS)[number]
export type EncounterEffectDispelPolicy = (typeof ENCOUNTER_EFFECT_DISPEL_POLICIES)[number]
export type EncounterEffectTransferPolicy =
  (typeof ENCOUNTER_EFFECT_TRANSFER_POLICIES)[number]

/** Every effect is attributable to the accepted operation, reviewed move, and source placement. */
export interface EncounterEffectSource {
  readonly operationId: string
  readonly moveId: string
  readonly placementId: string
}

export interface EncounterEffectCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Explicit recipients replace opaque effect metadata and ownership inference. */
export interface EncounterEffectAffected {
  readonly placementIds: readonly string[]
  readonly sideIds: readonly EncounterSideId[]
  readonly cells: readonly EncounterEffectCell[]
}

export type EncounterEffectDuration =
  | {
      readonly kind: 'turns'
      /** Whose authoritative turn advances this duration. */
      readonly subject: EncounterEffectTurnSubject
      readonly boundary: EncounterEffectBoundary
      readonly remaining: number
    }
  | {
      readonly kind: 'rounds'
      readonly boundary: EncounterEffectBoundary
      readonly remaining: number
    }
  | {
      /** Scene effects expire only on the authoritative scene-end event. */
      readonly kind: 'scene'
      readonly remaining: null
    }
  | {
      /** Trigger selection is server-owned and identifies the exact effect instance. */
      readonly kind: 'until-triggered'
      readonly remaining: null
    }
  | {
      /** No timing event expires this effect; an explicit removal still may. */
      readonly kind: 'permanent'
      readonly remaining: null
    }

export type EncounterEffectStackPolicy =
  | {
      readonly kind: Exclude<EncounterEffectStackPolicyKind, 'add-stack'>
      readonly maxStacks: null
    }
  | {
      readonly kind: 'add-stack'
      readonly maxStacks: number
    }

export type EncounterEffectChargePolicy =
  | {
      readonly kind: 'none'
      readonly amount: null
    }
  | {
      readonly kind: 'consume-on-trigger'
      /** Charges consumed by one authoritative trigger event. */
      readonly amount: number
    }

export interface EncounterEffectDispelMetadata {
  /** `none` excludes ordinary dispels; lifecycle and audited correction may still remove the effect. */
  readonly policy: EncounterEffectDispelPolicy
  /** Stable mechanic tags matched by reviewed dispel operations. */
  readonly tags: readonly string[]
}

export interface EncounterEffectSuppressionSource {
  readonly effectId: EncounterEffectId
  readonly reasonCode: string
}

export interface EncounterEffectSuppressionMetadata {
  /** An empty list means active. Sources are effect identities, never free-form state patches. */
  readonly sources: readonly EncounterEffectSuppressionSource[]
}

export interface EncounterConditionEffectPayload {
  readonly conditionId: string
  readonly action: EncounterEffectConditionAction
  /** Null means this effect has no save window; canonical timing is resolved before storage. */
  readonly saveTiming?: EncounterEffectConditionSaveTiming | null
}

export interface EncounterNumericModifierEffectPayload {
  readonly attribute: EncounterEffectNumericAttribute
  readonly operation: EncounterEffectNumericOperation
  readonly value: number
  readonly rounding: EncounterEffectRoundingPolicy
}

export interface EncounterCapabilityEffectPayload {
  readonly capabilityId: string
  readonly action: EncounterEffectCapabilityAction
  /** Optional bounded value for valued capabilities such as temporary movement speeds. */
  readonly value?: number
}

/** Durable item-use/benefit suppression without exposing private owner identities. */
export interface EncounterItemSuppressionEffectPayload {
  /** Stable reviewed family used by replace-by-source item effects. */
  readonly familyId: string
  readonly scope: EncounterEffectItemSuppressionScope
  /** Opaque item bindings are required only for item-bindings scope. */
  readonly itemBindingIds: readonly string[]
  readonly blocksUse: boolean
  readonly blocksBenefit: boolean
}

export interface EncounterMoveListAddEffectPayload {
  readonly action: 'add'
  /** Canonical catalog identity added to the affected move list. */
  readonly canonicalMoveId: string
  /** Exact reviewed runtime definition copied when this overlay was created. */
  readonly copiedSpecHash: string
}

export interface EncounterMoveListReplaceEffectPayload {
  readonly action: 'replace'
  /** Existing move identity removed for the lifetime of this effect. */
  readonly replacedCanonicalMoveId: string
  /** Canonical catalog identity projected in the removed move's position. */
  readonly canonicalMoveId: string
  /** Exact reviewed runtime definition copied when this overlay was created. */
  readonly copiedSpecHash: string
}

export interface EncounterMoveListDisableEffectPayload {
  readonly action: 'disable'
  /** Moves that remain visible but cannot be declared. */
  readonly canonicalMoveIds: readonly string[]
}

export interface EncounterMoveListRestrictEffectPayload {
  readonly action: 'restrict'
  /** Exclusive allow-list; every other projected move remains visible but unavailable. */
  readonly canonicalMoveIds: readonly string[]
}

export type EncounterMoveListOverlayEffectPayload =
  | EncounterMoveListAddEffectPayload
  | EncounterMoveListReplaceEffectPayload
  | EncounterMoveListDisableEffectPayload
  | EncounterMoveListRestrictEffectPayload

export type EncounterEffectPayload =
  | EncounterConditionEffectPayload
  | EncounterNumericModifierEffectPayload
  | EncounterCapabilityEffectPayload
  | EncounterItemSuppressionEffectPayload
  | EncounterMoveListOverlayEffectPayload

interface EncounterEffectDefinitionEnvelope<
  Kind extends EncounterEffectKind,
  Payload,
> {
  readonly kind: Kind
  readonly duration: EncounterEffectDuration
  readonly stacks: number
  readonly charges: number | null
  readonly stackPolicy: EncounterEffectStackPolicy
  readonly chargePolicy: EncounterEffectChargePolicy
  readonly tags: readonly string[]
  readonly payload: Payload
  readonly dispel: EncounterEffectDispelMetadata
  /** Omitted legacy data canonicalizes to retain at the switch-planning boundary. */
  readonly transferPolicy?: EncounterEffectTransferPolicy
}

export type EncounterConditionEffectDefinition = EncounterEffectDefinitionEnvelope<
  'condition',
  EncounterConditionEffectPayload
>

export type EncounterNumericModifierEffectDefinition = EncounterEffectDefinitionEnvelope<
  'numeric-modifier',
  EncounterNumericModifierEffectPayload
>

export type EncounterCapabilityEffectDefinition = EncounterEffectDefinitionEnvelope<
  'capability',
  EncounterCapabilityEffectPayload
>

export type EncounterItemSuppressionEffectDefinition = EncounterEffectDefinitionEnvelope<
  'item-suppression',
  EncounterItemSuppressionEffectPayload
>

export type EncounterMoveListOverlayEffectDefinition = EncounterEffectDefinitionEnvelope<
  'move-list-overlay',
  EncounterMoveListOverlayEffectPayload
>

/** Server-owned operations may request only this typed, context-free effect definition. */
export type EncounterEffectDefinition =
  | EncounterConditionEffectDefinition
  | EncounterNumericModifierEffectDefinition
  | EncounterCapabilityEffectDefinition
  | EncounterItemSuppressionEffectDefinition
  | EncounterMoveListOverlayEffectDefinition

interface EncounterEffectEnvelope<
  Kind extends EncounterEffectKind,
  Payload,
> {
  readonly id: EncounterEffectId
  readonly kind: Kind
  readonly source: EncounterEffectSource
  readonly affected: EncounterEffectAffected
  /** One-based authoritative encounter round at creation. */
  readonly createdRound: number
  /** Zero-based authoritative turn sequence within the encounter. */
  readonly createdTurn: number
  readonly duration: EncounterEffectDuration
  readonly stacks: number
  /** Null means the effect is not charge-based; zero is retained until lifecycle cleanup. */
  readonly charges: number | null
  readonly stackPolicy: EncounterEffectStackPolicy
  readonly chargePolicy: EncounterEffectChargePolicy
  readonly tags: readonly string[]
  readonly payload: Payload
  readonly dispel: EncounterEffectDispelMetadata
  /** Omitted legacy data canonicalizes to retain at the switch-planning boundary. */
  readonly transferPolicy?: EncounterEffectTransferPolicy
  readonly suppression: EncounterEffectSuppressionMetadata
}

export type EncounterConditionEffect = EncounterEffectEnvelope<
  'condition',
  EncounterConditionEffectPayload
>

export type EncounterNumericModifierEffect = EncounterEffectEnvelope<
  'numeric-modifier',
  EncounterNumericModifierEffectPayload
>

export type EncounterCapabilityEffect = EncounterEffectEnvelope<
  'capability',
  EncounterCapabilityEffectPayload
>

export type EncounterItemSuppressionEffect = EncounterEffectEnvelope<
  'item-suppression',
  EncounterItemSuppressionEffectPayload
>

export type EncounterMoveListOverlayEffect = EncounterEffectEnvelope<
  'move-list-overlay',
  EncounterMoveListOverlayEffectPayload
>

/**
 * Durable encounter effects are a discriminated union. The `kind` selects one
 * exact payload shape; arbitrary metadata objects are never accepted.
 */
export type EncounterEffect =
  | EncounterConditionEffect
  | EncounterNumericModifierEffect
  | EncounterCapabilityEffect
  | EncounterItemSuppressionEffect
  | EncounterMoveListOverlayEffect

export type EncounterEffectValidationCode =
  | 'invalid-encounter-effect'
  | 'unknown-effect-kind'
  | 'limit-exceeded'
  | 'duplicate-id'

export class EncounterEffectValidationError extends Error {
  readonly code: EncounterEffectValidationCode
  readonly path: string
  readonly detail: string

  constructor(code: EncounterEffectValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EncounterEffectValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>

const EFFECT_DEFINITION_FIELDS = [
  'kind',
  'duration',
  'stacks',
  'charges',
  'stackPolicy',
  'chargePolicy',
  'tags',
  'payload',
  'dispel',
  'transferPolicy',
] as const
const LEGACY_EFFECT_DEFINITION_FIELDS = [
  'kind',
  'duration',
  'stacks',
  'charges',
  'tags',
  'payload',
  'dispel',
] as const
const EFFECT_FIELDS = [
  'id',
  'kind',
  'source',
  'affected',
  'createdRound',
  'createdTurn',
  'duration',
  'stacks',
  'charges',
  'stackPolicy',
  'chargePolicy',
  'tags',
  'payload',
  'dispel',
  'transferPolicy',
  'suppression',
] as const
const LEGACY_EFFECT_FIELDS = [
  'id',
  'kind',
  'source',
  'affected',
  'createdRound',
  'createdTurn',
  'duration',
  'stacks',
  'charges',
  'tags',
  'payload',
  'dispel',
  'suppression',
] as const
const SOURCE_FIELDS = ['operationId', 'moveId', 'placementId'] as const
const AFFECTED_FIELDS = ['placementIds', 'sideIds', 'cells'] as const
const CELL_FIELDS = ['x', 'y', 'z'] as const
const DURATION_FIELDS = ['kind', 'subject', 'boundary', 'remaining'] as const
const DURATION_REQUIRED_FIELDS = ['kind', 'remaining'] as const
const STACK_POLICY_FIELDS = ['kind', 'maxStacks'] as const
const CHARGE_POLICY_FIELDS = ['kind', 'amount'] as const
const DISPEL_FIELDS = ['policy', 'tags'] as const
const SUPPRESSION_FIELDS = ['sources'] as const
const SUPPRESSION_SOURCE_FIELDS = ['effectId', 'reasonCode'] as const
const CONDITION_PAYLOAD_FIELDS = ['conditionId', 'action', 'saveTiming'] as const
const LEGACY_CONDITION_PAYLOAD_FIELDS = ['conditionId', 'action'] as const
const NUMERIC_MODIFIER_PAYLOAD_FIELDS = ['attribute', 'operation', 'value', 'rounding'] as const
const CAPABILITY_PAYLOAD_FIELDS = ['capabilityId', 'action', 'value'] as const
const CAPABILITY_PAYLOAD_REQUIRED_FIELDS = ['capabilityId', 'action'] as const
const ITEM_SUPPRESSION_PAYLOAD_FIELDS = [
  'familyId',
  'scope',
  'itemBindingIds',
  'blocksUse',
  'blocksBenefit',
] as const
const MOVE_LIST_ADD_PAYLOAD_FIELDS = ['action', 'canonicalMoveId', 'copiedSpecHash'] as const
const MOVE_LIST_REPLACE_PAYLOAD_FIELDS = [
  'action',
  'replacedCanonicalMoveId',
  'canonicalMoveId',
  'copiedSpecHash',
] as const
const MOVE_LIST_FILTER_PAYLOAD_FIELDS = ['action', 'canonicalMoveIds'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA_256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const EFFECT_KIND_SET = new Set<string>(ENCOUNTER_EFFECT_KINDS)
const DURATION_KIND_SET = new Set<string>(ENCOUNTER_EFFECT_DURATION_KINDS)
const TURN_SUBJECT_SET = new Set<string>(ENCOUNTER_EFFECT_TURN_SUBJECTS)
const BOUNDARY_SET = new Set<string>(ENCOUNTER_EFFECT_BOUNDARIES)
const STACK_POLICY_KIND_SET = new Set<string>(ENCOUNTER_EFFECT_STACK_POLICY_KINDS)
const CHARGE_POLICY_KIND_SET = new Set<string>(ENCOUNTER_EFFECT_CHARGE_POLICY_KINDS)
const CONDITION_ACTION_SET = new Set<string>(ENCOUNTER_EFFECT_CONDITION_ACTIONS)
const CONDITION_SAVE_TIMING_SET = new Set<string>(ENCOUNTER_EFFECT_CONDITION_SAVE_TIMINGS)
const NUMERIC_ATTRIBUTE_SET = new Set<string>(ENCOUNTER_EFFECT_NUMERIC_ATTRIBUTES)
const NUMERIC_OPERATION_SET = new Set<string>(ENCOUNTER_EFFECT_NUMERIC_OPERATIONS)
const ROUNDING_POLICY_SET = new Set<string>(ENCOUNTER_EFFECT_ROUNDING_POLICIES)
const CAPABILITY_ACTION_SET = new Set<string>(ENCOUNTER_EFFECT_CAPABILITY_ACTIONS)
const ITEM_SUPPRESSION_SCOPE_SET = new Set<string>(
  ENCOUNTER_EFFECT_ITEM_SUPPRESSION_SCOPES,
)
const MOVE_LIST_ACTION_SET = new Set<string>(ENCOUNTER_EFFECT_MOVE_LIST_ACTIONS)
const DISPEL_POLICY_SET = new Set<string>(ENCOUNTER_EFFECT_DISPEL_POLICIES)
const TRANSFER_POLICY_SET = new Set<string>(ENCOUNTER_EFFECT_TRANSFER_POLICIES)

const fail = (
  code: EncounterEffectValidationCode,
  path: string,
  detail: string,
): never => {
  throw new EncounterEffectValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-effect', path, 'must be a plain object.')
  }
  return value
}

const assertExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
  requiredFields: readonly string[] = fields,
): void => {
  const expected = new Set(fields)
  const missing = requiredFields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return

  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail('invalid-encounter-effect', path, `must contain exactly the supported fields (${details}).`)
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
  requiredFields: readonly string[] = fields,
): UnknownRecord => {
  const record = parseRecord(value, path)
  assertExactFields(record, fields, path, requiredFields)
  return record
}

const parseStableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_EFFECT_LIMITS.identifierChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail(
      'invalid-encounter-effect',
      path,
      `must be a lowercase stable identifier of at most ${ENCOUNTER_EFFECT_LIMITS.identifierChars} characters.`,
    )
  }
  return value
}

const parseCanonicalMoveId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_EFFECT_LIMITS.canonicalMoveChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-encounter-effect',
      path,
      `must be a trimmed canonical move identity of at most ${ENCOUNTER_EFFECT_LIMITS.canonicalMoveChars} characters.`,
    )
  }
  return value
}

const parseCopiedSpecHash = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) {
    return fail('invalid-encounter-effect', path, 'must be a lowercase SHA-256 hash.')
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
    return fail('invalid-encounter-effect', path, `must be ${description}.`)
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
    return fail('invalid-encounter-effect', path, 'must be a safe integer.')
  }
  const parsed = Number(value)
  if (parsed < minimum || parsed > maximum) {
    fail('limit-exceeded', path, `must be from ${minimum} through ${maximum}.`)
  }
  return parsed
}

const parseFiniteNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('invalid-encounter-effect', path, 'must be a finite number.')
  }
  if (Math.abs(value) > ENCOUNTER_EFFECT_LIMITS.numericMagnitude) {
    fail(
      'limit-exceeded',
      path,
      `magnitude must not exceed ${ENCOUNTER_EFFECT_LIMITS.numericMagnitude}.`,
    )
  }
  return value
}

const parseArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-encounter-effect', path, 'must be an array.')
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  }
  return value
}

const assertUnique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) {
    fail('duplicate-id', path, 'must not contain duplicate identifiers.')
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

const parseCanonicalMoveIdList = (
  value: unknown,
  path: string,
): readonly string[] => {
  const ids = parseArray(value, path, ENCOUNTER_EFFECT_LIMITS.moveListMoves)
    .map((entry, index) => parseCanonicalMoveId(entry, `${path}[${index}]`))
  if (ids.length === 0) {
    fail('invalid-encounter-effect', path, 'must contain at least one canonical move identity.')
  }
  const normalized = ids.map(id => id.toLowerCase())
  assertUnique(normalized, path)
  return ids
}

const parseSource = (value: unknown, path: string): EncounterEffectSource => {
  const source = parseExactRecord(value, SOURCE_FIELDS, path)
  return {
    operationId: parseStableId(source.operationId, `${path}.operationId`),
    moveId: parseStableId(source.moveId, `${path}.moveId`),
    placementId: parseStableId(source.placementId, `${path}.placementId`),
  }
}

const parseCells = (value: unknown, path: string): readonly EncounterEffectCell[] => {
  const cells = parseArray(value, path, ENCOUNTER_EFFECT_LIMITS.affectedCells)
    .map((entry, index): EncounterEffectCell => {
      const cellPath = `${path}[${index}]`
      const cell = parseExactRecord(entry, CELL_FIELDS, cellPath)
      return {
        x: parseInteger(cell.x, `${cellPath}.x`, 0, ENCOUNTER_EFFECT_LIMITS.coordinate),
        y: parseInteger(cell.y, `${cellPath}.y`, 0, ENCOUNTER_EFFECT_LIMITS.coordinate),
        z: parseInteger(cell.z, `${cellPath}.z`, 0, ENCOUNTER_EFFECT_LIMITS.coordinate),
      }
    })
  const keys = cells.map(cell => `${cell.x}:${cell.y}:${cell.z}`)
  if (new Set(keys).size !== keys.length) {
    fail('duplicate-id', path, 'must not contain duplicate cells.')
  }
  return cells
}

const parseAffected = (value: unknown, path: string): EncounterEffectAffected => {
  const affected = parseExactRecord(value, AFFECTED_FIELDS, path)
  const placementIds = parseStableIdList(
    affected.placementIds,
    `${path}.placementIds`,
    ENCOUNTER_EFFECT_LIMITS.affectedPlacements,
  )
  const sideIds = parseStableIdList(
    affected.sideIds,
    `${path}.sideIds`,
    ENCOUNTER_EFFECT_LIMITS.affectedSides,
  ) as readonly EncounterSideId[]
  const cells = parseCells(affected.cells, `${path}.cells`)
  if (placementIds.length === 0 && sideIds.length === 0 && cells.length === 0) {
    fail(
      'invalid-encounter-effect',
      path,
      'must identify at least one affected placement, side, or cell.',
    )
  }
  return { placementIds, sideIds, cells }
}

export const parseEncounterEffectDuration = (
  value: unknown,
  path = 'encounterEffect.duration',
): EncounterEffectDuration => {
  const duration = parseExactRecord(value, DURATION_FIELDS, path, DURATION_REQUIRED_FIELDS)
  const kind = parseEnum<EncounterEffectDurationKind>(
    duration.kind,
    DURATION_KIND_SET,
    `${path}.kind`,
    'turns, rounds, scene, until-triggered, or permanent',
  )
  const remaining = kind === 'turns' || kind === 'rounds'
    ? parseInteger(
        duration.remaining,
        `${path}.remaining`,
        1,
        ENCOUNTER_EFFECT_LIMITS.turn,
      )
    : null

  if (kind === 'turns') {
    return {
      kind,
      subject: duration.subject === undefined
        ? 'target'
        : parseEnum<EncounterEffectTurnSubject>(
            duration.subject,
            TURN_SUBJECT_SET,
            `${path}.subject`,
            'source or target',
          ),
      boundary: duration.boundary === undefined
        ? 'end'
        : parseEnum<EncounterEffectBoundary>(
            duration.boundary,
            BOUNDARY_SET,
            `${path}.boundary`,
            'start or end',
          ),
      remaining: remaining!,
    }
  }

  if (kind === 'rounds') {
    if (duration.subject !== undefined) {
      fail('invalid-encounter-effect', `${path}.subject`, 'is supported only for turn durations.')
    }
    return {
      kind,
      boundary: duration.boundary === undefined
        ? 'end'
        : parseEnum<EncounterEffectBoundary>(
            duration.boundary,
            BOUNDARY_SET,
            `${path}.boundary`,
            'start or end',
          ),
      remaining: remaining!,
    }
  }

  if (duration.subject !== undefined || duration.boundary !== undefined) {
    fail(
      'invalid-encounter-effect',
      path,
      'scene, until-triggered, and permanent durations cannot declare turn or round boundaries.',
    )
  }
  if (duration.remaining !== null) {
    fail(
      'invalid-encounter-effect',
      `${path}.remaining`,
      'must be null for scene, until-triggered, and permanent durations.',
    )
  }
  return { kind, remaining: null }
}

export const parseEncounterEffectStackPolicy = (
  value: unknown,
  path = 'encounterEffect.stackPolicy',
  stacks = 1,
): EncounterEffectStackPolicy => {
  if (value === undefined) return { kind: 'independent-instance', maxStacks: null }

  const policy = parseExactRecord(value, STACK_POLICY_FIELDS, path)
  const kind = parseEnum<EncounterEffectStackPolicyKind>(
    policy.kind,
    STACK_POLICY_KIND_SET,
    `${path}.kind`,
    'replace, refresh, add-stack, or independent-instance',
  )
  if (kind === 'add-stack') {
    const maxStacks = parseInteger(
      policy.maxStacks,
      `${path}.maxStacks`,
      1,
      ENCOUNTER_EFFECT_LIMITS.stacks,
    )
    if (stacks > maxStacks) {
      fail('invalid-encounter-effect', path, `current stacks ${stacks} exceed maxStacks ${maxStacks}.`)
    }
    return { kind, maxStacks }
  }
  if (policy.maxStacks !== null) {
    fail('invalid-encounter-effect', `${path}.maxStacks`, 'must be null unless policy is add-stack.')
  }
  return { kind, maxStacks: null }
}

const parseChargePolicy = (
  value: unknown,
  path: string,
  charges: number | null,
): EncounterEffectChargePolicy => {
  if (value === undefined) {
    return charges === null
      ? { kind: 'none', amount: null }
      : { kind: 'consume-on-trigger', amount: 1 }
  }

  const policy = parseExactRecord(value, CHARGE_POLICY_FIELDS, path)
  const kind = parseEnum<EncounterEffectChargePolicyKind>(
    policy.kind,
    CHARGE_POLICY_KIND_SET,
    `${path}.kind`,
    'none or consume-on-trigger',
  )
  if (kind === 'none') {
    if (policy.amount !== null) {
      fail('invalid-encounter-effect', `${path}.amount`, 'must be null when charge policy is none.')
    }
    if (charges !== null) {
      fail('invalid-encounter-effect', path, 'requires charges to be null when charge policy is none.')
    }
    return { kind, amount: null }
  }
  if (charges === null) {
    fail('invalid-encounter-effect', path, 'requires a finite charge count for consume-on-trigger.')
  }
  return {
    kind,
    amount: parseInteger(policy.amount, `${path}.amount`, 1, ENCOUNTER_EFFECT_LIMITS.charges),
  }
}

export const parseEncounterEffectTransferPolicy = (
  value: unknown,
  path = 'encounterEffect.transferPolicy',
): EncounterEffectTransferPolicy => parseEnum<EncounterEffectTransferPolicy>(
  value,
  TRANSFER_POLICY_SET,
  path,
  'retain, expire, or baton-pass',
)

const parseDispel = (value: unknown, path: string): EncounterEffectDispelMetadata => {
  const dispel = parseExactRecord(value, DISPEL_FIELDS, path)
  const policy = parseEnum<EncounterEffectDispelPolicy>(
    dispel.policy,
    DISPEL_POLICY_SET,
    `${path}.policy`,
    'none or matching-tags',
  )
  const tags = parseStableIdList(dispel.tags, `${path}.tags`, ENCOUNTER_EFFECT_LIMITS.tags)
  if (policy === 'none' && tags.length > 0) {
    fail('invalid-encounter-effect', `${path}.tags`, 'must be empty when dispel policy is none.')
  }
  if (policy === 'matching-tags' && tags.length === 0) {
    fail('invalid-encounter-effect', `${path}.tags`, 'must not be empty for matching-tags dispel policy.')
  }
  return { policy, tags }
}

const parseSuppression = (
  value: unknown,
  path: string,
): EncounterEffectSuppressionMetadata => {
  const suppression = parseExactRecord(value, SUPPRESSION_FIELDS, path)
  const sources = parseArray(
    suppression.sources,
    `${path}.sources`,
    ENCOUNTER_EFFECT_LIMITS.suppressionSources,
  ).map((entry, index): EncounterEffectSuppressionSource => {
    const sourcePath = `${path}.sources[${index}]`
    const source = parseExactRecord(entry, SUPPRESSION_SOURCE_FIELDS, sourcePath)
    return {
      effectId: parseStableId(source.effectId, `${sourcePath}.effectId`),
      reasonCode: parseStableId(source.reasonCode, `${sourcePath}.reasonCode`),
    }
  })
  assertUnique(sources.map(source => source.effectId), `${path}.sources.effectId`)
  return { sources }
}

const parseConditionPayload = (
  value: unknown,
  path: string,
): EncounterConditionEffectPayload => {
  const payload = parseExactRecord(
    value,
    CONDITION_PAYLOAD_FIELDS,
    path,
    LEGACY_CONDITION_PAYLOAD_FIELDS,
  )
  const action = parseEnum<EncounterEffectConditionAction>(
    payload.action,
    CONDITION_ACTION_SET,
    `${path}.action`,
    'apply, prevent, or suppress',
  )
  const saveTiming = payload.saveTiming === undefined || payload.saveTiming === null
    ? null
    : parseEnum<EncounterEffectConditionSaveTiming>(
        payload.saveTiming,
        CONDITION_SAVE_TIMING_SET,
        `${path}.saveTiming`,
        'start-turn, end-turn, or null',
      )
  if (action !== 'apply' && saveTiming !== null) {
    fail(
      'invalid-encounter-effect',
      `${path}.saveTiming`,
      'must be null for condition prevention and suppression effects.',
    )
  }
  return {
    conditionId: parseStableId(payload.conditionId, `${path}.conditionId`),
    action,
    ...(payload.saveTiming === undefined ? {} : { saveTiming }),
  }
}

const parseNumericModifierPayload = (
  value: unknown,
  path: string,
): EncounterNumericModifierEffectPayload => {
  const payload = parseExactRecord(value, NUMERIC_MODIFIER_PAYLOAD_FIELDS, path)
  return {
    attribute: parseEnum<EncounterEffectNumericAttribute>(
      payload.attribute,
      NUMERIC_ATTRIBUTE_SET,
      `${path}.attribute`,
      'a supported numeric attribute',
    ),
    operation: parseEnum<EncounterEffectNumericOperation>(
      payload.operation,
      NUMERIC_OPERATION_SET,
      `${path}.operation`,
      'add, multiply, or set',
    ),
    value: parseFiniteNumber(payload.value, `${path}.value`),
    rounding: parseEnum<EncounterEffectRoundingPolicy>(
      payload.rounding,
      ROUNDING_POLICY_SET,
      `${path}.rounding`,
      'none, floor, round, or ceil',
    ),
  }
}

const parseCapabilityPayload = (
  value: unknown,
  path: string,
): EncounterCapabilityEffectPayload => {
  const payload = parseExactRecord(
    value,
    CAPABILITY_PAYLOAD_FIELDS,
    path,
    CAPABILITY_PAYLOAD_REQUIRED_FIELDS,
  )
  const action = parseEnum<EncounterEffectCapabilityAction>(
    payload.action,
    CAPABILITY_ACTION_SET,
    `${path}.action`,
    'grant or suppress',
  )
  if (action === 'suppress' && payload.value !== undefined) {
    fail('invalid-encounter-effect', `${path}.value`, 'is supported only for capability grants.')
  }
  return {
    capabilityId: parseStableId(payload.capabilityId, `${path}.capabilityId`),
    action,
    ...(payload.value === undefined
      ? {}
      : {
          value: parseInteger(
            payload.value,
            `${path}.value`,
            0,
            ENCOUNTER_EFFECT_LIMITS.numericMagnitude,
          ),
        }),
  }
}

const parseItemSuppressionPayload = (
  value: unknown,
  path: string,
): EncounterItemSuppressionEffectPayload => {
  const payload = parseExactRecord(value, ITEM_SUPPRESSION_PAYLOAD_FIELDS, path)
  const scope = parseEnum<EncounterEffectItemSuppressionScope>(
    payload.scope,
    ITEM_SUPPRESSION_SCOPE_SET,
    `${path}.scope`,
    'all-equipped or item-bindings',
  )
  const itemBindingIds = parseStableIdList(
    payload.itemBindingIds,
    `${path}.itemBindingIds`,
    ENCOUNTER_EFFECT_LIMITS.tags,
  )
  if ((scope === 'item-bindings') !== (itemBindingIds.length > 0)) {
    fail(
      'invalid-encounter-effect',
      `${path}.itemBindingIds`,
      'must be non-empty exactly when scope is item-bindings.',
    )
  }
  if (typeof payload.blocksUse !== 'boolean' || typeof payload.blocksBenefit !== 'boolean') {
    fail('invalid-encounter-effect', path, 'item suppression flags must be booleans.')
  }
  const blocksUse = payload.blocksUse as boolean
  const blocksBenefit = payload.blocksBenefit as boolean
  if (!blocksUse && !blocksBenefit) {
    fail('invalid-encounter-effect', path, 'must block item use, item benefit, or both.')
  }
  return {
    familyId: parseStableId(payload.familyId, `${path}.familyId`),
    scope,
    itemBindingIds,
    blocksUse,
    blocksBenefit,
  }
}

const parseMoveListOverlayPayload = (
  value: unknown,
  path: string,
): EncounterMoveListOverlayEffectPayload => {
  const payload = parseRecord(value, path)
  const action = parseEnum<EncounterEffectMoveListAction>(
    payload.action,
    MOVE_LIST_ACTION_SET,
    `${path}.action`,
    'add, replace, disable, or restrict',
  )

  if (action === 'add') {
    assertExactFields(payload, MOVE_LIST_ADD_PAYLOAD_FIELDS, path)
    return {
      action,
      canonicalMoveId: parseCanonicalMoveId(
        payload.canonicalMoveId,
        `${path}.canonicalMoveId`,
      ),
      copiedSpecHash: parseCopiedSpecHash(
        payload.copiedSpecHash,
        `${path}.copiedSpecHash`,
      ),
    }
  }

  if (action === 'replace') {
    assertExactFields(payload, MOVE_LIST_REPLACE_PAYLOAD_FIELDS, path)
    const replacedCanonicalMoveId = parseCanonicalMoveId(
      payload.replacedCanonicalMoveId,
      `${path}.replacedCanonicalMoveId`,
    )
    const canonicalMoveId = parseCanonicalMoveId(
      payload.canonicalMoveId,
      `${path}.canonicalMoveId`,
    )
    if (replacedCanonicalMoveId.toLowerCase() === canonicalMoveId.toLowerCase()) {
      fail(
        'invalid-encounter-effect',
        path,
        'replacement source and destination canonical move identities must differ.',
      )
    }
    return {
      action,
      replacedCanonicalMoveId,
      canonicalMoveId,
      copiedSpecHash: parseCopiedSpecHash(
        payload.copiedSpecHash,
        `${path}.copiedSpecHash`,
      ),
    }
  }

  assertExactFields(payload, MOVE_LIST_FILTER_PAYLOAD_FIELDS, path)
  return {
    action,
    canonicalMoveIds: parseCanonicalMoveIdList(
      payload.canonicalMoveIds,
      `${path}.canonicalMoveIds`,
    ),
  }
}

type ParsedEncounterEffectDefinitionCommon = Omit<
  EncounterEffectDefinitionEnvelope<EncounterEffectKind, never>,
  'kind' | 'payload'
>

type ParsedEncounterEffectCommon = Omit<
  EncounterEffectEnvelope<EncounterEffectKind, never>,
  'kind' | 'payload'
>

const definitionWithPayload = <Kind extends EncounterEffectKind, Payload>(
  common: ParsedEncounterEffectDefinitionCommon,
  kind: Kind,
  payload: Payload,
): EncounterEffectDefinitionEnvelope<Kind, Payload> => ({
  kind,
  duration: common.duration,
  stacks: common.stacks,
  charges: common.charges,
  stackPolicy: common.stackPolicy,
  chargePolicy: common.chargePolicy,
  tags: common.tags,
  payload,
  dispel: common.dispel,
  ...(common.transferPolicy === undefined
    ? {}
    : { transferPolicy: common.transferPolicy }),
})

const effectWithPayload = <Kind extends EncounterEffectKind, Payload>(
  common: ParsedEncounterEffectCommon,
  kind: Kind,
  payload: Payload,
): EncounterEffectEnvelope<Kind, Payload> => ({
  id: common.id,
  kind,
  source: common.source,
  affected: common.affected,
  createdRound: common.createdRound,
  createdTurn: common.createdTurn,
  duration: common.duration,
  stacks: common.stacks,
  charges: common.charges,
  stackPolicy: common.stackPolicy,
  chargePolicy: common.chargePolicy,
  tags: common.tags,
  payload,
  dispel: common.dispel,
  ...(common.transferPolicy === undefined
    ? {}
    : { transferPolicy: common.transferPolicy }),
  suppression: common.suppression,
})

/**
 * Parse the context-free portion a reviewed operation may use to request an
 * effect. Source, recipients, creation coordinates, and suppression remain
 * authoritative reducer output rather than spec-authored data.
 */
export const parseEncounterEffectDefinition = (
  value: unknown,
  path = 'encounterEffectDefinition',
): EncounterEffectDefinition => {
  const definition = parseExactRecord(
    value,
    EFFECT_DEFINITION_FIELDS,
    path,
    LEGACY_EFFECT_DEFINITION_FIELDS,
  )
  const rawKind = definition.kind
  if (typeof rawKind !== 'string' || !EFFECT_KIND_SET.has(rawKind)) {
    fail('unknown-effect-kind', `${path}.kind`, 'must be a supported encounter effect kind.')
  }
  const kind = rawKind as EncounterEffectKind
  const stacks = parseInteger(
    definition.stacks,
    `${path}.stacks`,
    1,
    ENCOUNTER_EFFECT_LIMITS.stacks,
  )
  const charges = definition.charges === null
    ? null
    : parseInteger(
        definition.charges,
        `${path}.charges`,
        0,
        ENCOUNTER_EFFECT_LIMITS.charges,
      )
  const common: ParsedEncounterEffectDefinitionCommon = {
    duration: parseEncounterEffectDuration(definition.duration, `${path}.duration`),
    stacks,
    charges,
    stackPolicy: parseEncounterEffectStackPolicy(definition.stackPolicy, `${path}.stackPolicy`, stacks),
    chargePolicy: parseChargePolicy(definition.chargePolicy, `${path}.chargePolicy`, charges),
    tags: parseStableIdList(definition.tags, `${path}.tags`, ENCOUNTER_EFFECT_LIMITS.tags),
    dispel: parseDispel(definition.dispel, `${path}.dispel`),
    ...(definition.transferPolicy === undefined
      ? {}
      : {
          transferPolicy: parseEncounterEffectTransferPolicy(
            definition.transferPolicy,
            `${path}.transferPolicy`,
          ),
        }),
  }

  switch (kind) {
    case 'condition':
      return definitionWithPayload(
        common,
        kind,
        parseConditionPayload(definition.payload, `${path}.payload`),
      )
    case 'numeric-modifier':
      return definitionWithPayload(
        common,
        kind,
        parseNumericModifierPayload(definition.payload, `${path}.payload`),
      )
    case 'capability':
      return definitionWithPayload(
        common,
        kind,
        parseCapabilityPayload(definition.payload, `${path}.payload`),
      )
    case 'item-suppression':
      return definitionWithPayload(
        common,
        kind,
        parseItemSuppressionPayload(definition.payload, `${path}.payload`),
      )
    case 'move-list-overlay':
      return definitionWithPayload(
        common,
        kind,
        parseMoveListOverlayPayload(definition.payload, `${path}.payload`),
      )
  }
}

/** Parse and detach one strict typed effect instance. */
export const parseEncounterEffect = (
  value: unknown,
  path = 'encounterEffect',
): EncounterEffect => {
  const effect = parseExactRecord(value, EFFECT_FIELDS, path, LEGACY_EFFECT_FIELDS)
  const rawKind = effect.kind
  if (typeof rawKind !== 'string' || !EFFECT_KIND_SET.has(rawKind)) {
    fail('unknown-effect-kind', `${path}.kind`, 'must be a supported encounter effect kind.')
  }
  const kind = rawKind as EncounterEffectKind
  const stacks = parseInteger(
    effect.stacks,
    `${path}.stacks`,
    1,
    ENCOUNTER_EFFECT_LIMITS.stacks,
  )
  const charges = effect.charges === null
    ? null
    : parseInteger(effect.charges, `${path}.charges`, 0, ENCOUNTER_EFFECT_LIMITS.charges)
  const common: ParsedEncounterEffectCommon = {
    id: parseStableId(effect.id, `${path}.id`),
    source: parseSource(effect.source, `${path}.source`),
    affected: parseAffected(effect.affected, `${path}.affected`),
    createdRound: parseInteger(
      effect.createdRound,
      `${path}.createdRound`,
      1,
      ENCOUNTER_EFFECT_LIMITS.round,
    ),
    createdTurn: parseInteger(
      effect.createdTurn,
      `${path}.createdTurn`,
      0,
      ENCOUNTER_EFFECT_LIMITS.turn,
    ),
    duration: parseEncounterEffectDuration(effect.duration, `${path}.duration`),
    stacks,
    charges,
    stackPolicy: parseEncounterEffectStackPolicy(effect.stackPolicy, `${path}.stackPolicy`, stacks),
    chargePolicy: parseChargePolicy(effect.chargePolicy, `${path}.chargePolicy`, charges),
    tags: parseStableIdList(effect.tags, `${path}.tags`, ENCOUNTER_EFFECT_LIMITS.tags),
    dispel: parseDispel(effect.dispel, `${path}.dispel`),
    ...(effect.transferPolicy === undefined
      ? {}
      : {
          transferPolicy: parseEncounterEffectTransferPolicy(
            effect.transferPolicy,
            `${path}.transferPolicy`,
          ),
        }),
    suppression: parseSuppression(effect.suppression, `${path}.suppression`),
  }

  switch (kind) {
    case 'condition':
      return effectWithPayload(
        common,
        kind,
        parseConditionPayload(effect.payload, `${path}.payload`),
      )
    case 'numeric-modifier':
      return effectWithPayload(
        common,
        kind,
        parseNumericModifierPayload(effect.payload, `${path}.payload`),
      )
    case 'capability':
      return effectWithPayload(
        common,
        kind,
        parseCapabilityPayload(effect.payload, `${path}.payload`),
      )
    case 'item-suppression':
      return effectWithPayload(
        common,
        kind,
        parseItemSuppressionPayload(effect.payload, `${path}.payload`),
      )
    case 'move-list-overlay': {
      if (common.affected.placementIds.length === 0 && common.affected.sideIds.length === 0) {
        fail(
          'invalid-encounter-effect',
          `${path}.affected`,
          'move-list overlays must target at least one placement or side.',
        )
      }
      return effectWithPayload(
        common,
        kind,
        parseMoveListOverlayPayload(effect.payload, `${path}.payload`),
      )
    }
  }
}

/** Parse a bounded effect list and reject duplicate or dangling suppression identity. */
export const parseEncounterEffects = (
  value: unknown,
  path = 'encounterEffects',
): readonly EncounterEffect[] => {
  const effects = parseArray(value, path, ENCOUNTER_EFFECT_LIMITS.count)
    .map((effect, index) => parseEncounterEffect(effect, `${path}[${index}]`))
  assertUnique(effects.map(effect => effect.id), `${path}.id`)

  const effectIds = new Set(effects.map(effect => effect.id))
  effects.forEach((effect, effectIndex) => {
    effect.suppression.sources.forEach((source, sourceIndex) => {
      const sourcePath = `${path}[${effectIndex}].suppression.sources[${sourceIndex}].effectId`
      if (source.effectId === effect.id) {
        fail('invalid-encounter-effect', sourcePath, 'cannot suppress its own effect.')
      }
      if (!effectIds.has(source.effectId)) {
        fail('invalid-encounter-effect', sourcePath, `references unknown effect ${source.effectId}.`)
      }
    })
  })

  return effects
}
