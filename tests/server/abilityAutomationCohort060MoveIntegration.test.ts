import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { emberV2Fixture } from '../fixtures/moveAutomation/emberV2'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import { takeDownV2Fixture } from '../fixtures/moveAutomation/takeDownV2'

const targetHp = (plan: ReturnType<typeof planAuthoritativeMoveState>): number => {
  const write = plan.sheetWrites.find(entry => entry.slug === 'target')
  return (write?.nextSheet as CharacterSheet | undefined)?.combat?.currentHp ?? 100
}
const planEmber = (input: {
  readonly ability: 'Adaptability' | 'Analytic' | null
  readonly targetActed: boolean
  readonly adaptabilityDraw?: number
  readonly actorTypes?: readonly string[]
  readonly scenario?: Parameters<typeof emberV2Fixture>[0]
  readonly suppressAbility?: boolean
}) => {
  const fixture = emberV2Fixture(input.scenario ?? 'ember.v2-threshold-pass')
  const actor = structuredClone(fixture.pokemonSheets.get('actor')!)
  actor.types = [...(input.actorTypes ?? ['Fire'])]
  actor.abilities = input.ability ? [{ name: input.ability }] : []
  const pokemonSheets = new Map(fixture.pokemonSheets)
  pokemonSheets.set('actor', actor)
  const encounter = createEmptyEncounterState()
  const suppression = input.suppressAbility && input.ability
    ? {
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'suppress', values: [input.ability],
          referencePlacementId: null, suppressionScope: 'listed',
        }),
        id: `effect.suppress.${input.ability.toLowerCase()}`,
        affected: { placementIds: ['actor-token'], sideIds: [], cells: [] },
      }
    : null
  const encounterWithEffects = suppression ? { ...encounter, effects: [suppression] } : encounter
  const map = {
    ...fixture.map,
    encounterState: input.targetActed
      ? {
          ...encounterWithEffects,
          history: {
            ...encounterWithEffects.history,
            sceneId: 'scene:aa060',
            actedThisRoundPlacementIds: ['target-token'],
          },
        }
      : encounterWithEffects,
  }
  // Fire STAB raises Ember's DB and adds one deterministic damage die before
  // Adaptability requests its separate d10.
  const randomValues = [
    ...fixture.randomValues,
    0,
    ...(input.adaptabilityDraw === undefined ? [] : [input.adaptabilityDraw]),
  ]
  const fallbackDraw = 0
  return planAuthoritativeMoveState({
    ...fixture,
    map,
    pokemonSheets,
    random: () => randomValues.shift() ?? fallbackDraw,
    now: () => 5_000,
    operationId: `op_aa060_${input.ability?.toLowerCase() ?? 'base'}_${input.targetActed ? 'acted' : 'fresh'}`,
  })
}

