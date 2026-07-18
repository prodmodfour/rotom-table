import {
  EncounterEffectValidationError,
  parseEncounterEffect,
  type EncounterEffect,
  type EncounterEffectAffected,
  type EncounterEffectSource,
  type EncounterNumericModifierEffect,
  type EncounterNumericModifierEffectDefinition,
} from '#shared/moveAutomation/encounterEffects'
import {
  encounterStateHasSide,
  type EncounterSideDirectory,
  type EncounterSideId,
} from '#shared/moveAutomation/encounterState'
import {
  applyEncounterEffectLifecycleEvent,
  type EncounterEffectAppliedLifecycleEvent,
  type EncounterEffectLifecycleResult,
  type EncounterEffectLifecycleState,
  type EncounterEffectSceneEndLifecycleEvent,
  type EncounterEffectTriggeredLifecycleEvent,
} from './effectLifecycle'

export const REFLECT_MOVE_SOURCE_ID = 'move.reflect' as const
export const REFLECT_OPERATION_ID = 'reflect.apply-side-blessing' as const
export const REFLECT_EFFECT_BASE_ID = 'reflect.blessing' as const
export const REFLECT_ACTIVATIONS = 2 as const
export const REFLECT_RESISTANCE_STEPS = 1 as const

export const REFLECT_SIDE_EFFECT_TAGS = Object.freeze([
  'blessing',
  'damage-resistance',
  'reflect',
  'side-condition',
] as const)

/** Closed mechanics payload consulted by the damage pipeline in MA-172B. */
export interface ReflectSideEffectPayload {
  readonly attribute: 'damage-reduction'
  readonly operation: 'resist-step'
  readonly value: typeof REFLECT_RESISTANCE_STEPS
  readonly rounding: 'none'
  readonly damageClass: 'physical'
}

export type ReflectSideEffect = Omit<
  EncounterNumericModifierEffect,
  | 'affected'
  | 'charges'
  | 'chargePolicy'
  | 'dispel'
  | 'duration'
  | 'payload'
  | 'stackPolicy'
  | 'stacks'
  | 'tags'
  | 'transferPolicy'
> & {
  readonly affected: EncounterEffectAffected & {
    readonly placementIds: readonly []
    readonly sideIds: readonly [EncounterSideId]
    readonly cells: readonly []
  }
  readonly duration: { readonly kind: 'scene'; readonly remaining: null }
  readonly stacks: 1
  readonly charges: 1 | typeof REFLECT_ACTIVATIONS
  readonly stackPolicy: { readonly kind: 'replace'; readonly maxStacks: null }
  readonly chargePolicy: { readonly kind: 'consume-on-trigger'; readonly amount: 1 }
  readonly tags: typeof REFLECT_SIDE_EFFECT_TAGS
  readonly payload: ReflectSideEffectPayload
  readonly dispel: {
    readonly policy: 'matching-tags'
    readonly tags: readonly ['blessing']
  }
  readonly transferPolicy: 'retain'
}

export const REFLECT_SIDE_EFFECT_DEFINITION = Object.freeze({
  kind: 'numeric-modifier',
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: REFLECT_ACTIVATIONS,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
  tags: REFLECT_SIDE_EFFECT_TAGS,
  payload: {
    attribute: 'damage-reduction',
    operation: 'resist-step',
    value: REFLECT_RESISTANCE_STEPS,
    rounding: 'none',
    damageClass: 'physical',
  },
  dispel: { policy: 'matching-tags', tags: ['blessing'] },
  transferPolicy: 'retain',
} as const satisfies EncounterNumericModifierEffectDefinition)

export type ReflectSideEffectErrorCode =
  | 'actor-side-required'
  | 'invalid-reflect-effect'
  | 'reflect-effect-not-found'

export class ReflectSideEffectError extends Error {
  readonly code: ReflectSideEffectErrorCode

  constructor(code: ReflectSideEffectErrorCode, message: string) {
    super(message)
    this.name = 'ReflectSideEffectError'
    this.code = code
  }
}

const fail = (code: ReflectSideEffectErrorCode, message: string): never => {
  throw new ReflectSideEffectError(code, message)
}

const sameOrderedValues = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length && left.every((value, index) => value === right[index])

const reflectEffectId = (sideId: EncounterSideId): string => (
  `${REFLECT_EFFECT_BASE_ID}.${sideId}`
)

/** Match only the reviewed, side-owned physical resistance shape used by Reflect. */
export const isReflectSideEffect = (
  effect: EncounterEffect,
): effect is ReflectSideEffect => {
  if (
    effect.kind !== 'numeric-modifier'
    || effect.source.moveId !== REFLECT_MOVE_SOURCE_ID
    || effect.source.operationId !== REFLECT_OPERATION_ID
    || effect.affected.placementIds.length !== 0
    || effect.affected.sideIds.length !== 1
    || effect.affected.cells.length !== 0
  ) return false

  const sideId = effect.affected.sideIds[0]!
  return (
    effect.id === reflectEffectId(sideId)
    && effect.duration.kind === 'scene'
    && effect.stacks === 1
    && (effect.charges === 1 || effect.charges === REFLECT_ACTIVATIONS)
    && effect.stackPolicy.kind === 'replace'
    && effect.chargePolicy.kind === 'consume-on-trigger'
    && effect.chargePolicy.amount === 1
    && sameOrderedValues(effect.tags, REFLECT_SIDE_EFFECT_TAGS)
    && effect.payload.attribute === 'damage-reduction'
    && effect.payload.operation === 'resist-step'
    && effect.payload.value === REFLECT_RESISTANCE_STEPS
    && effect.payload.rounding === 'none'
    && effect.payload.damageClass === 'physical'
    && effect.dispel.policy === 'matching-tags'
    && sameOrderedValues(effect.dispel.tags, ['blessing'])
    && effect.transferPolicy === 'retain'
  )
}

