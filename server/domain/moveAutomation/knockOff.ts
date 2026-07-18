import {
  parseMoveEffectOperation,
  type MoveChoiceRequestEffectOperation,
  type MoveItemEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  parseMoveItemChoiceDeclaration,
  type MoveItemChoiceDeclaration,
} from '#shared/moveAutomation/itemChoices'
import type { MoveItemReference } from '#shared/moveAutomation/items'
import {
  MOVE_RESPONSE_OPTION_LIMITS,
  type PendingMoveResponseOption,
} from '#shared/moveAutomation/responseOptions'
import type {
  MoveResolutionAuditTraceEventInput,
  MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import type { SheetPlacement } from '~/types/map'
import type { AuthoritativeMoveRulesContext } from './context'
import {
  enumerateAuthoritativeMoveItemChoices,
  revalidateAuthoritativeMoveItemChoice,
  type AuthoritativeMoveItemChoice,
  type AuthoritativeMoveItemChoiceSet,
} from './itemChoices'
import {
  interpretMoveItemEffects,
  type InterpretedMoveItemEffects,
} from './itemEffectInterpreter'
import type { AuthoritativeMoveItemResourceQueries } from './itemResources'

export const KNOCK_OFF_ITEM_REQUIREMENT_ID = 'knock-off.target-equipped'
export const KNOCK_OFF_ITEM_SET_ID = 'knock-off.target-items'
export const KNOCK_OFF_ITEM_REQUEST_ID = 'knock-off.item-window'

/**
 * Frozen PTU damage facts that are independent from the target's items.
 * Knock Off has no item-presence damage modifier in the repository ruleset;
 * its item clause is ordered after qualifying damage.
 */
export const KNOCK_OFF_DAMAGE_INTERACTION = Object.freeze({
  damageClass: 'physical' as const,
  damageBase: 7,
  moveType: 'dark' as const,
  itemPresenceModifier: 'none' as const,
  itemEffectTiming: 'after-damage' as const,
  requiresPositiveDamage: true,
})

export const KNOCK_OFF_ITEM_CHOICE_DECLARATION: MoveItemChoiceDeclaration =
  parseMoveItemChoiceDeclaration({
    setId: KNOCK_OFF_ITEM_SET_ID,
    requirementId: KNOCK_OFF_ITEM_REQUIREMENT_ID,
    owner: 'actor',
    emptyPolicy: 'no-op',
    filter: {
      referenceKinds: ['pokemon-held', 'trainer-equipment-slot'],
      canonicalItemIds: null,
      trainerEquipmentSlots: ['accessory'],
      minimumQuantity: 1,
    },
    destinations: [{
      id: 'knock-off.to-ground',
      kind: 'map-ground',
      labelKey: 'move.item.destination.map-ground',
    }],
    noneOption: null,
  })

const parsedChoiceOperation = parseMoveEffectOperation({
  id: 'knock-off.choose-item',
  kind: 'choice-request',
  source: { kind: 'operation', id: 'knock-off.damage' },
  recipients: { kind: 'damaged-targets' },
  phase: 'after-damage',
  reasonCode: 'knock-off.choose-target-item',
  payload: {
    requestId: KNOCK_OFF_ITEM_REQUEST_ID,
    promptKey: 'move.knock-off.choose-item',
    options: [],
    allowPass: false,
    itemChoice: KNOCK_OFF_ITEM_CHOICE_DECLARATION,
  },
})
if (parsedChoiceOperation.kind !== 'choice-request') {
  throw new Error('Reviewed Knock Off item choice operation has the wrong kind.')
}
export type KnockOffItemChoiceOperation = MoveChoiceRequestEffectOperation & {
  readonly payload: MoveChoiceRequestEffectOperation['payload'] & {
    readonly itemChoice: MoveItemChoiceDeclaration
  }
}

export const KNOCK_OFF_ITEM_CHOICE_OPERATION =
  parsedChoiceOperation as KnockOffItemChoiceOperation

const parsedItemOperation = parseMoveEffectOperation({
  id: 'knock-off.ground-item',
  kind: 'item',
  source: { kind: 'operation', id: KNOCK_OFF_ITEM_CHOICE_OPERATION.id },
  recipients: { kind: 'damaged-targets' },
  phase: 'after-damage',
  reasonCode: 'knock-off.move-item-to-ground',
  payload: {
    action: 'knock-to-ground',
    item: {
      kind: 'choice',
      requestId: KNOCK_OFF_ITEM_REQUEST_ID,
      destinationId: 'knock-off.to-ground',
    },
    quantity: 1,
    onUnavailable: 'reject',
  },
})
if (parsedItemOperation.kind !== 'item') {
  throw new Error('Reviewed Knock Off item mutation operation has the wrong kind.')
}
export const KNOCK_OFF_ITEM_EFFECT_OPERATION: MoveItemEffectOperation = parsedItemOperation

export type KnockOffResolvedCombatOutcome =
  | {
      readonly kind: 'miss'
      readonly targetPlacementId: string
    }
  | {
      readonly kind: 'immune'
      readonly targetPlacementId: string
    }
  | {
      readonly kind: 'hit'
      readonly targetPlacementId: string
      /** Effective authoritative HP damage after prevention and mitigation. */
      readonly damageDealt: number
      readonly criticalHit: boolean
    }

export type KnockOffNoItemReasonCode =
  | 'knock-off.missed'
  | 'knock-off.immune'
  | 'knock-off.no-qualifying-damage'
  | 'knock-off.no-legal-item'

export type KnockOffItemOutcomeTraceEntry = Extract<
  MoveResolutionAuditTraceEventInput,
  { readonly kind: 'operation' }
>

interface KnockOffItemOutcomeBase {
  readonly damageInteraction: typeof KNOCK_OFF_DAMAGE_INTERACTION
  readonly traceEntries: readonly KnockOffItemOutcomeTraceEntry[]
}

export interface KnockOffNoItemOutcome extends KnockOffItemOutcomeBase {
  readonly kind: 'no-item'
  readonly reasonCode: KnockOffNoItemReasonCode
  /** Null means item resources were intentionally not consulted. */
  readonly legalItemCount: number | null
}

/** Private server-only request; authorized public views must redact itemSelection. */
export interface KnockOffPendingItemRequest {
  readonly kind: 'item-choice'
  readonly itemSetId: string
  readonly requirementId: string
  readonly operationId: string
  readonly phase: 'after-damage'
  readonly reasonCode: string
  readonly recipientIds: readonly string[]
  readonly requestId: string
  readonly promptKey: string
  readonly options: readonly PendingMoveResponseOption[]
  readonly allowPass: false
}

export interface KnockOffPendingItemOutcome extends KnockOffItemOutcomeBase {
  readonly kind: 'pending-choice'
  readonly request: KnockOffPendingItemRequest
}

export interface KnockOffPlannedItemOutcome extends KnockOffItemOutcomeBase {
  readonly kind: 'item-plan'
  readonly selectionMode: 'automatic' | 'durable-response'
  readonly optionId: string
  readonly itemEffects: InterpretedMoveItemEffects
}

export type KnockOffItemOutcome =
  | KnockOffNoItemOutcome
  | KnockOffPendingItemOutcome
  | KnockOffPlannedItemOutcome

export type KnockOffItemOutcomeErrorCode =
  | 'invalid-combat-outcome'
  | 'invalid-target'
  | 'invalid-option-id'
  | 'item-option-unavailable'
  | 'invalid-item-plan'

export class KnockOffItemOutcomeError extends Error {
  readonly code: KnockOffItemOutcomeErrorCode

  constructor(code: KnockOffItemOutcomeErrorCode, message: string) {
    super(message)
    this.name = 'KnockOffItemOutcomeError'
    this.code = code
  }
}

export interface PlanKnockOffItemOutcomeInput {
  readonly context: AuthoritativeMoveRulesContext
  readonly combat: KnockOffResolvedCombatOutcome
  /** Opaque durable option ID only; item identity and destination remain server-owned. */
  readonly selectedOptionId?: string | null
}

const EMPTY_ITEM_REFERENCES = Object.freeze([]) as readonly MoveItemReference[]

const fail = (
  code: KnockOffItemOutcomeErrorCode,
  message: string,
): never => {
  throw new KnockOffItemOutcomeError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const traceJson = (value: MoveResolutionTraceJsonValue): MoveResolutionTraceJsonValue => value

const selectedTarget = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
): SheetPlacement => {
  if (
    context.selectedPlacements.length !== 1
    || context.selectedPlacements[0]?.id !== placementId
  ) {
    return fail(
      'invalid-target',
      'Knock Off requires exactly one authoritative selected target matching its combat outcome.',
    )
  }
  return context.queries.placements.get(placementId)
    ?? fail('invalid-target', `Knock Off target ${placementId} is unavailable.`)
}

const assertCombatOutcome = (combat: KnockOffResolvedCombatOutcome): void => {
  if (
    typeof combat !== 'object'
    || combat === null
    || typeof combat.targetPlacementId !== 'string'
    || combat.targetPlacementId.length === 0
    || combat.targetPlacementId.length > MOVE_RESPONSE_OPTION_LIMITS.placementIdChars
  ) {
    fail('invalid-combat-outcome', 'Knock Off combat outcome has an invalid target identity.')
  }
  if (combat.kind === 'miss' || combat.kind === 'immune') return
  if (
    combat.kind !== 'hit'
    || !Number.isSafeInteger(combat.damageDealt)
    || combat.damageDealt < 0
    || combat.damageDealt > 1_000_000_000
    || typeof combat.criticalHit !== 'boolean'
  ) {
    fail('invalid-combat-outcome', 'Knock Off hit outcome must contain bounded authoritative damage and critical evidence.')
  }
}

const assertOptionId = (optionId: string | null): void => {
  if (optionId === null) return
  if (
    typeof optionId !== 'string'
    || optionId.length === 0
    || optionId.length > MOVE_RESPONSE_OPTION_LIMITS.identifierChars
  ) {
    fail('invalid-option-id', 'Knock Off item selection must be one bounded opaque option ID.')
  }
}

const referenceBelongsToTarget = (
  reference: MoveItemReference,
  target: SheetPlacement,
): boolean => {
  if (
    reference.owner.kind !== 'sheet'
    || reference.owner.sheetKind !== target.sheetKind
    || reference.owner.slug !== target.sheetSlug
  ) return false
  if (target.sheetKind === 'pokemon') return reference.kind === 'pokemon-held'
  return reference.kind === 'trainer-equipment-slot' && reference.slot === 'accessory'
}

const targetItemQueries = (
  context: AuthoritativeMoveRulesContext,
  target: SheetPlacement,
): AuthoritativeMoveItemResourceQueries => {
  const references = Object.freeze(
    context.queries.items
      .forRequirement(KNOCK_OFF_ITEM_REQUIREMENT_ID)
      .filter(reference => referenceBelongsToTarget(reference, target)),
  )
  return Object.freeze({
    all: () => references,
    forRequirement: (requirementId: string) => (
      requirementId === KNOCK_OFF_ITEM_REQUIREMENT_ID
        ? references
        : EMPTY_ITEM_REFERENCES
    ),
    consumedById: () => null,
  })
}

const choiceSetFor = (
  context: AuthoritativeMoveRulesContext,
  target: SheetPlacement,
): AuthoritativeMoveItemChoiceSet => enumerateAuthoritativeMoveItemChoices({
  declaration: KNOCK_OFF_ITEM_CHOICE_DECLARATION,
  items: targetItemQueries(context, target),
})

const combatTraceInput = (
  combat: KnockOffResolvedCombatOutcome,
): MoveResolutionTraceJsonValue => traceJson({
  combatOutcome: combat.kind,
  damageDealt: combat.kind === 'hit' ? combat.damageDealt : 0,
  criticalHit: combat.kind === 'hit' ? combat.criticalHit : false,
  damageBase: KNOCK_OFF_DAMAGE_INTERACTION.damageBase,
  itemPresenceModifier: KNOCK_OFF_DAMAGE_INTERACTION.itemPresenceModifier,
  itemEffectTiming: KNOCK_OFF_DAMAGE_INTERACTION.itemEffectTiming,
})

const outcomeTrace = (input: {
  readonly combat: KnockOffResolvedCombatOutcome
  readonly recipientIds: readonly string[]
  readonly outcome: KnockOffItemOutcomeTraceEntry['outcome']
  readonly result: MoveResolutionTraceJsonValue
}): KnockOffItemOutcomeTraceEntry => deepFreeze({
  kind: 'operation',
  phase: 'after-damage',
  operationId: KNOCK_OFF_ITEM_CHOICE_OPERATION.id,
  operationKind: KNOCK_OFF_ITEM_CHOICE_OPERATION.kind,
  recipientIds: [...input.recipientIds],
  outcome: input.outcome,
  reasonCode: KNOCK_OFF_ITEM_CHOICE_OPERATION.reasonCode,
  input: combatTraceInput(input.combat),
  result: input.result,
})

const noItemOutcome = (input: {
  readonly combat: KnockOffResolvedCombatOutcome
  readonly reasonCode: KnockOffNoItemReasonCode
  readonly legalItemCount: number | null
  readonly recipientIds: readonly string[]
}): KnockOffNoItemOutcome => deepFreeze({
  kind: 'no-item',
  reasonCode: input.reasonCode,
  legalItemCount: input.legalItemCount,
  damageInteraction: KNOCK_OFF_DAMAGE_INTERACTION,
  traceEntries: [outcomeTrace({
    combat: input.combat,
    recipientIds: input.recipientIds,
    outcome: 'no-op',
    result: traceJson({
      status: 'no-item',
      reasonCode: input.reasonCode,
      legalItemCount: input.legalItemCount,
    }),
  })],
})

const pendingOutcome = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly combat: Extract<KnockOffResolvedCombatOutcome, { readonly kind: 'hit' }>
  readonly set: AuthoritativeMoveItemChoiceSet
  readonly target: SheetPlacement
}): KnockOffPendingItemOutcome => deepFreeze({
  kind: 'pending-choice',
  damageInteraction: KNOCK_OFF_DAMAGE_INTERACTION,
  request: {
    kind: 'item-choice',
    itemSetId: input.set.setId,
    requirementId: input.set.requirementId,
    operationId: KNOCK_OFF_ITEM_CHOICE_OPERATION.id,
    phase: 'after-damage',
    reasonCode: KNOCK_OFF_ITEM_CHOICE_OPERATION.reasonCode,
    recipientIds: [input.context.actor.placement.id],
    requestId: KNOCK_OFF_ITEM_REQUEST_ID,
    promptKey: KNOCK_OFF_ITEM_CHOICE_OPERATION.payload.promptKey,
    options: input.set.choices.map(choice => choice.option),
    allowPass: false,
  },
  traceEntries: [outcomeTrace({
    combat: input.combat,
    recipientIds: [input.target.id],
    outcome: 'pending',
    result: traceJson({
      status: 'item-choice-required',
      requestId: KNOCK_OFF_ITEM_REQUEST_ID,
      optionCount: input.set.choices.length,
      owner: input.set.owner,
    }),
  })],
})

