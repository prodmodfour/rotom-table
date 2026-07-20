import { describe, expect, it } from 'vitest'
import {
  ABILITY_SPEC_LIMITS,
  AbilitySpecEnvelopeValidationError,
  parseAbilitySpecEnvelope,
  type AbilitySpecEnvelopeValidationCode,
} from '#shared/abilityAutomation/spec'

const validSpec = () => ({
  schemaVersion: 1,
  canonicalId: 'Moxie',
  version: 1,
  modes: [
    { id: 'mode-triggered', kind: 'triggered' },
    { id: 'mode-static', kind: 'static' },
  ],
  subscriptions: [
    {
      id: 'subscription-ko',
      modeId: 'mode-triggered',
      eventKind: 'creature.fainted',
      checkpoint: 'after-commit',
      response: 'optional',
      priority: 10,
      predicate: { kind: 'source-caused-event' },
    },
  ],
  targeting: [
    {
      id: 'target-self',
      modeId: 'mode-triggered',
      kind: 'self',
      minSelections: 0,
      maxSelections: 0,
      selector: null,
      predicate: null,
    },
  ],
  preconditions: [
    {
      id: 'precondition-source-effective',
      modeId: 'mode-triggered',
      predicate: { kind: 'ability-effective' },
      failureReasonCode: 'ability-not-effective',
    },
  ],
  costs: [
    {
      id: 'cost-scene-use',
      modeId: 'mode-triggered',
      phase: 'pay',
      cost: { kind: 'scene-frequency', amount: 1 },
    },
  ],
  phases: [
    {
      modeId: 'mode-triggered',
      phase: 'effect',
      operations: [
        { kind: 'combat-stage', recipients: 'actor', stage: 'attack', value: 1 },
      ],
    },
  ],
  registeredHandlerId: 'moxie-context',
  presentation: {
    displayName: 'Moxie',
    summaryKey: 'ability.moxie.summary',
    vfxKey: 'ability-stage-up',
    tags: ['combat-stage', 'triggered'],
  },
})

const expectSpecError = (
  value: unknown,
  code: AbilitySpecEnvelopeValidationCode,
  path?: string,
): void => {
  try {
    parseAbilitySpecEnvelope(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilitySpecEnvelopeValidationError)
    expect((error as AbilitySpecEnvelopeValidationError).code).toBe(code)
    if (path) expect((error as AbilitySpecEnvelopeValidationError).path).toBe(path)
  }
}

describe('AbilitySpec v1 envelope', () => {
  it('parses identity, modes, subscriptions, targeting, conditions, costs, phases, handler, and presentation', () => {
    const parsed = parseAbilitySpecEnvelope(validSpec())

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      canonicalId: 'Moxie',
      version: 1,
      registeredHandlerId: 'moxie-context',
    })
    expect(parsed.modes.map(mode => mode.kind)).toEqual(['triggered', 'static'])
    expect(parsed.subscriptions[0]).toMatchObject({
      eventKind: 'creature.fainted',
      checkpoint: 'after-commit',
      response: 'optional',
      priority: 10,
    })
    expect(parsed.targeting[0]).toMatchObject({ kind: 'self', minSelections: 0, maxSelections: 0 })
    expect(parsed.costs[0]?.phase).toBe('pay')
    expect(parsed.phases[0]?.operations).toHaveLength(1)
  })

  it('detaches and deeply freezes all mechanic-bearing and presentation data', () => {
    const source = validSpec()
    const parsed = parseAbilitySpecEnvelope(source)
    source.phases[0]!.operations[0]!.value = 6
    source.presentation.tags[0] = 'changed'

    expect(parsed.phases[0]!.operations[0]!.value).toBe(1)
    expect(parsed.presentation.tags[0]).toBe('combat-stage')
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.phases)).toBe(true)
    expect(Object.isFrozen(parsed.phases[0]!.operations[0])).toBe(true)
    expect(Object.isFrozen(parsed.presentation.tags)).toBe(true)
  })

  it('rejects unknown fields, unsupported enums, duplicate declaration IDs, and mode-reference drift', () => {
    expectSpecError({ ...validSpec(), executable: true }, 'invalid-spec', 'abilitySpec')

    const mode = validSpec()
    mode.modes[0]!.kind = 'browser'
    expectSpecError(mode, 'invalid-spec', 'abilitySpec.modes[0].kind')

    const duplicate = validSpec()
    duplicate.targeting[0]!.id = 'mode-triggered'
    expectSpecError(duplicate, 'duplicate-id', 'abilitySpec.declarationIds')

    const unknownMode = validSpec()
    unknownMode.costs[0]!.modeId = 'mode-missing'
    expectSpecError(unknownMode, 'unknown-mode-reference', 'abilitySpec.costs[0].modeId')

    const noModes = validSpec()
    noModes.modes = []
    expectSpecError(noModes, 'invalid-spec', 'abilitySpec.modes')
  })

  it('rejects callbacks, class instances, cycles, sparse arrays, accessors, and non-finite numbers', () => {
    const callback = validSpec()
    ;(callback.phases[0]!.operations[0] as Record<string, unknown>).run = () => undefined
    expectSpecError(callback, 'not-json', 'abilitySpec.phases[0].operations[0].run')

    const classInstance = validSpec()
    class Unsafe {}
    classInstance.subscriptions[0]!.predicate = new Unsafe() as never
    expectSpecError(classInstance, 'not-json', 'abilitySpec.subscriptions[0].predicate')

    const cyclic = validSpec()
    const operation: Record<string, unknown> = { kind: 'cycle' }
    operation.self = operation
    cyclic.phases[0]!.operations = [operation as never]
    expectSpecError(cyclic, 'not-json', 'abilitySpec.phases[0].operations[0].self')

    const sparse = validSpec()
    sparse.presentation.tags = Array(2) as string[]
    sparse.presentation.tags[1] = 'tag'
    expectSpecError(sparse, 'not-json', 'abilitySpec.presentation.tags[0]')

    const infinite = validSpec()
    infinite.subscriptions[0]!.priority = Number.POSITIVE_INFINITY
    expectSpecError(infinite, 'not-json', 'abilitySpec.subscriptions[0].priority')

    let getterCalls = 0
    const accessor = validSpec()
    Object.defineProperty(accessor, 'canonicalId', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return 'Moxie'
      },
    })
    expectSpecError(accessor, 'not-json', 'abilitySpec.canonicalId')
    expect(getterCalls).toBe(0)
  })

  it('enforces per-family and aggregate limits', () => {
    const modes = validSpec()
    modes.modes = Array.from(
      { length: ABILITY_SPEC_LIMITS.modes + 1 },
      (_, index) => ({ id: `mode-${index}`, kind: 'static' }),
    )
    expectSpecError(modes, 'limit-exceeded', 'abilitySpec.modes')

    const operations = validSpec()
    operations.phases = Array.from({ length: 5 }, () => ({
      modeId: 'mode-triggered',
      phase: 'effect',
      operations: Array.from(
        { length: ABILITY_SPEC_LIMITS.operationsPerPhase },
        (_, index) => ({
          kind: 'combat-stage',
          recipients: 'actor',
          stage: 'attack',
          value: index,
        }),
      ),
    }))
    expectSpecError(operations, 'limit-exceeded', 'abilitySpec.phases')

    const tooManySelections = validSpec()
    tooManySelections.targeting[0]!.maxSelections = ABILITY_SPEC_LIMITS.selections + 1
    expectSpecError(
      tooManySelections,
      'invalid-spec',
      'abilitySpec.targeting[0].maxSelections',
    )
  })
})
