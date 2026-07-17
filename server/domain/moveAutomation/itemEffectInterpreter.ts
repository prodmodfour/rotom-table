import { normalizeRevision } from '#shared/sessionRevisions'
import {
  moveItemEffectBindingId,
  type MoveItemEffectPayload,
  type MoveItemEffectSelection,
  type MoveItemEffectUnavailablePolicy,
} from '#shared/moveAutomation/itemEffects'
import type {
  MoveItemEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveItemReference } from '#shared/moveAutomation/items'
import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
} from '#shared/moveAutomation/trace'
import {
  resolveMoveAutomationItemRuleIdentity,
} from './itemRuleData'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { splitSheetItemNames } from '~/utils/sheetItemNames'
import type { AuthoritativeMoveRulesContext } from './context'
import type {
  MoveSpecEmittedOperation,
  MoveSpecResolvedItemChoice,
} from './executeSpec'
import type {
  MoveItemDigestionBuffDestination,
  MoveItemEquippedDestination,
  MoveItemMutation,
  MoveItemMutationOperationResult,
} from './itemMutationTypes'

export const MOVE_ITEM_EFFECT_INTERPRETER_LIMITS = Object.freeze({
  mutations: 64,
  recipients: 64,
})

export type MoveItemEffectInterpretationErrorCode =
  | 'unsupported-operation'
  | 'selection-unavailable'
  | 'selection-ambiguous'
  | 'selection-owner-mismatch'
  | 'recipient-count-invalid'
  | 'destination-occupied'
  | 'mutation-limit-exceeded'
  | 'binding-collision'
  | 'trace-result-missing'

export class MoveItemEffectInterpretationError extends Error {
  readonly code: MoveItemEffectInterpretationErrorCode

  constructor(code: MoveItemEffectInterpretationErrorCode, message: string) {
    super(message)
    this.name = 'MoveItemEffectInterpretationError'
    this.code = code
  }
}

export interface InterpretedMoveItemEffectResult {
  readonly operationId: string
  readonly action: MoveItemEffectPayload['action']
  readonly outcome: 'applied' | 'prevented' | 'no-op'
  /** Stable private explanation for a prevented/no-op interpretation. */
  readonly outcomeCode: MoveItemEffectInterpretationErrorCode | null
  readonly mutationIds: readonly string[]
  readonly itemCount: number
  readonly reasonCode: string
}

export interface InterpretedMoveItemEffects {
  readonly mutations: readonly MoveItemMutation[]
  readonly results: readonly InterpretedMoveItemEffectResult[]
}

export interface MoveResolvedItemEffectOperation
  extends Omit<MoveSpecEmittedOperation, 'operation'> {
  readonly operation: MoveItemEffectOperation
}

const ITEM_EFFECT_KIND = 'item'

