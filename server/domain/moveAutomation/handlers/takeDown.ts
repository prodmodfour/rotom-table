import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'

export const TAKE_DOWN_RECKLESS_ABILITY = 'Reckless' as const
export const TAKE_DOWN_RECKLESS_DAMAGE_BASE_BONUS = 3 as const
export const TAKE_DOWN_BASE_DAMAGE_BASE = 9 as const
export const TAKE_DOWN_HANDLER_ID = 'take-down.contextual-damage' as const

/**
 * Resolve Take Down's directly referenced ability and recoil interactions from
 * the immutable actor snapshot. The handler emits only bounded typed effects;
 * accuracy, damage dice, HP reduction, and every later Trip roll remain owned
 * by the ordinary interpreter and reducers.
 */
const runTakeDownHandler = (context: RegisteredMoveHandlerContext) => {
  context.reads.recordPlacement(context.actor.placement)
  const reckless = sheetHasCanonicalAbility(
    context.actor.token.abilityNames,
    TAKE_DOWN_RECKLESS_ABILITY,
  )
  const damageBase = TAKE_DOWN_BASE_DAMAGE_BASE
    + (reckless ? TAKE_DOWN_RECKLESS_DAMAGE_BASE_BONUS : 0)

  return {
    operations: [
      {
        id: 'take-down.damage',
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
      {
        id: 'take-down.recoil',
        kind: 'direct-hp',
        source: { kind: 'operation', id: 'take-down.damage' },
        recipients: { kind: 'actor' },
        phase: 'damage',
        reasonCode: 'take-down.recoil-one-third',
        payload: {
          mode: 'lose',
          pool: 'hit-points',
          calculation: {
            kind: 'damage-dealt',
            damageOperationId: 'take-down.damage',
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
      },
    ],
    traceEntries: [{
      kind: 'predicate',
      phase: 'damage',
      predicateId: 'take-down.reckless-damage-base',
      outcome: reckless,
      reasonCode: reckless
        ? 'take-down.reckless-applied'
        : 'take-down.reckless-absent',
      input: {
        baseDamageBase: TAKE_DOWN_BASE_DAMAGE_BASE,
        damageBaseBonus: reckless ? TAKE_DOWN_RECKLESS_DAMAGE_BASE_BONUS : 0,
        resolvedDamageBase: damageBase,
      },
    }],
  }
}

export const TAKE_DOWN_MOVE_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({
    id: TAKE_DOWN_HANDLER_ID,
    version: 1,
    run: runTakeDownHandler,
  })
