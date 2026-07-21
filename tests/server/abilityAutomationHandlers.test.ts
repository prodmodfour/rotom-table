import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createAbilitySpecExtensionRegistry,
} from '../../server/domain/abilityAutomation/extensionRegistry'
import {
  REGISTERED_ABILITY_HANDLER_REGISTRY,
  RegisteredAbilityHandlerExecutionError,
  RegisteredAbilityHandlerOutputValidationError,
  RegisteredAbilityHandlerRegistryValidationError,
  createRegisteredAbilityHandlerRegistry,
  executeRegisteredAbilityHandler,
  validateRegisteredAbilityHandlerOutput,
  type AuthoritativeAbilityHandlerContext,
  type RegisteredAbilityHandlerRegistration,
} from '../../server/domain/abilityAutomation/handlers/registry'

const extensionRegistry = createAbilitySpecExtensionRegistry([{
  family: 'operation',
  kind: 'marker',
  version: 1,
  parse: (value) => {
    if (Object.keys(value).sort().join(',') !== 'id,kind') throw new Error('invalid marker')
    return value
  },
}])

const output = () => ({
  operations: [{
    phase: 'effect',
    operation: { kind: 'marker', id: 'handler-marker' },
  }],
  traceEntries: [{
    kind: 'calculation',
    phase: 'effect',
    reasonCode: 'handler.calculated',
    value: 2,
  }],
})

const context = (): AuthoritativeAbilityHandlerContext => ({
  snapshot: {
    canonicalId: 'Healer',
    modeId: 'mode-activated',
    actorPlacementId: 'actor-one',
    sourcePlacementId: 'actor-one',
    selectedPlacementIds: ['target-one'],
    triggeringEvent: { kind: 'ability-declared', id: 'event-one' },
    ruleset: {
      rulesetId: 'ptu-1.05-plus-errata',
      sourceDataSha256: 'a'.repeat(64),
    },
  },
  queries: {
    placementById: id => ({ kind: 'placement', id, hp: 10 }),
    distanceMeters: () => 3,
    relation: () => 'ally',
    effectiveAbilityIds: () => ['Healer'],
    ownedStateById: () => null,
    ownedStatesForAbility: () => [],
    historyCount: () => 2,
  },
})

const registration = (
  run: RegisteredAbilityHandlerRegistration['run'] = () => output(),
): RegisteredAbilityHandlerRegistration => ({
  id: 'healer-context',
  version: 1,
  run,
})

