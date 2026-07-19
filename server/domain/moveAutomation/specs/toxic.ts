import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

const actorHasPoisonType = {
  kind: 'any',
  predicates: (['primary', 'secondary'] as const).map(of => ({
    kind: 'comparison' as const,
    operator: 'equal' as const,
    left: {
      kind: 'type' as const,
      of,
      subject: { kind: 'actor' as const },
    },
    right: { kind: 'constant' as const, value: 'poison' },
  })),
} as const

/** Reviewed native-v2 definition for canonical PTU Toxic. */
export const TOXIC_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Toxic',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [{
    id: 'toxic.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'toxic.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.toxic' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'toxic.accuracy-check',
        payload: {
          rollId: 'toxic.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
          accuracyRule: {
            kind: 'automatic-hit-when',
            predicate: actorHasPoisonType,
            sourceId: 'toxic.poison-user',
            reasonCode: 'toxic.poison-user-automatic-hit',
          },
        },
      }],
    },
    {
      phase: 'hit',
      operations: [{
        id: 'toxic.badly-poisoned',
        kind: 'condition',
        source: { kind: 'operation', id: 'toxic.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'toxic.apply-badly-poisoned',
        payload: {
          action: 'apply',
          conditionId: 'badly-poisoned',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          duration: null,
          saveTiming: 'canonical',
          stackPolicy: { kind: 'refresh', maxStacks: null },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'toxic.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.toxic' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'toxic.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'toxic.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'toxic.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.toxic' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'toxic.completed',
        payload: {
          messageKey: 'move.toxic.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Toxic',
    vfxKey: 'move.toxic',
    tags: ['condition', 'poison', 'automatic-hit'],
  },
} as const satisfies MoveSpec)

export const TOXIC_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Toxic',
  sourceModule: 'server/domain/moveAutomation/specs/toxic.ts',
  spec: TOXIC_MOVE_SPEC,
})