describe('AA-060 production move integration', () => {
  it('aa060.abominable.static-hp-recoil raises Base HP by five and suppresses cleanly', () => {
    const contextFor = (suppressed: boolean) => {
      const fixture = takeDownV2Fixture({ actorAbilities: [{ name: 'Abominable' }] })
      const encounter = fixture.map.encounterState ?? createEmptyEncounterState()
      const suppression = creatureRuleOverlayEncounterEffectFixture({
        domain: 'ability', action: 'suppress', values: ['Abominable'],
        referencePlacementId: null, suppressionScope: 'listed',
      })
      return buildAuthoritativeMoveRulesContext({
        ...fixture,
        map: suppressed ? {
          ...fixture.map,
          encounterState: {
            ...encounter,
            effects: [{
              ...suppression,
              id: 'effect.suppress.abominable',
              affected: { placementIds: ['actor-token'], sideIds: [], cells: [] },
            }],
          },
        } : fixture.map,
        random: () => 0,
        time: 5_000,
      })
    }
    const active = contextFor(false)
    const suppressed = contextFor(true)
    expect(active.queries.abilities.has('actor-token', 'Abominable')).toBe(true)
    expect(active.actor.token.fullMaxHp! - suppressed.actor.token.fullMaxHp!).toBe(15)
    expect(active.actor.token.maxHp - suppressed.actor.token.maxHp).toBe(15)
    expect(suppressed.queries.abilities.has('actor-token', 'Abominable')).toBe(false)
  })

  it('aa060.adaptability.native-damage records one d10 and adds it only to a STAB damage roll', () => {
    const base = planEmber({ ability: null, targetActed: false })
    const applied = planEmber({ ability: 'Adaptability', targetActed: false, adaptabilityDraw: 0.4 })
    const exactRetry = planEmber({ ability: 'Adaptability', targetActed: false, adaptabilityDraw: 0.4 })
    // A 0.4 d10 draw resolves to 5 and normal effectiveness preserves all five points.
    expect(targetHp(base) - targetHp(applied)).toBe(5)
    expect(targetHp(exactRetry)).toBe(targetHp(applied))
    expect(exactRetry.resolution.rollLedger).toEqual(applied.resolution.rollLedger)
    expect(applied.resolution.rollLedger).toContainEqual(expect.objectContaining({
      rollId: 'ability.adaptability.ember.damage.actor-token',
      finalValue: 5,
    }))
  })

  it('does not roll or apply Adaptability when STAB is absent', () => {
    const base = planEmber({ ability: null, targetActed: false, actorTypes: ['Electric'] })
    const ineligible = planEmber({ ability: 'Adaptability', targetActed: false, actorTypes: ['Electric'] })
    expect(targetHp(ineligible)).toBe(targetHp(base))
    expect(ineligible.resolution.rollLedger.some(entry => entry.rollId.startsWith('ability.adaptability'))).toBe(false)
  })

  it('does not roll or apply Adaptability when the move misses', () => {
    const fixture = emberV2Fixture('ember.v2-miss')
    const actor = structuredClone(fixture.pokemonSheets.get('actor')!)
    actor.types = ['Fire']
    actor.abilities = [{ name: 'Adaptability' }]
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set('actor', actor)
    const draws = [...fixture.randomValues]
    const plan = planAuthoritativeMoveState({
      ...fixture,
      pokemonSheets,
      random: () => {
        const next = draws.shift()
        if (next === undefined) throw new Error('Adaptability requested entropy for a miss.')
        return next
      },
      now: () => 5_000,
      operationId: 'op_aa060_adaptability_miss',
    })
    expect(targetHp(plan)).toBe(100)
    expect(plan.resolution.rollLedger.some(entry => entry.rollId.startsWith('ability.adaptability'))).toBe(false)
  })

  it('aa060.analytic.native-damage adds five only when the target already acted this round', () => {
    const fresh = planEmber({ ability: 'Analytic', targetActed: false })
    const acted = planEmber({ ability: 'Analytic', targetActed: true })
    expect(targetHp(fresh) - targetHp(acted)).toBe(5)
  })

  it('keeps Analytic in pre-type ordering on a critical hit and off a miss', () => {
    const criticalBase = planEmber({ ability: null, targetActed: true, scenario: 'ember.v2-critical-hit' })
    const critical = planEmber({ ability: 'Analytic', targetActed: true, scenario: 'ember.v2-critical-hit' })
    const miss = planEmber({ ability: 'Analytic', targetActed: true, scenario: 'ember.v2-miss' })
    expect(targetHp(criticalBase) - targetHp(critical)).toBe(5)
    expect(targetHp(miss)).toBe(100)
  })

  it('suppresses both static mechanics when absent or disabled by an authoritative overlay', () => {
    const base = planEmber({ ability: null, targetActed: true })
    const analytic = planEmber({ ability: 'Analytic', targetActed: true })
    const suppressedAnalytic = planEmber({ ability: 'Analytic', targetActed: true, suppressAbility: true })
    const suppressedAdaptability = planEmber({
      ability: 'Adaptability', targetActed: false, adaptabilityDraw: 0.4, suppressAbility: true,
    })
    expect(targetHp(base) - targetHp(analytic)).toBe(5)
    expect(targetHp(suppressedAnalytic)).toBe(targetHp(base))
    expect(suppressedAdaptability.resolution.rollLedger.some(entry => entry.rollId.startsWith('ability.'))).toBe(false)
    expect(base.resolution.rollLedger.some(entry => entry.rollId.startsWith('ability.'))).toBe(false)
  })
})
