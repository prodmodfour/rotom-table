import { describe, expect, it } from 'vitest'
import {
  MoveResolutionTraceValidationError,
  parseMoveResolutionAuditTrace,
  parseMoveResolutionTraceSummary,
} from '#shared/moveAutomation/trace'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const identity = () => ({
  schemaVersion: 1,
  program: {
    canonicalId: 'Trace Test',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 3,
    definitionHash: HASH_A,
  },
  ruleset: {
    rulesetId: 'ruleset-v1',
    sourceDataSha256: HASH_B,
  },
  ancestry: [{
    depth: 0,
    resolutionId: 'resolution-root',
    canonicalId: 'Parent Move',
    definitionHash: HASH_B,
    parentOperationId: null,
  }],
})

const roll = () => ({
  rollId: 'roll.accuracy.1',
  parentEffectId: 'effect.accuracy',
  formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  reason: 'Accuracy check',
  naturalResults: [14],
  naturalResult: 14,
  modifiers: [{ sourceId: 'user-accuracy', reason: 'User Accuracy', value: 2 }],
  finalValue: 16,
})

const auditTrace = () => ({
  ...identity(),
  events: [
    { sequence: 1, kind: 'phase-transition', reasonCode: 'declare-phase', from: null, to: 'declare' },
    {
      sequence: 2,
      kind: 'predicate',
      reasonCode: 'precondition-passed',
      phase: 'declare',
      predicateId: 'predicate.can-act',
      outcome: true,
      input: { privateStat: 17 },
    },
    { sequence: 3, kind: 'phase-transition', reasonCode: 'target-phase', from: 'declare', to: 'target' },
    {
      sequence: 4,
      kind: 'target',
      reasonCode: 'legal-target',
      phase: 'target',
      targetId: 'target-token',
      outcome: 'included',
    },
    { sequence: 5, kind: 'phase-transition', reasonCode: 'accuracy-phase', from: 'target', to: 'accuracy' },
    { sequence: 6, kind: 'roll', reasonCode: 'server-roll-resolved', phase: 'accuracy', roll: roll() },
    { sequence: 7, kind: 'phase-transition', reasonCode: 'hit-phase', from: 'accuracy', to: 'hit' },
    {
      sequence: 8,
      kind: 'operation',
      reasonCode: 'type-immunity',
      phase: 'hit',
      operationId: 'operation.condition.1',
      operationKind: 'condition',
      recipientIds: ['target-token'],
      outcome: 'prevented',
      input: { conditionId: 'sleep', secretOption: 'gm-only' },
      result: { applied: false },
    },
    {
      sequence: 9,
      kind: 'choice',
      reasonCode: 'choice-selected',
      phase: 'hit',
      requestId: 'request.branch.1',
      requestKind: 'choice',
      outcome: 'selected',
      optionId: 'option.private-branch',
    },
    {
      sequence: 10,
      kind: 'child-move',
      reasonCode: 'child-completed',
      phase: 'hit',
      childResolutionId: 'resolution-child',
      canonicalId: 'Child Move',
      definitionHash: HASH_A,
      parentOperationId: 'operation.condition.1',
      depth: 1,
      outcome: 'completed',
    },
    { sequence: 11, kind: 'phase-transition', reasonCode: 'cleanup-phase', from: 'hit', to: 'cleanup' },
  ],
})

const summary = () => ({
  ...identity(),
  totalEventCount: 4,
  truncated: false,
  events: [
    { sequence: 1, kind: 'phase-transition', reasonCode: 'declare-phase', from: null, to: 'declare' },
    {
      sequence: 2,
      kind: 'predicate',
      reasonCode: 'precondition-passed',
      phase: 'declare',
      predicateId: 'predicate.can-act',
      outcome: true,
    },
    {
      sequence: 3,
      kind: 'choice',
      reasonCode: 'choice-selected',
      phase: 'declare',
      requestId: 'request.branch.1',
      requestKind: 'choice',
      outcome: 'selected',
    },
    { sequence: 4, kind: 'phase-transition', reasonCode: 'cleanup-phase', from: 'declare', to: 'cleanup' },
  ],
})

const expectTraceError = (
  run: () => unknown,
  code: MoveResolutionTraceValidationError['code'],
): MoveResolutionTraceValidationError => {
  try {
    run()
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveResolutionTraceValidationError)
    expect((error as MoveResolutionTraceValidationError).code).toBe(code)
    return error as MoveResolutionTraceValidationError
  }
  throw new Error(`Expected ${code}`)
}

describe('move resolution trace contracts', () => {
  it('strictly parses and freezes complete server audit evidence', () => {
    const source = auditTrace()
    const parsed = parseMoveResolutionAuditTrace(source)

    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(parsed.events[7]).not.toBe(source.events[7])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.events)).toBe(true)
    expect(parsed.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'predicate', outcome: true }),
      expect.objectContaining({ kind: 'target', outcome: 'included' }),
      expect.objectContaining({ kind: 'roll', roll: expect.objectContaining({ finalValue: 16 }) }),
      expect.objectContaining({ kind: 'operation', outcome: 'prevented' }),
      expect.objectContaining({ kind: 'choice', optionId: 'option.private-branch' }),
      expect.objectContaining({ kind: 'child-move', depth: 1 }),
    ]))
  })

  it('rejects unknown fields, invalid phase flow, malformed hashes, and non-JSON audit values', () => {
    const source = auditTrace()
    expectTraceError(
      () => parseMoveResolutionAuditTrace({ ...source, clientPatch: {} }),
      'invalid-trace',
    )
    expectTraceError(
      () => parseMoveResolutionAuditTrace({
        ...source,
        program: { ...source.program, definitionHash: 'not-a-hash' },
      }),
      'invalid-trace',
    )
    expectTraceError(
      () => parseMoveResolutionAuditTrace({
        ...source,
        events: source.events.map((event, index) => index === 2 ? { ...event, from: 'accuracy' } : event),
      }),
      'invalid-sequence',
    )

    const operation = { ...source.events[7] }
    Object.defineProperty(operation, 'result', { enumerable: true, get: () => ({ exposed: true }) })
    expectTraceError(
      () => parseMoveResolutionAuditTrace({
        ...source,
        events: source.events.map((event, index) => index === 7 ? operation : event),
      }),
      'not-json',
    )
  })

  it('accepts only the sanitized bounded wire shape', () => {
    const source = summary()
    const parsed = parseMoveResolutionTraceSummary(source)
    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)

    const choice = source.events[2]
    expectTraceError(
      () => parseMoveResolutionTraceSummary({
        ...source,
        events: source.events.map((event, index) => index === 2
          ? { ...choice, optionId: 'option.private-branch' }
          : event),
      }),
      'invalid-trace',
    )
    expectTraceError(
      () => parseMoveResolutionTraceSummary({ ...source, truncated: true }),
      'invalid-sequence',
    )
  })
})
