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
      payload: { action: 'modify', stage: 'def', value: -1 },
    }],
  },
  'direct-hp':  {
    mode: 'lose',
    pool: 'hit-points',
    amount: 10,
    minimumRemaining: 1,
    applyTypeImmunity: true,
  },
  heal: {
    mode: 'percent-max',
    pool: 'hit-points',
    amount: 50,
    rounding: 'floor',
  },
  condition: {
    action: 'apply',
    conditionId: 'burned',
  },
  'combat-stage': {
    action: 'modify',
    stage: 'atk',
    value: 1,
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
    expect(parseMoveEffectOperation(validOperation('condition', {
      payload: { action: 'clear', conditionId: null },
    })).payload).toEqual({ action: 'clear', conditionId: null })
    expect(parseMoveEffectOperation(validOperation('combat-stage', {
      payload: { action: 'reset', stage: 'all', value: null },
    })).payload).toEqual({ action: 'reset', stage: 'all', value: null })
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
          amount: MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude + 1,
        },
      }),
      'limit-exceeded',
      'operation.payload.amount',
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