const fail = (
  code: MoveItemEffectInterpretationErrorCode,
  message: string,
): never => {
  throw new MoveItemEffectInterpretationError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export const isMoveItemEffectEmission = (
  value: MoveSpecEmittedOperation,
): value is MoveResolvedItemEffectOperation => value.operation.kind === ITEM_EFFECT_KIND

const unavailable = (input: {
  readonly operation: MoveItemEffectOperation
  readonly policy: MoveItemEffectUnavailablePolicy
  readonly code: MoveItemEffectInterpretationErrorCode
  readonly message: string
  readonly outcome?: 'prevented' | 'no-op'
}): InterpretedMoveItemEffectResult => {
  if (input.policy === 'reject') return fail(input.code, input.message)
  return deepFreeze({
    operationId: input.operation.id,
    action: input.operation.payload.action,
    outcome: input.outcome ?? 'no-op',
    outcomeCode: input.code,
    mutationIds: [],
    itemCount: 0,
    reasonCode: input.operation.reasonCode,
  })
}

const applied = (input: {
  readonly operation: MoveItemEffectOperation
  readonly mutations: readonly MoveItemMutation[]
  readonly itemCount: number
}): InterpretedMoveItemEffectResult => deepFreeze({
  operationId: input.operation.id,
  action: input.operation.payload.action,
  outcome: 'applied' as const,
  outcomeCode: null,
  mutationIds: input.mutations.map(mutation => mutation.id),
  itemCount: input.itemCount,
  reasonCode: input.operation.reasonCode,
})

const hashPart = (value: string, seed: number): string => {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const mutationId = (operationId: string, index: number): string => {
  const candidate = `${operationId}.mutation-${index + 1}`
  if (candidate.length <= 160) return candidate
  const identity = `${operationId}\u0000${index}`
  return `${operationId.slice(0, 136)}.m.${hashPart(identity, 0x811c9dc5)}${hashPart(identity, 0x9e3779b9)}`
}

const groundItemId = (
  operationId: string,
  reference: MoveItemReference,
  ordinal: number,
): string => {
  const identity = `${operationId}\u0000${moveItemEffectBindingId(reference)}\u0000${ordinal}`
  return `ground.item.${hashPart(identity, 0x811c9dc5)}${hashPart(identity, 0x9e3779b9)}`
}

const resolvedChoiceFor = (
  choices: readonly MoveSpecResolvedItemChoice[],
  requestId: string,
): MoveSpecResolvedItemChoice | null => {
  const matches = choices.filter(choice => choice.requestId === requestId)
  if (matches.length > 1) {
    return fail(
      'selection-ambiguous',
      `Item choice request ${requestId} resolved more than once.`,
    )
  }
  return matches[0] ?? null
}

const resolveSelection = (input: {
  readonly selection: MoveItemEffectSelection
  readonly context: AuthoritativeMoveRulesContext
  readonly choices: readonly MoveSpecResolvedItemChoice[]
  readonly operation: MoveItemEffectOperation
}): readonly MoveItemReference[] | null => {
  if (input.selection.kind === 'choice') {
    const choice = resolvedChoiceFor(input.choices, input.selection.requestId)
    if (!choice || choice.choice.reference === null) return null
    if (choice.choice.destination?.id !== input.selection.destinationId) {
      return fail(
        'selection-owner-mismatch',
        `Item operation ${input.operation.id} expected destination branch ${input.selection.destinationId} for ${input.selection.requestId}.`,
      )
    }
    return [choice.choice.reference]
  }

  const references = input.context.queries.items.forRequirement(
    input.selection.requirementId,
  )
  if (input.selection.cardinality === 'one') {
    return references.length === 1 ? references : null
  }
  return references.length > 0 ? references : null
}

const placementForRole = (input: {
  readonly role: 'actor' | 'first-recipient' | 'second-recipient'
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
  readonly operation: MoveItemEffectOperation
}): SheetPlacement => {
  if (input.role === 'actor') return input.context.actor.placement
  const index = input.role === 'first-recipient' ? 0 : 1
  const placementId = input.recipientIds[index]
  const placement = placementId
    ? input.context.queries.placements.get(placementId)
    : null
  return placement ?? fail(
    'recipient-count-invalid',
    `Item operation ${input.operation.id} requires a ${input.role}.`,
  )
}

const referenceMatchesPlacement = (
  reference: MoveItemReference,
  placement: SheetPlacement,
): boolean => reference.owner.kind === 'sheet'
  && reference.owner.sheetKind === placement.sheetKind
  && reference.owner.slug === placement.sheetSlug

const assertReferencesOwnedBy = (input: {
  readonly references: readonly MoveItemReference[]
  readonly placement: SheetPlacement
  readonly operation: MoveItemEffectOperation
  readonly label: string
}): void => {
  if (input.references.every(reference => referenceMatchesPlacement(reference, input.placement))) {
    return
  }
  fail(
    'selection-owner-mismatch',
    `Item operation ${input.operation.id} ${input.label} does not belong to ${input.placement.id}.`,
  )
}

const assertEquipped = (
  references: readonly MoveItemReference[],
  operation: MoveItemEffectOperation,
): void => {
  if (references.every(reference => (
    reference.kind === 'pokemon-held' || reference.kind === 'trainer-equipment-slot'
  ))) return
  fail(
    'selection-owner-mismatch',
    `Item operation ${operation.id} requires equipped item references.`,
  )
}

const sheetForPlacement = (
  context: AuthoritativeMoveRulesContext,
  placement: SheetPlacement,
) => context.queries.sheets.forPlacement(placement)
  ?? fail(
    'selection-owner-mismatch',
    `Item destination sheet ${placement.sheetKind}/${placement.sheetSlug} is unavailable.`,
  )

const heldDestination = (
  context: AuthoritativeMoveRulesContext,
  placement: SheetPlacement,
): MoveItemEquippedDestination => {
  const sheet = sheetForPlacement(context, placement)
  return placement.sheetKind === 'pokemon'
    ? {
        kind: 'pokemon-held',
        owner: {
          kind: 'sheet',
          sheetKind: 'pokemon',
          slug: placement.sheetSlug,
          revision: sheet.revision,
        },
      }
    : {
        kind: 'trainer-equipment-slot',
        owner: {
          kind: 'sheet',
          sheetKind: 'trainer',
          slug: placement.sheetSlug,
          revision: sheet.revision,
        },
        slot: 'accessory',
      }
}

const digestionDestination = (
  context: AuthoritativeMoveRulesContext,
  placement: SheetPlacement,
): MoveItemDigestionBuffDestination => {
  const sheet = sheetForPlacement(context, placement)
  return placement.sheetKind === 'pokemon'
    ? {
        kind: 'digestion-buff',
        owner: {
          kind: 'sheet',
          sheetKind: 'pokemon',
          slug: placement.sheetSlug,
          revision: sheet.revision,
        },
      }
    : {
        kind: 'digestion-buff',
        owner: {
          kind: 'sheet',
          sheetKind: 'trainer',
          slug: placement.sheetSlug,
          revision: sheet.revision,
        },
      }
}

const heldItemCount = (
  context: AuthoritativeMoveRulesContext,
  placement: SheetPlacement,
): number => {
  const resolved = sheetForPlacement(context, placement)
  return placement.sheetKind === 'pokemon'
    ? splitSheetItemNames((resolved.sheet as CharacterSheet).items?.held).length
    : splitSheetItemNames(
        (resolved.sheet as TrainerSheet).equipmentSlots?.accessory,
      ).length
}

const storedDigestionBuffId = (
  context: AuthoritativeMoveRulesContext,
  placement: SheetPlacement,
): string | null => {
  const resolved = sheetForPlacement(context, placement)
  const value = placement.sheetKind === 'pokemon'
    ? (resolved.sheet as CharacterSheet).items?.digestionFood
    : (resolved.sheet as TrainerSheet).digestion
  if (typeof value !== 'string' || !value.trim()) return null
  return resolveMoveAutomationItemRuleIdentity(value.trim())?.canonicalItemId ?? null
}

const sourceOwnerPlacement = (input: {
  readonly reference: MoveItemReference
  readonly context: AuthoritativeMoveRulesContext
  readonly candidates: readonly SheetPlacement[]
  readonly operation: MoveItemEffectOperation
}): SheetPlacement => {
  const matches = input.candidates.filter(placement => (
    referenceMatchesPlacement(input.reference, placement)
  ))
  if (matches.length !== 1) {
    return fail(
      'selection-owner-mismatch',
      `Item operation ${input.operation.id} cannot bind ${input.reference.itemId} to exactly one authoritative placement.`,
    )
  }
  return matches[0]!
}

const ensureMutationLimit = (
  mutations: readonly MoveItemMutation[],
  operation: MoveItemEffectOperation,
): void => {
  if (mutations.length <= MOVE_ITEM_EFFECT_INTERPRETER_LIMITS.mutations) return
  fail(
    'mutation-limit-exceeded',
    `Item operation ${operation.id} emitted more than ${MOVE_ITEM_EFFECT_INTERPRETER_LIMITS.mutations} mutations.`,
  )
}

const interpretGiveOrSteal = (input: InterpretOperationInput): OperationInterpretation => {
  const payload = input.operation.payload
  if (payload.action !== 'give' && payload.action !== 'steal') {
    return fail('unsupported-operation', `Operation ${input.operation.id} is not give or steal.`)
  }
  const references = resolveSelection({
    selection: payload.item,
    context: input.context,
    choices: input.choices,
    operation: input.operation,
  })
  if (!references || references.length !== 1) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Item operation ${input.operation.id} requires exactly one selected item.`,
    }), mutations: [] }
  }
  assertEquipped(references, input.operation)
  const sourcePlacement = placementForRole({
    role: payload.action === 'give' ? 'actor' : 'first-recipient',
    ...input,
  })
  const destinationPlacement = placementForRole({
    role: payload.action === 'give' ? 'first-recipient' : 'actor',
    ...input,
  })
  assertReferencesOwnedBy({
    references,
    placement: sourcePlacement,
    operation: input.operation,
    label: 'source item',
  })
  if (heldItemCount(input.context, destinationPlacement) > 0) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'destination-occupied',
      message: `Item operation ${input.operation.id} destination ${destinationPlacement.id} is occupied.`,
      outcome: 'prevented',
    }), mutations: [] }
  }
  const mutations: MoveItemMutation[] = [{
    id: mutationId(input.operation.id, 0),
    kind: 'transfer',
    reasonCode: input.operation.reasonCode,
    source: references[0]!,
    destination: heldDestination(input.context, destinationPlacement),
    quantity: payload.quantity,
  }]
  return { result: applied({ operation: input.operation, mutations, itemCount: 1 }), mutations }
}

const swapRoles = (
  payload: Extract<MoveItemEffectPayload, { readonly action: 'swap' }>,
): readonly ['actor' | 'first-recipient', 'first-recipient' | 'second-recipient'] => (
  payload.participants === 'actor-and-first-recipient'
    ? ['actor', 'first-recipient']
    : ['first-recipient', 'second-recipient']
)

const interpretSwap = (input: InterpretOperationInput): OperationInterpretation => {
  const payload = input.operation.payload
  if (payload.action !== 'swap') {
    return fail('unsupported-operation', `Operation ${input.operation.id} is not swap.`)
  }
  const [leftRole, rightRole] = swapRoles(payload)
  const leftPlacement = placementForRole({ role: leftRole, ...input })
  const rightPlacement = placementForRole({ role: rightRole, ...input })
  if (leftPlacement.id === rightPlacement.id) {
    return fail('recipient-count-invalid', `Item swap ${input.operation.id} requires distinct participants.`)
  }
  const left = payload.leftItem
    ? resolveSelection({ selection: payload.leftItem, context: input.context, choices: input.choices, operation: input.operation })
    : []
  const right = payload.rightItem
    ? resolveSelection({ selection: payload.rightItem, context: input.context, choices: input.choices, operation: input.operation })
    : []
  if (left === null || right === null || left.length > 1 || right.length > 1) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Item swap ${input.operation.id} could not resolve both reviewed endpoints.`,
    }), mutations: [] }
  }
  if (left.length > 0) {
    assertEquipped(left, input.operation)
    assertReferencesOwnedBy({ references: left, placement: leftPlacement, operation: input.operation, label: 'left item' })
  }
  else if (heldItemCount(input.context, leftPlacement) > 0) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'destination-occupied',
      message: `Item swap ${input.operation.id} expected ${leftPlacement.id} to have an empty held slot.`,
      outcome: 'prevented',
    }), mutations: [] }
  }
  if (right.length > 0) {
    assertEquipped(right, input.operation)
    assertReferencesOwnedBy({ references: right, placement: rightPlacement, operation: input.operation, label: 'right item' })
  }
  else if (heldItemCount(input.context, rightPlacement) > 0) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'destination-occupied',
      message: `Item swap ${input.operation.id} expected ${rightPlacement.id} to have an empty held slot.`,
      outcome: 'prevented',
    }), mutations: [] }
  }

  let mutations: MoveItemMutation[]
  if (left.length === 1 && right.length === 1) {
    mutations = [{
      id: mutationId(input.operation.id, 0),
      kind: 'swap',
      reasonCode: input.operation.reasonCode,
      left: left[0]!,
      right: right[0]!,
    }]
  }
  else if (left.length === 1) {
    mutations = [{
      id: mutationId(input.operation.id, 0),
      kind: 'transfer',
      reasonCode: input.operation.reasonCode,
      source: left[0]!,
      destination: heldDestination(input.context, rightPlacement),
      quantity: 1,
    }]
  }
  else if (right.length === 1) {
    mutations = [{
      id: mutationId(input.operation.id, 0),
      kind: 'transfer',
      reasonCode: input.operation.reasonCode,
      source: right[0]!,
      destination: heldDestination(input.context, leftPlacement),
      quantity: 1,
    }]
  }
  else {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Item swap ${input.operation.id} has no item on either endpoint.`,
    }), mutations: [] }
  }
  return {
    result: applied({ operation: input.operation, mutations, itemCount: left.length + right.length }),
    mutations,
  }
}

const interpretGrounding = (input: InterpretOperationInput): OperationInterpretation => {
  const payload = input.operation.payload
  if (payload.action !== 'knock-to-ground' && payload.action !== 'throw') {
    return fail('unsupported-operation', `Operation ${input.operation.id} is not a ground transfer.`)
  }
  const references = resolveSelection({
    selection: payload.item,
    context: input.context,
    choices: input.choices,
    operation: input.operation,
  })
  if (!references || references.length === 0) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Item operation ${input.operation.id} has no selected item.`,
    }), mutations: [] }
  }
  assertEquipped(references, input.operation)
  const actor = input.context.actor.placement
  const recipientPlacements = input.recipientIds.map(id => input.context.queries.placements.get(id))
    .filter((placement): placement is SheetPlacement => placement !== null)
  const candidates = [actor, ...recipientPlacements.filter(placement => placement.id !== actor.id)]
  const throwDestination = payload.action === 'throw'
    ? placementForRole({ role: 'first-recipient', ...input })
    : null
  if (payload.action === 'throw') {
    assertReferencesOwnedBy({ references, placement: actor, operation: input.operation, label: 'thrown item' })
    if (references.length !== 1) {
      return { result: unavailable({
        operation: input.operation,
        policy: payload.onUnavailable,
        code: 'selection-ambiguous',
        message: `Throw operation ${input.operation.id} requires exactly one held item.`,
      }), mutations: [] }
    }
  }

  const mutations = references.map((reference, index): MoveItemMutation => {
    const ownerPlacement = sourceOwnerPlacement({
      reference,
      context: input.context,
      candidates,
      operation: input.operation,
    })
    const destinationPlacement = throwDestination ?? ownerPlacement
    return {
      id: mutationId(input.operation.id, index),
      kind: 'ground-item-add',
      reasonCode: input.operation.reasonCode,
      source: reference,
      destination: {
        kind: 'map-ground-item',
        owner: {
          kind: 'map',
          slug: input.context.map.slug,
          revision: normalizeRevision(input.context.map.revision),
        },
        itemId: groundItemId(input.operation.id, reference, index),
        position: { ...destinationPlacement.position },
        sideId: ownerPlacement.sideId ?? null,
        ownerPlacementId: ownerPlacement.id,
      },
      quantity: payload.quantity,
    }
  })
  ensureMutationLimit(mutations, input.operation)
  return {
    result: applied({ operation: input.operation, mutations, itemCount: references.length }),
    mutations,
  }
}

