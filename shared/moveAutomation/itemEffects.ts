import {
  EncounterEffectValidationError,
  parseEncounterEffectDuration,
  type EncounterEffectDuration,
} from './encounterEffects'
import {
  isMoveCanonicalItemId,
  type MoveItemReference,
} from './items'

/** Closed high-level item behaviors available to reviewed MoveSpecs. */
export const MOVE_ITEM_EFFECT_ACTIONS = [
  'give',
  'pickup',
  'steal',
  'swap',
  'knock-to-ground',
  'throw',
  'consume',
  'restore',
  'destroy',
  'suppress',
  'store-buff',
  'digest-buff',
] as const

export const MOVE_ITEM_EFFECT_SELECTION_KINDS = ['choice', 'requirement'] as const
export const MOVE_ITEM_EFFECT_SELECTION_CARDINALITIES = ['one', 'all'] as const
export const MOVE_ITEM_EFFECT_UNAVAILABLE_POLICIES = ['no-op', 'reject'] as const
export const MOVE_ITEM_EFFECT_SWAP_PARTICIPANTS = [
  'actor-and-first-recipient',
  'first-and-second-recipients',
] as const
export const MOVE_ITEM_EFFECT_RESTORE_MODES = ['item', 'effect'] as const
export const MOVE_ITEM_EFFECT_RESTORE_DESTINATIONS = [
  'actor-held',
  'first-recipient-held',
] as const
export const MOVE_ITEM_EFFECT_SUPPRESSION_SCOPES = [
  'all-equipped',
  'selected-items',
] as const
export const MOVE_ITEM_EFFECT_SUPPRESSION_REPLACEMENTS = [
  'replace-by-source',
  'independent',
] as const

export const MOVE_ITEM_EFFECT_LIMITS = Object.freeze({
  identifierChars: 160,
  quantity: Number.MAX_SAFE_INTEGER,
  canonicalItemIds: 256,
})

export type MoveItemEffectAction = (typeof MOVE_ITEM_EFFECT_ACTIONS)[number]
export type MoveItemEffectSelectionKind =
  (typeof MOVE_ITEM_EFFECT_SELECTION_KINDS)[number]
export type MoveItemEffectSelectionCardinality =
  (typeof MOVE_ITEM_EFFECT_SELECTION_CARDINALITIES)[number]
export type MoveItemEffectUnavailablePolicy =
  (typeof MOVE_ITEM_EFFECT_UNAVAILABLE_POLICIES)[number]
export type MoveItemEffectSwapParticipants =
  (typeof MOVE_ITEM_EFFECT_SWAP_PARTICIPANTS)[number]
export type MoveItemEffectRestoreMode =
  (typeof MOVE_ITEM_EFFECT_RESTORE_MODES)[number]
export type MoveItemEffectRestoreDestination =
  (typeof MOVE_ITEM_EFFECT_RESTORE_DESTINATIONS)[number]
export type MoveItemEffectSuppressionScope =
  (typeof MOVE_ITEM_EFFECT_SUPPRESSION_SCOPES)[number]
export type MoveItemEffectSuppressionReplacement =
  (typeof MOVE_ITEM_EFFECT_SUPPRESSION_REPLACEMENTS)[number]

/** Resolve a prior private durable item choice by request ID. */
export interface MoveItemEffectChoiceSelection {
  readonly kind: 'choice'
  readonly requestId: string
  /** Binds mechanics to the reviewed destination branch selected in that window. */
  readonly destinationId: string
}

/** Resolve a server-loaded reviewed requirement without accepting item identity from a client. */
export interface MoveItemEffectRequirementSelection {
  readonly kind: 'requirement'
  readonly requirementId: string
  readonly cardinality: MoveItemEffectSelectionCardinality
}

export type MoveItemEffectSelection =
  | MoveItemEffectChoiceSelection
  | MoveItemEffectRequirementSelection

interface MoveItemSelectedEffectPayloadBase<Action extends MoveItemEffectAction> {
  readonly action: Action
  readonly item: MoveItemEffectSelection
  readonly quantity: number
  readonly onUnavailable: MoveItemEffectUnavailablePolicy
}

