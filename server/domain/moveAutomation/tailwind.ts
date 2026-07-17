import {
  TAILWIND_EFFECT_ID_PREFIX,
  TAILWIND_EFFECT_TAG,
  TAILWIND_INITIATIVE_BONUS,
} from '#shared/moveAutomation/globalFields'

export { isTailwindInitiativeEffect } from '#shared/moveAutomation/globalFields'
import {
  parseEncounterEffect,
  type EncounterEffectSource,
  type EncounterNumericModifierEffect,
} from '#shared/moveAutomation/encounterEffects'
import { isEncounterSideId, type EncounterSideId } from '#shared/moveAutomation/encounterState'

export interface CreateTailwindInitiativeEffectInput {
  readonly sideId: EncounterSideId
  readonly source: EncounterEffectSource
  readonly createdRound: number
  readonly createdTurn: number
}

export type TailwindInitiativeEffect = EncounterNumericModifierEffect & {
  readonly duration: { readonly kind: 'scene'; readonly remaining: null }
  readonly affected: {
    readonly placementIds: readonly []
    readonly sideIds: readonly [EncounterSideId]
    readonly cells: readonly []
  }
  readonly payload: {
    readonly attribute: 'initiative'
    readonly operation: 'add'
    readonly value: typeof TAILWIND_INITIATIVE_BONUS
    readonly rounding: 'none'
  }
}

export const tailwindInitiativeEffectId = (sideId: EncounterSideId): string => {
  if (!isEncounterSideId(sideId)) {
    throw new Error('Tailwind requires one valid authoritative encounter side ID.')
  }
  return `${TAILWIND_EFFECT_ID_PREFIX}${sideId}`
}

/**
 * Materialize one canonical side-owned Tailwind instance. Its stable per-side
 * identity plus refresh policy makes repeated applications refresh rather than
 * stack, and scene duration delegates expiry to authoritative lifecycle facts.
 */
export const createTailwindInitiativeEffect = (
  input: CreateTailwindInitiativeEffectInput,
): TailwindInitiativeEffect => parseEncounterEffect({
  id: tailwindInitiativeEffectId(input.sideId),
  kind: 'numeric-modifier',
  source: input.source,
  affected: {
    placementIds: [],
    sideIds: [input.sideId],
    cells: [],
  },
  createdRound: input.createdRound,
  createdTurn: input.createdTurn,
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'refresh', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: [TAILWIND_EFFECT_TAG, 'initiative'],
  payload: {
    attribute: 'initiative',
    operation: 'add',
    value: TAILWIND_INITIATIVE_BONUS,
    rounding: 'none',
  },
  dispel: { policy: 'matching-tags', tags: [TAILWIND_EFFECT_TAG] },
  transferPolicy: 'retain',
  suppression: { sources: [] },
}, 'tailwind.effect') as TailwindInitiativeEffect
