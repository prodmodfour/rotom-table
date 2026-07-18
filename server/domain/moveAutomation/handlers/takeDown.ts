import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'

export const TAKE_DOWN_HANDLER_ID = 'move.take-down.damage-and-recoil'
export const TAKE_DOWN_HANDLER_VERSION = 1

export const TAKE_DOWN_DAMAGE_OPERATION_ID = 'take-down.damage'
export const TAKE_DOWN_RECOIL_OPERATION_ID = 'take-down.recoil'

const RECKLESS_ABILITY = 'Reckless'
const RECOIL_IMMUNITY_ABILITIES = Object.freeze(['Rock Head', 'Magic Guard'] as const)
const BASE_DAMAGE_BASE = 9
const RECKLESS_DAMAGE_BASE_BONUS = 3

/**
 * Resolve Take Down's directly referenced Ability interactions without parsing
 * move or Ability prose at runtime. The handler may choose only between the
 * reviewed typed damage/recoil operations below; repositories and randomness
 * remain owned by the ordinary interpreter and planner.
 */
export const TAKE_DOWN_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration = Object.freeze({
  id: TAKE_DOWN_HANDLER_ID,
  version: TAKE_DOWN_HANDLER_VERSION,
  run: (context: RegisteredMoveHandlerContext) => {
    const actorPlacementId = context.actor.placement.id
    const reckless = context.queries.creatureRules.hasAbility(
      actorPlacementId,
      RECKLESS_ABILITY,
    )
    const recoilImmunity = RECOIL_IMMUNITY_ABILITIES.find(ability => (
      context.queries.creatureRules.hasAbility(actorPlacementId, ability)
    )) ?? null
    const damageBase = BASE_DAMAGE_BASE + (reckless ? RECKLESS_DAMAGE_BASE_BONUS : 0)

    return {
      operations: [
        {
          id: TAKE_DOWN_DAMAGE_OPERATION_ID,
          kind: 'damage',
          source: { kind: 'operation', id: 'take-down.accuracy' },
          recipients: { kind: 'hit-targets' },
          phase: 'damage',
          reasonCode: reckless
            ? 'take-down.physical-damage-reckless'
            : 'take-down.physical-damage',
          payload: {
            damageClass: 'physical',
            damageBase,
            moveType: 'normal',
            accuracyRollId: 'take-down.accuracy-roll',
            criticalRollId: 'take-down.accuracy-roll',
          },
        },
        ...(recoilImmunity
          ? []
          : [{
              id: TAKE_DOWN_RECOIL_OPERATION_ID,
              kind: 'direct-hp',
              source: { kind: 'operation', id: TAKE_DOWN_DAMAGE_OPERATION_ID },
              recipients: { kind: 'actor' },
              phase: 'damage',
              reasonCode: 'take-down.recoil-one-third',
              payload: {
                mode: 'lose',
                pool: 'hit-points',
                calculation: {
                  kind: 'damage-dealt',
                  damageOperationId: TAKE_DOWN_DAMAGE_OPERATION_ID,
                  percent: 100 / 3,
                  aggregation: 'aggregate',
                  preventedDamage: 'zero',
                },
                copySource: null,
                bounds: { minimum: null, maximum: null },
                rounding: 'floor',
                applyTypeImmunity: false,
                cost: null,
                injury: {
                  hitPointMarkers: 'apply-after-operation',
                  massiveDamage: 'never',
                },
              },
            }]),
      ],
      traceEntries: [
        {
          kind: 'predicate',
          phase: 'damage',
          predicateId: 'take-down.reckless-ability',
          outcome: reckless,
          reasonCode: reckless
            ? 'take-down.reckless-damage-base-applied'
            : 'take-down.reckless-ability-absent',
          input: {
            abilityId: RECKLESS_ABILITY,
            baseDamageBase: BASE_DAMAGE_BASE,
            damageBase,
          },
        },
        {
          kind: 'predicate',
          phase: 'damage',
          predicateId: 'take-down.recoil-immunity',
          outcome: recoilImmunity !== null,
          reasonCode: recoilImmunity
            ? 'take-down.recoil-prevented'
            : 'take-down.recoil-applies',
          input: {
            blockedBy: recoilImmunity,
          },
        },
      ],
    }
  },
})