export type MoveItemGiveEffectPayload = MoveItemSelectedEffectPayloadBase<'give'>
export type MoveItemPickupEffectPayload = MoveItemSelectedEffectPayloadBase<'pickup'>
export type MoveItemStealEffectPayload = MoveItemSelectedEffectPayloadBase<'steal'>
export type MoveItemKnockToGroundEffectPayload =
  MoveItemSelectedEffectPayloadBase<'knock-to-ground'>
export type MoveItemThrowEffectPayload = MoveItemSelectedEffectPayloadBase<'throw'>
export type MoveItemDestroyEffectPayload = MoveItemSelectedEffectPayloadBase<'destroy'>

export interface MoveItemSwapEffectPayload {
  readonly action: 'swap'
  readonly participants: MoveItemEffectSwapParticipants
  /** Null explicitly represents an empty reviewed held-item endpoint. */
  readonly leftItem: MoveItemEffectSelection | null
  readonly rightItem: MoveItemEffectSelection | null
  readonly onUnavailable: MoveItemEffectUnavailablePolicy
}

export interface MoveItemConsumeEffectPayload
  extends MoveItemSelectedEffectPayloadBase<'consume'> {
  readonly consumptionId: string
}

export interface MoveItemRestoreEffectPayload {
  readonly action: 'restore'
  readonly consumptionId: string
  /** Effect-only replay is the Recycle primitive and does not recreate quantity. */
  readonly mode: MoveItemEffectRestoreMode
  readonly destination: MoveItemEffectRestoreDestination | null
  readonly onUnavailable: MoveItemEffectUnavailablePolicy
}

export interface MoveItemSuppressEffectPayload {
  readonly action: 'suppress'
  /** Required for selected-items; null for all current and future equipped items. */
  readonly item: MoveItemEffectSelection | null
  readonly scope: MoveItemEffectSuppressionScope
  readonly blocksUse: boolean
  readonly blocksBenefit: boolean
  readonly effectId: string
  readonly duration: EncounterEffectDuration
  readonly replacement: MoveItemEffectSuppressionReplacement
  readonly onUnavailable: MoveItemEffectUnavailablePolicy
}

export interface MoveItemStoreBuffEffectPayload
  extends MoveItemSelectedEffectPayloadBase<'store-buff'> {
  readonly consumptionId: string
}

export interface MoveItemDigestBuffEffectPayload {
  readonly action: 'digest-buff'
  /** Null accepts any authoritative stored buff; a list narrows canonical legality. */
  readonly canonicalItemIds: readonly string[] | null
  readonly onUnavailable: MoveItemEffectUnavailablePolicy
}

export type MoveItemEffectPayload =
  | MoveItemGiveEffectPayload
  | MoveItemPickupEffectPayload
  | MoveItemStealEffectPayload
  | MoveItemSwapEffectPayload
  | MoveItemKnockToGroundEffectPayload
  | MoveItemThrowEffectPayload
  | MoveItemConsumeEffectPayload
  | MoveItemRestoreEffectPayload
  | MoveItemDestroyEffectPayload
  | MoveItemSuppressEffectPayload
  | MoveItemStoreBuffEffectPayload
  | MoveItemDigestBuffEffectPayload

export type MoveItemEffectValidationCode =
  | 'invalid-item-effect'
  | 'unknown-action'
  | 'limit-exceeded'
  | 'inconsistent-item-effect'
  | 'duplicate-id'

export class MoveItemEffectValidationError extends Error {
  readonly code: MoveItemEffectValidationCode
  readonly path: string