/** Strictly parse the bounded Reflect subset of the generic encounter-effect union. */
export const parseReflectSideEffect = (
  value: unknown,
  path = 'reflectSideEffect',
): ReflectSideEffect => {
  let effect: EncounterEffect
  try {
    effect = parseEncounterEffect(value, path)
  }
  catch (error) {
    if (error instanceof EncounterEffectValidationError) {
      return fail('invalid-reflect-effect', error.message)
    }
    throw error
  }
  if (!isReflectSideEffect(effect)) {
    return fail(
      'invalid-reflect-effect',
      `${path} must be the canonical side-owned Reflect effect with one or two charges.`,
    )
  }
  return effect
}

export interface ReflectEffectActor {
  readonly id: string
  readonly sideId?: EncounterSideId | null
}

/** Resolve ownership from explicit authoritative side state and never from token control. */
export const resolveReflectOwningSide = (input: {
  readonly actor: ReflectEffectActor
  readonly sides: EncounterSideDirectory
}): EncounterSideId => {
  if (!encounterStateHasSide({ sides: input.sides }, input.actor.sideId)) {
    return fail(
      'actor-side-required',
      `Reflect actor ${input.actor.id} must belong to an explicit encounter side.`,
    )
  }
  return input.actor.sideId
}

export interface CreateReflectSideEffectInput {
  readonly actor: ReflectEffectActor
  readonly sides: EncounterSideDirectory
  readonly createdRound: number
  readonly createdTurn: number
}

/** Create one deterministic side-owned instance without mutating encounter state. */
export const createReflectSideEffect = (
  input: CreateReflectSideEffectInput,
): ReflectSideEffect => {
  const sideId = resolveReflectOwningSide(input)
  const source: EncounterEffectSource = {
    operationId: REFLECT_OPERATION_ID,
    moveId: REFLECT_MOVE_SOURCE_ID,
    placementId: input.actor.id,
  }
  return parseReflectSideEffect({
    id: reflectEffectId(sideId),
    kind: REFLECT_SIDE_EFFECT_DEFINITION.kind,
    source,
    affected: {
      placementIds: [],
      sideIds: [sideId],
      cells: [],
    },
    createdRound: input.createdRound,
    createdTurn: input.createdTurn,
    duration: REFLECT_SIDE_EFFECT_DEFINITION.duration,
    stacks: REFLECT_SIDE_EFFECT_DEFINITION.stacks,
    charges: REFLECT_SIDE_EFFECT_DEFINITION.charges,
    stackPolicy: REFLECT_SIDE_EFFECT_DEFINITION.stackPolicy,
    chargePolicy: REFLECT_SIDE_EFFECT_DEFINITION.chargePolicy,
    tags: REFLECT_SIDE_EFFECT_DEFINITION.tags,
    payload: REFLECT_SIDE_EFFECT_DEFINITION.payload,
    dispel: REFLECT_SIDE_EFFECT_DEFINITION.dispel,
    transferPolicy: REFLECT_SIDE_EFFECT_DEFINITION.transferPolicy,
    suppression: { sources: [] },
  })
}

export type ReflectSideEffectLifecycleEvent =
  | EncounterEffectAppliedLifecycleEvent
  | EncounterEffectTriggeredLifecycleEvent
  | EncounterEffectSceneEndLifecycleEvent

/**
 * Apply only Reflect's reviewed creation, activation, and scene-expiry events
 * through the generic immutable lifecycle reducer. Damage eligibility remains
 * outside this foundation seam until MA-172B.
 */
export const applyReflectSideEffectLifecycleEvent = (
  state: EncounterEffectLifecycleState,
  event: ReflectSideEffectLifecycleEvent,
): EncounterEffectLifecycleResult => {
  if (event.kind === 'effect-applied') {
    return applyEncounterEffectLifecycleEvent(state, {
      kind: 'effect-applied',
      effect: parseReflectSideEffect(event.effect, 'reflectLifecycleEvent.effect'),
    })
  }
  if (event.kind === 'effect-triggered') {
    const effect = state.effects.find(candidate => candidate.id === event.effectId)
    if (!effect || !isReflectSideEffect(effect)) {
      return fail(
        'reflect-effect-not-found',
        `Reflect effect ${event.effectId} is not an active canonical Reflect side effect.`,
      )
    }
  }
  return applyEncounterEffectLifecycleEvent(state, event)
}
