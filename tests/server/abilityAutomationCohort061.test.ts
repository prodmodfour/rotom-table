import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { resolveMoveCriticalHit } from '../../server/domain/moveAutomation/criticalHits'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../server/domain/moveAutomation/reducers/immunities'
import { resolveMoveCoreTokenRecipient } from '../../server/domain/moveAutomation/reducers/coreTokenRecipients'
import type { MoveConditionEffectOperation } from '#shared/moveAutomation/effects'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/moveAutomation/registry'
import { AA061_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa061'
import { validateAbilitySpec } from '../../server/domain/abilityAutomation/validateSpec'
import { emberV2Fixture } from '../fixtures/moveAutomation/emberV2'

const emberPlan = (injuries: number) => {
  const fixture = emberV2Fixture('ember.v2-threshold-pass')
  const actor = structuredClone(fixture.pokemonSheets.get('actor')!)
  actor.abilities = [{ name: 'Aura Storm' }]
  actor.combat = { ...(actor.combat ?? {}), injuries }
  const pokemonSheets = new Map(fixture.pokemonSheets)
  pokemonSheets.set('actor', actor)
  const draws = [...fixture.randomValues, 0, 0, 0]
  return planAuthoritativeMoveState({
    ...fixture,
    pokemonSheets,
    random: () => draws.shift() ?? 0,
    now: () => 5_000,
    operationId: `op_aa061_aura_storm_${injuries}`,
  })
}
const targetHp = (plan: ReturnType<typeof emberPlan>): number => (
  (plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet | undefined)
    ?.combat?.currentHp ?? 100
)

describe('AA-061 native cohort foundations', () => {
  it('validates the exact twelve reviewed AbilitySpecs', () => {
    expect(AA061_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Aqua Boost', 'Aqua Bullet', 'Arena Trap', 'Aroma Veil', 'Aura Break', 'Aura Storm',
      'Bad Dreams', 'Ball Fetch', 'Battery', 'Battle Armor', 'Beam Cannon', 'Beast Boost',
    ])
    for (const spec of AA061_ABILITY_SPECS) expect(validateAbilitySpec(spec).spec).toEqual(spec)
  })

  it('aa061.aura-storm.injury-scaling adds exactly three damage per current injury', () => {
    const none = emberPlan(0)
    const two = emberPlan(2)
    expect(targetHp(none) - targetHp(two)).toBe(6)
    expect(JSON.stringify(two.resolution.auditTrace)).toContain('ability.aura-storm.injury-bonus')
  })

  it('aa061.aroma-veil.adjacent-immunity prevents all three canonical conditions', () => {
    const fixture = emberV2Fixture('ember.v2-threshold-pass')
    const provider = structuredClone(fixture.pokemonSheets.get('actor')!)
    provider.slug = 'provider'
    provider.abilities = [{ name: 'Aroma Veil' }]
    provider.movelist = []
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set('provider', provider)
    const context = buildAuthoritativeMoveRulesContext({
      ...fixture,
      pokemonSheets,
      map: {
        ...fixture.map,
        placements: [
          ...fixture.map.placements,
          { id: 'provider-token', sheetKind: 'pokemon', sheetSlug: 'provider', position: { x: 3, y: 0, z: 1 } },
        ],
        encounterState: createEmptyEncounterState(),
      },
      random: () => 0,
      time: 5_000,
    })
    const operation: MoveConditionEffectOperation = {
      id: 'test.condition', kind: 'condition', source: { kind: 'move', id: 'move.test' },
      recipients: { kind: 'selected-targets' }, phase: 'after-damage', reasonCode: 'test.condition',
      payload: {
        action: 'apply', conditionId: 'confused', conditionSource: null, filter: null, randomChoice: null,
        duration: null, saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
      },
    }
    const query = createStandardMoveCoreTokenEffectImmunityQueries({ moveType: null, context })
    const recipient = resolveMoveCoreTokenRecipient(context, 'target-token')
    for (const condition of ['Confused', 'Rage', 'Suppressed']) {
      expect(query.condition({ operation, condition, recipient })).toMatchObject({
        blockedBy: 'Aroma Veil', consultedPlacementIds: ['provider-token'],
      })
    }
  })

  it('aa061.beam-cannon.expanded-ranges expands both Effect and Critical ranges by three', () => {
    const fixture = emberV2Fixture('ember.v2-threshold-fail')
    const actor = structuredClone(fixture.pokemonSheets.get('actor')!)
    actor.abilities = [{ name: 'Beam Cannon' }]
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set('actor', actor)
    const draws = [...fixture.randomValues, 0, 0]
    const plan = planAuthoritativeMoveState({
      ...fixture,
      pokemonSheets,
      random: () => draws.shift() ?? 0,
      now: () => 5_000,
      operationId: 'op_aa061_beam_cannon',
    })
    expect(plan.resolution.transaction.conditionUpdates).toContainEqual(expect.objectContaining({
      id: 'target-token', conditions: expect.arrayContaining(['Burned']),
    }))
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('critical-hit')
  })

  it('aa061.battle-armor.critical-immunity uses only the effective selected runtime', () => {
    const fixture = emberV2Fixture('ember.v2-threshold-pass')
    const target = structuredClone(fixture.pokemonSheets.get('target')!)
    target.abilities = [{ name: 'Battle Armor' }]
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set('target', target)
    const context = buildAuthoritativeMoveRulesContext({
      ...fixture,
      pokemonSheets,
      map: { ...fixture.map, encounterState: createEmptyEncounterState() },
      random: () => 0,
      time: 5_000,
    })
    const runtime = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve('Ember')!
    if (runtime.kind !== 'movespec-v2') throw new Error('Ember native runtime missing.')
    const operation = runtime.definition.spec.phases.flatMap(phase => phase.operations)
      .find(candidate => candidate.kind === 'damage')
    if (!operation || operation.kind !== 'damage') throw new Error('Ember damage operation missing.')
    const entry = context.queries.resolveActorMoveEntry('Ember')
    if (!entry.ok) throw new Error(entry.message)
    expect(resolveMoveCriticalHit({
      context, operation, script: entry.entry.script, recipientId: 'target-token', naturalRoll: 20,
    })).toMatchObject({ candidate: true, critical: false, preventedBy: 'Battle Armor', reasonCode: 'critical-prevented' })
  })
})
