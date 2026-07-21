import { describe, expect, it } from 'vitest'
import { validateAbilitySpec } from '../../server/domain/abilityAutomation/validateSpec'
import type { AbilitySpecV1Runtime } from '../../server/domain/abilityAutomation/registry'
import { AA060_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa060'
import {
  aa060AnchorAllowsPlacement,
  aa060MechanicForRuntime,
  materializeAa060PassiveProviders,
  resolveAa060Aftermath,
  resolveAa060AirLock,
  resolveAa060AnchorShift,
  resolveAa060AngerPoint,
  resolveAa060Anticipation,
  resolveAa060MoveMechanics,
  type Aa060MoveFact,
} from '../../server/domain/abilityAutomation/mechanics/aa060'

const runtime = (spec: (typeof AA060_ABILITY_SPECS)[number]): AbilitySpecV1Runtime => {
  const definition = validateAbilitySpec(spec)
  return {
    canonicalId: spec.canonicalId,
    kind: 'abilityspec-v1', version: 1,
    definitionHash: definition.definitionHash,
    sourceModule: 'server/domain/abilityAutomation/specs/aa060.ts',
    definition,
  }
}
const moveFact = (overrides: Partial<Aa060MoveFact> = {}): Aa060MoveFact => ({
  actorPlacementId: 'actor', targetPlacementId: 'target', moveInstanceId: 'move:one',
  moveType: 'normal', actorTypeIds: ['flying'], damageClass: 'physical',
  damageBaseBeforeStab: 6, keywords: [], actorSpeed: 15,
  actorInitiativeOrder: 5, targetInitiativeOrder: 2,
  hit: true, baseTypeMultiplier: 1, adaptabilityRoll: null,
  activeMechanics: [], accelerateMoveInstanceId: null, ambushMoveInstanceId: null,
  ...overrides,
})

describe('AA-060 Abominable through Anticipation', () => {
  it('validates one hash-bound reviewed runtime mechanic for every cohort ability', () => {
    expect(AA060_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Abominable', 'Absorb Force', 'Accelerate', 'Adaptability', 'Aerilate', 'Aftermath',
      'Air Lock', 'Ambush', 'Analytic', 'Anchored', 'Anger Point', 'Anticipation',
    ])
    for (const spec of AA060_ABILITY_SPECS) {
      const selectedMode = String(spec.modes[0]!.id)
      expect(aa060MechanicForRuntime(runtime(spec), selectedMode).mechanicId)
        .toBe(`aa060.${spec.canonicalId.toLowerCase().replaceAll(' ', '-')}`)
    }
  })

  it('materializes Abominable Base HP and recoil prevention only while effective', () => {
    const resolved = materializeAa060PassiveProviders({ abilities: [{
      instanceId: 'base:actor:0', canonicalId: 'Abominable', sourcePlacementId: 'actor',
    }] })
    expect(resolved.passiveGroups).toEqual([
      expect.objectContaining({ attribute: 'stat.hp', providers: [expect.objectContaining({ value: 5 })] }),
    ])
    expect(resolved.hpProviders).toEqual([
      expect.objectContaining({ effect: { kind: 'damage-prevention' }, predicate: expect.objectContaining({ damageKinds: ['recoil'] }) }),
    ])
    expect(materializeAa060PassiveProviders({ abilities: [] })).toMatchObject({ passiveGroups: [], hpProviders: [] })
  })

  it('orders Aerilate, STAB, Accelerate, Adaptability, Ambush, and Analytic deterministically', () => {
    const result = resolveAa060MoveMechanics(moveFact({
      activeMechanics: [
        'aa060.accelerate', 'aa060.adaptability', 'aa060.aerilate',
        'aa060.ambush', 'aa060.analytic', 'aa060.abominable',
      ],
      adaptabilityRoll: 7,
      accelerateMoveInstanceId: 'move:one',
      ambushMoveInstanceId: 'move:one',
      keywords: ['priority'],
    }))
    expect(result).toMatchObject({
      moveType: 'flying', hasStab: true, priority: true, accuracyBonus: 4,
      // floor(15/2) + 1d10 result + Analytic
      preTypeDamageBonus: 19,
      ignoreRecoil: true,
      hitEffects: [
        { kind: 'condition', conditionId: 'flinched', durationRounds: 1 },
        { kind: 'accuracy-penalty', value: -2, durationRounds: 1 },
      ],
    })
    expect(result.appliedMechanicIds).toEqual([
      'aa060.aerilate', 'aa060.accelerate', 'aa060.ambush',
      'aa060.adaptability', 'aa060.analytic', 'aa060.abominable',
    ])
  })

  it('enforces move eligibility, misses, DB thresholds, and recorded Adaptability rolls', () => {
    const missed = resolveAa060MoveMechanics(moveFact({
      actorTypeIds: ['normal'], hit: false, damageBaseBeforeStab: 7,
      activeMechanics: ['aa060.accelerate', 'aa060.ambush'],
      accelerateMoveInstanceId: 'move:one', ambushMoveInstanceId: 'move:one',
    }))
    expect(missed).toMatchObject({ priority: true, preTypeDamageBonus: 0, hitEffects: [] })
    expect(missed.appliedMechanicIds).toEqual(['aa060.accelerate'])
    expect(() => resolveAa060MoveMechanics(moveFact({
      actorTypeIds: ['normal'], activeMechanics: ['aa060.adaptability'], adaptabilityRoll: null,
    }))).toThrow(/recorded d10/)
  })

  it('applies Absorb Force exactly one resistance step only to physical attacks', () => {
    expect(resolveAa060MoveMechanics(moveFact({
      activeMechanics: ['aa060.absorb-force'], baseTypeMultiplier: 1.5,
    }))).toMatchObject({ resistanceSteps: 1, finalTypeMultiplier: 1 })
    expect(resolveAa060MoveMechanics(moveFact({
      activeMechanics: ['aa060.absorb-force'], damageClass: 'special', baseTypeMultiplier: 1.5,
    }))).toMatchObject({ resistanceSteps: 0, finalTypeMultiplier: 1.5 })
  })

  it('resolves Aftermath Burst 1 as three target-owned HP ticks with mixed outcomes', () => {
    expect(resolveAa060Aftermath([
      { placementId: 'inside', maximumHp: 55, distance: 1, externalImmune: false },
      { placementId: 'immune', maximumHp: 21, distance: 1, externalImmune: true },
      { placementId: 'outside', maximumHp: 100, distance: 2, externalImmune: false },
    ])).toEqual([
      { placementId: 'inside', tickValue: 5, attemptedHpLoss: 15, appliedHpLoss: 15, outcome: 'applied' },
      { placementId: 'immune', tickValue: 2, attemptedHpLoss: 6, appliedHpLoss: 0, outcome: 'prevented' },
      { placementId: 'outside', tickValue: 10, attemptedHpLoss: 30, appliedHpLoss: 0, outcome: 'outside-burst' },
    ])
  })

  it('sustains Air Lock only with its Swift upkeep on the next round', () => {
    const started = resolveAa060AirLock({
      sourceAbilityInstanceId: 'base:actor:0', round: 2, activated: true,
      previous: null, swiftSustainPaid: false,
    })
    expect(started).toMatchObject({ active: true, weatherSuppressed: true, sustainAction: 'swift' })
    expect(resolveAa060AirLock({
      sourceAbilityInstanceId: 'base:actor:0', round: 3, activated: false,
      previous: started, swiftSustainPaid: true,
    }).active).toBe(true)
    expect(resolveAa060AirLock({
      sourceAbilityInstanceId: 'base:actor:0', round: 4, activated: false,
      previous: { ...started, round: 3 }, swiftSustainPaid: false,
    }).active).toBe(false)
  })

  it('enforces Anchored range/open-space/control and emits only an affordable optional attack', () => {
    expect(aa060AnchorAllowsPlacement({ anchorPosition: { x: 0, y: 0, z: 0 }, placementPosition: { x: 2, y: 0, z: 2 } })).toBe(true)
    expect(aa060AnchorAllowsPlacement({ anchorPosition: { x: 0, y: 0, z: 0 }, placementPosition: { x: 3, y: 0, z: 3 } })).toBe(false)
    expect(resolveAa060AnchorShift({
      sourcePosition: { x: 0, y: 0, z: 0 }, destination: { x: 2, y: 0, z: 2 },
      controllerAuthorized: true, destinationOpen: true, optionalMoveInstanceId: 'move:anchor',
      damagingMove: true, attackActionAvailable: true,
    })).toMatchObject({
      legal: true,
      nestedAttack: { moveInstanceId: 'move:anchor', rangeId: 'melee-1-target', bonusFormula: '2d6', damageClass: 'physical' },
    })
    expect(resolveAa060AnchorShift({
      sourcePosition: { x: 0, y: 0, z: 0 }, destination: { x: 3, y: 0, z: 3 },
      controllerAuthorized: true, destinationOpen: true, optionalMoveInstanceId: null,
      damagingMove: false, attackActionAvailable: false,
    })).toMatchObject({ legal: false, reasonCode: 'anchor-out-of-range', nestedAttack: null })
  })

  it('applies Anger Point on an unprevented critical and respects the +6 cap', () => {
    expect(resolveAa060AngerPoint({ critical: true, prevented: false, currentAttackStage: -2, conditions: [] }))
      .toEqual({ applied: true, attackStage: 4, conditions: ['Enraged'] })
    expect(resolveAa060AngerPoint({ critical: true, prevented: false, currentAttackStage: 4, conditions: ['Enraged'] }))
      .toEqual({ applied: true, attackStage: 6, conditions: ['Enraged'] })
    expect(resolveAa060AngerPoint({ critical: false, prevented: false, currentAttackStage: 0, conditions: [] }).applied).toBe(false)
  })

  it('returns only Anticipation’s private binary answer and rejects repeat targets', () => {
    const result = resolveAa060Anticipation({
      actorTypeIds: ['Grass'], targetPlacementId: 'target',
      targetMoves: [
        { moveId: 'ember', type: 'Fire', damageClass: 'special' },
        { moveId: 'growl', type: 'Normal', damageClass: 'status' },
      ],
      existingReceiptIds: [], receiptId: 'anticipation:actor:target',
    })
    expect(result).toEqual({
      targetPlacementId: 'target', hasSuperEffectiveMove: true,
      revealedMoveIds: [], receiptId: 'anticipation:actor:target',
    })
    expect(JSON.stringify(result)).not.toContain('ember')
    expect(() => resolveAa060Anticipation({
      actorTypeIds: ['Grass'], targetPlacementId: 'target', targetMoves: [],
      existingReceiptIds: ['anticipation:actor:target'], receiptId: 'anticipation:actor:target',
    })).toThrow(/already queried/)
  })
})