const interpretConsumeDestroyOrStore = (
  input: InterpretOperationInput,
): OperationInterpretation => {
  const payload = input.operation.payload
  if (
    payload.action !== 'consume'
    && payload.action !== 'destroy'
    && payload.action !== 'store-buff'
  ) {
    return fail('unsupported-operation', `Operation ${input.operation.id} is not consumptive.`)
  }
  const references = resolveSelection({
    selection: payload.item,
    context: input.context,
    choices: input.choices,
    operation: input.operation,
  })
  if (!references || references.length === 0) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Item operation ${input.operation.id} has no selected item.`,
    }), mutations: [] }
  }
  if ((payload.action === 'consume' || payload.action === 'store-buff') && references.length !== 1) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-ambiguous',
      message: `Item operation ${input.operation.id} requires exactly one item stack.`,
    }), mutations: [] }
  }
  if (references.some(reference => (
    payload.quantity > reference.quantity
    || (reference.stack === 'singleton' && payload.quantity !== 1)
  ))) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Item operation ${input.operation.id} requests unavailable quantity.`,
    }), mutations: [] }
  }
  if (payload.action === 'store-buff') {
    assertReferencesOwnedBy({
      references,
      placement: input.context.actor.placement,
      operation: input.operation,
      label: 'buff source',
    })
    if (storedDigestionBuffId(input.context, input.context.actor.placement) !== null) {
      return { result: unavailable({
        operation: input.operation,
        policy: payload.onUnavailable,
        code: 'destination-occupied',
        message: `Item operation ${input.operation.id} actor already stores a digestion buff.`,
      }), mutations: [] }
    }
  }
  const mutations = references.map((reference, index): MoveItemMutation => {
    const common = {
      id: mutationId(input.operation.id, index),
      reasonCode: input.operation.reasonCode,
    }
    if (payload.action === 'destroy') {
      return { ...common, kind: 'destroy', source: reference, quantity: payload.quantity }
    }
    if (payload.action === 'consume') {
      return {
        ...common,
        kind: 'consume',
        source: reference,
        quantity: payload.quantity,
        consumptionId: payload.consumptionId,
      }
    }
    return {
      ...common,
      kind: 'store-digestion-buff',
      source: reference,
      destination: digestionDestination(input.context, input.context.actor.placement),
      quantity: 1,
      consumptionId: payload.consumptionId,
    }
  })
  ensureMutationLimit(mutations, input.operation)
  return {
    result: applied({ operation: input.operation, mutations, itemCount: references.length }),
    mutations,
  }
}

