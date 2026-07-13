import { describe, expect, it } from 'vitest'
import {
  MOVE_EFFECT_OPERATION_KINDS,
  MOVE_EFFECT_OPERATION_LIMITS,
  MOVE_EFFECT_RECIPIENT_SELECTOR_KINDS,
  MOVE_EFFECT_SOURCE_KINDS,
  MoveEffectOperationValidationError,
  parseMoveEffectOperation,
  parseMoveEffectOperations,
  type MoveEffectOperationKind,
  type MoveEffectOperationValidationCode,
} from '#shared/moveAutomation/effects'

const VALID_PAYLOADS = {
  roll: {
    rollId: 'roll.accuracy',
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 2 },
  },
  check: {
    kind: 'opposed',
    checkId: 'check.push',
    actorRoll: {
      rollId: 'roll.push.actor',
      source: {
        kind: 'stat',
        stat: 'attack',
        combatStagePolicy: 'honor',
        stageModifierPolicy: 'honor',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
      modifiers: [],
      reroll: { count: 0, keep: 'latest' },
      resourceReroll: null,
    },
    targetRoll: {
      rollId: 'roll.push.target',
      source: { kind: 'skill', skill: 'athletics' },
      modifiers: [],
      reroll: { count: 0, keep: 'latest' },
      resourceReroll: null,
    },
    tie: { kind: 'failure' },
    branches: { success: 'branch.push', failure: 'branch.no-push' },
  },
  branch: {
    kind: 'predicate',
    selectionId: 'branch.low-health',
    scope: 'recipient',
    predicate: {
      kind: 'comparison',
      operator: 'less-than',
      left: {
        kind: 'hp-ratio',
        subject: { kind: 'current-target' },
        ratio: 'current-to-maximum',
      },
      right: { kind: 'constant', value: 0.5 },
    },
    whenTrue: { id: 'branch.heal', operationIds: ['operation.heal'] },
    whenFalse: { id: 'branch.damage', operationIds: ['operation.damage'] },
  },
  damage: {
    damageClass: 'physical',
    damageBase: 4,
    moveType: 'normal',
    accuracyRollId: 'roll.accuracy',
    criticalRollId: 'roll.critical',
  },
  'multi-hit': {
    count: { kind: 'fixed', hits: 2 },
    accuracy: {
      kind: 'per-hit',
      rollId: 'roll.strike-accuracy',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      stopOnMiss: false,
    },
    critical: { kind: 'accuracy' },
    damage: {
      damageClass: 'physical',
      damageBase: 4,
      moveType: 'normal',
      accuracyRollId: null,
      criticalRollId: null,
    },
    effects: [{
      id: 'effect.defense-drop',
      timing: 'after-each',
      trigger: 'damage',
      recipient: 'target',
      kind: 'combat-stage',
      reasonCode: 'move.scratch.defense-drop',
      payload: {
        action: 'modify',
        stage: 'def',
        selectedStage: null,
        value: -1,
        stageSource: null,
        rounding: null,
      },
    }],
  },
  'direct-hp':  {
    mode: 'lose',
    pool: 'hit-points',
    calculation: { kind: 'fixed', value: 10 },
    copySource: null,
    bounds: { minimum: 1, maximum: null },
    rounding: 'floor',
    accuracyRollId: null,
    applyTypeImmunity: true,
    cost: null,
    injury: {
      hitPointMarkers: 'apply-after-operation',
      massiveDamage: 'never',
    },
  },
  heal: {
    mode: 'gain',
    pool: 'hit-points',
    calculation: { kind: 'percent-max', percent: 50 },
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
  condition: {
    action: 'apply',
    conditionId: 'burned',
    conditionSource: null,
    filter: null,
    randomChoice: null,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
  'combat-stage': {
    action: 'modify',
    stage: 'atk',
    selectedStage: null,
    value: 1,
    stageSource: null,
    rounding: null,
  },
  'temporary-effect': {
    action: 'add',
    effectId: 'effect.helping-hand',
    definition: {
      kind: 'numeric-modifier',
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      stacks: 1,
      charges: 1,
      stackPolicy: { kind: 'refresh', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      tags: ['next-attack'],
      payload: {
        attribute: 'damage',
        operation: 'multiply',
        value: 1.5,
        rounding: 'floor',
      },
      dispel: { policy: 'none', tags: [] },
    },
  },
  field: {
    action: 'apply',
    category: 'weather',
    fieldId: 'sunny',
    rounds: 5,
  },
  hazard: {
    action: 'add',
    hazardId: 'hazard.spikes',
    hazardKind: 'spikes',
    cellSetId: 'cells.spikes',
    layers: 1,
  },
  'movement-request': {
    requestId: 'movement.tackle',
    mode: 'forced',
    distance: 2,
    destinationSetId: null,
  },
  usage: {
    action: 'spend',
    resourceId: 'move.daily-use',
    amount: 1,
  },
  history: {
    event: 'move-completed',
    detailCode: 'outcome.hit',
  },
  log: {
    messageKey: 'move.damage.applied',
    arguments: [
      { key: 'amount', value: 12 },
      { key: 'critical', value: false },
      { key: 'type', value: 'Normal' },
    ],
  },
  'choice-request': {
    requestId: 'choice.pollen-puff',
    promptKey: 'move.choice.branch',
    options: [
      { id: 'damage', labelKey: 'move.choice.damage' },
      { id: 'heal', labelKey: 'move.choice.heal' },
    ],
    allowPass: false,
  },
  'reaction-request': {
    requestId: 'reaction.protect',
    promptKey: 'move.reaction.protect',
    options: [{ id: 'protect', labelKey: 'move.reaction.use-protect' }],
    allowPass: true,
    timing: 'pre-damage',
    priority: 10,
  },
} satisfies Record<MoveEffectOperationKind, unknown>

const validOperation = (
  kind: MoveEffectOperationKind = 'damage',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: `operation.${kind}`,
  kind,
  source: { kind: 'move', id: 'move.scratch' },
  recipients: { kind: kind === 'roll' ? 'none' : 'hit-targets' },
  phase: kind === 'roll' ? 'accuracy' : 'damage',
  reasonCode: `move.scratch.${kind}`,
  payload: structuredClone(VALID_PAYLOADS[kind]),
  ...overrides,
})

const expectEffectError = (
  value: unknown,
  code: MoveEffectOperationValidationCode,
  path?: string,
): MoveEffectOperationValidationError => {
  try {
    parseMoveEffectOperation(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveEffectOperationValidationError)
    expect((error as MoveEffectOperationValidationError).code).toBe(code)
    if (path) expect((error as MoveEffectOperationValidationError).path).toBe(path)
    return error as MoveEffectOperationValidationError
  }
}

const expectDeeplyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

describe('MoveSpec typed effect operations', () => {
  it('defines and parses the complete seed operation union', () => {
    expect(MOVE_EFFECT_OPERATION_KINDS).toEqual([
      'roll',
      'check',
      'branch',
      'damage',
      'multi-hit',
      'direct-hp',
      'heal',
      'condition',
      'combat-stage',
      'temporary-effect',
      'field',
      'hazard',
      'movement-request',
      'usage',
      'history',
      'log',
      'choice-request',
      'reaction-request',
    ])

    const parsed = MOVE_EFFECT_OPERATION_KINDS.map(kind =>
      parseMoveEffectOperation(validOperation(kind)),
    )

    expect(parsed.map(operation => operation.kind)).toEqual(MOVE_EFFECT_OPERATION_KINDS)
    expect(parsed.map(operation => operation.payload)).toEqual(
      MOVE_EFFECT_OPERATION_KINDS.map(kind => VALID_PAYLOADS[kind]),
    )
    parsed.forEach((operation) => {
      expect(operation).toMatchObject({
        source: { kind: 'move', id: 'move.scratch' },
        reasonCode: expect.stringContaining('move.scratch.'),
      })
      expect(Object.keys(operation)).toEqual([
        'id',
        'source',
        'recipients',
        'phase',
        'reasonCode',
        'kind',
        'payload',
      ])
    })
  })

  it('supports each bounded payload variant without accepting generic metadata', () => {
    expect(parseMoveEffectOperation(validOperation('roll', {
      payload: {
        rollId: 'roll.uniform',
        formula: { kind: 'uniform-integer', minimum: -2, maximum: 5 },
      },
    })).payload).toEqual({
      rollId: 'roll.uniform',
      formula: { kind: 'uniform-integer', minimum: -2, maximum: 5 },
    })
    expect(parseMoveEffectOperation(validOperation('roll', {
      payload: {
        rollId: 'roll.table',
        formula: { kind: 'table', tableId: 'table.five-strike' },
      },
    })).payload).toEqual({
      rollId: 'roll.table',
      formula: { kind: 'table', tableId: 'table.five-strike' },
    })
    const save = parseMoveEffectOperation(validOperation('check', {
      payload: {
        kind: 'save',
        checkId: 'check.escape',
        roll: {
          rollId: 'roll.escape',
          source: {
            kind: 'choice',
            requestId: 'request.escape-stat',
            promptKey: 'move.escape.choose-stat',
            options: [{
              id: 'speed',
              labelKey: 'stat.speed',
              source: {
                kind: 'stat',
                stat: 'speed',
                combatStagePolicy: 'honor',
                stageModifierPolicy: 'honor',
                formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
              },
            }, {
              id: 'athletics',
              labelKey: 'skill.athletics',
              source: { kind: 'skill', skill: 'athletics' },
            }],
          },
          modifiers: [{
            sourceId: 'effect.escape-bonus',
            reasonCode: 'effect.escape-bonus',
            value: { kind: 'constant', value: 2 },
          }],
          reroll: { count: 1, keep: 'highest' },
          resourceReroll: {
            requestId: 'request.escape-reroll',
            promptKey: 'move.escape.spend-resource',
            resourceId: 'resource.action-point',
            amount: 1,
            trigger: 'on-failure',
            spendOption: { id: 'spend', labelKey: 'choice.spend' },
            declineOption: { id: 'decline', labelKey: 'choice.decline' },
          },
        },
        dc: {
          kind: 'arithmetic',
          operator: 'add',
          operands: [
            { kind: 'constant', value: 10 },
            { kind: 'stat', subject: { kind: 'actor' }, stat: 'level' },
          ],
        },
        tie: { kind: 'reroll', maximumRerolls: 2, exhaustedOutcome: 'failure' },
        branches: { success: 'branch.escaped', failure: 'branch.trapped' },
      },
    }))
    expect(save.kind === 'check' && save.payload).toMatchObject({
      kind: 'save',
      checkId: 'check.escape',
      roll: {
        source: { kind: 'choice' },
        reroll: { count: 1, keep: 'highest' },
        resourceReroll: { resourceId: 'resource.action-point', amount: 1 },
      },
      tie: { kind: 'reroll', maximumRerolls: 2 },
    })
    const tableMultiHit = parseMoveEffectOperation(validOperation('multi-hit', {
      payload: {
        ...VALID_PAYLOADS['multi-hit'],
        count: {
          kind: 'table',
          scope: 'sequence',
          rollId: 'roll.hit-count',
          tableId: 'table.five-strike',
          drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
          entries: [
            { minimum: 8, maximum: 8, hits: 5 },
            { minimum: 1, maximum: 3, hits: 2 },
            { minimum: 4, maximum: 7, hits: 3 },
          ],
        },
        accuracy: { kind: 'automatic' },
        critical: {
          kind: 'per-hit',
          rollId: 'roll.critical',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      },
    }))
    expect(tableMultiHit.kind === 'multi-hit' && tableMultiHit.payload).toMatchObject({
      count: {
        kind: 'table',
        entries: [
          { minimum: 1, maximum: 3, hits: 2 },
          { minimum: 4, maximum: 7, hits: 3 },
          { minimum: 8, maximum: 8, hits: 5 },
        ],
      },
      accuracy: { kind: 'automatic' },
      critical: { kind: 'per-hit' },
    })
    const selectedDamage = parseMoveEffectOperation(validOperation('damage', {
      payload: {
        ...VALID_PAYLOADS.damage,
        attackStat: {
          kind: 'max',
          values: [
            {
              kind: 'stat',
              subject: { kind: 'actor' },
              stat: 'attack',
              combatStagePolicy: 'honor',
              stageModifierPolicy: 'honor',
            },
            {
              kind: 'stat',
              subject: { kind: 'actor' },
              stat: 'special-attack',
              combatStagePolicy: 'honor',
              stageModifierPolicy: 'honor',
            },
          ],
        },
        defenseStat: {
          kind: 'stat',
          subject: { kind: 'current-target' },
          stat: 'defense',
          combatStagePolicy: 'ignore-positive',
          stageModifierPolicy: 'honor',
        },
      },
    }))
    expect(selectedDamage.kind === 'damage' && selectedDamage.payload).toMatchObject({
      attackStat: { kind: 'max' },
      defenseStat: {
        kind: 'stat',
        stat: 'defense',
        combatStagePolicy: 'ignore-positive',
        stageModifierPolicy: 'honor',
      },
    })
    const overrideDamage = parseMoveEffectOperation(validOperation('damage', {
      payload: {
        ...VALID_PAYLOADS.damage,
        moveType: { kind: 'type', of: 'primary', subject: { kind: 'actor' } },
        typeEffectiveness: {
          immunity: 'ignore',
          resistance: 'honor',
          weakness: 'honor',
          effectivenessOverride: null,
          defenderTypeOverrides: [{ defenderType: 'water', relation: 'weak' }],
        },
        criticalHit: {
          trigger: { kind: 'natural-rolls', values: [20, 18, 16, 14, 12, 10, 8, 6, 4, 2] },
          prevention: 'honor',
        },
      },
    }))
    expect(overrideDamage.kind === 'damage' && overrideDamage.payload).toMatchObject({
      moveType: { kind: 'type', of: 'primary' },
      typeEffectiveness: {
        immunity: 'ignore',
        defenderTypeOverrides: [{ defenderType: 'water', relation: 'weak' }],
      },
      criticalHit: {
        trigger: { kind: 'natural-rolls', values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
        prevention: 'honor',
      },
    })
    const contextualDamage = parseMoveEffectOperation(validOperation('damage', {
      payload: {
        ...VALID_PAYLOADS.damage,
        damageBase: {
          kind: 'expression',
          expression: {
            kind: 'lookup-table',
            input: {
              kind: 'condition',
              subject: { kind: 'current-target' },
              conditionId: 'burned',
            },
            entries: [{ key: true, value: { kind: 'constant', value: 12 } }],
            fallback: { kind: 'constant', value: 6 },
          },
          minimum: 1,
          maximum: 20,
          rounding: 'floor',
          stabTiming: 'after-bounds',
        },
      },
    }))
    expect(contextualDamage.kind === 'damage' && contextualDamage.payload.damageBase)
      .toMatchObject({
        kind: 'expression',
        minimum: 1,
        maximum: 20,
        rounding: 'floor',
        stabTiming: 'after-bounds',
        expression: { kind: 'lookup-table' },
      })
    const triggeredCondition = parseMoveEffectOperation(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        accuracyRollTrigger: {
          rollId: 'roll.accuracy',
          trigger: { kind: 'natural-rolls', values: [20, 18, 19] },
        },
      },
    }))
    expect(triggeredCondition.kind === 'condition' && triggeredCondition.payload)
      .toMatchObject({
        accuracyRollTrigger: {
          rollId: 'roll.accuracy',
          trigger: { kind: 'natural-rolls', values: [18, 19, 20] },
        },
      })
    expect(parseMoveEffectOperation(validOperation('condition', {
      payload: { action: 'clear', conditionId: null },
    })).payload).toEqual({
      action: 'clear',
      conditionId: null,
      conditionSource: null,
      filter: null,
      randomChoice: null,
      duration: null,
      saveTiming: 'canonical',
      stackPolicy: { kind: 'refresh', maxStacks: null },
    })
    expect(parseMoveEffectOperation(validOperation('combat-stage', {
      payload: { action: 'reset', stage: 'all', value: null },
    })).payload).toEqual({
      action: 'reset',
      stage: 'all',
      selectedStage: null,
      value: null,
      stageSource: null,
      rounding: null,
    })
    expect(parseMoveEffectOperation(validOperation('temporary-effect', {
      payload: { action: 'remove', effectId: 'effect.helping-hand' },
    })).payload).toEqual({ action: 'remove', effectId: 'effect.helping-hand' })
    expect(parseMoveEffectOperation(validOperation('field', {
      payload: { action: 'remove', category: 'weather', fieldId: 'sunny' },
    })).payload).toEqual({ action: 'remove', category: 'weather', fieldId: 'sunny' })
    expect(parseMoveEffectOperation(validOperation('hazard', {
      payload: { action: 'remove', hazardId: 'hazard.spikes' },
    })).payload).toEqual({ action: 'remove', hazardId: 'hazard.spikes' })
  })

  it('parses typed condition transforms, cleanse groups, randomness, timing, and stacking', () => {
    const clear = parseMoveEffectOperation(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'clear',
        conditionId: null,
        filter: {
          groups: ['major', 'volatile'],
          conditionIds: ['tripped'],
          excludedConditionIds: ['sleep'],
        },
      },
    }))
    expect(clear.kind === 'condition' && clear.payload).toMatchObject({
      action: 'clear',
      filter: {
        groups: ['major', 'volatile'],
        conditionIds: ['tripped'],
        excludedConditionIds: ['sleep'],
      },
    })

    const transfer = parseMoveEffectOperation(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'transfer',
        conditionId: 'poisoned',
        conditionSource: { kind: 'actor' },
      },
    }))
    expect(transfer.kind === 'condition' && transfer.payload.conditionSource)
      .toEqual({ kind: 'actor' })

    const replace = parseMoveEffectOperation(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'replace',
        conditionId: 'sleep',
        filter: {
          groups: ['persistent'],
          conditionIds: [],
          excludedConditionIds: [],
        },
      },
    }))
    expect(replace.kind === 'condition' && replace.payload.action).toBe('replace')

    const random = parseMoveEffectOperation(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'random-choice',
        conditionId: null,
        randomChoice: {
          rollId: 'roll.random-condition',
          conditionIds: ['burned', 'frozen', 'paralysis'],
        },
        duration: {
          effectId: 'effect.random-condition',
          duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
        },
        saveTiming: 'end-turn',
        stackPolicy: { kind: 'add-stack', maxStacks: 3 },
      },
    }))
    expect(random.kind === 'condition' && random.payload).toMatchObject({
      action: 'random-choice',
      randomChoice: {
        rollId: 'roll.random-condition',
        conditionIds: ['burned', 'frozen', 'paralysis'],
      },
      duration: {
        effectId: 'effect.random-condition',
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      },
      saveTiming: 'end-turn',
      stackPolicy: { kind: 'add-stack', maxStacks: 3 },
    })
    if (random.kind !== 'condition') throw new Error('Expected condition operation')
    expect(Object.isFrozen(random.payload.duration?.duration)).toBe(true)
  })

  it('rejects ambiguous or unbounded typed condition policies', () => {
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'transfer',
        conditionId: 'burned',
      },
    }), 'invalid-effect-operation', 'operation.payload.conditionSource')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'random-choice',
        conditionId: null,
        randomChoice: { rollId: 'roll.condition', conditionIds: ['burned'] },
      },
    }), 'invalid-effect-operation', 'operation.payload.randomChoice.conditionIds')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'clear',
        conditionId: null,
        filter: {
          groups: ['all', 'major'],
          conditionIds: [],
          excludedConditionIds: [],
        },
      },
    }), 'invalid-effect-operation', 'operation.payload.filter.groups')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        stackPolicy: { kind: 'independent-instance', maxStacks: null },
      },
    }), 'invalid-effect-operation', 'operation.payload.stackPolicy')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        saveTiming: 'none',
      },
    }), 'invalid-effect-operation', 'operation.payload.saveTiming')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'remove',
        duration: {
          effectId: 'effect.invalid',
          duration: { kind: 'scene', remaining: null },
        },
      },
    }), 'invalid-effect-operation', 'operation.payload.duration')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        accuracyRollTrigger: {
          rollId: 'roll.accuracy',
          trigger: { kind: 'always' },
        },
      },
    }), 'invalid-effect-operation', 'operation.payload.accuracyRollTrigger.trigger.kind')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        action: 'remove',
        accuracyRollTrigger: {
          rollId: 'roll.accuracy',
          trigger: { kind: 'range', minimum: 18 },
        },
      },
    }), 'invalid-effect-operation', 'operation.payload.accuracyRollTrigger')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        accuracyRollTrigger: {
          rollId: 'roll.accuracy',
          trigger: { kind: 'range', minimum: 21 },
        },
      },
    }), 'limit-exceeded', 'operation.payload.accuracyRollTrigger.trigger.minimum')
    expectEffectError(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        accuracyRollTrigger: {
          rollId: 'roll.accuracy',
          trigger: { kind: 'range', minimum: 18 },
          naturalResult: 20,
        },
      },
    }), 'invalid-effect-operation', 'operation.payload.accuracyRollTrigger')
  })

  it('parses advanced combat-stage transforms and concrete selected-Stat choices', () => {
    const payloads = [
      {
        action: 'set',
        stage: 'all-stats',
        selectedStage: null,
        value: 2,
        stageSource: null,
        rounding: null,
      },
      {
        action: 'invert',
        stage: 'all',
        selectedStage: null,
        value: null,
        stageSource: null,
        rounding: null,
      },
      {
        action: 'clear-positive',
        stage: 'selected-stat',
        selectedStage: 'def',
        value: null,
        stageSource: null,
        rounding: null,
      },
      {
        action: 'clear-negative',
        stage: 'spd',
        selectedStage: null,
        value: null,
        stageSource: null,
        rounding: null,
      },
      {
        action: 'copy',
        stage: 'all',
        selectedStage: null,
        value: null,
        stageSource: { kind: 'selected-targets' },
        rounding: null,
      },
      {
        action: 'swap',
        stage: 'all-stats',
        selectedStage: null,
        value: null,
        stageSource: null,
        rounding: null,
      },
      {
        action: 'split',
        stage: 'atk',
        selectedStage: null,
        value: null,
        stageSource: null,
        rounding: 'round',
      },
      {
        action: 'transfer',
        stage: 'all',
        selectedStage: null,
        value: null,
        stageSource: { kind: 'current-target' },
        rounding: null,
      },
    ]

    const parsed = payloads.map((payload, index) => parseMoveEffectOperation(
      validOperation('combat-stage', {
        id: `operation.combat-stage-${index}`,
        payload,
      }),
    ))

    expect(parsed.map(operation => operation.payload)).toEqual(payloads)
    parsed.forEach(operation => expectDeeplyFrozen(operation))

    // Existing reviewed delta definitions normalize the new fields explicitly.
    expect(parseMoveEffectOperation(validOperation('combat-stage', {
      payload: { action: 'modify', stage: 'atk', value: 2 },
    })).payload).toEqual({
      action: 'modify',
      stage: 'atk',
      selectedStage: null,
      value: 2,
      stageSource: null,
      rounding: null,
    })
  })

  it('parses every standalone HP calculation and explicit set, copy, split, swap, and full mode', () => {
    const calculations = [
      { kind: 'fixed', value: 12.5 },
      { kind: 'percent-max', percent: 50 },
      { kind: 'percent-current', percent: 25 },
      { kind: 'percent-missing', percent: 75 },
      {
        kind: 'formula',
        expression: {
          kind: 'arithmetic',
          operator: 'divide',
          operands: [
            { kind: 'stat', subject: { kind: 'actor' }, stat: 'maximum-hp' },
            { kind: 'constant', value: 3 },
          ],
        },
      },
    ]
    const parsedCalculations = calculations.map(calculation => parseMoveEffectOperation(
      validOperation('direct-hp', {
        payload: { ...VALID_PAYLOADS['direct-hp'], calculation },
      }),
    ))
    expect(parsedCalculations.map((parsed) => (
      parsed.kind === 'direct-hp' ? parsed.payload.calculation?.kind : null
    ))).toEqual([
      'fixed',
      'percent-max',
      'percent-current',
      'percent-missing',
      'formula',
    ])

    const set = parseMoveEffectOperation(validOperation('direct-hp', {
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        mode: 'set',
        calculation: { kind: 'fixed', value: -5 },
        bounds: { minimum: -10, maximum: 40 },
      },
    }))
    const copy = parseMoveEffectOperation(validOperation('direct-hp', {
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        mode: 'copy',
        calculation: null,
        copySource: { kind: 'actor' },
      },
    }))
    const split = parseMoveEffectOperation(validOperation('direct-hp', {
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        mode: 'split',
        calculation: null,
        copySource: null,
      },
    }))
    const swap = parseMoveEffectOperation(validOperation('direct-hp', {
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        mode: 'swap',
        calculation: null,
        copySource: null,
        applyTypeImmunity: false,
      },
    }))
    const full = parseMoveEffectOperation(validOperation('heal', {
      payload: {
        ...VALID_PAYLOADS.heal,
        mode: 'full',
        calculation: null,
      },
    }))

    expect(set.kind === 'direct-hp' && set.payload).toMatchObject({
      mode: 'set',
      calculation: { kind: 'fixed', value: -5 },
      bounds: { minimum: -10, maximum: 40 },
    })
    expect(copy.kind === 'direct-hp' && copy.payload.copySource).toEqual({ kind: 'actor' })
    expect(split.kind === 'direct-hp' && split.payload.mode).toBe('split')
    expect(swap.kind === 'direct-hp' && swap.payload.mode).toBe('swap')
    expect(full.kind === 'heal' && full.payload).toMatchObject({
      mode: 'full',
      pool: 'hit-points',
      calculation: null,
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    })
    for (const parsed of [...parsedCalculations, set, copy, split, swap, full]) {
      expectDeeplyFrozen(parsed)
    }
  })

  it('parses an explicit server-owned accuracy link for hit-only direct HP', () => {
    const parsed = parseMoveEffectOperation(validOperation('direct-hp', {
      recipients: { kind: 'hit-targets' },
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        accuracyRollId: 'dragon-rage.accuracy-roll',
      },
    }))

    expect(parsed).toMatchObject({
      kind: 'direct-hp',
      recipients: { kind: 'hit-targets' },
      payload: { accuracyRollId: 'dragon-rage.accuracy-roll' },
    })
    expectDeeplyFrozen(parsed)

    expectEffectError(
      validOperation('direct-hp', {
        recipients: { kind: 'attacked-targets' },
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          accuracyRollId: 'dragon-rage.accuracy-roll',
        },
      }),
      'invalid-effect-operation',
      'operation.recipients.kind',
    )
  })

  it('parses linked drain/recoil, authoritative HP-loss links, timed costs, and self-KO policies', () => {
    const damageCalculation = {
      kind: 'damage-dealt',
      damageOperationId: 'operation.damage',
      percent: 50,
      aggregation: 'per-target',
      preventedDamage: 'zero',
    }
    const drain = parseMoveEffectOperation(validOperation('heal', {
      source: { kind: 'operation', id: 'operation.damage' },
      recipients: { kind: 'actor' },
      phase: 'after-damage',
      payload: {
        ...VALID_PAYLOADS.heal,
        calculation: damageCalculation,
      },
    }))
    const recoil = parseMoveEffectOperation(validOperation('direct-hp', {
      source: { kind: 'operation', id: 'operation.damage' },
      recipients: { kind: 'actor' },
      phase: 'damage',
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        calculation: { ...damageCalculation, aggregation: 'aggregate', percent: 25 },
        bounds: { minimum: null, maximum: null },
        applyTypeImmunity: false,
      },
    }))
    const linkedHpLoss = parseMoveEffectOperation(validOperation('direct-hp', {
      source: { kind: 'operation', id: 'operation.sacrifice' },
      recipients: { kind: 'hit-targets' },
      phase: 'cleanup',
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        calculation: {
          kind: 'hp-lost',
          hpOperationId: 'operation.sacrifice',
          pool: 'hit-points',
          percent: 100,
          aggregation: 'aggregate',
        },
        bounds: { minimum: null, maximum: null },
        applyTypeImmunity: true,
      },
    }))
    const fixedHitCost = parseMoveEffectOperation(validOperation('direct-hp', {
      recipients: { kind: 'actor' },
      phase: 'hit',
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        calculation: { kind: 'fixed', value: 5 },
        bounds: { minimum: null, maximum: null },
        applyTypeImmunity: false,
        cost: {
          kind: 'cost',
          timing: 'hit',
          minimumRemaining: 1,
          damageOperationId: null,
        },
      },
    }))
    const maxHpCost = parseMoveEffectOperation(validOperation('direct-hp', {
      recipients: { kind: 'actor' },
      phase: 'pay',
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        calculation: { kind: 'percent-max', percent: 50 },
        bounds: { minimum: null, maximum: null },
        applyTypeImmunity: false,
        cost: {
          kind: 'cost',
          timing: 'declaration',
          minimumRemaining: null,
          damageOperationId: null,
        },
      },
    }))
    const sacrifice = parseMoveEffectOperation(validOperation('direct-hp', {
      recipients: { kind: 'actor' },
      phase: 'cleanup',
      payload: {
        ...VALID_PAYLOADS['direct-hp'],
        mode: 'set',
        calculation: { kind: 'fixed', value: 0 },
        bounds: { minimum: null, maximum: null },
        applyTypeImmunity: false,
        cost: {
          kind: 'sacrifice',
          timing: 'completion',
          minimumRemaining: null,
          damageOperationId: null,
        },
      },
    }))

    expect(drain.kind === 'heal' && drain.payload.calculation).toEqual(damageCalculation)
    expect(recoil.kind === 'direct-hp' && recoil.payload.calculation).toMatchObject({
      kind: 'damage-dealt',
      aggregation: 'aggregate',
      percent: 25,
    })
    expect(linkedHpLoss.kind === 'direct-hp' && linkedHpLoss.payload.calculation).toEqual({
      kind: 'hp-lost',
      hpOperationId: 'operation.sacrifice',
      pool: 'hit-points',
      percent: 100,
      aggregation: 'aggregate',
    })
    expect(fixedHitCost.kind === 'direct-hp' && fixedHitCost.payload.cost).toEqual({
      kind: 'cost',
      timing: 'hit',
      minimumRemaining: 1,
      damageOperationId: null,
    })
    expect(maxHpCost.kind === 'direct-hp' && maxHpCost.payload.calculation).toEqual({
      kind: 'percent-max',
      percent: 50,
    })
    expect(sacrifice.kind === 'direct-hp' && sacrifice.payload).toMatchObject({
      mode: 'set',
      calculation: { kind: 'fixed', value: 0 },
      cost: { kind: 'sacrifice', timing: 'completion' },
    })
    for (const parsed of [drain, recoil, linkedHpLoss, fixedHitCost, maxHpCost, sacrifice]) {
      expectDeeplyFrozen(parsed)
    }
  })

  it('rejects malformed damage links, cost timing, and sacrifice policies', () => {
    expectEffectError(
      validOperation('heal', {
        phase: 'after-damage',
        payload: {
          ...VALID_PAYLOADS.heal,
          calculation: {
            kind: 'damage-dealt',
            damageOperationId: 'operation.damage',
            percent: 50,
            aggregation: 'aggregate',
            preventedDamage: 'zero',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.recipients.kind',
    )
    expectEffectError(
      validOperation('direct-hp', {
        recipients: { kind: 'actor' },
        phase: 'pay',
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          bounds: { minimum: null, maximum: null },
          applyTypeImmunity: false,
          cost: {
            kind: 'cost',
            timing: 'hit',
            minimumRemaining: 1,
            damageOperationId: null,
          },
        },
      }),
      'invalid-effect-operation',
      'operation.phase',
    )
    expectEffectError(
      validOperation('direct-hp', {
        recipients: { kind: 'actor' },
        phase: 'pay',
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          calculation: { kind: 'percent-current', percent: 50 },
          bounds: { minimum: null, maximum: null },
          applyTypeImmunity: false,
          cost: {
            kind: 'cost',
            timing: 'declaration',
            minimumRemaining: 0,
            damageOperationId: null,
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.calculation',
    )
    expectEffectError(
      validOperation('direct-hp', {
        recipients: { kind: 'actor' },
        phase: 'cleanup',
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          mode: 'set',
          calculation: { kind: 'fixed', value: 1 },
          bounds: { minimum: null, maximum: null },
          applyTypeImmunity: false,
          cost: {
            kind: 'sacrifice',
            timing: 'completion',
            minimumRemaining: null,
            damageOperationId: null,
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.calculation',
    )
    expectEffectError(
      validOperation('direct-hp', {
        recipients: { kind: 'actor' },
        phase: 'after-damage',
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          bounds: { minimum: null, maximum: null },
          applyTypeImmunity: false,
          cost: {
            kind: 'cost',
            timing: 'damage',
            minimumRemaining: 0,
            damageOperationId: null,
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.cost.damageOperationId',
    )
  })

  it('rejects ambiguous HP modes, invalid bounds, and injury policy inflation', () => {
    expectEffectError(
      validOperation('direct-hp', {
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          mode: 'swap',
          calculation: null,
          copySource: { kind: 'actor' },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.copySource',
    )
    expectEffectError(
      validOperation('direct-hp', {
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          mode: 'copy',
          copySource: { kind: 'actor' },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.calculation',
    )
    expectEffectError(
      validOperation('direct-hp', {
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          mode: 'split',
          calculation: null,
          copySource: { kind: 'actor' },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.copySource',
    )
    expectEffectError(
      validOperation('direct-hp', {
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          bounds: { minimum: 10, maximum: 2 },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.bounds',
    )
    expectEffectError(
      validOperation('direct-hp', {
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          pool: 'temporary-hit-points',
        },
      }),
      'invalid-effect-operation',
      'operation.payload.injury.hitPointMarkers',
    )
    expectEffectError(
      validOperation('direct-hp', {
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          injury: {
            hitPointMarkers: 'apply-after-operation',
            massiveDamage: 'apply',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.injury.massiveDamage',
    )
    expectEffectError(
      validOperation('heal', {
        payload: {
          ...VALID_PAYLOADS.heal,
          mode: 'full',
          calculation: null,
          pool: 'temporary-hit-points',
        },
      }),
      'invalid-effect-operation',
      'operation.payload.pool',
    )
    expectEffectError(
      validOperation('heal', {
        payload: {
          ...VALID_PAYLOADS.heal,
          injury: {
            hitPointMarkers: 'apply-after-operation',
            massiveDamage: 'never',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.injury.hitPointMarkers',
    )
  })

  it('parses exhaustive server branches, exclusive choices, optional pass, and recipient scope', () => {
    const relationship = parseMoveEffectOperation(validOperation('branch', {
      phase: 'target',
      recipients: { kind: 'attacked-targets' },
      payload: {
        kind: 'relationship',
        selectionId: 'branch.pollen-puff-target',
        scope: 'recipient',
        branches: {
          self: { id: 'branch.heal-self', operationIds: ['operation.heal'] },
          ally: { id: 'branch.heal-ally', operationIds: ['operation.heal'] },
          enemy: { id: 'branch.damage-enemy', operationIds: ['operation.accuracy', 'operation.damage'] },
          unknown: { id: 'branch.unknown-side', operationIds: [] },
        },
      },
    }))
    expect(relationship.kind === 'branch' && relationship.payload).toMatchObject({
      kind: 'relationship',
      scope: 'recipient',
      branches: {
        ally: { id: 'branch.heal-ally', operationIds: ['operation.heal'] },
        enemy: { id: 'branch.damage-enemy', operationIds: ['operation.accuracy', 'operation.damage'] },
        unknown: { operationIds: [] },
      },
    })

    const checkResult = parseMoveEffectOperation(validOperation('branch', {
      phase: 'hit',
      recipients: { kind: 'hit-targets' },
      payload: {
        kind: 'check',
        selectionId: 'branch.escape-result',
        scope: 'recipient',
        checkId: 'check.escape',
        branches: {
          success: { id: 'branch.escaped', operationIds: ['operation.escape'] },
          failure: { id: 'branch.trapped', operationIds: ['operation.trap'] },
        },
      },
    }))
    expect(checkResult.kind === 'branch' && checkResult.payload).toEqual({
      kind: 'check',
      selectionId: 'branch.escape-result',
      scope: 'recipient',
      checkId: 'check.escape',
      branches: {
        success: { id: 'branch.escaped', operationIds: ['operation.escape'] },
        failure: { id: 'branch.trapped', operationIds: ['operation.trap'] },
      },
    })

    const optionalChoice = parseMoveEffectOperation(validOperation('branch', {
      phase: 'hit',
      recipients: { kind: 'hit-targets' },
      payload: {
        kind: 'choice',
        selectionId: 'branch.choose-stat',
        scope: 'recipient',
        requestId: 'request.choose-stat',
        promptKey: 'move.choose-stat',
        options: [
          {
            id: 'option.attack',
            labelKey: 'stat.attack',
            operationIds: ['operation.raise-attack'],
          },
          {
            id: 'option.defense',
            labelKey: 'stat.defense',
            operationIds: ['operation.raise-defense'],
          },
        ],
        pass: { id: 'option.pass', operationIds: [] },
      },
    }))
    expect(optionalChoice.kind === 'branch' && optionalChoice.payload).toEqual({
      kind: 'choice',
      selectionId: 'branch.choose-stat',
      scope: 'recipient',
      requestId: 'request.choose-stat',
      promptKey: 'move.choose-stat',
      options: [
        {
          id: 'option.attack',
          labelKey: 'stat.attack',
          operationIds: ['operation.raise-attack'],
        },
        {
          id: 'option.defense',
          labelKey: 'stat.defense',
          operationIds: ['operation.raise-defense'],
        },
      ],
      pass: { id: 'option.pass', operationIds: [] },
    })
  })

  it('rejects ambiguous, effectful, or non-target recipient branch choices', () => {
    expectEffectError(
      validOperation('branch', {
        recipients: { kind: 'none' },
        payload: {
          kind: 'choice',
          selectionId: 'branch.ownerless',
          scope: 'resolution',
          requestId: 'request.ownerless',
          promptKey: 'move.ownerless',
          options: [
            { id: 'one', labelKey: 'choice.one', operationIds: ['operation.one'] },
            { id: 'two', labelKey: 'choice.two', operationIds: ['operation.two'] },
          ],
          pass: null,
        },
      }),
      'invalid-effect-operation',
      'operation.recipients.kind',
    )
    expectEffectError(
      validOperation('branch', {
        recipients: { kind: 'actor' },
        payload: {
          kind: 'choice',
          selectionId: 'branch.choose-stat',
          scope: 'recipient',
          requestId: 'request.choose-stat',
          promptKey: 'move.choose-stat',
          options: [
            { id: 'attack', labelKey: 'stat.attack', operationIds: ['operation.attack'] },
            { id: 'defense', labelKey: 'stat.defense', operationIds: ['operation.defense'] },
          ],
          pass: null,
        },
      }),
      'invalid-effect-operation',
      'operation.recipients.kind',
    )
    expectEffectError(
      validOperation('branch', {
        payload: {
          kind: 'choice',
          selectionId: 'branch.optional',
          scope: 'recipient',
          requestId: 'request.optional',
          promptKey: 'move.optional',
          options: [{ id: 'apply', labelKey: 'choice.apply', operationIds: ['operation.apply'] }],
          pass: { id: 'pass', operationIds: ['operation.hidden-effect'] },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.pass.operationIds',
    )
    expectEffectError(
      validOperation('branch', {
        payload: {
          kind: 'choice',
          selectionId: 'branch.not-exclusive',
          scope: 'recipient',
          requestId: 'request.not-exclusive',
          promptKey: 'move.not-exclusive',
          options: [{ id: 'only', labelKey: 'choice.only', operationIds: ['operation.only'] }],
          pass: null,
        },
      }),
      'invalid-effect-operation',
      'operation.payload.options',
    )
    expectEffectError(
      validOperation('branch', {
        payload: {
          kind: 'predicate',
          selectionId: 'branch.too-many-references',
          scope: 'resolution',
          predicate: { kind: 'constant', value: true },
          whenTrue: {
            id: 'branch.true',
            operationIds: Array.from({ length: 65 }, (_, index) => `operation.true-${index}`),
          },
          whenFalse: {
            id: 'branch.false',
            operationIds: Array.from({ length: 64 }, (_, index) => `operation.false-${index}`),
          },
        },
      }),
      'limit-exceeded',
      'operation.payload.operationIds',
    )
  })

  it('requires canonical phase-bound optional reaction windows', () => {
    const parsed = parseMoveEffectOperation(validOperation('reaction-request'))
    expect(parsed).toMatchObject({
      phase: 'damage',
      payload: { timing: 'pre-damage', allowPass: true, priority: 10 },
    })

    expectEffectError(
      validOperation('reaction-request', {
        payload: { ...VALID_PAYLOADS['reaction-request'], timing: 'browser-prompt' },
      }),
      'invalid-effect-operation',
      'operation.payload.timing',
    )
    expectEffectError(
      validOperation('reaction-request', { phase: 'hit' }),
      'invalid-effect-operation',
      'operation.payload.timing',
    )
    expectEffectError(
      validOperation('reaction-request', {
        payload: { ...VALID_PAYLOADS['reaction-request'], allowPass: false },
      }),
      'invalid-effect-operation',
      'operation.payload.allowPass',
    )
  })

  it('accepts only explicit source and interpreter-owned recipient references', () => {
    for (const sourceKind of MOVE_EFFECT_SOURCE_KINDS) {
      expect(parseMoveEffectOperation(validOperation('history', {
        source: { kind: sourceKind, id: `source.${sourceKind}` },
      })).source.kind).toBe(sourceKind)
    }
    for (const recipientKind of MOVE_EFFECT_RECIPIENT_SELECTOR_KINDS) {
      expect(parseMoveEffectOperation(validOperation('history', {
        recipients: { kind: recipientKind },
      })).recipients.kind).toBe(recipientKind)
    }
  })

  it('returns detached, deeply immutable, round-trip-safe JSON data', () => {
    const input = validOperation('choice-request')
    const parsed = parseMoveEffectOperation(input)
    expectDeeplyFrozen(parsed)

    const source = input.source as Record<string, unknown>
    source.id = 'move.changed'
    const payload = input.payload as { options: Array<Record<string, unknown>> }
    payload.options[0].id = 'changed'

    expect(parsed.source.id).toBe('move.scratch')
    expect(parsed.kind === 'choice-request' && parsed.payload.options[0].id).toBe('damage')
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
    expect(structuredClone(parsed)).toEqual(parsed)
  })

  it('rejects ambiguous, executable, or unbounded check definitions', () => {
    const duplicateRoll = structuredClone(VALID_PAYLOADS.check)
    duplicateRoll.targetRoll.rollId = duplicateRoll.actorRoll.rollId
    expectEffectError(
      validOperation('check', { payload: duplicateRoll }),
      'duplicate-id',
      'operation.payload.rollId',
    )

    const duplicateBranch = structuredClone(VALID_PAYLOADS.check)
    duplicateBranch.branches.failure = duplicateBranch.branches.success
    expectEffectError(
      validOperation('check', { payload: duplicateBranch }),
      'duplicate-id',
      'operation.payload.branches.failure',
    )

    const tableFormula = structuredClone(VALID_PAYLOADS.check)
    tableFormula.actorRoll.source = {
      kind: 'fixed',
      formula: { kind: 'table', tableId: 'table.forged' },
    } as unknown as typeof tableFormula.actorRoll.source
    expectEffectError(
      validOperation('check', { payload: tableFormula }),
      'invalid-effect-operation',
      'operation.payload.actorRoll.source.formula.kind',
    )

    const invalidStatPolicy = structuredClone(VALID_PAYLOADS.check)
    invalidStatPolicy.actorRoll.source = {
      kind: 'stat',
      stat: 'level',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'ignore',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    } as unknown as typeof invalidStatPolicy.actorRoll.source
    expectEffectError(
      validOperation('check', { payload: invalidStatPolicy }),
      'invalid-effect-operation',
      'operation.payload.actorRoll.source',
    )

    const tooManyRerolls = structuredClone(VALID_PAYLOADS.check)
    tooManyRerolls.targetRoll.reroll.count = MOVE_EFFECT_OPERATION_LIMITS.checkRerolls + 1
    expectEffectError(
      validOperation('check', { payload: tooManyRerolls }),
      'limit-exceeded',
      'operation.payload.targetRoll.reroll.count',
    )
  })

  it('rejects unknown operation kinds and fields at every operation level', () => {
    expectEffectError(
      validOperation('damage', { kind: 'client-state-patch' }),
      'unknown-operation-kind',
      'operation.kind',
    )
    expectEffectError(
      { ...validOperation(), patch: { hp: 0 } },
      'invalid-effect-operation',
      'operation',
    )
    expectEffectError(
      validOperation('damage', {
        payload: { ...VALID_PAYLOADS.damage, statePatch: { hp: 0 } },
      }),
      'invalid-effect-operation',
      'operation.payload',
    )
    expectEffectError(
      validOperation('damage', {
        source: { kind: 'move', id: 'move.scratch', callback: 'run' },
      }),
      'invalid-effect-operation',
      'operation.source',
    )
    expectEffectError(
      validOperation('damage', {
        recipients: { kind: 'hit-targets', placementIds: ['forged-target'] },
      }),
      'invalid-effect-operation',
      'operation.recipients',
    )
    expectEffectError(
      validOperation('roll', {
        payload: {
          rollId: 'roll.accuracy',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0, script: '1d20' },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.formula',
    )
    expectEffectError(
      validOperation('log', {
        payload: {
          messageKey: 'move.log',
          arguments: [{ key: 'amount', value: 1, patch: {} }],
        },
      }),
      'invalid-effect-operation',
      'operation.payload.arguments[0]',
    )
  })

  it('requires all common authority and trace fields', () => {
    const { source: _source, ...withoutSource } = validOperation()
    expectEffectError(withoutSource, 'invalid-effect-operation', 'operation')
    const { reasonCode: _reasonCode, ...withoutReason } = validOperation()
    expectEffectError(withoutReason, 'invalid-effect-operation', 'operation')
    const { payload: _payload, ...withoutPayload } = validOperation()
    expectEffectError(withoutPayload, 'invalid-effect-operation', 'operation')

    expectEffectError(
      validOperation('damage', { id: 'Not Stable' }),
      'invalid-effect-operation',
      'operation.id',
    )
    expectEffectError(
      validOperation('damage', { phase: 'browser-after-animation' }),
      'invalid-effect-operation',
      'operation.phase',
    )
    expectEffectError(
      validOperation('damage', { reasonCode: '' }),
      'invalid-effect-operation',
      'operation.reasonCode',
    )
    expectEffectError(
      validOperation('damage', { source: { kind: 'browser', id: 'move.scratch' } }),
      'invalid-effect-operation',
      'operation.source.kind',
    )
    expectEffectError(
      validOperation('damage', { recipients: { kind: 'client-target-ids' } }),
      'invalid-effect-operation',
      'operation.recipients.kind',
    )
  })

  it('enforces payload discriminants and cross-field invariants', () => {
    expectEffectError(
      validOperation('condition', { payload: { action: 'clear', conditionId: 'burned' } }),
      'invalid-effect-operation',
      'operation.payload.conditionId',
    )
    expectEffectError(
      validOperation('condition', { payload: { action: 'apply', conditionId: null } }),
      'invalid-effect-operation',
      'operation.payload.conditionId',
    )
    expectEffectError(
      validOperation('combat-stage', {
        payload: { action: 'reset', stage: 'all', value: 0 },
      }),
      'invalid-effect-operation',
      'operation.payload.value',
    )
    expectEffectError(
      validOperation('combat-stage', {
        payload: {
          ...VALID_PAYLOADS['combat-stage'],
          stage: 'selected-stat',
          selectedStage: null,
        },
      }),
      'invalid-effect-operation',
      'operation.payload.selectedStage',
    )
    expectEffectError(
      validOperation('combat-stage', {
        payload: {
          ...VALID_PAYLOADS['combat-stage'],
          action: 'copy',
          value: null,
          stageSource: null,
        },
      }),
      'invalid-effect-operation',
      'operation.payload.stageSource',
    )
    expectEffectError(
      validOperation('combat-stage', {
        payload: {
          ...VALID_PAYLOADS['combat-stage'],
          action: 'split',
          value: null,
          rounding: null,
        },
      }),
      'invalid-effect-operation',
      'operation.payload.rounding',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          attackStat: {
            kind: 'stat',
            subject: { kind: 'actor' },
            stat: 'attack',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.attackStat',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          defenseStat: {
            kind: 'weather',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.defenseStat',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          damageBase: {
            kind: 'expression',
            expression: { kind: 'constant', value: 4 },
            minimum: 10,
            maximum: 2,
            rounding: 'floor',
            stabTiming: 'after-bounds',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.damageBase',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          damageBase: {
            kind: 'expression',
            expression: { kind: 'constant', value: 4 },
            minimum: 1,
            maximum: 20,
            rounding: 'floor',
            stabTiming: 'client-selected',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.damageBase.stabTiming',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          moveType: { kind: 'client-type', value: 'fire' },
          typeEffectiveness: {
            immunity: 'honor',
            resistance: 'honor',
            weakness: 'honor',
            effectivenessOverride: null,
            defenderTypeOverrides: [],
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.moveType.kind',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          typeEffectiveness: {
            immunity: 'bypass-client',
            resistance: 'honor',
            weakness: 'honor',
            effectivenessOverride: null,
            defenderTypeOverrides: [],
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.typeEffectiveness.immunity',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          typeEffectiveness: {
            immunity: 'honor',
            resistance: 'honor',
            weakness: 'honor',
            effectivenessOverride: null,
            defenderTypeOverrides: [
              { defenderType: 'water', relation: 'weak' },
              { defenderType: 'water', relation: 'neutral' },
            ],
          },
        },
      }),
      'duplicate-id',
      'operation.payload.typeEffectiveness.defenderTypeOverrides.defenderType',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          criticalHit: {
            trigger: { kind: 'natural-rolls', values: [2, 2] },
            prevention: 'honor',
          },
        },
      }),
      'duplicate-id',
      'operation.payload.criticalHit.trigger.values',
    )
    expectEffectError(
      validOperation('damage', {
        payload: {
          ...VALID_PAYLOADS.damage,
          criticalHit: {
            trigger: { kind: 'range', minimum: 0 },
            prevention: 'honor',
          },
        },
      }),
      'limit-exceeded',
      'operation.payload.criticalHit.trigger.minimum',
    )
    const temporaryEffect = VALID_PAYLOADS['temporary-effect']
    expectEffectError(
      validOperation('temporary-effect', {
        payload: {
          ...temporaryEffect,
          definition: {
            ...temporaryEffect.definition,
            duration: { kind: 'scene', remaining: 1 },
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.definition.duration.remaining',
    )
    expectEffectError(
      validOperation('temporary-effect', {
        payload: {
          ...temporaryEffect,
          definition: {
            ...temporaryEffect.definition,
            duration: { kind: 'rounds', remaining: null },
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.definition.duration.remaining',
    )
    expectEffectError(
      validOperation('temporary-effect', {
        payload: {
          ...temporaryEffect,
          definition: {
            ...temporaryEffect.definition,
            kind: 'condition',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.definition.payload',
    )
    expectEffectError(
      validOperation('roll', {
        payload: {
          rollId: 'roll.uniform',
          formula: { kind: 'uniform-integer', minimum: 2, maximum: 1 },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.formula',
    )
    expectEffectError(
      validOperation('multi-hit', {
        payload: {
          ...VALID_PAYLOADS['multi-hit'],
          accuracy: {
            kind: 'per-hit',
            rollId: 'roll.strike',
            formula: { kind: 'dice', count: 2, sides: 20, modifier: 0 },
            stopOnMiss: false,
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.accuracy.formula',
    )
    expectEffectError(
      validOperation('multi-hit', {
        payload: {
          ...VALID_PAYLOADS['multi-hit'],
          count: {
            kind: 'table',
            scope: 'sequence',
            rollId: 'roll.hit-count',
            tableId: 'table.five-strike',
            drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
            entries: [
              { minimum: 1, maximum: 4, hits: 2 },
              { minimum: 4, maximum: 8, hits: 3 },
            ],
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.count.entries',
    )
    expectEffectError(
      validOperation('multi-hit', {
        payload: {
          ...VALID_PAYLOADS['multi-hit'],
          damage: {
            ...VALID_PAYLOADS['multi-hit'].damage,
            accuracyRollId: 'roll.client-supplied',
          },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.damage',
    )
    expectEffectError(
      validOperation('hazard', { payload: { action: 'patch', state: {} } }),
      'invalid-effect-operation',
      'operation.payload.action',
    )
  })

  it('bounds numeric values, text, and request collections', () => {
    expectEffectError(
      validOperation('roll', {
        payload: {
          rollId: 'roll.too-many',
          formula: {
            kind: 'dice',
            count: MOVE_EFFECT_OPERATION_LIMITS.diceCount + 1,
            sides: 20,
            modifier: 0,
          },
        },
      }),
      'limit-exceeded',
      'operation.payload.formula.count',
    )
    expectEffectError(
      validOperation('damage', {
        payload: { ...VALID_PAYLOADS.damage, damageBase: 1.5 },
      }),
      'invalid-effect-operation',
      'operation.payload.damageBase',
    )
    expectEffectError(
      validOperation('direct-hp', {
        payload: {
          ...VALID_PAYLOADS['direct-hp'],
          calculation: {
            kind: 'fixed',
            value: MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude + 1,
          },
        },
      }),
      'limit-exceeded',
      'operation.payload.calculation.value',
    )
    expectEffectError(
      validOperation('log', {
        payload: {
          messageKey: 'move.log',
          arguments: [{
            key: 'detail',
            value: 'x'.repeat(MOVE_EFFECT_OPERATION_LIMITS.textLength + 1),
          }],
        },
      }),
      'limit-exceeded',
      'operation.payload.arguments[0].value',
    )
    expectEffectError(
      validOperation('choice-request', {
        payload: { ...VALID_PAYLOADS['choice-request'], options: [] },
      }),
      'invalid-effect-operation',
      'operation.payload.options',
    )
    expectEffectError(
      validOperation('choice-request', {
        payload: {
          ...VALID_PAYLOADS['choice-request'],
          options: Array.from(
            { length: MOVE_EFFECT_OPERATION_LIMITS.requestOptions + 1 },
            (_, index) => ({ id: `option-${index}`, labelKey: `option.${index}` }),
          ),
        },
      }),
      'limit-exceeded',
      'operation.payload.options',
    )
    expectEffectError(
      validOperation('choice-request', {
        payload: {
          ...VALID_PAYLOADS['choice-request'],
          options: [
            { id: 'same', labelKey: 'choice.one' },
            { id: 'same', labelKey: 'choice.two' },
          ],
        },
      }),
      'duplicate-id',
      'operation.payload.options.id',
    )
  })

  it('accepts bounded server-authored details only for Disabled and Infatuation applications', () => {
    expect(parseMoveEffectOperation(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        conditionId: 'disabled',
        conditionDetail: 'Ember',
      },
    }))).toMatchObject({
      payload: { conditionId: 'disabled', conditionDetail: 'Ember' },
    })
    expect(parseMoveEffectOperation(validOperation('condition', {
      payload: {
        ...VALID_PAYLOADS.condition,
        conditionId: 'infatuation',
        conditionDetail: 'Defender',
      },
    }))).toMatchObject({
      payload: { conditionId: 'infatuation', conditionDetail: 'Defender' },
    })
    expectEffectError(
      validOperation('condition', {
        payload: {
          ...VALID_PAYLOADS.condition,
          conditionDetail: 'not allowed',
        },
      }),
      'invalid-effect-operation',
      'operation.payload.conditionDetail',
    )
    expectEffectError(
      validOperation('condition', {
        payload: {
          ...VALID_PAYLOADS.condition,
          action: 'remove',
          conditionId: 'disabled',
          conditionDetail: 'Ember',
        },
      }),
      'invalid-effect-operation',
      'operation.payload.conditionDetail',
    )
  })

  it('rejects callbacks, class instances, accessors, and lossy arrays', () => {
    expectEffectError(
      validOperation('log', {
        payload: {
          messageKey: 'move.log',
          arguments: [{ key: 'callback', value: () => 'patch' }],
        },
      }),
      'not-json',
      'operation.payload.arguments[0].value',
    )
    expectEffectError(
      validOperation('damage', { source: new Date() }),
      'not-json',
      'operation.source',
    )

    let getterCalled = false
    const operation = validOperation('damage')
    Object.defineProperty(operation, 'payload', {
      enumerable: true,
      get: () => {
        getterCalled = true
        return VALID_PAYLOADS.damage
      },
    })
    expectEffectError(operation, 'not-json', 'operation.payload')
    expect(getterCalled).toBe(false)

    const sparseOptions = new Array(1)
    expectEffectError(
      validOperation('choice-request', {
        payload: { ...VALID_PAYLOADS['choice-request'], options: sparseOptions },
      }),
      'not-json',
      'operation.payload.options[0]',
    )
  })

  it('parses bounded lists and rejects duplicate operation ids', () => {
    const input = [
      validOperation('roll'),
      validOperation('damage'),
      validOperation('condition'),
    ]
    const operations = parseMoveEffectOperations(input)

    expect(operations.map(operation => operation.kind)).toEqual([
      'roll',
      'damage',
      'condition',
    ])
    expectDeeplyFrozen(operations)

    expect(() => parseMoveEffectOperations([
      validOperation('damage', { id: 'operation.same' }),
      validOperation('heal', { id: 'operation.same' }),
    ])).toThrowError(expect.objectContaining({
      code: 'duplicate-id',
      path: 'operations.id',
    }))

    expect(() => parseMoveEffectOperations(Array.from(
      { length: MOVE_EFFECT_OPERATION_LIMITS.operations + 1 },
      (_, index) => validOperation('history', { id: `operation.history-${index}` }),
    ))).toThrowError(expect.objectContaining({
      code: 'limit-exceeded',
      path: 'operations',
    }))
  })
})
