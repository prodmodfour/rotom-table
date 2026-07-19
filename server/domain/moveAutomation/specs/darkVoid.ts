import {
  DARK_VOID_BURST_BRANCH_ID,
  DARK_VOID_SINGLE_TARGET_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'
import type { MoveSpec } from '#shared/moveAutomation/spec'
import { DARK_VOID_HANDLER_ID } from '../handlers/darkVoid'
import type { MoveSpecV2Registration } from '../registry'

const singleTargetRule = {
  kind: 'single-target',
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'selected-targets' },
} as const

/** Reviewed native-v2 definition for both canonical PTU Dark Void forms. */
export const DARK_VOID_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Dark Void',
  version: 2,
  targeting: {
    ...singleTargetRule,
    branches: [{
      id: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      ...singleTargetRule,
    }, {
      id: DARK_VOID_BURST_BRANCH_ID,
      kind: 'area',
      minTargets: 0,
      maxTargets: 32,
      selector: { kind: 'candidate-targets' },
      predicate: {
        relationship: 'any',
        willingness: 'any',
        excludeActor: true,
      },
    }],
  },
  preconditions: [],
  costs: [{
    id: 'dark-void.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'dark-void.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.dark-void' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'dark-void.accuracy-check',
        payload: {
          rollId: 'dark-void.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'hit',
      operations: [{
        id: 'dark-void.sleep',
        kind: 'condition',
        source: { kind: 'operation', id: 'dark-void.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'dark-void.apply-sleep',
        payload: {
          action: 'apply',
          conditionId: 'sleep',
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
        id: 'dark-void.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.dark-void' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'dark-void.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'dark-void.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'dark-void.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.dark-void' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'dark-void.completed',
        payload: {
          messageKey: 'move.dark-void.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: DARK_VOID_HANDLER_ID,
  presentation: {
    displayName: 'Dark Void',
    vfxKey: 'move.dark-void',
    tags: ['area', 'condition', 'sleep', 'alternate-frequency'],
  },
} as const satisfies MoveSpec)

export const DARK_VOID_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Dark Void',
  sourceModule: 'server/domain/moveAutomation/specs/darkVoid.ts',
  spec: DARK_VOID_MOVE_SPEC,
})
