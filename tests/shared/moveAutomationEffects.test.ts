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
  'direct-hp': {
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
    effectKind: 'next-attack-bonus',
    duration: { kind: 'turns', amount: 1 },
    stacks: 1,
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
      validOperation('temporary-effect', {
        payload: {
          ...VALID_PAYLOADS['temporary-effect'],
          duration: { kind: 'scene', amount: 1 },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.duration.amount',
    )
    expectEffectError(
      validOperation('temporary-effect', {
        payload: {
          ...VALID_PAYLOADS['temporary-effect'],
          duration: { kind: 'rounds', amount: null },
        },
      }),
      'invalid-effect-operation',
      'operation.payload.duration.amount',
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