const interpretRestore = (input: InterpretOperationInput): OperationInterpretation => {
  const payload = input.operation.payload
  if (payload.action !== 'restore') {
    return fail('unsupported-operation', `Operation ${input.operation.id} is not restore.`)
  }
  const consumed = input.context.queries.items.consumedById(payload.consumptionId)
  if (!consumed) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Restore operation ${input.operation.id} has no recorded consumption ${payload.consumptionId}.`,
    }), mutations: [] }
  }

  let mutation: MoveItemMutation
  if (payload.mode === 'effect') {
    mutation = {
      id: mutationId(input.operation.id, 0),
      kind: 'reuse-consumed',
      reasonCode: input.operation.reasonCode,
      consumptionId: consumed.consumptionId,
    }
  }
  else {
    const placement = placementForRole({
      role: payload.destination === 'actor-held' ? 'actor' : 'first-recipient',
      ...input,
    })
    if (heldItemCount(input.context, placement) > 0) {
      return { result: unavailable({
        operation: input.operation,
        policy: payload.onUnavailable,
        code: 'destination-occupied',
        message: `Restore operation ${input.operation.id} destination ${placement.id} is occupied.`,
        outcome: 'prevented',
      }), mutations: [] }
    }
    mutation = {
      id: mutationId(input.operation.id, 0),
      kind: 'restore-consumed',
      reasonCode: input.operation.reasonCode,
      consumptionId: consumed.consumptionId,
      destination: heldDestination(input.context, placement),
    }
  }
  const mutations = [mutation]
  return { result: applied({ operation: input.operation, mutations, itemCount: 1 }), mutations }
}

const interpretSuppression = (input: InterpretOperationInput): OperationInterpretation => {
  const payload = input.operation.payload
  if (payload.action !== 'suppress') {
    return fail('unsupported-operation', `Operation ${input.operation.id} is not suppression.`)
  }
  if (input.recipientIds.length === 0) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'recipient-count-invalid',
      message: `Item suppression ${input.operation.id} requires at least one recipient.`,
    }), mutations: [] }
  }
  if (input.recipientIds.length > MOVE_ITEM_EFFECT_INTERPRETER_LIMITS.recipients) {
    return fail('recipient-count-invalid', `Item suppression ${input.operation.id} has too many recipients.`)
  }
  if (new Set(input.recipientIds).size !== input.recipientIds.length) {
    return fail('recipient-count-invalid', `Item suppression ${input.operation.id} duplicates a recipient.`)
  }
  const recipientPlacements = input.recipientIds.map(id => (
    input.context.queries.placements.get(id)
      ?? fail('recipient-count-invalid', `Item suppression recipient ${id} is unavailable.`)
  ))
  const bindingsByPlacement = new Map<string, string[]>()
  let itemCount = payload.scope === 'all-equipped'
    ? recipientPlacements.reduce(
        (count, placement) => count + heldItemCount(input.context, placement),
        0,
      )
    : 0
  if (payload.scope === 'selected-items' && payload.item) {
    const references = resolveSelection({
      selection: payload.item,
      context: input.context,
      choices: input.choices,
      operation: input.operation,
    })
    if (!references || references.length === 0) {
      return { result: unavailable({
        operation: input.operation,
        policy: payload.onUnavailable,
        code: 'selection-unavailable',
        message: `Item suppression ${input.operation.id} has no selected item.`,
      }), mutations: [] }
    }
    assertEquipped(references, input.operation)
    const bindingOwners = new Map<string, string>()
    for (const reference of references) {
      const placement = sourceOwnerPlacement({
        reference,
        context: input.context,
        candidates: recipientPlacements,
        operation: input.operation,
      })
      const bindingId = moveItemEffectBindingId(reference)
      const previousOwner = bindingOwners.get(bindingId)
      if (previousOwner && previousOwner !== placement.id) {
        return fail('binding-collision', `Opaque item binding ${bindingId} resolves to multiple recipients.`)
      }
      bindingOwners.set(bindingId, placement.id)
      const bindings = bindingsByPlacement.get(placement.id) ?? []
      if (!bindings.includes(bindingId)) bindings.push(bindingId)
      bindingsByPlacement.set(placement.id, bindings)
      itemCount += 1
    }
  }
  const targets = recipientPlacements.flatMap(placement => {
    const itemBindingIds = bindingsByPlacement.get(placement.id) ?? []
    if (payload.scope === 'selected-items' && itemBindingIds.length === 0) return []
    return [{ placementId: placement.id, itemBindingIds }]
  })
  if (targets.length === 0) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Item suppression ${input.operation.id} has no eligible target item.`,
    }), mutations: [] }
  }
  const mutations: MoveItemMutation[] = [{
    id: mutationId(input.operation.id, 0),
    kind: 'item-suppress',
    reasonCode: input.operation.reasonCode,
    effectId: payload.effectId,
    sourceMoveId: input.operation.source.id,
    sourcePlacementId: input.context.actor.placement.id,
    targets,
    scope: payload.scope === 'all-equipped' ? 'all-equipped' : 'item-bindings',
    blocksUse: payload.blocksUse,
    blocksBenefit: payload.blocksBenefit,
    duration: payload.duration,
    replacement: payload.replacement,
  }]
  return { result: applied({ operation: input.operation, mutations, itemCount }), mutations }
}

