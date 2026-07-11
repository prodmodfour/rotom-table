import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Ember.
 *
 * The server owns the accuracy d20 used for hit, critical-hit, and Burn
 * threshold decisions. Damage and the hit-only condition are then reduced in
 * one authoritative plan.
 */
export const EMBER_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Ember',
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
        id: 'ember.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.ember' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'ember.accuracy-check',
        payload: {
          rollId: 'ember.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'ember.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'ember.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'ember.special-damage',
        payload: {
          damageClass: 'special',
          damageBase: 4,
          moveType: 'fire',
          accuracyRollId: 'ember.accuracy-roll',
          criticalRollId: 'ember.accuracy-roll',
          criticalHit: {
            trigger: { kind: 'range', minimum: 20 },
            prevention: 'honor',
          },
        },
      }],
    },
    {
      phase: 'after-damage',
      operations: [{
        id: 'ember.burn',
        kind: 'condition',
        source: { kind: 'operation', id: 'ember.damage' },
        recipients: { kind: 'hit-targets' },
        phase: 'after-damage',
        reasonCode: 'ember.burned-on-18-plus',
        payload: {
          action: 'apply',
          conditionId: 'burned',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          accuracyRollTrigger: {
            rollId: 'ember.accuracy-roll',
            trigger: { kind: 'range', minimum: 18 },
          },
          duration: null,
          saveTiming: 'canonical',
          stackPolicy: { kind: 'refresh', maxStacks: null },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'ember.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.ember' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'ember.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'ember.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'ember.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.ember' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'ember.completed',
        payload: {
          messageKey: 'move.ember.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Ember',
    vfxKey: 'move.ember',
    tags: ['condition', 'damage'],
  },
} as const satisfies MoveSpec)

export const EMBER_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Ember',
  sourceModule: 'server/domain/moveAutomation/specs/ember.ts',
  spec: EMBER_MOVE_SPEC,
})
