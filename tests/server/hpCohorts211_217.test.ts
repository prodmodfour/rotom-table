import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '~~/server/domain/moveAutomation/handlers/registry'
import { HP_COHORTS_211_217_HANDLER_REGISTRATION } from '~~/server/domain/moveAutomation/handlers/hpCohorts211_217'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  resolveStaticGrappleMoveBonuses,
  staticGrappleDominanceHpLoss,
} from '~~/server/domain/moveAutomation/staticMovePassives'
import {
  BELLY_DRUM_MOVE_SPEC,
  BIND_MOVE_SPEC,
  BRINE_MOVE_SPEC,
  DRAIN_PUNCH_MOVE_SPEC,
  FINAL_GAMBIT_MOVE_SPEC,
  HOLD_HANDS_MOVE_SPEC,
  HP_COHORTS_211_217_MOVE_SPEC_REGISTRATIONS,
  MA_211_217_MOVE_NAMES,
  METAL_BURST_MOVE_SPEC,
  MYSTICAL_POWER_MOVE_SPEC,
  PAIN_SPLIT_MOVE_SPEC,
  POLLEN_PUFF_MOVE_SPEC,
  RELIC_SONG_MOVE_SPEC,
  STRENGTH_SAP_MOVE_SPEC,
  TOXIC_THREAD_MOVE_SPEC,
  type HpCohort211217MoveName,
} from '~~/server/domain/moveAutomation/specs/hpCohorts211_217'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { MA_211_217_SCENARIOS_BY_MOVE } from '../fixtures/moveAutomation/hpCohorts211_217'

const operations = (spec: typeof BELLY_DRUM_MOVE_SPEC) => spec.phases.flatMap(
  block => block.operations.map(operation => parseMoveEffectOperation(operation)),
)

const operation = (spec: typeof BELLY_DRUM_MOVE_SPEC, id: string) => (
  operations(spec).find(candidate => candidate.id === id)
)