describe('registered ability handler boundary', () => {
  it('builds a duplicate-checked production registry with no speculative handlers', () => {
    const handler = registration()
    const registry = createRegisteredAbilityHandlerRegistry([handler])

    expect(registry.size).toBe(1)
    expect(registry.resolve('healer-context')).toMatchObject({ id: 'healer-context', version: 1 })
    expect(registry.resolve('missing')).toBeNull()
    expect(registry.entries()).toHaveLength(1)
    expect(Object.isFrozen(registry.entries())).toBe(true)
    expect(REGISTERED_ABILITY_HANDLER_REGISTRY.size).toBe(0)
  })

  it('rejects malformed and duplicate registrations', () => {
    expect(() => createRegisteredAbilityHandlerRegistry([
      registration(),
      registration(),
    ])).toThrowError(expect.objectContaining({
      name: 'RegisteredAbilityHandlerRegistryValidationError',
      code: 'duplicate-id',
    }))

    expect(() => createRegisteredAbilityHandlerRegistry([{
      ...registration(),
      version: 0,
    }])).toThrowError(RegisteredAbilityHandlerRegistryValidationError)

    expect(() => createRegisteredAbilityHandlerRegistry([{
      ...registration(),
      repository: {},
    } as never])).toThrowError(expect.objectContaining({
      code: 'invalid-registration',
      path: 'abilityHandlers[0]',
    }))
  })

  it('passes only a frozen snapshot and closed pure query interface', () => {
    let observation: Record<string, unknown> = {}
    const source = context()
    const result = executeRegisteredAbilityHandler({
      registration: registration((handlerContext) => {
        const placement = handlerContext.queries.placementById('target-one')
        const abilities = handlerContext.queries.effectiveAbilityIds('actor-one')
        observation = {
          contextKeys: Object.keys(handlerContext),
          snapshotFrozen: Object.isFrozen(handlerContext.snapshot),
          selectedFrozen: Object.isFrozen(handlerContext.snapshot.selectedPlacementIds),
          queriesFrozen: Object.isFrozen(handlerContext.queries),
          placementFrozen: Object.isFrozen(placement),
          abilitiesFrozen: Object.isFrozen(abilities),
          distance: handlerContext.queries.distanceMeters('actor-one', 'target-one'),
          relation: handlerContext.queries.relation('actor-one', 'target-one'),
          history: handlerContext.queries.historyCount('actor-one', 'creature.fainted'),
          hasRepository: 'repository' in handlerContext,
          hasClock: 'clock' in handlerContext,
          hasRandom: 'random' in handlerContext,
        }
        return output()
      }),
      expectedVersion: 1,
      context: source,
      extensionRegistry,
      maximumOperations: 4,
    })
    ;(source.snapshot.selectedPlacementIds as string[])[0] = 'changed'

    expect(observation).toEqual({
      contextKeys: ['snapshot', 'queries'],
      snapshotFrozen: true,
      selectedFrozen: true,
      queriesFrozen: true,
      placementFrozen: true,
      abilitiesFrozen: true,
      distance: 3,
      relation: 'ally',
      history: 2,
      hasRepository: false,
      hasClock: false,
      hasRandom: false,
    })
    expect(result.operations[0]).toMatchObject({
      phase: 'effect',
      operation: { kind: 'marker', id: 'handler-marker' },
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.operations[0]!.operation)).toBe(true)
  })

  it('strictly parses bounded operations and trace entries', () => {
    const parsed = validateRegisteredAbilityHandlerOutput(output(), {
      extensionRegistry,
      maximumOperations: 1,
    })
    expect(parsed.traceEntries).toEqual([{
      kind: 'calculation',
      phase: 'effect',
      reasonCode: 'handler.calculated',
      value: 2,
    }])

    expect(() => validateRegisteredAbilityHandlerOutput({
      ...output(),
      extra: true,
    }, { extensionRegistry })).toThrowError(expect.objectContaining({
      code: 'invalid-output',
      path: 'abilityHandlerOutput',
    }))

    expect(() => validateRegisteredAbilityHandlerOutput({
      ...output(),
      operations: [
        { phase: 'cleanup', operation: { kind: 'marker', id: 'late' } },
        { phase: 'effect', operation: { kind: 'marker', id: 'early' } },
      ],
    }, { extensionRegistry })).toThrowError(expect.objectContaining({
      code: 'invalid-phase-order',
    }))

    expect(() => validateRegisteredAbilityHandlerOutput({
      ...output(),
      operations: [{ phase: 'effect', operation: { kind: 'unknown' } }],
    }, { extensionRegistry })).toThrowError(expect.objectContaining({
      code: 'unknown-operation-extension',
    }))

    expect(() => validateRegisteredAbilityHandlerOutput(output(), {
      extensionRegistry,
      maximumOperations: 0,
    })).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }))
  })

  it('rejects callbacks and malformed trace scalars in handler output', () => {
    expect(() => validateRegisteredAbilityHandlerOutput({
      ...output(),
      callback: () => undefined,
    }, { extensionRegistry })).toThrowError(RegisteredAbilityHandlerOutputValidationError)

    expect(() => validateRegisteredAbilityHandlerOutput({
      ...output(),
      traceEntries: [{
        kind: 'calculation',
        phase: 'effect',
        reasonCode: 'handler.calculated',
        value: { private: true },
      }],
    }, { extensionRegistry })).toThrowError(expect.objectContaining({
      code: 'invalid-output',
      path: 'abilityHandlerOutput.traceEntries[0].value',
    }))
  })

  it('fails on version drift, thrown handlers, and invalid query results', () => {
    expect(() => executeRegisteredAbilityHandler({
      registration: registration(),
      expectedVersion: 2,
      context: context(),
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      name: 'RegisteredAbilityHandlerExecutionError',
      code: 'handler-version-mismatch',
    }))

    expect(() => executeRegisteredAbilityHandler({
      registration: registration(() => { throw new Error('private detail') }),
      expectedVersion: 1,
      context: context(),
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      code: 'handler-threw',
      message: 'Registered handler healer-context failed during pure calculation.',
    }))

    const invalidQuery = context()
    ;(invalidQuery.queries as unknown as {
      distanceMeters: (left: string, right: string) => number
    }).distanceMeters = () => Number.NaN
    expect(() => executeRegisteredAbilityHandler({
      registration: registration(handlerContext => ({
        ...output(),
        traceEntries: [{
          kind: 'calculation',
          phase: 'effect',
          reasonCode: 'handler.distance',
          value: handlerContext.queries.distanceMeters('actor-one', 'target-one'),
        }],
      })),
      expectedVersion: 1,
      context: invalidQuery,
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      name: 'RegisteredAbilityHandlerExecutionError',
      code: 'invalid-query-result',
    }))
  })

  it('keeps reviewed handler modules free of ambient I/O, time, and randomness', () => {
    const directory = join(process.cwd(), 'server/domain/abilityAutomation/handlers')
    const files = readdirSync(directory)
      .map(name => join(directory, name))
      .filter(path => statSync(path).isFile() && path.endsWith('.ts') && !path.endsWith('/registry.ts'))
    const forbidden = [
      /from ['"]node:/,
      /server\/storage/,
      /\bDate\.now\s*\(/,
      /\bMath\.random\s*\(/,
      /\bfetch\s*\(/,
      /\bsetTimeout\s*\(/,
      /\bprocess\./,
    ]

    for (const path of files) {
      const source = readFileSync(path, 'utf8')
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${relative(process.cwd(), path)} matches ${pattern}`).toBe(false)
      }
    }
  })
})
