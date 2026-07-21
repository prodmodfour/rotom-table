import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AbilityFrequencyPaymentError,
  attachAbilityFrequencyPayment,
  planAbilityFrequencyPayment,
} from '../../server/domain/abilityAutomation/usage'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
} from '../../server/domain/moveAutomation/plan'
import {
  AbilityUsageLedgerValidationError,
  beginAbilityDailyUsagePeriod,
  beginAbilitySceneUsagePeriod,
  createEmptyAbilityDailyUsageLedger,
  createEmptyAbilitySceneUsageLedger,
  parseAbilityDailyUsageLedger,
  parseAbilitySceneUsageLedger,
  type AbilityDailyUsageLedger,
} from '#shared/abilityAutomation/resources'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const sceneFrequency: AbilityFrequencyDeclaration = {
  raw: 'Scene x2 – Swift Action',
  kind: 'scene',
  uses: 2,
  actionText: 'Swift Action',
  exceptionId: null,
}
const dailyFrequency: AbilityFrequencyDeclaration = {
  raw: 'Daily – Standard Action',
  kind: 'daily',
  uses: 1,
  actionText: 'Standard Action',
  exceptionId: null,
}
const atWillFrequency: AbilityFrequencyDeclaration = {
  raw: 'At-Will – Free Action',
  kind: 'at-will',
  uses: null,
  actionText: 'Free Action',
  exceptionId: null,
}

const actorSheet = (abilityUsage?: AbilityDailyUsageLedger): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Actor',
  species: 'Audino',
  level: 20,
  revision: 3,
  abilities: [{ name: 'Healer' }],
  movelist: [],
  combat: { currentHp: 80 },
  ...(abilityUsage ? { abilityUsage } : {}),
})

const context = (input: {
  readonly encounterState?: ReturnType<typeof createEmptyEncounterState>
  readonly sheet?: CharacterSheet
} = {}): AuthoritativeAbilityContext => ({
  time: 1_000,
  runtime: { canonicalId: 'Healer' },
  actor: {
    placement: { id: 'actor-token' },
    sheet: {
      kind: 'pokemon',
      slug: 'actor',
      revision: input.sheet?.revision ?? 3,
      sheet: input.sheet ?? actorSheet(),
    },
    effectiveAbilities: [{
      instanceId: 'ability.actor.healer',
      canonicalId: 'Healer',
      sourceKind: 'base',
      sourcePlacementId: null,
      definitionHash: null,
      effective: true,
      suppressionReasonCode: null,
    }],
  },
  map: {
    slug: 'ability-arena',
    revision: 9,
    encounterState: input.encounterState ?? createEmptyEncounterState(),
  },
} as unknown as AuthoritativeAbilityContext)

const expectPaymentError = (callback: () => unknown, code: string): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityFrequencyPaymentError)
    expect((error as AbilityFrequencyPaymentError).code).toBe(code)
  }
}

const pay = (input: {
  readonly context?: AuthoritativeAbilityContext
  readonly frequency?: AbilityFrequencyDeclaration
  readonly operationId?: string
  readonly abilityInstanceId?: string
  readonly clauseId?: string
  readonly sceneId?: string
  readonly dayKey?: string
} = {}) => planAbilityFrequencyPayment({
  context: input.context ?? context(),
  frequency: input.frequency ?? sceneFrequency,
  abilityInstanceId: input.abilityInstanceId ?? 'ability.actor.healer',
  clauseId: input.clauseId ?? 'base',
  operationId: input.operationId ?? 'operation.use-1',
  sceneId: input.sceneId,
  dayKey: input.dayKey,
})