  constructor(code: MoveItemEffectValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveItemEffectValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const SELECTED_FIELDS = ['action', 'item', 'quantity', 'onUnavailable'] as const
const CONSUME_FIELDS = [...SELECTED_FIELDS, 'consumptionId'] as const
const SWAP_FIELDS = [
  'action',
  'participants',
  'leftItem',
  'rightItem',
  'onUnavailable',
] as const
const RESTORE_FIELDS = [
  'action',
  'consumptionId',
  'mode',
  'destination',
  'onUnavailable',
] as const
const SUPPRESS_FIELDS = [
  'action',
  'item',
  'scope',
  'blocksUse',
  'blocksBenefit',
  'effectId',
  'duration',
  'replacement',
  'onUnavailable',
] as const
const DIGEST_FIELDS = ['action', 'canonicalItemIds', 'onUnavailable'] as const
const CHOICE_SELECTION_FIELDS = ['kind', 'requestId', 'destinationId'] as const
const REQUIREMENT_SELECTION_FIELDS = ['kind', 'requirementId', 'cardinality'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const ACTION_SET = new Set<unknown>(MOVE_ITEM_EFFECT_ACTIONS)
const SELECTION_KIND_SET = new Set<unknown>(MOVE_ITEM_EFFECT_SELECTION_KINDS)
const CARDINALITY_SET = new Set<unknown>(MOVE_ITEM_EFFECT_SELECTION_CARDINALITIES)
const UNAVAILABLE_SET = new Set<unknown>(MOVE_ITEM_EFFECT_UNAVAILABLE_POLICIES)
const SWAP_PARTICIPANT_SET = new Set<unknown>(MOVE_ITEM_EFFECT_SWAP_PARTICIPANTS)
const RESTORE_MODE_SET = new Set<unknown>(MOVE_ITEM_EFFECT_RESTORE_MODES)
const RESTORE_DESTINATION_SET = new Set<unknown>(MOVE_ITEM_EFFECT_RESTORE_DESTINATIONS)
const SUPPRESSION_SCOPE_SET = new Set<unknown>(MOVE_ITEM_EFFECT_SUPPRESSION_SCOPES)
const SUPPRESSION_REPLACEMENT_SET = new Set<unknown>(
  MOVE_ITEM_EFFECT_SUPPRESSION_REPLACEMENTS,
)

const fail = (
  code: MoveItemEffectValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveItemEffectValidationError(code, path, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('invalid-item-effect', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('invalid-item-effect', path, 'must be a plain object.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('invalid-item-effect', path, 'symbol properties are not allowed.')
  }
  const detached: UnknownRecord = Object.create(null) as UnknownRecord
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail('invalid-item-effect', `${path}.${key}`, 'must be an enumerable data field.')
    }
    detached[key] = (descriptor as PropertyDescriptor & { value: unknown }).value
  }
  return detached
}

const exactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const parsed = record(value, path)
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(parsed, field))
  const unknown = Object.keys(parsed).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-item-effect',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
  return parsed
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_ITEM_EFFECT_LIMITS.identifierChars
    || value.trim() !== value
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail('invalid-item-effect', path, 'must be a bounded lowercase stable identifier.')
  }
  return value
}

const enumValue = <Value extends string>(
  value: unknown,
  values: ReadonlySet<unknown>,
  path: string,
  description: string,
): Value => {
  if (typeof value !== 'string' || !values.has(value)) {
    return fail('invalid-item-effect', path, `must be ${description}.`)
  }
  return value as Value
}

const booleanValue = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') return fail('invalid-item-effect', path, 'must be a boolean.')
  return value
}

const quantity = (value: unknown, path: string): number => {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 1
    || Number(value) > MOVE_ITEM_EFFECT_LIMITS.quantity
  ) {
    return fail('limit-exceeded', path, 'must be a positive safe integer.')
  }
  return Number(value)
}

const unavailablePolicy = (
  value: unknown,
  path: string,
): MoveItemEffectUnavailablePolicy => enumValue(
  value,
  UNAVAILABLE_SET,
  path,
  'no-op or reject',
)

const selection = (
  value: unknown,
  path: string,
): MoveItemEffectSelection => {
  const candidate = record(value, path)
  if (!SELECTION_KIND_SET.has(candidate.kind)) {
    return fail('invalid-item-effect', `${path}.kind`, 'must be choice or requirement.')
  }
  if (candidate.kind === 'choice') {
    const input = exactRecord(value, CHOICE_SELECTION_FIELDS, path)
    return Object.freeze({
      kind: 'choice' as const,
      requestId: stableId(input.requestId, `${path}.requestId`),
      destinationId: stableId(input.destinationId, `${path}.destinationId`),
    })
  }
  const input = exactRecord(value, REQUIREMENT_SELECTION_FIELDS, path)
  return Object.freeze({
    kind: 'requirement' as const,
    requirementId: stableId(input.requirementId, `${path}.requirementId`),
    cardinality: enumValue<MoveItemEffectSelectionCardinality>(
      input.cardinality,
      CARDINALITY_SET,
      `${path}.cardinality`,
      'one or all',
    ),
  })
}

