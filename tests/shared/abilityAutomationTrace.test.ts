import { describe, expect, it } from 'vitest'
import {
  AbilityResolutionTraceValidationError,
  abilityResolutionTraceRollLedger,
  appendAbilityResolutionTraceEvent,
  childAbilityResolutionAncestry,
  createAbilityResolutionTrace,
  parseAbilityResolutionTrace,
  type AbilityResolutionAuditTrace,
} from '#shared/abilityAutomation/trace'

const HASH = 'a'.repeat(64)
const CHILD_HASH = 'b'.repeat(64)

const traceFixture = (ancestry: readonly unknown[] = []): AbilityResolutionAuditTrace => (
  createAbilityResolutionTrace({
    resolutionId: 'resolution.root',
    program: {
      canonicalId: 'Moxie',
      modeId: 'mode-triggered',
      runtimeKind: 'abilityspec-v1',
      runtimeVersion: 1,
      definitionHash: HASH,
      sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
    },
    ruleset: {
      rulesetId: 'ptu-1.05-plus-errata',
      sourceDataSha256: HASH,
    },
    ancestry: ancestry as never,
  })
)

const roll = () => ({
  rollId: 'roll.effect',
  parentEffectId: 'operation.raise-attack',
  formula: { kind: 'dice' as const, count: 1, sides: 20, modifier: 0 },
  reason: 'Ability effect check',
  naturalResults: [11],
  naturalResult: 11,
  modifiers: [{ sourceId: 'ability.moxie', reason: 'Moxie', value: 1 }],
  finalValue: 12,
})

const completeTrace = (): AbilityResolutionAuditTrace => {
  let trace = traceFixture()
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'phase-transition',
    reasonCode: 'phase.eligibility',
    from: null,
    to: 'eligibility',
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'suppression',
    phase: 'eligibility',
    reasonCode: 'ability.effective',
    abilityInstanceId: 'ability-instance.moxie',
    outcome: 'effective',
    sourceInstanceId: null,
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'eligibility',
    phase: 'eligibility',
    reasonCode: 'trigger.eligible',
    abilityInstanceId: 'ability-instance.moxie',
    outcome: 'eligible',
    input: { eventId: 'event.ko', privateHp: 0 },
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'subscription',
    phase: 'eligibility',
    reasonCode: 'subscription.matched',
    subscriptionId: 'subscription.ko',
    eventId: 'event.ko',
    outcome: 'matched',
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'phase-transition',
    reasonCode: 'phase.target',
    from: 'eligibility',
    to: 'target',
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'choice',
    phase: 'target',
    reasonCode: 'choice.selected',
    requestId: 'choice.moxie',
    requestKind: 'choice',
    outcome: 'selected',
    optionId: 'option.attack',
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'phase-transition',
    reasonCode: 'phase.effect',
    from: 'target',
    to: 'effect',
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'roll',
    phase: 'effect',
    reasonCode: 'roll.effect',
    roll: roll(),
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'operation',
    phase: 'effect',
    reasonCode: 'ability.moxie.raise-attack',
    operationId: 'operation.raise-attack',
    operationKind: 'combat-stage',
    recipientIds: ['actor-token'],
    outcome: 'applied',
    input: { value: 1 },
    result: { previous: 0, current: 1 },
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'prevention',
    phase: 'effect',
    reasonCode: 'effect.prevented',
    operationId: 'operation.secondary',
    recipientId: 'target-token',
    preventedBy: 'Shield Dust',
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'phase-transition',
    reasonCode: 'phase.after-effect',
    from: 'effect',
    to: 'after-effect',
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'child-ability',
    phase: 'after-effect',
    reasonCode: 'child.started',
    childResolutionId: 'resolution.child',
    canonicalId: 'Celebrate',
    modeId: 'mode-triggered',
    definitionHash: CHILD_HASH,
    parentEventId: 'event.ko',
    parentOperationId: 'operation.raise-attack',
    depth: 1,
    outcome: 'started',
  })
  trace = appendAbilityResolutionTraceEvent(trace, {
    kind: 'phase-transition',
    reasonCode: 'phase.schedule',
    from: 'after-effect',
    to: 'schedule',
  })
  return appendAbilityResolutionTraceEvent(trace, {
    kind: 'lifecycle',
    phase: 'schedule',
    reasonCode: 'effect.created',
    eventId: 'event.effect-created',
    action: 'created',
    subjectId: 'effect.moxie',
  })
}

