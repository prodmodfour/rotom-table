import { describe, expect, it, vi } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AbilityOwnedStateCommandError,
  planAbilityOwnedStateCommand,
  recoverAbilityOwnedState,
  reduceAbilityOwnedStateCommand,
  reduceAbilityOwnedStateLifecycle,
  type AbilityOwnedStateCommand,
} from '../../server/domain/abilityAutomation/ownedState'
import {
  AbilityOwnedStateValidationError,
  createEmptyAbilityOwnedState,
  parseAbilityOwnedState,
  type AbilityOwnedStateEntry,
  type AbilityOwnedStatePayload,
} from '#shared/abilityAutomation/ownedState'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const draft = (input: {
  readonly stateId?: string
  readonly payload?: AbilityOwnedStatePayload
  readonly lifecycleKind?: 'turn' | 'scene' | 'source-presence' | 'source-ability' | 'target-presence'
  readonly targets?: readonly string[]
} = {}) => ({
  stateId: input.stateId ?? 'state.mark.primary',
  ownerPlacementId: 'actor-token',
  sourceAbilityInstanceId: 'base:actor-token:0',
  canonicalId: 'Illusion',
  targetPlacementIds: input.targets ?? ['target-token'],
  lifecycle: {
    kind: input.lifecycleKind ?? 'scene',
    targetPolicy: input.lifecycleKind === 'target-presence' ? 'any-target-leaves' as const : null,
  },
  payload: input.payload ?? { kind: 'mark' as const, markId: 'primary' },
})

const createCommand = (input: {
  readonly operationId?: string
  readonly stateId?: string
  readonly payload?: AbilityOwnedStatePayload
  readonly lifecycleKind?: 'turn' | 'scene' | 'source-presence' | 'source-ability' | 'target-presence'
  readonly targets?: readonly string[]
} = {}): Extract<AbilityOwnedStateCommand, { kind: 'create' }> => {
  const entry = draft(input)
  return {
    operationId: input.operationId ?? 'operation.create',
    kind: 'create',
    stateId: entry.stateId,
    expectedVersion: null,
    entry,
  }
}

const expectCommandError = (callback: () => unknown, code: string): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityOwnedStateCommandError)
    expect((error as AbilityOwnedStateCommandError).code).toBe(code)
  }
}

const authoritativeContext = (
  encounterState = createEmptyEncounterState(),
  active = true,
): AuthoritativeAbilityContext => ({
  runtime: { canonicalId: 'Illusion' },
  map: { slug: 'owned-state-arena', revision: 8, encounterState },
  queries: {
    placements: { get: vi.fn((id: string) => ['actor-token', 'target-token'].includes(id) ? { id } : null) },
    effectiveAbilities: {
      activeForPlacement: vi.fn(() => active ? [{
        instanceId: 'base:actor-token:0',
        canonicalId: 'Illusion',
      }] : []),
    },
  },
} as unknown as AuthoritativeAbilityContext)