const interpretDigestBuff = (input: InterpretOperationInput): OperationInterpretation => {
  const payload = input.operation.payload
  if (payload.action !== 'digest-buff') {
    return fail('unsupported-operation', `Operation ${input.operation.id} is not digest-buff.`)
  }
  const actor = input.context.actor.placement
  const storedItemId = storedDigestionBuffId(input.context, actor)
  if (
    storedItemId === null
    || (
      payload.canonicalItemIds !== null
      && !payload.canonicalItemIds.includes(storedItemId)
    )
  ) {
    return { result: unavailable({
      operation: input.operation,
      policy: payload.onUnavailable,
      code: 'selection-unavailable',
      message: `Item operation ${input.operation.id} has no eligible stored digestion buff.`,
    }), mutations: [] }
  }
  const destination = digestionDestination(input.context, actor)
  const mutations: MoveItemMutation[] = [{
    id: mutationId(input.operation.id, 0),
    kind: 'digest-buff',
    reasonCode: input.operation.reasonCode,
    owner: destination.owner,
    canonicalItemIds: payload.canonicalItemIds,
  }]
  return { result: applied({ operation: input.operation, mutations, itemCount: 1 }), mutations }
}

interface InterpretOperationInput {
  readonly operation: MoveItemEffectOperation
  readonly recipientIds: readonly string[]
  readonly context: AuthoritativeMoveRulesContext
  readonly choices: readonly MoveSpecResolvedItemChoice[]
}