describe('ability resolution audit trace', () => {
  it('records runtime identity and every required causal evidence family', () => {
    const trace = completeTrace()

    expect(trace.program).toEqual({
      canonicalId: 'Moxie',
      modeId: 'mode-triggered',
      runtimeKind: 'abilityspec-v1',
      runtimeVersion: 1,
      definitionHash: HASH,
      sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
    })
    expect(new Set(trace.events.map(event => event.kind))).toEqual(new Set([
      'phase-transition',
      'suppression',
      'eligibility',
      'subscription',
      'choice',
      'roll',
      'operation',
      'prevention',
      'child-ability',
      'lifecycle',
    ]))
    expect(trace.events.map(event => event.sequence)).toEqual(
      Array.from({ length: trace.events.length }, (_, index) => index),
    )
    expect(Object.isFrozen(trace)).toBe(true)
    expect(Object.isFrozen(trace.events)).toBe(true)
  })

  it('round-trips persisted JSON and extracts one strict roll ledger', () => {
    const trace = completeTrace()
    const parsed = parseAbilityResolutionTrace(JSON.parse(JSON.stringify(trace)))

    expect(parsed).toEqual(trace)
    expect(abilityResolutionTraceRollLedger(parsed)).toEqual([roll()])
    expect(Object.isFrozen(parsed.events[2])).toBe(true)
  })

  it('detaches private event inputs and selected option IDs', () => {
    let trace = traceFixture()
    trace = appendAbilityResolutionTraceEvent(trace, {
      kind: 'phase-transition',
      reasonCode: 'phase.eligibility',
      from: null,
      to: 'eligibility',
    })
    const privateInput = { targetHp: 1 }
    trace = appendAbilityResolutionTraceEvent(trace, {
      kind: 'eligibility',
      phase: 'eligibility',
      reasonCode: 'trigger.eligible',
      abilityInstanceId: 'ability-instance.moxie',
      outcome: 'eligible',
      input: privateInput,
    })
    privateInput.targetHp = 99

    expect(trace.events[1]).toMatchObject({ input: { targetHp: 1 } })
    expect(Object.isFrozen((trace.events[1] as { input: object }).input)).toBe(true)
  })

  it('builds contiguous immutable ancestry for direct children', () => {
    const trace = completeTrace()
    const ancestry = childAbilityResolutionAncestry({
      trace,
      parentEventId: 'event.ko',
      parentOperationId: 'operation.raise-attack',
    })
    const child = createAbilityResolutionTrace({
      resolutionId: 'resolution.child',
      program: {
        canonicalId: 'Celebrate',
        modeId: 'mode-triggered',
        runtimeKind: 'abilityspec-v1',
        runtimeVersion: 1,
        definitionHash: CHILD_HASH,
        sourceModule: 'server/domain/abilityAutomation/specs/celebrate.ts',
      },
      ruleset: trace.ruleset,
      ancestry,
    })

    expect(child.ancestry).toEqual([{
      depth: 0,
      resolutionId: 'resolution.root',
      canonicalId: 'Moxie',
      modeId: 'mode-triggered',
      definitionHash: HASH,
      parentEventId: 'event.ko',
      parentOperationId: 'operation.raise-attack',
    }])
    expect(Object.isFrozen(child.ancestry)).toBe(true)
  })

  it('fails on phase reversal, events outside an active phase, duplicate rolls, and sequence drift', () => {
    expect(() => appendAbilityResolutionTraceEvent(traceFixture(), {
      kind: 'eligibility',
      phase: 'eligibility',
      reasonCode: 'trigger.eligible',
      abilityInstanceId: 'ability-instance.moxie',
      outcome: 'eligible',
      input: null,
    })).toThrowError(expect.objectContaining({ code: 'invalid-phase-order' }))

    let trace = traceFixture()
    trace = appendAbilityResolutionTraceEvent(trace, {
      kind: 'phase-transition',
      reasonCode: 'phase.effect',
      from: null,
      to: 'effect',
    })
    expect(() => appendAbilityResolutionTraceEvent(trace, {
      kind: 'phase-transition',
      reasonCode: 'phase.target',
      from: 'effect',
      to: 'target',
    })).toThrowError(expect.objectContaining({ code: 'invalid-phase-order' }))

    trace = appendAbilityResolutionTraceEvent(trace, {
      kind: 'roll',
      phase: 'effect',
      reasonCode: 'roll.effect',
      roll: roll(),
    })
    expect(() => appendAbilityResolutionTraceEvent(trace, {
      kind: 'roll',
      phase: 'effect',
      reasonCode: 'roll.effect',
      roll: roll(),
    })).toThrowError(expect.objectContaining({ code: 'duplicate-roll-id' }))

    const serialized = JSON.parse(JSON.stringify(completeTrace()))
    serialized.events[2].sequence = 99
    expect(() => parseAbilityResolutionTrace(serialized)).toThrowError(expect.objectContaining({
      code: 'invalid-sequence',
    }))
  })

  it('fails on malformed ancestry and non-JSON audit payloads', () => {
    expect(() => traceFixture([{
      depth: 1,
      resolutionId: 'resolution.parent',
      canonicalId: 'Moxie',
      modeId: 'mode-triggered',
      definitionHash: HASH,
      parentEventId: null,
      parentOperationId: null,
    }])).toThrowError(expect.objectContaining({ code: 'invalid-ancestry' }))

    expect(() => createAbilityResolutionTrace({
      resolutionId: 'resolution.root',
      program: {
        canonicalId: 'Moxie',
        modeId: 'mode-triggered',
        runtimeKind: 'abilityspec-v1',
        runtimeVersion: 1,
        definitionHash: HASH,
        sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
        callback: () => undefined,
      } as never,
      ruleset: { rulesetId: 'rules', sourceDataSha256: HASH },
    })).toThrowError(AbilityResolutionTraceValidationError)
  })
})
