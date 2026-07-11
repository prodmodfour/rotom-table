import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Dragon Rage.
 *
 * The server-owned accuracy d20 determines hit recipients. The direct-HP
 * reducer then applies exactly 15 real HP loss while honoring Dragon immunity;
 * no damage, Stat, effectiveness multiplier, STAB, or critical-hit pipeline is
 * entered.
 */
export const DRAGON_RAGE_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Dragon Rage',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'dragon-rage.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.dragon-rage' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'dragon-rage.accuracy-check',
        payload: {
          rollId: 'dragon-rage.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'dragon-rage.fixed-hp-loss',
        kind: 'direct-hp',
        source: { kind: 'operation', id: 'dragon-rage.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'dragon-rage.fixed-hp-loss',
        payload: {
          mode: 'lose',
          pool: 'hit-points',
          calculation: { kind: 'fixed', value: 15 },
          copySource: null,
          bounds: { minimum: null, maximum: null },
          rounding: 'floor',
          accuracyRollId: 'dragon-rage.accuracy-roll',
          applyTypeImmunity: true,
          cost: null,
          injury: {
            hitPointMarkers: 'apply-after-operation',
            massiveDamage: 'never',
          },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'dragon-rage.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.dragon-rage' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'dragon-rage.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'dragon-rage.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'dragon-rage.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.dragon-rage' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'dragon-rage.completed',
        payload: {
          messageKey: 'move.dragon-rage.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Dragon Rage',
    vfxKey: 'move.dragon-rage',
    tags: ['direct-hp', 'special'],
  },
} as const satisfies MoveSpec)

export const DRAGON_RAGE_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Dragon Rage',
  sourceModule: 'server/domain/moveAutomation/specs/dragonRage.ts',
  spec: DRAGON_RAGE_MOVE_SPEC,
})