const nullableSelection = (
  value: unknown,
  path: string,
): MoveItemEffectSelection | null => value === null ? null : selection(value, path)

const selectedPayload = <Action extends
  | 'give'
  | 'pickup'
  | 'steal'
  | 'knock-to-ground'
  | 'throw'
  | 'destroy'
>(
  value: unknown,
  path: string,
  action: Action,
): MoveItemSelectedEffectPayloadBase<Action> => {
  const input = exactRecord(value, SELECTED_FIELDS, path)
  const parsedQuantity = quantity(input.quantity, `${path}.quantity`)
  if (action !== 'destroy' && parsedQuantity !== 1) {
    fail(
      'inconsistent-item-effect',
      `${path}.quantity`,
      `${action} operates on one singleton item.`,
    )
  }
  return {
    action,
    item: selection(input.item, `${path}.item`),
    quantity: parsedQuantity,
    onUnavailable: unavailablePolicy(input.onUnavailable, `${path}.onUnavailable`),
  }
}

const canonicalItemIds = (
  value: unknown,
  path: string,
): readonly string[] | null => {
  if (value === null) return null
  if (!Array.isArray(value) || value.length === 0) {
    return fail('invalid-item-effect', path, 'must be null or a non-empty canonical item ID array.')
  }
  if (value.length > MOVE_ITEM_EFFECT_LIMITS.canonicalItemIds) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_ITEM_EFFECT_LIMITS.canonicalItemIds} entries.`,
    )
  }
  const parsed = value.map((entry, index) => {
    if (!isMoveCanonicalItemId(entry)) {
      return fail('invalid-item-effect', `${path}[${index}]`, 'must be a canonical item ID.')
    }
    return entry
  })
  if (new Set(parsed).size !== parsed.length) {
    fail('duplicate-id', path, 'must not contain duplicate canonical item IDs.')
  }
  return Object.freeze(parsed)
}

/** Strictly parse the item payload selected by one reviewed `item` operation. */
export const parseMoveItemEffectPayload = (
  value: unknown,
  path = 'itemEffect',
): MoveItemEffectPayload => {
  const candidate = record(value, path)
  if (!ACTION_SET.has(candidate.action)) {
    return fail('unknown-action', `${path}.action`, 'must be a supported item effect action.')
  }
  const action = candidate.action as MoveItemEffectAction

  if (
    action === 'give'
    || action === 'pickup'
    || action === 'steal'
    || action === 'knock-to-ground'
    || action === 'throw'
    || action === 'destroy'
  ) {
    return deepFreeze(selectedPayload(value, path, action))
  }

  if (action === 'consume' || action === 'store-buff') {
    const input = exactRecord(value, CONSUME_FIELDS, path)
    const parsedQuantity = quantity(input.quantity, `${path}.quantity`)
    if (action === 'store-buff' && parsedQuantity !== 1) {
      fail(
        'inconsistent-item-effect',
        `${path}.quantity`,
        'store-buff consumes exactly one item.',
      )
    }
    const common = {
      action,
      item: selection(input.item, `${path}.item`),
      quantity: parsedQuantity,
      onUnavailable: unavailablePolicy(input.onUnavailable, `${path}.onUnavailable`),
      consumptionId: stableId(input.consumptionId, `${path}.consumptionId`),
    }
    return deepFreeze(common) as MoveItemConsumeEffectPayload | MoveItemStoreBuffEffectPayload
  }

  if (action === 'swap') {
    const input = exactRecord(value, SWAP_FIELDS, path)
    return deepFreeze({
      action,
      participants: enumValue<MoveItemEffectSwapParticipants>(
        input.participants,
        SWAP_PARTICIPANT_SET,
        `${path}.participants`,
        'actor-and-first-recipient or first-and-second-recipients',
      ),
      leftItem: nullableSelection(input.leftItem, `${path}.leftItem`),
      rightItem: nullableSelection(input.rightItem, `${path}.rightItem`),
      onUnavailable: unavailablePolicy(input.onUnavailable, `${path}.onUnavailable`),
    })
  }

  if (action === 'restore') {
    const input = exactRecord(value, RESTORE_FIELDS, path)
    const mode = enumValue<MoveItemEffectRestoreMode>(
      input.mode,
      RESTORE_MODE_SET,
      `${path}.mode`,
      'item or effect',
    )
    const destination = input.destination === null
      ? null
      : enumValue<MoveItemEffectRestoreDestination>(
          input.destination,
          RESTORE_DESTINATION_SET,
          `${path}.destination`,
          'actor-held, first-recipient-held, or null',
        )
    if ((mode === 'item') !== (destination !== null)) {
      fail(
        'inconsistent-item-effect',
        `${path}.destination`,
        'must be non-null only when restore mode is item.',
      )
    }
    return deepFreeze({
      action,
      consumptionId: stableId(input.consumptionId, `${path}.consumptionId`),
      mode,
      destination,
      onUnavailable: unavailablePolicy(input.onUnavailable, `${path}.onUnavailable`),
    })
  }

  if (action === 'suppress') {
    const input = exactRecord(value, SUPPRESS_FIELDS, path)
    const scope = enumValue<MoveItemEffectSuppressionScope>(
      input.scope,
      SUPPRESSION_SCOPE_SET,
      `${path}.scope`,
      'all-equipped or selected-items',
    )
    const item = nullableSelection(input.item, `${path}.item`)
    if ((scope === 'selected-items') !== (item !== null)) {
      fail(
        'inconsistent-item-effect',
        `${path}.item`,
        'must be non-null exactly when suppression scope is selected-items.',
      )
    }
    let duration: EncounterEffectDuration
    try {
      duration = parseEncounterEffectDuration(input.duration, `${path}.duration`)
    }
    catch (error) {
      if (!(error instanceof EncounterEffectValidationError)) throw error
      return fail('invalid-item-effect', `${path}.duration`, error.message)
    }
    const blocksUse = booleanValue(input.blocksUse, `${path}.blocksUse`)
    const blocksBenefit = booleanValue(input.blocksBenefit, `${path}.blocksBenefit`)
    if (!blocksUse && !blocksBenefit) {
      fail(
        'inconsistent-item-effect',
        path,
        'suppression must block item use, item benefit, or both.',
      )
    }
    return deepFreeze({
      action,
      item,
      scope,
      blocksUse,
      blocksBenefit,
      effectId: stableId(input.effectId, `${path}.effectId`),
      duration,
      replacement: enumValue<MoveItemEffectSuppressionReplacement>(
        input.replacement,
        SUPPRESSION_REPLACEMENT_SET,
        `${path}.replacement`,
        'replace-by-source or independent',
      ),
      onUnavailable: unavailablePolicy(input.onUnavailable, `${path}.onUnavailable`),
    })
  }

  const input = exactRecord(value, DIGEST_FIELDS, path)
  return deepFreeze({
    action: 'digest-buff' as const,
    canonicalItemIds: canonicalItemIds(input.canonicalItemIds, `${path}.canonicalItemIds`),
    onUnavailable: unavailablePolicy(input.onUnavailable, `${path}.onUnavailable`),
  })
}

const fnvHex = (value: string, seed: number): string => {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const itemOwnerIdentity = (reference: MoveItemReference): string => {
  const owner = reference.owner
  return owner.kind === 'sheet'
    ? `${owner.kind}:${owner.sheetKind}:${owner.slug}`
    : `${owner.kind}:${owner.slug}`
}

/**
 * Opaque revision-independent binding for one physical item location. It is
 * safe to persist in encounter suppression state without exposing owner slugs.
 */
export const moveItemEffectBindingId = (reference: MoveItemReference): string => {
  const identity = [
    reference.kind,
    itemOwnerIdentity(reference),
    reference.itemId,
    reference.canonicalItemId,
  ].join('\u0000')
  return `item.binding.${fnvHex(identity, 0x811c9dc5)}${fnvHex(identity, 0x9e3779b9)}`
}
