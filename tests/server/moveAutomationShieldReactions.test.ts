import { describe, expect, it } from 'vitest'
import {
  MOVE_SHIELD_GUARD_BREAK_PRIORITY,
  MOVE_SHIELD_REACTION_DEFINITION_HASH,
  MOVE_SHIELD_REACTION_DEFINITIONS,
  MOVE_SHIELD_REACTION_PRIORITY,
  moveShieldReactionDefinition,
} from '../../server/domain/moveAutomation/shieldReactionDefinitions'
import {
  MoveShieldReactionError,
  applyMoveShieldReaction,
  buildMoveShieldReactionRequestOperation,
  createMoveShieldGuardBreak,
  createMoveShieldProvokingPlan,
} from '../../server/domain/moveAutomation/shieldReactions'
import {
  SHIELD_REACTION_CANARY_SCENARIOS,
  createShieldReactionCanaryAuthority,
  runShieldReactionCanaryScenario,
} from '../fixtures/moveAutomation/shieldReactions'

const basePlan = (options: {
  readonly moveCategory?: 'status' | 'damaging'
  readonly actionTiming?: 'ordinary' | 'priority' | 'interrupt'
  readonly range?: 'melee' | 'ranged' | 'other'
  readonly round?: number
  readonly targets?: readonly string[]
} = {}) => {
  const authority = createShieldReactionCanaryAuthority()
  const targets = options.targets ?? ['guardian']
  return {
    authority,
    plan: createMoveShieldProvokingPlan(authority, {
      actorPlacementId: 'attacker',
      moveCategory: options.moveCategory ?? 'damaging',
      actionTiming: options.actionTiming ?? 'ordinary',
      range: options.range ?? 'melee',
      encounterRound: options.round ?? 1,
      attackedTargetIds: targets,
      hitTargetIds: targets,
      effects: [
        { operationId: 'provoking.damage', recipientIds: targets },
        { operationId: 'provoking.effect', recipientIds: targets },
      ],
    }),
  }
}