const selectedChoice = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly target: SheetPlacement
  readonly set: AuthoritativeMoveItemChoiceSet
  readonly optionId: string | null
}): { readonly choice: AuthoritativeMoveItemChoice; readonly mode: 'automatic' | 'durable-response' } => {
  if (input.optionId === null) {
    if (input.set.choices.length !== 1) {
      return fail('item-option-unavailable', 'Knock Off cannot automatically select an ambiguous item outcome.')
    }
    return { choice: input.set.choices[0]!, mode: 'automatic' }
  }
  try {
    return {
      choice: revalidateAuthoritativeMoveItemChoice({
        declaration: KNOCK_OFF_ITEM_CHOICE_DECLARATION,
        items: targetItemQueries(input.context, input.target),
        optionId: input.optionId,
      }),
      mode: 'durable-response',
    }
  }
  catch {
    return fail('item-option-unavailable', 'The selected Knock Off item option is no longer legal.')
  }
}

const plannedOutcome = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly combat: Extract<KnockOffResolvedCombatOutcome, { readonly kind: 'hit' }>
  readonly target: SheetPlacement
  readonly set: AuthoritativeMoveItemChoiceSet
  readonly optionId: string | null
}): KnockOffPlannedItemOutcome => {
  const selected = selectedChoice({
    context: input.context,
    target: input.target,
    set: input.set,
    optionId: input.optionId,
  })
  if (selected.choice.reference === null || selected.choice.destination?.kind !== 'map-ground') {
    return fail('invalid-item-plan', 'Knock Off resolved a non-item or non-ground destination branch.')
  }
  const itemEffects = interpretMoveItemEffects({
    context: input.context,
    operations: [{
      operation: KNOCK_OFF_ITEM_EFFECT_OPERATION,
      recipientIds: [input.target.id],
    }],
    resolvedItemChoices: [{
      operationId: KNOCK_OFF_ITEM_CHOICE_OPERATION.id,
      requestId: KNOCK_OFF_ITEM_REQUEST_ID,
      optionId: selected.choice.option.id,
      choice: selected.choice,
    }],
  })
  if (
    itemEffects.mutations.length !== 1
    || itemEffects.mutations[0]?.kind !== 'ground-item-add'
    || itemEffects.results[0]?.outcome !== 'applied'
  ) {
    return fail('invalid-item-plan', 'Knock Off did not produce exactly one typed ground-item transfer.')
  }
  const itemTrace: KnockOffItemOutcomeTraceEntry = deepFreeze({
    kind: 'operation',
    phase: 'after-damage',
    operationId: KNOCK_OFF_ITEM_EFFECT_OPERATION.id,
    operationKind: KNOCK_OFF_ITEM_EFFECT_OPERATION.kind,
    recipientIds: [input.target.id],
    outcome: 'applied',
    reasonCode: KNOCK_OFF_ITEM_EFFECT_OPERATION.reasonCode,
    input: traceJson({
      action: KNOCK_OFF_ITEM_EFFECT_OPERATION.payload.action,
      quantity: itemEffects.mutations[0].quantity,
      destination: 'map-ground',
    }),
    result: traceJson({
      status: 'planned',
      mutationIds: itemEffects.mutations.map(mutation => mutation.id),
      selectionMode: selected.mode,
    }),
  })
  return deepFreeze({
    kind: 'item-plan',
    selectionMode: selected.mode,
    optionId: selected.choice.option.id,
    damageInteraction: KNOCK_OFF_DAMAGE_INTERACTION,
    itemEffects,
    traceEntries: [
      outcomeTrace({
        combat: input.combat,
        recipientIds: [input.target.id],
        outcome: 'applied',
        result: traceJson({
          status: selected.mode === 'automatic' ? 'auto-selected' : 'selected',
          legalItemCount: input.set.choices.length,
          optionId: selected.choice.option.id,
        }),
      }),
      itemTrace,
    ],
  })
}

