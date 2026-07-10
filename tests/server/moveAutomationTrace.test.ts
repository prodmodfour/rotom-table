import { describe, expect, it } from 'vitest'
import {
  MOVE_RESOLUTION_TRACE_LIMITS,
  MoveResolutionTraceValidationError,
} from '#shared/moveAutomation/trace'
import { renderMoveResolutionTraceLogLines } from '#shared/moveAutomation/traceLog'
import {
  createMoveResolutionTrace,
  reduceMoveResolutionTrace,
  summarizeMoveResolutionTrace,
} from '~~/server/domain/moveAutomation/trace'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const newTrace = () => createMoveResolutionTrace({
  program: {
    canonicalId: 'Trace Test',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
    definitionHash: HASH_A,
  },
  ruleset: {
    rulesetId: 'ruleset-v1',
    sourceDataSha256: HASH_B,
  },
  ancestry: [{
    depth: 0,
    resolutionId: 'resolution-parent',
    canonicalId: 'Parent Move',
    definitionHash: HASH_B,
    parentOperationId: null,
  }],
})

const append = <Event extends Parameters<typeof reduceMoveResolutionTrace>[1]>(
  trace: ReturnType<typeof newTrace>,
  event: Event,
) => reduceMoveResolutionTrace(trace, event)

describe('authoritative move resolution trace reducer', () => {
  it('records decisions and strips private audit details from the wire summary', () => {
    let trace = newTrace()
    trace = append(trace, {
      kind: 'phase-transition',
      from: null,
      to: 'declare',
      reasonCode: 'declare-phase',
    })
    trace = append(trace, {
      kind: 'predicate',
      phase: 'declare',
      predicateId: 'predicate.can-act',
      outcome: true,
      reasonCode: 'precondition-passed',
      input: { privateStat: 17 },
    })
    trace = append(trace, {
      kind: 'phase-transition',
      from: 'declare',
      to: 'target',
      reasonCode: 'target-phase',
    })
    trace = append(trace, {
      kind: 'target',
      phase: 'target',
      targetId: 'target-token',
      outcome: 'included',
      reasonCode: 'legal-target',
    })
    trace = append(trace, {
      kind: 'target',
      phase: 'target',
      targetId: 'excluded-token',
      outcome: 'excluded',
      reasonCode: 'relationship-ineligible',
    })
    trace = append(trace, {
      kind: 'phase-transition',
      from: 'target',
      to: 'accuracy',
      reasonCode: 'accuracy-phase',
    })
    trace = append(trace, {
      kind: 'roll',
      phase: 'accuracy',
      reasonCode: 'server-roll-resolved',
      roll: {
        rollId: 'roll.accuracy.1',
        parentEffectId: 'operation.accuracy',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        reason: 'Accuracy check',
        naturalResults: [12],
        naturalResult: 12,
        modifiers: [{ sourceId: 'accuracy-stage', reason: 'Accuracy stage', value: 2 }],
        finalValue: 14,
      },
    })
    trace = append(trace, {
      kind: 'phase-transition',
      from: 'accuracy',
      to: 'hit',
      reasonCode: 'hit-phase',
    })
    trace = append(trace, {
      kind: 'operation',
      phase: 'hit',
      operationId: 'operation.condition.1',
      operationKind: 'condition',
      recipientIds: ['target-token'],
      outcome: 'prevented',
      reasonCode: 'type-immunity',
      input: { conditionId: 'sleep', hiddenSheetValue: 17 },
      result: { applied: false, privateReason: 'secret-audit-detail' },
    })
    trace = append(trace, {
      kind: 'choice',
      phase: 'hit',
      requestId: 'request.branch.1',
      requestKind: 'choice',
      outcome: 'selected',
      optionId: 'option.private-branch',
      reasonCode: 'choice-selected',
    })
    trace = append(trace, {
      kind: 'child-move',
      phase: 'hit',
      childResolutionId: 'resolution-child',
      canonicalId: 'Child Move',
      definitionHash: HASH_B,
      parentOperationId: 'operation.condition.1',
      depth: 1,
      outcome: 'completed',
      reasonCode: 'child-completed',
    })

    const operation = trace.events.find(event => event.kind === 'operation')
    const choice = trace.events.find(event => event.kind === 'choice')
    expect(operation).toMatchObject({
      outcome: 'prevented',
      input: { hiddenSheetValue: 17 },
      result: { privateReason: 'secret-audit-detail' },
    })
    expect(choice).toMatchObject({ optionId: 'option.private-branch' })

    const summary = summarizeMoveResolutionTrace(trace)
    expect(summary.program).toEqual(trace.program)
    expect(summary.ruleset).toEqual(trace.ruleset)
    expect(summary.ancestry).toEqual(trace.ancestry)
    expect(summary.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'predicate', outcome: true }),
      expect.objectContaining({ kind: 'target', targetId: 'target-token', outcome: 'included' }),
      expect.objectContaining({
        kind: 'roll',
        rollId: 'roll.accuracy.1',
        naturalResult: 12,
        modifierTotal: 2,
        finalValue: 14,
      }),
      expect.objectContaining({ kind: 'operation', outcome: 'prevented' }),
      expect.objectContaining({ kind: 'choice', outcome: 'selected' }),
      expect.objectContaining({ kind: 'child-move', childResolutionId: 'resolution-child' }),
    ]))
    const serialized = JSON.stringify(summary)
    expect(summary).toMatchObject({
      truncated: false,
      totalEventCount: trace.events.length - 1,
    })
    expect(serialized).not.toContain('hiddenSheetValue')
    expect(serialized).not.toContain('secret-audit-detail')
    expect(serialized).not.toContain('option.private-branch')
    expect(serialized).not.toContain('excluded-token')
    expect(serialized).not.toContain('relationship-ineligible')

    const lines = renderMoveResolutionTraceLogLines(summary)
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Runtime movespec-v2 v2 for Trace Test'),
      expect.stringContaining('Predicate predicate.can-act: passed'),
      expect.stringContaining('Operation operation.condition.1 [condition]: prevented'),
      expect.stringContaining('Child move resolution-child (Child Move): completed'),
    ]))
    expect(lines.join('\n')).not.toContain('secret-audit-detail')
  })

  it('bounds oversized wire projections while retaining audit entries and endpoint sequence IDs', () => {
    let trace = newTrace()
    trace = append(trace, {
      kind: 'phase-transition',
      from: null,
      to: 'declare',
      reasonCode: 'declare-phase',
    })
    for (let index = 0; index < MOVE_RESOLUTION_TRACE_LIMITS.wireEvents; index += 1) {
      trace = append(trace, {
        kind: 'predicate',
        phase: 'declare',
        predicateId: `predicate.branch.${index + 1}`,
        outcome: index % 2 === 0,
        reasonCode: 'branch-evaluated',
        input: { index },
      })
    }

    const summary = summarizeMoveResolutionTrace(trace)
    expect(trace.events).toHaveLength(MOVE_RESOLUTION_TRACE_LIMITS.wireEvents + 1)
    expect(summary.events).toHaveLength(MOVE_RESOLUTION_TRACE_LIMITS.wireEvents)
    expect(summary).toMatchObject({
      totalEventCount: MOVE_RESOLUTION_TRACE_LIMITS.wireEvents + 1,
      truncated: true,
    })
    expect(summary.events[0]?.sequence).toBe(1)
    expect(summary.events.at(-1)?.sequence).toBe(MOVE_RESOLUTION_TRACE_LIMITS.wireEvents + 1)
  })

  it('rejects non-canonical phase transitions and duplicate operation IDs', () => {
    let trace = newTrace()
    trace = append(trace, {
      kind: 'phase-transition',
      from: null,
      to: 'target',
      reasonCode: 'target-phase',
    })
    expect(() => append(trace, {
      kind: 'phase-transition',
      from: 'declare',
      to: 'hit',
      reasonCode: 'hit-phase',
    })).toThrowError(MoveResolutionTraceValidationError)

    trace = append(trace, {
      kind: 'operation',
      phase: 'target',
      operationId: 'operation.same',
      operationKind: 'log',
      recipientIds: [],
      outcome: 'applied',
      reasonCode: 'first-operation',
      input: null,
      result: null,
    })
    expect(() => append(trace, {
      kind: 'operation',
      phase: 'target',
      operationId: 'operation.same',
      operationKind: 'log',
      recipientIds: [],
      outcome: 'applied',
      reasonCode: 'duplicate-operation',
      input: null,
      result: null,
    })).toThrowError(MoveResolutionTraceValidationError)
  })
})