describe('MA-211 through MA-217 HP and direct-loss move cohorts', () => {
  it('registers every reviewed move exactly once with immutable manifest hashes', () => {
    expect(HP_COHORTS_211_217_MOVE_SPEC_REGISTRATIONS.map(value => value.canonicalId))
      .toEqual(MA_211_217_MOVE_NAMES)
    expect(new Set(MA_211_217_MOVE_NAMES).size).toBe(50)

    for (const registration of HP_COHORTS_211_217_MOVE_SPEC_REGISTRATIONS) {
      const moveName = registration.canonicalId as HpCohort211217MoveName
      const row = manifestJson.moves.find(value => value.canonicalId === moveName)!
      const definition = validateMoveSpec(registration.spec, {
        capabilityIds: row.capabilityTags,
        rulesetVersion: row.rulesProvenance,
        handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      })
      expect(row).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        runtime: {
          kind: 'movespec-v2',
          version: 2,
          definitionHash: definition.definitionHash,
          sourceModule: registration.sourceModule,
        },
      })
      expect(row.scenarioIds).toEqual(
        MA_211_217_SCENARIOS_BY_MOVE[moveName].map(value => value.scenarioId),
      )
      expect(registeredMoveAutomationRuntimeFor(moveName)?.definitionHash)
        .toBe(definition.definitionHash)
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(value => (
        value.canonicalId === moveName
      ))).toHaveLength(1)
      expect(Object.isFrozen(definition.spec)).toBe(true)
    }
  })

  it('publishes browser-safe native intent metadata and hides Static grapple records', () => {
    for (const moveName of MA_211_217_MOVE_NAMES) {
      const status = menuStatusJson.moves.find(value => value.canonicalId === moveName)
      expect(status, moveName).toMatchObject({
        canonicalId: moveName,
        baseStatus: 'complete',
        runtimeKind: 'movespec-v2',
      })
      const presentation = nativeMoveAutomationPresentationScriptForMove(moveName)
      if (['Bind', 'Clamp', 'Wrap'].includes(moveName)) expect(presentation).toBeNull()
      else {
        expect(presentation, moveName).not.toBeNull()
        expect(presentation?.automationNotes, moveName).toEqual([])
      }
    }
  })

  it('encodes costs, drains, recoil links, split HP, and round retaliation structurally', () => {
    expect(operation(BELLY_DRUM_MOVE_SPEC, 'belly-drum.half-max-cost')).toMatchObject({
      kind: 'direct-hp',
      phase: 'pay',
      payload: {
        calculation: { kind: 'percent-max', percent: 50 },
        cost: { kind: 'cost', timing: 'declaration' },
      },
    })
    expect(operation(DRAIN_PUNCH_MOVE_SPEC, 'drain-punch.drain-heal')).toMatchObject({
      kind: 'heal',
      payload: {
        calculation: {
          kind: 'damage-dealt',
          damageOperationId: 'drain-punch.damage',
          percent: 50,
        },
      },
    })
    expect(operation(PAIN_SPLIT_MOVE_SPEC, 'pain-split.equalize-hp')).toMatchObject({
      kind: 'direct-hp',
      recipients: { kind: 'actor-and-attacked-targets' },
      payload: { mode: 'split', calculation: null },
    })
    expect(operation(METAL_BURST_MOVE_SPEC, 'metal-burst.retaliation-loss')).toMatchObject({
      kind: 'direct-hp',
      payload: {
        calculation: {
          kind: 'formula',
          expression: { kind: 'move-history', query: 'damage-received-this-round' },
        },
      },
    })
    expect(operation(FINAL_GAMBIT_MOVE_SPEC, 'final-gambit.target-loss')).toMatchObject({
      kind: 'direct-hp',
      payload: { calculation: { kind: 'hp-lost', hpOperationId: 'final-gambit.self-sacrifice' } },
    })
  })

  it('encodes authoritative contextual, relationship, threshold, and form branches', () => {
    for (const spec of [BRINE_MOVE_SPEC, MYSTICAL_POWER_MOVE_SPEC, STRENGTH_SAP_MOVE_SPEC]) {
      expect(spec.registeredHandlerId).toBe('ma211-217.hp-outliers')
    }
    expect(POLLEN_PUFF_MOVE_SPEC.registeredHandlerId).toBe('ma211-217.hp-outliers')
    expect(operation(POLLEN_PUFF_MOVE_SPEC, 'pollen-puff.relationship')).toMatchObject({
      kind: 'branch', payload: { kind: 'relationship', scope: 'recipient' },
    })
    expect(operation(TOXIC_THREAD_MOVE_SPEC, 'toxic-thread.poison-state')).toMatchObject({
      kind: 'branch', payload: { kind: 'predicate', scope: 'recipient' },
    })
    expect(operation(RELIC_SONG_MOVE_SPEC, 'relic-song.choose-form')).toMatchObject({
      kind: 'branch', payload: { kind: 'choice', requestId: 'relic-song.form' },
    })
    expect(operation(HOLD_HANDS_MOVE_SPEC, 'hold-hands.save-bonus')).toMatchObject({
      kind: 'temporary-effect',
      payload: { definition: { payload: { attribute: 'save-check', value: 2 } } },
    })
  })

  it('derives HP-scaled damage and tied highest-stat branches from authoritative queries', () => {
    const baseContext = {
      map: {},
      actor: {
        placement: { id: 'actor' },
        token: { currentHp: 80, maxHp: 100, fullMaxHp: 100 },
      },
      candidatePlacements: [],
      selectedPlacements: [{ id: 'target' }],
      resolvedSheets: [],
      ruleset: {},
      reads: { recordPlacement: () => undefined },
      queries: {
        tokens: { get: () => ({ currentHp: 49, maxHp: 100, fullMaxHp: 100 }) },
        targetStates: { resolve: () => ({ conditionIds: ['burned', 'confused'] }) },
        relationships: { resolve: () => ({ relationship: 'ally' }) },
        stats: {
          resolve: (_placementId: string, input: { stat: string }) => ({
            value: input.stat === 'attack' || input.stat === 'special-attack' ? 12 : 6,
          }),
        },
      },
    }
    const run = (moveName: string, hasCapability = (_id: string, _capability: string) => false) => (
      HP_COHORTS_211_217_HANDLER_REGISTRATION.run({
        ...baseContext,
        intent: { moveName },
        queries: {
          ...baseContext.queries,
          creatureRules: { hasCapability },
        },
      } as never) as { readonly operations: readonly ReturnType<typeof parseMoveEffectOperation>[] }
    )

    expect(run('Brine').operations[0]).toMatchObject({
      kind: 'damage', payload: { damageBase: 13 },
    })
    const mystical = run('Mystical Power').operations
    expect(mystical.find(value => value.id === 'mystical-power.choose-highest-stat')).toMatchObject({
      kind: 'branch',
      payload: {
        kind: 'choice',
        options: [{ id: 'atk' }, { id: 'satk' }],
      },
    })
    expect(run('Purify').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'purify.clear-statuses', kind: 'condition' }),
      expect.objectContaining({
        id: 'purify.heal-per-status',
        kind: 'heal',
        payload: expect.objectContaining({ calculation: { kind: 'fixed', value: 20 } }),
      }),
    ]))
    expect(run('Pollen Puff').operations).toEqual([
      expect.objectContaining({ id: 'pollen-puff.ally-usage', kind: 'usage' }),
    ])
    expect(run('Explosion').operations).toEqual([
      expect.objectContaining({
        id: 'explosion.loyalty-adjudication',
        kind: 'branch',
        payload: expect.objectContaining({ owner: 'gm', pass: expect.objectContaining({ operationIds: [] }) }),
      }),
      expect.objectContaining({
        id: 'explosion.loyalty-decrease',
        kind: 'loyalty',
        payload: { action: 'decrease-rank', amount: 1, minimum: 0 },
      }),
    ])
    expect(run('Self-Destruct', (_id, capability) => capability === 'Volatile Bomb').operations).toEqual([])
  })

  it('deduplicates Static grapple passives and rounds dominance loss down', () => {
    expect(resolveStaticGrappleMoveBonuses(['Wrap', 'Bind', 'Bind'])).toEqual({
      sourceMoveIds: ['Bind', 'Wrap'],
      initiateAccuracyBonus: 1,
      initiateSkillCheckBonus: 2,
      dominanceSkillCheckBonus: 2,
      dominanceTargetHpLossPercent: 10,
    })
    expect(staticGrappleDominanceHpLoss(99)).toBe(9)
    expect(() => staticGrappleDominanceHpLoss(0)).toThrow(/positive authoritative full Max HP/)
    expect(BIND_MOVE_SPEC.preconditions[0]?.failureReasonCode).toBe('bind.not-declarable')
  })
})