/**
 * Pure Knock Off item-outcome seam. It consumes only a server-resolved combat
 * fact plus immutable authoritative context, accepts at most an opaque durable
 * option ID, and emits no repository writes or arbitrary patches.
 */
export const planKnockOffItemOutcome = (
  input: PlanKnockOffItemOutcomeInput,
): KnockOffItemOutcome => {
  assertCombatOutcome(input.combat)
  const optionId = input.selectedOptionId ?? null
  assertOptionId(optionId)
  const target = selectedTarget(input.context, input.combat.targetPlacementId)

  if (input.combat.kind === 'miss') {
    return noItemOutcome({
      combat: input.combat,
      reasonCode: 'knock-off.missed',
      legalItemCount: null,
      recipientIds: [],
    })
  }
  if (input.combat.kind === 'immune') {
    return noItemOutcome({
      combat: input.combat,
      reasonCode: 'knock-off.immune',
      legalItemCount: null,
      recipientIds: [],
    })
  }
  if (input.combat.damageDealt === 0) {
    return noItemOutcome({
      combat: input.combat,
      reasonCode: 'knock-off.no-qualifying-damage',
      legalItemCount: null,
      recipientIds: [target.id],
    })
  }

  const set = choiceSetFor(input.context, target)
  if (set.choices.length === 0) {
    if (optionId !== null) {
      return fail('item-option-unavailable', 'The selected Knock Off option has no current legal item.')
    }
    return noItemOutcome({
      combat: input.combat,
      reasonCode: 'knock-off.no-legal-item',
      legalItemCount: 0,
      recipientIds: [target.id],
    })
  }
  if (set.choices.length > 1 && optionId === null) {
    return pendingOutcome({ context: input.context, combat: input.combat, set, target })
  }
  return plannedOutcome({ context: input.context, combat: input.combat, target, set, optionId })
}