interface OperationInterpretation {
  readonly result: InterpretedMoveItemEffectResult
  readonly mutations: readonly MoveItemMutation[]
}

const interpretOperation = (input: InterpretOperationInput): OperationInterpretation => {
  const action = input.operation.payload.action
  if (action === 'give' || action === 'steal') return interpretGiveOrSteal(input)
  if (action === 'swap') return interpretSwap(input)
  if (action === 'knock-to-ground' || action === 'throw') return interpretGrounding(input)
  if (action === 'consume' || action === 'destroy' || action === 'store-buff') {
    return interpretConsumeDestroyOrStore(input)
  }
  if (action === 'restore') return interpretRestore(input)
  if (action === 'suppress') return interpretSuppression(input)
  if (action === 'digest-buff') return interpretDigestBuff(input)
  return fail('unsupported-operation', `Item operation ${input.operation.id} is unsupported.`)
}

/**
 * Compile reviewed high-level item behavior into the existing bounded physical
 * mutation union. This layer reads immutable context/choice data and never
 * mutates map, sheets, inventory, or encounter state.
 */
export const interpretMoveItemEffects = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operations: readonly MoveResolvedItemEffectOperation[]
  readonly resolvedItemChoices: readonly MoveSpecResolvedItemChoice[]
  readonly contextForOperation?: (
    operation: MoveItemEffectOperation,
  ) => AuthoritativeMoveRulesContext
}): InterpretedMoveItemEffects => {
  const mutations: MoveItemMutation[] = []
  const results: InterpretedMoveItemEffectResult[] = []
  const operationIds = new Set<string>()
  for (const emission of input.operations) {
    if (operationIds.has(emission.operation.id)) {
      return fail('unsupported-operation', `Item operation ${emission.operation.id} is duplicated.`)
    }
    operationIds.add(emission.operation.id)
    const interpreted = interpretOperation({
      operation: emission.operation,
      recipientIds: emission.recipientIds,
      context: input.contextForOperation?.(emission.operation) ?? input.context,
      choices: input.resolvedItemChoices,
    })
    mutations.push(...interpreted.mutations)
    results.push(interpreted.result)
    if (mutations.length > MOVE_ITEM_EFFECT_INTERPRETER_LIMITS.mutations) {
      return fail(
        'mutation-limit-exceeded',
        `Move item effects emitted more than ${MOVE_ITEM_EFFECT_INTERPRETER_LIMITS.mutations} mutations.`,
      )
    }
  }
  const ids = mutations.map(mutation => mutation.id)
  if (new Set(ids).size !== ids.length) {
    return fail('unsupported-operation', 'Move item effects emitted duplicate mutation IDs.')
  }
  return deepFreeze({ mutations, results })
}

