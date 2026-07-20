import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseEncounterEffect,
  type EncounterConditionEffect,
} from '#shared/moveAutomation/encounterEffects'
import { emberV2Fixture } from '../fixtures/moveAutomation/emberV2'
import { HELPING_HAND_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/helpingHandV2'
import { swordsDanceV2Fixture } from '../fixtures/moveAutomation/swordsDanceV2'
import { yawnV2Fixture } from '../fixtures/moveAutomation/yawnV2'
import { planAuthoritativeMoveState } from '~~/server/domain/planAuthoritativeMoveState'
import { applyEncounterEffectLifecycleEvent } from '~~/server/domain/moveAutomation/effectLifecycle'
import {
  HELPING_HAND_ACCURACY_BONUS,
  HELPING_HAND_DAMAGE_BONUS,
  HELPING_HAND_EFFECT_BASE_ID,
  HELPING_HAND_MOVE_SOURCE_ID,
  HELPING_HAND_OPERATION_ID,
  isHelpingHandBonusEffect,
} from '~~/server/domain/moveAutomation/helpingHand'
import { createFiniteAuthoritativeMoveRandomStream } from '~~/server/domain/moveAutomation/random'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { HELPING_HAND_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/helpingHand'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import {
  LivePlayIntegrationHarness,
  assertAccepted,
} from './livePlayIntegrationHarness'

const helpingHandRow = manifestJson.moves.find(row => row.canonicalId === 'Helping Hand')!
const harnesses: LivePlayIntegrationHarness[] = []
const gm = { role: 'gm' as const, clientId: 'gm-helping-hand-client' }

const bonusEffect = (
  placementId = 'actor-token',
  round = 1,
): EncounterConditionEffect => parseEncounterEffect({
  id: `condition.helping-hand.${placementId}`,
  kind: 'condition',
  source: {
    operationId: HELPING_HAND_OPERATION_ID,
    moveId: HELPING_HAND_MOVE_SOURCE_ID,
    placementId: 'helper-token',
  },
  affected: {
    placementIds: [placementId],
    sideIds: [],
    cells: [],
  },
  createdRound: round,
  createdTurn: 0,
  duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
  stacks: 1,
  charges: 1,
  stackPolicy: { kind: 'refresh', maxStacks: null },
  chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
  tags: ['condition'],
  payload: {
    conditionId: 'helping-hand',
    action: 'apply',
    saveTiming: null,
  },
  dispel: { policy: 'matching-tags', tags: ['condition'] },
  transferPolicy: 'retain',
  suppression: { sources: [] },
}, 'helpingHandTest.effect') as EncounterConditionEffect

const withEffect = (map: TabletopMap, effect: EncounterConditionEffect): TabletopMap => ({
  ...map,
  encounterState: {
    ...createEmptyEncounterState(),
    ...map.encounterState,
    effects: [effect],
  },
})

const helpingHandPlan = () => {
  const fixture = yawnV2Fixture()
  const actor = fixture.pokemonSheets.get('actor')!
  return planAuthoritativeMoveState({
    ...fixture,
    pokemonSheets: new Map(fixture.pokemonSheets).set('actor', {
      ...actor,
      movelist: [{ name: 'Helping Hand' }],
    }),
    intent: {
      ...fixture.intent,
      moveName: 'Helping Hand',
    },
    random: createFiniteAuthoritativeMoveRandomStream([]),
    now: () => 5_000,
    operationId: 'op_helping_hand_apply',
  })
}

const targetCurrentHp = (
  plan: ReturnType<typeof planAuthoritativeMoveState>,
): number => plan.resolution.transaction.hpUpdates.find(
  update => update.id === 'target-token',
)?.currentHp ?? 100

const damagePipelineModifiers = (
  plan: ReturnType<typeof planAuthoritativeMoveState>,
): readonly unknown[] => {
  const event = plan.resolution.auditTrace.events.find(candidate => (
    candidate.kind === 'operation' && candidate.operationId === 'ember.damage'
  ))
  if (!event || event.kind !== 'operation') return []
  const result = event.result as {
    recipients?: readonly {
      details?: {
        calculation?: {
          damagePipeline?: {
            stages?: readonly { modifiers?: readonly unknown[] }[]
          }
        }
      }
    }[]
  }
  return result.recipients?.flatMap(recipient => (
    recipient.details?.calculation?.damagePipeline?.stages?.flatMap(
      stage => stage.modifiers ?? [],
    ) ?? []
  )) ?? []
}

const persistedSheets = (
  sheets: ReadonlyMap<string, CharacterSheet>,
): readonly PersistedSheet[] => [...sheets].map(([slug, sheet]) => ({
  kind: 'pokemon' as const,
  slug,
  revision: 0,
  updatedAt: 1_700_000_000_000,
  sheet: { ...sheet, slug, revision: 0, updatedAt: 1_700_000_000_000 },
}))

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

describe('Helping Hand native consumable bonus', () => {
  it('selects the complete reviewed runtime and links its conformance evidence', () => {
    expect(helpingHandRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '1368510ac461137277885785709e3fd75718fc5f581572c4d59931f53b1335be',
        sourceModule: 'server/domain/moveAutomation/specs/helpingHand.ts',
      },
      capabilityTags: ['expressions.bounded', 'lifecycle.effects'],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(helpingHandRow.scenarioIds).toEqual(
      HELPING_HAND_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(helpingHandRow.conformanceEvidence.scenarios).toEqual(
      HELPING_HAND_V2_SEMANTIC_SCENARIOS,
    )
    expect(registeredMoveAutomationRuntimeFor('Helping Hand')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: HELPING_HAND_MOVE_SPEC },
      definitionHash: helpingHandRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Helping Hand' }),
    )
  })

  it('stores one target-linked trigger charge instead of a sheet marker', () => {
    const plan = helpingHandPlan()
    const effect = plan.nextMap.encounterState?.effects.find(isHelpingHandBonusEffect)

    expect(plan.resolution.transaction.conditionUpdates).toEqual([])
    expect(effect).toMatchObject({
      source: {
        operationId: HELPING_HAND_OPERATION_ID,
        moveId: HELPING_HAND_MOVE_SOURCE_ID,
        placementId: 'actor-token',
      },
      affected: { placementIds: ['target-token'] },
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      charges: 1,
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      stackPolicy: { kind: 'refresh', maxStacks: null },
    })
    expect(projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: plan.nextMap.encounterState?.effects,
      target: { placementId: 'target-token' },
    }).conditions).toEqual(['Helping Hand'])
    expect(plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: HELPING_HAND_OPERATION_ID,
      outcome: 'applied',
    }))
  })

  it('applies +2 Accuracy and +10 Damage, traces both sources, then consumes once', () => {
    const fixture = emberV2Fixture('ember.v2-threshold-fail')
    const effect = bonusEffect()
    const aided = planAuthoritativeMoveState({
      ...fixture,
      map: withEffect(fixture.map, effect),
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      now: () => 5_000,
      operationId: 'op_helping_hand_consume',
    })
    const baseline = planAuthoritativeMoveState({
      ...fixture,
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      now: () => 5_000,
      operationId: 'op_helping_hand_baseline',
    })

    expect(targetCurrentHp(baseline) - targetCurrentHp(aided)).toBe(HELPING_HAND_DAMAGE_BONUS)
    expect(aided.resolution.rollLedger[0]?.modifiers).toContainEqual({
      sourceId: effect.id,
      reason: 'Helping Hand Accuracy',
      value: HELPING_HAND_ACCURACY_BONUS,
    })
    expect(damagePipelineModifiers(aided)).toContainEqual(expect.objectContaining({
      source: { kind: 'encounter-effect', id: effect.id },
      reasonCode: 'helping-hand.damage-roll-bonus',
      value: HELPING_HAND_DAMAGE_BONUS,
    }))
    expect(aided.resolution.helpingHandBonus).toMatchObject({
      status: 'applied',
      reasonCode: 'helping-hand.applied-and-consumed',
      effectIdsToConsume: [effect.id],
      accuracyBonus: HELPING_HAND_ACCURACY_BONUS,
      damageBonus: HELPING_HAND_DAMAGE_BONUS,
    })
    expect(aided.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'helping-hand.bonus-use',
      outcome: true,
      reasonCode: 'helping-hand.applied-and-consumed',
    }))
    expect(aided.nextMap.encounterState?.effects.some(isHelpingHandBonusEffect)).toBe(false)
    expect(effect.charges).toBe(1)
  })

  it('applies and consumes through the retired move’s native runtime', () => {
    const fixture = emberV2Fixture('ember.v2-threshold-fail')
    const actor = fixture.pokemonSheets.get('actor')!
    const legacyFixture = {
      ...fixture,
      pokemonSheets: new Map(fixture.pokemonSheets).set('actor', {
        ...actor,
        movelist: [{ name: 'Pound' }],
      }),
      intent: { ...fixture.intent, moveName: 'Pound' },
      randomValues: [0.8, 0],
    }
    const effect = bonusEffect()
    const aided = planAuthoritativeMoveState({
      ...legacyFixture,
      map: withEffect(legacyFixture.map, effect),
      random: createFiniteAuthoritativeMoveRandomStream(legacyFixture.randomValues),
      now: () => 5_000,
      operationId: 'op_helping_hand_legacy',
    })
    const baseline = planAuthoritativeMoveState({
      ...legacyFixture,
      random: createFiniteAuthoritativeMoveRandomStream(legacyFixture.randomValues),
      now: () => 5_000,
      operationId: 'op_helping_hand_legacy_baseline',
    })

    expect(aided.resolution.auditTrace.program.runtimeKind).toBe('movespec-v2')
    expect(targetCurrentHp(baseline) - targetCurrentHp(aided)).toBe(HELPING_HAND_DAMAGE_BONUS)
    expect(aided.resolution.rollLedger[0]?.modifiers).toContainEqual({
      sourceId: 'condition.helping-hand.actor-token',
      reason: 'Helping Hand Accuracy',
      value: HELPING_HAND_ACCURACY_BONUS,
    })
    expect(aided.resolution.helpingHandBonus).toMatchObject({
      status: 'applied',
      effectIdsToConsume: [effect.id],
      accuracyBonus: HELPING_HAND_ACCURACY_BONUS,
      damageBonus: HELPING_HAND_DAMAGE_BONUS,
    })
    expect(aided.nextMap.encounterState?.effects.some(isHelpingHandBonusEffect)).toBe(false)
  })

  it('consumes after an aided miss without inventing a Damage Roll', () => {
    const fixture = emberV2Fixture('ember.v2-miss')
    const effect = bonusEffect()
    const plan = planAuthoritativeMoveState({
      ...fixture,
      map: withEffect(fixture.map, effect),
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      now: () => 5_000,
      operationId: 'op_helping_hand_miss',
    })

    expect(plan.resolution.transaction.hitTargetIds).toEqual([])
    expect(plan.resolution.helpingHandBonus).toMatchObject({
      status: 'applied',
      accuracyBonus: HELPING_HAND_ACCURACY_BONUS,
      damageBonus: 0,
      damageRollIds: [],
      effectIdsToConsume: [effect.id],
    })
    expect(plan.nextMap.encounterState?.effects.some(isHelpingHandBonusEffect)).toBe(false)
  })

  it('retains the bonus for a non-rolling status move and records why', () => {
    const fixture = swordsDanceV2Fixture('swords-dance.v2-full-increase')
    const effect = bonusEffect('actor-token', 3)
    const plan = planAuthoritativeMoveState({
      ...fixture,
      map: withEffect(fixture.map, effect),
      random: createFiniteAuthoritativeMoveRandomStream([]),
      now: () => 5_000,
      operationId: 'op_helping_hand_retain',
    })

    expect(plan.resolution.helpingHandBonus).toMatchObject({
      status: 'not-qualifying',
      reasonCode: 'helping-hand.no-qualifying-roll',
      effectIdsToConsume: [],
      accuracyBonus: 0,
      damageBonus: 0,
    })
    expect(plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'helping-hand.bonus-use',
      outcome: false,
      reasonCode: 'helping-hand.no-qualifying-roll',
    }))
    expect(plan.nextMap.encounterState?.effects).toContainEqual(effect)
  })

  it('expires unused at the authoritative round end', () => {
    const effect = bonusEffect()
    const expired = applyEncounterEffectLifecycleEvent(
      { effects: [effect] },
      { kind: 'round-end' },
    )

    expect(expired.effects).toEqual([])
    expect(expired.transitions).toEqual([
      expect.objectContaining({
        effectId: effect.id,
        kind: 'expired',
        reasonCode: 'effect-duration-expired',
      }),
    ])
  })

  it('survives reconnect and duplicate delivery cannot consume or roll twice', async () => {
    const fixture = emberV2Fixture('ember.v2-threshold-fail')
    const effect = bonusEffect()
    const map: TabletopMap = {
      ...withEffect(fixture.map, effect),
      slug: 'integration-arena',
      revision: 0,
      updatedAt: 1_700_000_000_000,
    }
    const harness = LivePlayIntegrationHarness.create({
      map,
      sheets: persistedSheets(fixture.pokemonSheets),
    })
    harnesses.push(harness)
    const client = await harness.loadClient('helping-hand-reconnect-client')
    expect(client.map?.encounterState?.effects.some(isHelpingHandBonusEffect)).toBe(true)
    client.disconnect()

    const command = harness.resolveMoveCommand({
      opId: 'op_helping_hand_duplicate',
      baseRevision: 0,
      intent: fixture.intent,
      candidateScopePlacementIds: ['target-token'],
    })
    const first = await harness.resolveMove({ actor: gm, command })
    const duplicate = await harness.resolveMove({ actor: gm, command })

    const accepted = assertAccepted(first.result)
    expect(accepted).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(first.move).not.toHaveProperty('helpingHandBonus')
    expect(duplicate.result).toEqual(first.result)
    expect(harness.operationRecordCount()).toBe(1)
    expect((await harness.readMap())?.encounterState?.effects.some(isHelpingHandBonusEffect)).toBe(false)
    await client.reconnect()
    expect(client.map?.encounterState?.effects.some(isHelpingHandBonusEffect)).toBe(false)
  })
})