describe('authoritative ability usage ledgers', () => {
  it('spends Scene uses in encounter state and retains idempotency ancestry', () => {
    const first = pay({ sceneId: 'scene.encounter-1' })
    const change = first.plan.changes[0]
    const current = change?.kind === 'encounter-state'
      ? change.current as ReturnType<typeof createEmptyEncounterState>
      : null

    expect(first).toMatchObject({
      status: 'paid',
      period: 'scene',
      spent: 1,
      limit: 2,
      remaining: 1,
    })
    expect(current?.abilityUsage).toEqual({
      schemaVersion: 1,
      sceneId: 'scene.encounter-1',
      entries: [{
        ownerId: 'actor-token',
        abilityInstanceId: 'ability.actor.healer',
        canonicalId: 'Healer',
        clauseId: 'base',
        limit: 2,
        spent: 1,
        operationIds: ['operation.use-1'],
      }],
    })

    const duplicate = pay({
      context: context({ encounterState: current! }),
      operationId: 'operation.use-1',
      sceneId: 'scene.encounter-1',
    })
    expect(duplicate).toMatchObject({ status: 'duplicate', spent: 1, remaining: 1 })
    expect(duplicate.plan.changes).toEqual([])
    expectPaymentError(
      () => attachAbilityFrequencyPayment(createMoveStateChangePlan([]), duplicate),
      'payment-plan-conflict',
    )

    const second = pay({
      context: context({ encounterState: current! }),
      operationId: 'operation.use-2',
      sceneId: 'scene.encounter-1',
    })
    expect(second).toMatchObject({ status: 'paid', spent: 2, remaining: 0 })
    const secondState = second.plan.changes[0]!.current as ReturnType<typeof createEmptyEncounterState>
    expectPaymentError(() => pay({
      context: context({ encounterState: secondState }),
      operationId: 'operation.use-3',
      sceneId: 'scene.encounter-1',
    }), 'uses-exhausted')
  })

  it('persists Daily usage on the sheet instead of encounter state', () => {
    const payment = pay({
      frequency: dailyFrequency,
      operationId: 'operation.daily-1',
      dayKey: 'day.2026-07-09',
    })
    const change = payment.plan.changes[0]

    expect(change).toMatchObject({
      kind: 'sheet-state',
      expectedRevision: 3,
      current: { revision: 4 },
      changedFields: ['abilityUsage'],
    })
    expect(change?.current).toHaveProperty('abilityUsage', {
      schemaVersion: 1,
      dayKey: 'day.2026-07-09',
      entries: [expect.objectContaining({
        ownerId: 'sheet:pokemon:actor',
        spent: 1,
        operationIds: ['operation.daily-1'],
      })],
    })
    expect(context().map.encounterState?.abilityUsage?.entries).toEqual([])

    const paidSheet = change?.current as CharacterSheet
    const movedContext = {
      ...context({ sheet: paidSheet }),
      actor: {
        ...context({ sheet: paidSheet }).actor,
        placement: { ...context({ sheet: paidSheet }).actor.placement, id: 'actor-token-new-map' },
        effectiveAbilities: [{
          ...context({ sheet: paidSheet }).actor.effectiveAbilities[0]!,
          instanceId: 'base:actor-token-new-map:0',
        }],
      },
    } as AuthoritativeAbilityContext
    expectPaymentError(() => pay({
      context: movedContext,
      frequency: dailyFrequency,
      operationId: 'operation.daily-2',
      abilityInstanceId: 'base:actor-token-new-map:0',
      dayKey: 'day.2026-07-09',
    }), 'uses-exhausted')
  })

  it('does not create ledger writes for At-Will uses', () => {
    expect(pay({ frequency: atWillFrequency })).toMatchObject({
      status: 'not-required',
      period: 'at-will',
      spent: 0,
      limit: null,
      remaining: null,
      plan: { changes: [] },
    })
  })

  it('binds exceptional resources to their reviewed clause identity', () => {
    const frequency: AbilityFrequencyDeclaration = {
      raw: 'Special – Free Action',
      kind: 'exceptional',
      uses: null,
      actionText: 'Free Action',
      exceptionId: 'receiver-dual-scene-clauses',
    }
    const copy = planAbilityFrequencyPayment({
      context: context(),
      frequency,
      exceptionClause: { id: 'copy', period: 'scene', uses: 1 },
      abilityInstanceId: 'ability.actor.healer',
      clauseId: 'copy',
      operationId: 'operation.copy',
      sceneId: 'scene.one',
    })
    expect(copy).toMatchObject({ status: 'paid', period: 'scene', limit: 1 })

    expectPaymentError(() => planAbilityFrequencyPayment({
      context: context({
        encounterState: copy.plan.changes[0]!.current as ReturnType<typeof createEmptyEncounterState>,
      }),
      frequency,
      exceptionClause: { id: 'receive', period: 'scene', uses: 1 },
      abilityInstanceId: 'ability.actor.healer',
      clauseId: 'receive',
      operationId: 'operation.copy',
      sceneId: 'scene.one',
    }), 'operation-id-conflict')

    expectPaymentError(() => planAbilityFrequencyPayment({
      context: context(),
      frequency,
      exceptionClause: { id: 'copy', period: 'scene', uses: 1 },
      abilityInstanceId: 'ability.actor.healer',
      clauseId: 'other',
      operationId: 'operation.other',
      sceneId: 'scene.one',
    }), 'clause-mismatch')
  })

  it('rejects stale lifecycle keys, cross-resource operation reuse, and absent abilities', () => {
    const sceneLedger = parseAbilitySceneUsageLedger({
      schemaVersion: 1,
      sceneId: 'scene.old',
      entries: [],
    })
    expectPaymentError(() => pay({
      context: context({ encounterState: { ...createEmptyEncounterState(), abilityUsage: sceneLedger } }),
      sceneId: 'scene.new',
    }), 'scene-id-mismatch')

    const dailyLedger = parseAbilityDailyUsageLedger({
      schemaVersion: 1,
      dayKey: 'day.old',
      entries: [],
    })
    expectPaymentError(() => pay({
      context: context({ sheet: actorSheet(dailyLedger) }),
      frequency: dailyFrequency,
      dayKey: 'day.new',
    }), 'day-key-mismatch')

    expectPaymentError(() => pay({
      context: { ...context(), actor: { ...context().actor, effectiveAbilities: [] } },
      sceneId: 'scene.one',
    }), 'ability-instance-missing')
  })

  it('validates bounded detached ledgers and rejects duplicate operation ancestry', () => {
    const source = createEmptyAbilityDailyUsageLedger()
    const parsed = parseAbilityDailyUsageLedger(source)
    expect(parsed).not.toBe(source)
    expect(Object.isFrozen(parsed)).toBe(true)

    expect(() => parseAbilityDailyUsageLedger({
      schemaVersion: 1,
      dayKey: 'day.one',
      entries: [
        {
          ownerId: 'actor-token', abilityInstanceId: 'ability.one', canonicalId: 'One',
          clauseId: 'base', limit: 1, spent: 1, operationIds: ['operation.same'],
        },
        {
          ownerId: 'actor-token', abilityInstanceId: 'ability.two', canonicalId: 'Two',
          clauseId: 'base', limit: 1, spent: 1, operationIds: ['operation.same'],
        },
      ],
    })).toThrow(AbilityUsageLedgerValidationError)
    expect(createEmptyAbilitySceneUsageLedger()).toEqual({
      schemaVersion: 1,
      sceneId: null,
      entries: [],
    })
  })

  it('resets uses only through explicit authoritative lifecycle transitions', () => {
    const usedScene = parseAbilitySceneUsageLedger({
      schemaVersion: 1,
      sceneId: 'scene.one',
      entries: [{
        ownerId: 'actor-token', abilityInstanceId: 'ability.one', canonicalId: 'One',
        clauseId: 'base', limit: 1, spent: 1, operationIds: ['operation.one'],
      }],
    })
    expect(beginAbilitySceneUsagePeriod(usedScene, 'scene.one').entries).toHaveLength(1)
    expect(beginAbilitySceneUsagePeriod(usedScene, 'scene.two')).toEqual({
      schemaVersion: 1,
      sceneId: 'scene.two',
      entries: [],
    })

    const usedDay = parseAbilityDailyUsageLedger({
      schemaVersion: 1,
      dayKey: 'day.one',
      entries: usedScene.entries,
    })
    expect(beginAbilityDailyUsagePeriod(usedDay, 'day.one').entries).toHaveLength(1)
    expect(beginAbilityDailyUsagePeriod(usedDay, 'day.two')).toEqual({
      schemaVersion: 1,
      dayKey: 'day.two',
      entries: [],
    })
  })

  it('merges payment with disjoint effects into one atomic sheet change', () => {
    const baseContext = context()
    const payment = pay({
      context: baseContext,
      frequency: dailyFrequency,
      operationId: 'operation.atomic',
      dayKey: 'day.one',
    })
    const previous = baseContext.actor.sheet.sheet as CharacterSheet
    const effects = createMoveStateChangePlan([{
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor' },
      expectedRevision: 3,
      sourceOperationId: 'effect.atomic',
      reasonCode: 'ability.effect.condition',
      previous,
      current: { ...previous, conditions: ['Burned'], revision: 4 },
      changedFields: ['conditions'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }])
    const atomic = attachAbilityFrequencyPayment(effects, payment)

    expect(atomic.changes).toHaveLength(1)
    expect(atomic.changes[0]).toMatchObject({
      kind: 'sheet-state',
      reasonCode: 'ability.atomic-payment-and-effects',
      changedFields: ['abilityUsage', 'conditions'],
      current: {
        conditions: ['Burned'],
        abilityUsage: { dayKey: 'day.one' },
      },
    })
  })
})