/** Project private reducer completion into the private audit trace only. */
export const applyMoveItemEffectResultsToTrace = (input: {
  readonly trace: MoveResolutionAuditTrace
  readonly interpretation: InterpretedMoveItemEffects
  readonly mutationResults: readonly MoveItemMutationOperationResult[]
}): MoveResolutionAuditTrace => {
  const mutationResults = new Map(input.mutationResults.map(result => [result.operationId, result]))
  const itemResults = new Map(input.interpretation.results.map(result => [result.operationId, result]))
  const events = input.trace.events.map((event) => {
    if (event.kind !== 'operation' || event.operationKind !== 'item') return event
    const result = itemResults.get(event.operationId)
      ?? fail('trace-result-missing', `Item trace operation ${event.operationId} has no interpretation.`)
    const reduced = result.mutationIds.map(id => mutationResults.get(id)
      ?? fail('trace-result-missing', `Item mutation ${id} has no reducer result.`))
    return {
      ...event,
      outcome: result.outcome,
      result: {
        status: result.outcome,
        action: result.action,
        outcomeCode: result.outcomeCode,
        itemCount: result.itemCount,
        mutationCount: result.mutationIds.length,
        quantityEffects: reduced.flatMap(entry => entry.quantityEffects),
        consumptionIds: [...new Set(reduced.flatMap(entry => (
          entry.consumptionId === null ? [] : [entry.consumptionId]
        )))],
        resourceScopeCount: new Set(reduced.flatMap(entry => entry.resourceScopes.map(scope => (
          scope.kind === 'sheet'
            ? `sheet:${scope.sheetKind}:${scope.slug}`
            : `${scope.kind}:${scope.slug}`
        )))).size,
      },
    }
  })
  return parseMoveResolutionAuditTrace({ ...input.trace, events })
}
