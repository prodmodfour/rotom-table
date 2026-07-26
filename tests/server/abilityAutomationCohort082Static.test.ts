import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA082_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa082'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import { moveAutomationMoveImmunitySource } from '~/utils/moveAutomationMoveImmunity'
import { resolveMoveAutomationTargetEvasion } from '~/utils/moveAutomationAccuracy'
import { aa082ParentalBondTetherViolation } from '../../server/domain/abilityAutomation/mechanics/aa082MovementIntegration'
import { aa082OdiousSprayScript } from '../../server/domain/abilityAutomation/mechanics/aa082StaticIntegration'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: { schemaVersion: 1 as const, instanceId: `base:${id(canonicalId)}`, canonicalId, definitionVersion: null, selections: [] },
})
const sheet = (input: { slug: string; move?: string; abilities?: readonly string[]; hp?: number; types?: readonly string[] }): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: { hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 }, satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 300, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string; move: string; actorAbilities?: readonly string[]; targetAbilities?: readonly string[];
  actorHp?: number; targetTypes?: readonly string[]; allyAbility?: string; allyDistance?: number;
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
    ...(input.allyAbility ? [{ id: 'ally', sheetKind: 'pokemon' as const, sheetSlug: 'ally', sideId: 'heroes', position: { x: 2 + (input.allyDistance ?? 1), y: 0, z: 3 } }] : []),
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0, voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1, currentTurn: { round: 1, turn: 1, placementId: 'actor' } },
      turnResources: Object.fromEntries(placements.map(p => [p.id, createEncounterTurnResourceLedger({ placementId: p.id, round: 1, turn: 1 })])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 }, metadata: {},
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, abilities: input.actorAbilities, hp: input.actorHp })],
    ['target', sheet({ slug: 'target', abilities: input.targetAbilities, types: input.targetTypes })],
    ...(input.allyAbility ? [['ally', sheet({ slug: 'ally', abilities: [input.allyAbility] })] as const] : []),
  ])
  return { map, sheets, move: input.move }
}
type State = ReturnType<typeof fixture>
const resolve = (s: State) => planAuthoritativeMoveState({
  map: s.map, pokemonSheets: s.sheets, trainerSheets: new Map(),
  intent: { schemaVersion: 1, placementId: 'actor', moveName: s.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
  random: () => 0.75, now: () => 1000, operationId: `op_${id(s.map.slug)}`,
})
const hp = (s: State) => ((resolve(s).sheetWrites.find(w => w.slug === 'target')?.nextSheet ?? s.sheets.get('target')!) as CharacterSheet).combat?.currentHp ?? 0
const context = (s: State) => buildAuthoritativeMoveRulesContext({
  map: s.map, pokemonSheets: s.sheets, trainerSheets: new Map(),
  intent: { schemaVersion: 1, placementId: 'actor', moveName: s.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
  candidatePlacementIds: ['target'], selectedPlacementIds: ['target'], random: () => 0.75, time: 1000,
})

describe('AA-082 static integrations', () => {
  it('registers all exact reviewed runtimes', () => {
    expect(AA082_ABILITY_SPECS.map(s => s.canonicalId)).toEqual([
      'Oblivious', 'Odious Spray', 'Omen', 'Overcharge', 'Overcoat', 'Overgrow',
      'Own Tempo', 'Pack Hunt', 'Parental Bond', 'Parry', 'Pastel Veil', 'Perception',
    ])
    for (const spec of AA082_ABILITY_SPECS) expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
      sourceModule: 'server/domain/abilityAutomation/specs/aa082.ts', version: 1,
    })
  })

  it('uses effective Oblivious, Own Tempo, and Pastel Veil condition immunity', () => {
    const oblivious = context(fixture({ slug: 'aa082-oblivious', move: 'Tackle', targetAbilities: ['Oblivious'] }))
    expect(moveAutomationConditionImmunitySource('Enraged', oblivious.queries.tokens.get('target')!)).toBe('Oblivious')
    expect(moveAutomationConditionImmunitySource('Infatuated', oblivious.queries.tokens.get('target')!)).toBe('Oblivious')
    const tempo = context(fixture({ slug: 'aa082-tempo', move: 'Tackle', targetAbilities: ['Own Tempo'] }))
    expect(moveAutomationConditionImmunitySource('Confused', tempo.queries.tokens.get('target')!)).toBe('Own Tempo')
    const veilState = fixture({ slug: 'aa082-veil', move: 'Tackle', allyAbility: 'Pastel Veil' })
    const veil = context(veilState)
    expect(moveAutomationConditionImmunitySource('Poisoned', veil.queries.tokens.get('actor')!, null, {
      sweetVeilProviderCandidates: veil.queries.tokens.all(),
      isAlly: (a, b) => veil.queries.relationships.resolve(a.id, b.id).relationship === 'ally',
    })).toContain('Pastel Veil')
  })

  it('applies Electric and Grass Last Chance only at one-third HP', () => {
    const electricPlain = fixture({ slug: 'aa082-electric-plain', move: 'Thunder Shock', actorHp: 100 })
    const electric = fixture({ slug: 'aa082-electric', move: 'Thunder Shock', actorHp: 100, actorAbilities: ['Overcharge'] })
    expect(hp(electricPlain) - hp(electric)).toBe(5)
    const grassPlain = fixture({ slug: 'aa082-grass-plain', move: 'Vine Whip', actorHp: 100 })
    const grass = fixture({ slug: 'aa082-grass', move: 'Vine Whip', actorHp: 100, actorAbilities: ['Overgrow'] })
    expect(hp(grassPlain) - hp(grass)).toBe(5)
    const healthy = fixture({ slug: 'aa082-overgrow-healthy', move: 'Vine Whip', actorHp: 300, actorAbilities: ['Overgrow'] })
    expect(hp(healthy)).toBe(hp(fixture({ slug: 'aa082-overgrow-healthy-plain', move: 'Vine Whip', actorHp: 300 })))
  })

  it('Overcoat blocks Powder Moves and Parental Bond grants 10 DR', () => {
    const powder = fixture({ slug: 'aa082-overcoat', move: 'Sleep Powder', targetAbilities: ['Overcoat'] })
    const c = context(powder)
    expect(moveAutomationMoveImmunitySource(c.queries.rules.reviewedScriptFor('Sleep Powder')!, c.queries.tokens.get('target')!)).toBe('Overcoat')
    const plain = fixture({ slug: 'aa082-parental-plain', move: 'Tackle' })
    const bonded = fixture({ slug: 'aa082-parental', move: 'Tackle', targetAbilities: ['Parental Bond'] })
    expect(hp(bonded) - hp(plain)).toBe(10)
  })

  it('Parental Bond prevents only voluntary paths that move the Baby farther beyond its 10-metre mother tether', () => {
    const footprints = [
      { id: 'baby', sideId: 'heroes', position: { x: 10, y: 0, z: 0 }, base: 1, speciesId: 'kangaskhan', currentHp: 50, effectiveAbilityIds: ['Parental Bond'] },
      { id: 'mother', sideId: 'heroes', position: { x: 0, y: 0, z: 0 }, base: 1, speciesId: 'kangaskhan', currentHp: 100, effectiveAbilityIds: [] },
    ]
    expect(aa082ParentalBondTetherViolation({
      placementId: 'baby', origin: { x: 10, y: 0, z: 0 }, path: [{ x: 20, y: 0, z: 0 }], footprints,
    })).toBe(true)
    expect(aa082ParentalBondTetherViolation({
      placementId: 'baby', origin: { x: 10, y: 0, z: 0 }, path: [{ x: 9, y: 0, z: 0 }], footprints,
    })).toBe(false)
  })

  it('Perception contributes exactly +1 non-stat Evasion', () => {
    const state = fixture({ slug: 'aa082-perception', move: 'Tackle', targetAbilities: ['Perception'] })
    const c = context(state)
    const result = resolveMoveAutomationTargetEvasion(c.queries.rules.reviewedScriptFor('Tackle'), c.queries.tokens.get('target')!, { attacker: c.actor.token })
    expect(result.abilityModifiers).toContainEqual({ source: 'Perception', modifier: 1 })
  })

  it('keeps Odious Spray optional by leaving the original area branch unchanged', () => {
    const state = fixture({ slug: 'aa082-odious-area', move: 'Poison Gas', actorAbilities: ['Odious Spray'] })
    const areaContext = buildAuthoritativeMoveRulesContext({
      map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Poison Gas', selection: { kind: 'area', areaTemplateId: 'burst:1' } },
      candidatePlacementIds: ['target'], selectedPlacementIds: ['target'], random: () => 0.75, time: 1000,
    })
    const original = areaContext.queries.rules.reviewedScriptFor('Poison Gas')!
    expect(aa082OdiousSprayScript({ context: areaContext, script: original })).toBe(original)
  })

  it('Odious Spray permits exact Range 8 single-target Poison Gas at AC 2 and Flinches on hit', () => {
    const state = fixture({ slug: 'aa082-odious', move: 'Poison Gas', actorAbilities: ['Odious Spray'] })
    state.map.placements[1] = { ...state.map.placements[1]!, position: { x: 8, y: 0, z: 2 } }
    const plan = resolve(state)
    const target = (plan.sheetWrites.find(w => w.slug === 'target')?.nextSheet ?? state.sheets.get('target')!) as CharacterSheet
    expect(target.combat?.conditions).toContain('Flinch')
    expect(plan.resolution.script.range).toBe('8, 1 Target')
    expect(plan.resolution.script.ac).toBe(2)
  })
})
