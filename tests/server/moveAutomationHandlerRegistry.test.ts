import { describe, expect, it } from 'vitest'
import {
  RegisteredMoveHandlerOutputValidationError,
  RegisteredMoveHandlerRegistryValidationError,
  createRegisteredMoveHandlerRegistry,
  validateRegisteredMoveHandlerOutput,
} from '~~/server/domain/moveAutomation/handlers/registry'

const logOperation = (id = 'handler.log') => ({
  id,
  kind: 'log',
  source: { kind: 'move', id: 'move.handler-test' },
  recipients: { kind: 'actor' },
  phase: 'hit',
  reasonCode: 'handler-test.calculated',
  payload: {
    messageKey: 'move.handler-test.calculated',
    arguments: [],
  },
})

const emptyHandler = () => ({ operations: [], traceEntries: [] })

describe('registered move handler registry', () => {
  it('keeps only versioned, duplicate-checked server callbacks', () => {
    const registration = {
      id: 'move.contextual-damage',
      version: 3,
      run: emptyHandler,
    }
    const registry = createRegisteredMoveHandlerRegistry([registration])

    expect(registry.size).toBe(1)
    expect(registry.resolve(registration.id)).toEqual(registration)
    expect(registry.resolve('move.unknown')).toBeNull()
    expect(registry.entries()).toEqual([registration])
    expect(Object.isFrozen(registry)).toBe(true)
    expect(Object.isFrozen(registry.entries())).toBe(true)
    expect(Object.isFrozen(registry.entries()[0])).toBe(true)
  })

  it('rejects duplicate, invalid, unversioned, and non-callable registrations', () => {
    const duplicate = {
      id: 'move.duplicate',
      version: 1,
      run: emptyHandler,
    }
    expect(() => createRegisteredMoveHandlerRegistry([duplicate, duplicate]))
      .toThrowError(expect.objectContaining({
        name: RegisteredMoveHandlerRegistryValidationError.name,
        code: 'duplicate-id',
        path: 'handlers[1].id',
      }))

    const invalidRegistrations = [
      { id: 'Run arbitrary code', version: 1, run: emptyHandler },
      { id: 'move.invalid-version', version: 0, run: emptyHandler },
      { id: 'move.not-callable', version: 1, run: 'source code' },
    ]
    for (const registration of invalidRegistrations) {
      expect(() => createRegisteredMoveHandlerRegistry([
        registration as never,
      ])).toThrowError(expect.objectContaining({
        name: RegisteredMoveHandlerRegistryValidationError.name,
        code: 'invalid-registration',
      }))
    }
  })
})

describe('registered move handler output validation', () => {
  it('accepts only detached, frozen typed operations and calculation trace entries', () => {
    const source = {
      operations: [logOperation()],
      traceEntries: [{
        kind: 'predicate',
        phase: 'hit',
        predicateId: 'handler.contextual-rule',
        outcome: true,
        reasonCode: 'handler-test.contextual-rule-passed',
        input: { calculatedValue: 7 },
      }],
    }
    const output = validateRegisteredMoveHandlerOutput(source)

    source.operations[0]!.payload.messageKey = 'forged.after-validation'
    ;(source.traceEntries[0]!.input as { calculatedValue: number }).calculatedValue = 99

    expect(output.operations).toEqual([logOperation()])
    expect(output.traceEntries).toEqual([{
      kind: 'predicate',
      phase: 'hit',
      predicateId: 'handler.contextual-rule',
      outcome: true,
      reasonCode: 'handler-test.contextual-rule-passed',
      input: { calculatedValue: 7 },
    }])
    expect(Object.isFrozen(output)).toBe(true)
    expect(Object.isFrozen(output.operations)).toBe(true)
    expect(Object.isFrozen(output.operations[0])).toBe(true)
    expect(Object.isFrozen(output.traceEntries)).toBe(true)
    expect(Object.isFrozen(output.traceEntries[0])).toBe(true)
  })

  it('cannot exceed the remaining operation budget or emit arbitrary trace events', () => {
    expect(() => validateRegisteredMoveHandlerOutput({
      operations: [logOperation()],
      traceEntries: [],
    }, { maximumOperations: 0 })).toThrowError(expect.objectContaining({
      name: RegisteredMoveHandlerOutputValidationError.name,
      code: 'limit-exceeded',
      path: 'handlerOutput.operations',
    }))

    expect(() => validateRegisteredMoveHandlerOutput({
      operations: [],
      traceEntries: [{
        kind: 'operation',
        phase: 'hit',
        operationId: 'forged.patch',
        operationKind: 'log',
        recipientIds: [],
        outcome: 'applied',
        reasonCode: 'forged.patch',
        input: {},
        result: {},
      }],
    })).toThrowError(expect.objectContaining({
      name: RegisteredMoveHandlerOutputValidationError.name,
      code: 'unsupported-trace-entry',
      path: 'handlerOutput.traceEntries[0].kind',
    }))
  })

  it('requires canonical operation and trace phase order', () => {
    expect(() => validateRegisteredMoveHandlerOutput({
      operations: [
        { ...logOperation('handler.cleanup'), phase: 'cleanup' },
        logOperation('handler.hit'),
      ],
      traceEntries: [],
    })).toThrowError(expect.objectContaining({
      name: RegisteredMoveHandlerOutputValidationError.name,
      code: 'invalid-phase-order',
      path: 'handlerOutput.operations[1].phase',
    }))

    expect(() => validateRegisteredMoveHandlerOutput({
      operations: [],
      traceEntries: [
        {
          kind: 'target',
          phase: 'damage',
          targetId: 'target-one',
          outcome: 'included',
          reasonCode: 'handler-test.included',
        },
        {
          kind: 'target',
          phase: 'target',
          targetId: 'target-two',
          outcome: 'excluded',
          reasonCode: 'handler-test.excluded',
        },
      ],
    })).toThrowError(expect.objectContaining({
      name: RegisteredMoveHandlerOutputValidationError.name,
      code: 'invalid-phase-order',
      path: 'handlerOutput.traceEntries[1].phase',
    }))
  })
})