describe('ability-owned marks, counters, tokens, modes, and forms', () => {
  it('expires turn-owned continuation marks exactly at their owner turn end', () => {
    const created = reduceAbilityOwnedStateCommand(createEmptyAbilityOwnedState(), createCommand({
      stateId: 'state.turn-mark', operationId: 'op.turn-mark', lifecycleKind: 'turn',
      payload: { kind: 'mark', markId: 'aa060.accelerate.next-move' },
    })).state
    expect(reduceAbilityOwnedStateLifecycle(created, {
      kind: 'turn-boundary', placementId: 'other-token', boundary: 'end',
    }).entries).toHaveLength(1)
    expect(reduceAbilityOwnedStateLifecycle(created, {
      kind: 'turn-boundary', placementId: 'actor-token', boundary: 'end',
    }).entries).toEqual([])
  })

  it('strictly parses every state kind with source linkage and bounded lifecycle', () => {
    const entries: AbilityOwnedStateEntry[] = [
      { ...draft(), version: 1, createdOperationId: 'op.mark', lastOperationId: 'op.mark' },
      {
        ...draft({ stateId: 'state.counter', payload: { kind: 'counter', value: 2, minimum: 0, maximum: 5 } }),
        version: 1, createdOperationId: 'op.counter', lastOperationId: 'op.counter',
      },
      {
        ...draft({ stateId: 'state.token', payload: { kind: 'token', tokenId: 'charge', quantity: 1, maximum: 3 } }),
        version: 1, createdOperationId: 'op.token', lastOperationId: 'op.token',
      },
      {
        ...draft({ stateId: 'state.mode', payload: { kind: 'mode', modeId: 'full-belly' } }),
        version: 1, createdOperationId: 'op.mode', lastOperationId: 'op.mode',
      },
      {
        ...draft({ stateId: 'state.form', payload: { kind: 'form', formId: 'sun-form' } }),
        version: 1, createdOperationId: 'op.form', lastOperationId: 'op.form',
      },
    ]
    const parsed = parseAbilityOwnedState({ schemaVersion: 1, entries, receipts: [] })
    ;(entries[0] as unknown as { targetPlacementIds: string[] }).targetPlacementIds = []

    expect(parsed.entries.map(entry => entry.payload.kind)).toEqual([
      'mark', 'counter', 'token', 'mode', 'form',
    ])
    expect(parsed.entries[0]?.targetPlacementIds).toEqual(['target-token'])
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('creates, versions, removes, and exactly deduplicates commands', () => {
    const command = createCommand()
    const created = reduceAbilityOwnedStateCommand(createEmptyAbilityOwnedState(), command)
    expect(created).toMatchObject({
      status: 'applied', outcome: 'created', entry: { version: 1 },
      state: { receipts: [expect.objectContaining({ resultVersion: 1 })] },
    })

    const duplicate = reduceAbilityOwnedStateCommand(created.state, command)
    expect(duplicate).toMatchObject({ status: 'duplicate', outcome: 'created' })
    expect(duplicate.state).toEqual(created.state)

    expectCommandError(() => reduceAbilityOwnedStateCommand(created.state, {
      ...command,
      stateId: 'state.other',
      entry: { ...command.entry, stateId: 'state.other' },
    }), 'operation-id-conflict')

    const targeted = reduceAbilityOwnedStateCommand(created.state, {
      operationId: 'operation.targets',
      kind: 'set-targets',
      stateId: command.stateId,
      expectedVersion: 1,
      targetPlacementIds: ['target-token', 'actor-token'],
    })
    expect(targeted.entry).toMatchObject({ version: 2, targetPlacementIds: ['target-token', 'actor-token'] })

    expectCommandError(() => reduceAbilityOwnedStateCommand(targeted.state, {
      operationId: 'operation.stale',
      kind: 'remove',
      stateId: command.stateId,
      expectedVersion: 1,
    }), 'version-conflict')

    const removed = reduceAbilityOwnedStateCommand(targeted.state, {
      operationId: 'operation.remove',
      kind: 'remove',
      stateId: command.stateId,
      expectedVersion: 2,
    })
    expect(removed).toMatchObject({ status: 'applied', outcome: 'removed', entry: null })
    expect(removed.state.entries).toEqual([])
    expect(reduceAbilityOwnedStateCommand(removed.state, {
      operationId: 'operation.remove',
      kind: 'remove',
      stateId: command.stateId,
      expectedVersion: 2,
    }).status).toBe('duplicate')
  })

  it('updates bounded counters, tokens, modes, and forms by matching kind only', () => {
    const scenarios = [
      {
        create: createCommand({
          stateId: 'state.counter', operationId: 'op.create-counter',
          payload: { kind: 'counter', value: 2, minimum: 0, maximum: 3 },
        }),
        update: { operationId: 'op.counter', kind: 'adjust-counter', stateId: 'state.counter', expectedVersion: 1, delta: 1 } as const,
        expected: { kind: 'counter', value: 3 },
      },
      {
        create: createCommand({
          stateId: 'state.token', operationId: 'op.create-token',
          payload: { kind: 'token', tokenId: 'charge', quantity: 1, maximum: 2 },
        }),
        update: { operationId: 'op.token', kind: 'adjust-token', stateId: 'state.token', expectedVersion: 1, delta: -1 } as const,
        expected: { kind: 'token', quantity: 0 },
      },
      {
        create: createCommand({
          stateId: 'state.mode', operationId: 'op.create-mode', payload: { kind: 'mode', modeId: 'full-belly' },
        }),
        update: { operationId: 'op.mode', kind: 'set-mode', stateId: 'state.mode', expectedVersion: 1, modeId: 'hangry' } as const,
        expected: { kind: 'mode', modeId: 'hangry' },
      },
      {
        create: createCommand({
          stateId: 'state.form', operationId: 'op.create-form', payload: { kind: 'form', formId: 'base' },
        }),
        update: { operationId: 'op.form', kind: 'set-form', stateId: 'state.form', expectedVersion: 1, formId: 'alternate' } as const,
        expected: { kind: 'form', formId: 'alternate' },
      },
    ]

    for (const scenario of scenarios) {
      const created = reduceAbilityOwnedStateCommand(createEmptyAbilityOwnedState(), scenario.create)
      const updated = reduceAbilityOwnedStateCommand(created.state, scenario.update)
      expect(updated.entry?.payload).toMatchObject(scenario.expected)
      expect(updated.entry?.version).toBe(2)
    }

    const counter = reduceAbilityOwnedStateCommand(
      createEmptyAbilityOwnedState(),
      scenarios[0]!.create,
    )
    expectCommandError(() => reduceAbilityOwnedStateCommand(counter.state, {
      operationId: 'op.counter-overflow', kind: 'adjust-counter', stateId: 'state.counter',
      expectedVersion: 1, delta: 2,
    }), 'value-out-of-bounds')
    expectCommandError(() => reduceAbilityOwnedStateCommand(counter.state, {
      operationId: 'op.wrong-kind', kind: 'set-form', stateId: 'state.counter',
      expectedVersion: 1, formId: 'wrong',
    }), 'kind-mismatch')
  })

  it('authorizes source ability and targets before producing one encounter plan', () => {
    const command = createCommand()
    const planned = planAbilityOwnedStateCommand({ context: authoritativeContext(), command })

    expect(planned.plan.changes).toHaveLength(1)
    expect(planned.plan.changes[0]).toMatchObject({
      kind: 'encounter-state', expectedRevision: 8,
      current: { abilityOwnedState: { entries: [expect.objectContaining({ stateId: command.stateId })] } },
    })
    expectCommandError(
      () => planAbilityOwnedStateCommand({ context: authoritativeContext(createEmptyEncounterState(), false), command }),
      'source-ability-inactive',
    )
    expectCommandError(() => planAbilityOwnedStateCommand({
      context: authoritativeContext(),
      command: createCommand({ targets: ['missing-token'] }),
    }), 'target-placement-missing')
  })

  it('cleans linked state on scene, source, ability, and target lifecycle changes', () => {
    let owned = createEmptyAbilityOwnedState()
    for (const [index, lifecycleKind] of [
      'scene', 'source-presence', 'source-ability', 'target-presence',
    ].entries()) {
      owned = reduceAbilityOwnedStateCommand(owned, createCommand({
        operationId: `operation.create-${index}`,
        stateId: `state.lifecycle-${index}`,
        lifecycleKind: lifecycleKind as 'scene' | 'source-presence' | 'source-ability' | 'target-presence',
      })).state
    }
    owned = reduceAbilityOwnedStateLifecycle(owned, {
      kind: 'presence-snapshot', presentPlacementIds: ['actor-token'],
    })
    expect(owned.entries.map(entry => entry.stateId)).toEqual([
      'state.lifecycle-0', 'state.lifecycle-1', 'state.lifecycle-2',
    ])
    owned = reduceAbilityOwnedStateLifecycle(owned, {
      kind: 'effective-ability-snapshot', placementId: 'actor-token', activeAbilityInstanceIds: [],
    })
    expect(owned.entries.map(entry => entry.stateId)).toEqual([
      'state.lifecycle-0', 'state.lifecycle-1',
    ])
    owned = reduceAbilityOwnedStateLifecycle(owned, {
      kind: 'presence-snapshot', presentPlacementIds: [],
    })
    expect(owned.entries.map(entry => entry.stateId)).toEqual(['state.lifecycle-0'])
    owned = reduceAbilityOwnedStateLifecycle(owned, { kind: 'scene-end' })
    expect(owned).toEqual({ schemaVersion: 1, entries: [], receipts: [] })
  })

  it('recovers stale owner/ability state after restart', () => {
    const source = reduceAbilityOwnedStateCommand(
      createEmptyAbilityOwnedState(),
      createCommand({ lifecycleKind: 'source-ability' }),
    ).state
    const encounter = { ...createEmptyEncounterState(), abilityOwnedState: source }
    const recovered = recoverAbilityOwnedState(JSON.parse(JSON.stringify(encounter)), {
      presentPlacementIds: ['actor-token', 'target-token'],
      activeAbilityInstanceIdsByPlacement: new Map([['actor-token', []]]),
    })
    expect(recovered.abilityOwnedState?.entries).toEqual([])
    expect(recovered.abilityOwnedState?.receipts).toHaveLength(1)
  })

  it('rejects malformed payloads, duplicate IDs, callbacks, unknown fields, and command shapes', () => {
    const valid = {
      ...draft(), version: 1, createdOperationId: 'operation.create', lastOperationId: 'operation.create',
    }
    expect(() => parseAbilityOwnedState({
      schemaVersion: 1, entries: [valid, valid], receipts: [],
    })).toThrow(AbilityOwnedStateValidationError)
    expect(() => parseAbilityOwnedState({
      schemaVersion: 1,
      entries: [{ ...valid, payload: { kind: 'counter', value: 4, minimum: 0, maximum: 3 } }],
      receipts: [],
    })).toThrow(AbilityOwnedStateValidationError)
    expect(() => parseAbilityOwnedState({
      schemaVersion: 1, entries: [valid], receipts: [], callback: () => true,
    })).toThrow(AbilityOwnedStateValidationError)
    expectCommandError(() => reduceAbilityOwnedStateCommand(createEmptyAbilityOwnedState(), {
      ...createCommand(),
      unknown: true,
    } as unknown as AbilityOwnedStateCommand), 'invalid-command')
  })
})