describe('shield and guard reaction primitives', () => {
  it('keeps one versioned reviewed definition for every canary without production registration', () => {
    expect(MOVE_SHIELD_REACTION_DEFINITIONS.map(entry => entry.canonicalId)).toEqual([
      'Protect',
      'Detect',
      'Baneful Bunker',
      'King’s Shield',
      'Obstruct',
      'Spiky Shield',
      'Crafty Shield',
      'Mat Block',
      'Quick Guard',
      'Wide Guard',
    ])
    expect(new Set(MOVE_SHIELD_REACTION_DEFINITIONS.map(entry => entry.definitionId)).size)
      .toBe(MOVE_SHIELD_REACTION_DEFINITIONS.length)
    expect(MOVE_SHIELD_REACTION_DEFINITION_HASH).toMatch(/^[a-f0-9]{64}$/)
    expect(MOVE_SHIELD_GUARD_BREAK_PRIORITY).toBeGreaterThan(MOVE_SHIELD_REACTION_PRIORITY)
  })

  it('builds canonical phase-bound windows with server-owned guard priority', () => {
    for (const definition of MOVE_SHIELD_REACTION_DEFINITIONS) {
      const operation = buildMoveShieldReactionRequestOperation({
        canonicalMoveId: definition.canonicalId,
        operationId: `request.${definition.definitionId}`,
        recipients: definition.scope.kind === 'self' ? 'hit-targets' : 'area-targets',
      })
      expect(operation).toMatchObject({
        kind: 'reaction-request',
        phase: definition.timing === 'target' ? 'target' : 'hit',
        payload: {
          allowPass: true,
          timing: definition.timing,
          priority: MOVE_SHIELD_REACTION_PRIORITY,
          options: [{ id: definition.optionId }],
        },
      })
    }
  })

  it.each(SHIELD_REACTION_CANARY_SCENARIOS)(
    'applies $scenarioId before commit',
    (scenario) => {
      const result = runShieldReactionCanaryScenario(scenario)

      expect(result.status).toBe('applied')
      if (result.status !== 'applied') return
      expect(result.application.cancelledHitTargetIds)
        .toEqual(scenario.expectedCancelledTargetIds)
      expect(result.plan.preventedHitTargetIds)
        .toEqual(scenario.expectedCancelledTargetIds)
      expect(result.plan.hitTargetIds).toEqual(
        ['guardian', 'ally', 'area-foe', 'outside-target']
          .filter(id => !scenario.expectedCancelledTargetIds.includes(id)),
      )
      expect(result.plan.effects).toEqual([
        {
          operationId: 'provoking.damage',
          recipientIds: ['guardian', 'ally', 'area-foe', 'outside-target']
            .filter(id => !scenario.expectedCancelledTargetIds.includes(id)),
        },
        {
          operationId: 'provoking.secondary-effect',
          recipientIds: ['guardian', 'ally', 'area-foe', 'outside-target']
            .filter(id => !scenario.expectedCancelledTargetIds.includes(id)),
        },
      ])
      expect(result.plan.preventions.filter(entry => entry.kind === 'hit')).toHaveLength(1)
      expect(result.plan.preventions.filter(entry => entry.kind === 'effect')).toHaveLength(2)
      expect(result.plan.usageSpends).toEqual([expect.objectContaining({
        canonicalMoveId: scenario.canonicalMoveId,
        ownerPlacementId: 'guardian',
        amount: 1,
      })])
      expect(result.plan.retaliationOperations.map(operation => operation.kind)).toEqual(
        scenario.expectedRetaliationKind ? [scenario.expectedRetaliationKind] : [],
      )
    },
  )

  it('emits only typed melee retaliation operations for the four contact families', () => {
    const cases = [
      ['Baneful Bunker', { kind: 'condition', conditionId: 'poisoned' }],
      ['King’s Shield', { kind: 'combat-stage', stage: 'atk', value: -2 }],
      ['Obstruct', { kind: 'combat-stage', stage: 'def', value: -2 }],
      ['Spiky Shield', { kind: 'direct-hp', calculation: { kind: 'percent-max', percent: 10 } }],
    ] as const

    for (const [canonicalMoveId, expected] of cases) {
      const { authority, plan } = basePlan({
        moveCategory: canonicalMoveId === 'Obstruct' ? 'status' : 'damaging',
      })
      const result = applyMoveShieldReaction({
        authority,
        plan,
        canonicalMoveId,
        guardianPlacementId: 'guardian',
        reactionOperationId: `reaction.${moveShieldReactionDefinition(canonicalMoveId).definitionId}`,
      })
      expect(result.status).toBe('applied')
      expect(result.plan.retaliationOperations).toHaveLength(1)
      const operation = result.plan.retaliationOperations[0]!
      expect(operation).toMatchObject({
        kind: expected.kind,
        recipients: { kind: 'actor' },
        phase: 'after-damage',
        ...(expected.kind === 'condition'
          ? { payload: { conditionId: expected.conditionId } }
          : expected.kind === 'combat-stage'
            ? { payload: { stage: expected.stage, value: expected.value } }
            : { payload: { calculation: expected.calculation } }),
      })

      const ranged = applyMoveShieldReaction({
        authority,
        plan: basePlan({
          moveCategory: canonicalMoveId === 'Obstruct' ? 'status' : 'damaging',
          range: 'ranged',
        }).plan,
        canonicalMoveId,
        guardianPlacementId: 'guardian',
        reactionOperationId: `reaction.ranged-${moveShieldReactionDefinition(canonicalMoveId).definitionId}`,
      })
      expect(ranged.status).toBe('applied')
      expect(ranged.plan.retaliationOperations).toEqual([])
    }
  })

  it('fails category, timing, round, and side eligibility closed without spending usage', () => {
    const failures = [
      {
        canonicalMoveId: 'Crafty Shield' as const,
        source: basePlan({ moveCategory: 'damaging' }),
        scope: ['guardian'],
        reasonCode: 'shield-trigger-category-mismatch',
      },
      {
        canonicalMoveId: 'Quick Guard' as const,
        source: basePlan({ actionTiming: 'ordinary' }),
        scope: ['guardian'],
        reasonCode: 'shield-trigger-timing-mismatch',
      },
      {
        canonicalMoveId: 'Mat Block' as const,
        source: basePlan({ round: 2 }),
        scope: ['guardian'],
        reasonCode: 'shield-first-round-required',
      },
      {
        canonicalMoveId: 'Quick Guard' as const,
        source: basePlan({ actionTiming: 'priority', targets: ['unknown-side'] }),
        scope: ['unknown-side'],
        reasonCode: 'shield-trigger-target-uncovered',
      },
    ]

    for (const failure of failures) {
      const result = applyMoveShieldReaction({
        ...failure.source,
        canonicalMoveId: failure.canonicalMoveId,
        guardianPlacementId: 'guardian',
        reactionOperationId: `reaction.failure-${failure.canonicalMoveId.toLowerCase().replaceAll(' ', '-')}`,
        authoritativeScopePlacementIds: failure.scope,
      })
      expect(result).toMatchObject({
        status: 'ineligible',
        reasonCode: failure.reasonCode,
        plan: { usageSpends: [], appliedReactions: [] },
      })
    }
  })

  it('derives side coverage from allegiance while area coverage may include foes', () => {
    const sideSource = basePlan({
      actionTiming: 'priority',
      targets: ['guardian', 'ally', 'area-foe'],
    })
    const side = applyMoveShieldReaction({
      ...sideSource,
      canonicalMoveId: 'Quick Guard',
      guardianPlacementId: 'guardian',
      reactionOperationId: 'reaction.quick-guard-side',
      authoritativeScopePlacementIds: ['guardian', 'ally', 'area-foe'],
    })
    expect(side.application?.protectedRecipientIds).toEqual(['guardian', 'ally'])

    const areaSource = basePlan({
      moveCategory: 'status',
      targets: ['guardian', 'ally', 'area-foe', 'outside-target'],
    })
    const area = applyMoveShieldReaction({
      ...areaSource,
      canonicalMoveId: 'Crafty Shield',
      guardianPlacementId: 'guardian',
      reactionOperationId: 'reaction.crafty-shield-area',
      authoritativeScopePlacementIds: ['guardian', 'ally', 'area-foe'],
    })
    expect(area.application?.protectedRecipientIds).toEqual(['guardian', 'ally', 'area-foe'])
    expect(area.plan.hitTargetIds).toEqual(['outside-target'])
  })

  it('lets a higher-priority reviewed Feint break the guard before cancellation', () => {
    const { authority, plan } = basePlan()
    const guardBreak = createMoveShieldGuardBreak('reaction.feint')
    const result = applyMoveShieldReaction({
      authority,
      plan,
      canonicalMoveId: 'Protect',
      guardianPlacementId: 'guardian',
      reactionOperationId: 'reaction.protect-broken',
      guardBreak,
    })

    expect(result).toMatchObject({
      status: 'broken',
      application: {
        outcome: 'broken',
        cancelledHitTargetIds: [],
        cancelledEffectOperationIds: [],
        guardBreakOperationId: 'reaction.feint',
      },
      plan: {
        hitTargetIds: ['guardian'],
        effects: [
          { operationId: 'provoking.damage', recipientIds: ['guardian'] },
          { operationId: 'provoking.effect', recipientIds: ['guardian'] },
        ],
        usageSpends: [{ canonicalMoveId: 'Protect', amount: 1 }],
        retaliationOperations: [],
      },
    })
  })

  it('spends usage and applies retaliation exactly once on duplicate response delivery', () => {
    const { authority, plan } = basePlan()
    const first = applyMoveShieldReaction({
      authority,
      plan,
      canonicalMoveId: 'Baneful Bunker',
      guardianPlacementId: 'guardian',
      reactionOperationId: 'reaction.baneful-idempotent',
    })
    const duplicate = applyMoveShieldReaction({
      authority,
      plan: first.plan,
      canonicalMoveId: 'Baneful Bunker',
      guardianPlacementId: 'guardian',
      reactionOperationId: 'reaction.baneful-idempotent',
    })

    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.plan).toBe(first.plan)
    expect(duplicate.plan.usageSpends).toHaveLength(1)
    expect(duplicate.plan.retaliationOperations).toHaveLength(1)
    expect(duplicate.plan.appliedReactions).toHaveLength(1)
  })

  it('keeps inputs immutable and rejects non-authoritative recipient identities', () => {
    const authority = createShieldReactionCanaryAuthority()
    const targets = ['guardian']
    const effects = [{ operationId: 'provoking.damage', recipientIds: targets }]
    const plan = createMoveShieldProvokingPlan(authority, {
      actorPlacementId: 'attacker',
      moveCategory: 'damaging',
      actionTiming: 'ordinary',
      range: 'melee',
      encounterRound: 1,
      attackedTargetIds: targets,
      hitTargetIds: targets,
      effects,
    })
    const snapshot = structuredClone(plan)

    const result = applyMoveShieldReaction({
      authority,
      plan,
      canonicalMoveId: 'Protect',
      guardianPlacementId: 'guardian',
      reactionOperationId: 'reaction.protect-immutable',
    })

    expect(plan).toEqual(snapshot)
    expect(result.plan).not.toBe(plan)
    expect(Object.isFrozen(result.plan)).toBe(true)
    expect(Object.isFrozen(result.plan.effects)).toBe(true)
    expect(targets).toEqual(['guardian'])
    expect(effects).toEqual([{ operationId: 'provoking.damage', recipientIds: ['guardian'] }])

    expect(() => applyMoveShieldReaction({
      authority,
      plan,
      canonicalMoveId: 'Wide Guard',
      guardianPlacementId: 'guardian',
      reactionOperationId: 'reaction.wide-invalid',
      authoritativeScopePlacementIds: ['client-forged-placement'],
    })).toThrowError(expect.objectContaining({
      name: MoveShieldReactionError.name,
      code: 'placement-not-found',
    }))
  })
})
