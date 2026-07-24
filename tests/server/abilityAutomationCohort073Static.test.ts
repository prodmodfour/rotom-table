import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA073_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa073'
import { aa067PokemonHeldItemCapacity } from '../../server/domain/abilityAutomation/mechanics/aa067ItemIntegration'
import {
  aa073GutsConditionActive,
  aa073HeatproofPreventsBurnHpLoss,
} from '../../server/domain/abilityAutomation/mechanics/aa073StaticIntegration'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${slugify(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  ability?: string
  conditions?: readonly string[]
  currentHp?: number
  held?: string
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  ...(input.held ? { items: { held: input.held } } : {}),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.currentHp ?? 150,
    injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})

const fixture = (input: {
  slug: string
  move: string
  actorAbility?: string
  targetAbility?: string
  actorConditions?: readonly string[]
  actorHp?: number
  effects?: readonly EncounterEffect[]
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    encounterState: {
      ...encounter,
      effects: [...(input.effects ?? [])],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${input.slug}`,
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move: input.move, ability: input.actorAbility,
      conditions: input.actorConditions, currentHp: input.actorHp,
    })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility, types: ['Psychic'] })],
  ])
  return { map, sheets }
}

const resolve = (input: Parameters<typeof fixture>[0]) => {
  const state = fixture(input)
  const plan = planAuthoritativeMoveState({
    map: state.map,
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: input.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => 0.99,
    now: () => 1_000,
    operationId: `op_${input.slug}`,
  })
  const target = (plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
    ?? state.sheets.get('target')) as CharacterSheet
  return {
    hp: Number(target.combat?.currentHp ?? 150),
    trace: JSON.stringify(plan.resolution.auditTrace),
  }
}

const suppression = (placementId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa073.suppress.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})

describe('AA-073 static abilities', () => {
  it('selects all twelve reviewed AA-073 runtimes through exact manifest hashes', () => {
    expect(AA073_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Grassy Surge', 'Grim Neigh', 'Gulp', 'Gulp Missile', 'Guts', 'Handyman',
      'Harvest', 'Haunt', 'Hay Fever', 'Healer', 'Heat Mirage', 'Heatproof',
    ])
    for (const spec of AA073_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId,
        kind: 'abilityspec-v1',
        version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa073.ts',
      })
    }
  })

  it('aa073.guts.reviewed adds two Attack stages only while an effective trigger condition exists', () => {
    const ordinary = resolve({ slug: 'aa073-guts-plain', move: 'Tackle' })
    const active = resolve({
      slug: 'aa073-guts-active', move: 'Tackle', actorAbility: 'Guts', actorConditions: ['Burned'],
    })
    const inactive = resolve({ slug: 'aa073-guts-inactive', move: 'Tackle', actorAbility: 'Guts' })
    const suppressed = resolve({
      slug: 'aa073-guts-suppressed', move: 'Tackle', actorAbility: 'Guts',
      actorConditions: ['Burned'], effects: [suppression('actor')],
    })
    expect(active.hp).toBeLessThan(ordinary.hp)
    expect(inactive.hp).toBe(ordinary.hp)
    expect(suppressed.hp).toBe(ordinary.hp)
    expect(aa073GutsConditionActive(['Badly Poisoned'])).toBe(true)
    expect(aa073GutsConditionActive(['Confused'])).toBe(false)
  }, 30_000)

  it('aa073.haunt.reviewed applies Ghost Last Chance at one-third HP and fails closed when suppressed', () => {
    const ordinary = resolve({ slug: 'aa073-haunt-plain', move: 'Shadow Sneak', actorHp: 50 })
    const active = resolve({
      slug: 'aa073-haunt-active', move: 'Shadow Sneak', actorAbility: 'Haunt', actorHp: 50,
    })
    const above = resolve({
      slug: 'aa073-haunt-above', move: 'Shadow Sneak', actorAbility: 'Haunt', actorHp: 100,
    })
    const suppressed = resolve({
      slug: 'aa073-haunt-suppressed', move: 'Shadow Sneak', actorAbility: 'Haunt',
      actorHp: 50, effects: [suppression('actor')],
    })
    expect(active.hp).toBeLessThan(ordinary.hp)
    expect(active.trace).toContain('ability.haunt.last-chance')
    expect(above.hp).toBe(ordinary.hp)
    expect(suppressed.hp).toBe(ordinary.hp)
  }, 30_000)

  it('aa073.heatproof.reviewed resists Fire one additional step and exposes the Burn-loss guard', () => {
    const ordinary = resolve({ slug: 'aa073-heatproof-plain', move: 'Ember' })
    const active = resolve({ slug: 'aa073-heatproof-active', move: 'Ember', targetAbility: 'Heatproof' })
    const suppressed = resolve({
      slug: 'aa073-heatproof-suppressed', move: 'Ember', targetAbility: 'Heatproof',
      effects: [suppression('target')],
    })
    expect(active.hp).toBeGreaterThan(ordinary.hp)
    expect(active.trace).toContain('Heatproof')
    expect(suppressed.hp).toBe(ordinary.hp)

    const state = fixture({ slug: 'aa073-heatproof-burn', move: 'Tackle', targetAbility: 'Heatproof' })
    const context = buildAuthoritativeMoveRulesContext({
      map: state.map,
      pokemonSheets: state.sheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5,
      time: 1_000,
    })
    expect(aa073HeatproofPreventsBurnHpLoss({ context, placementId: 'target' })).toBe(true)
  }, 30_000)

  it('aa073.handyman.reviewed grants exactly two held-item slots only while effective', () => {
    const activeSheet = sheet({ slug: 'actor', ability: 'Handyman', held: 'Oran Berry' })
    const base = fixture({ slug: 'aa073-handyman', move: 'Tackle' }).map
    expect(aa067PokemonHeldItemCapacity({ map: base, sheet: activeSheet })).toBe(2)
    expect(aa067PokemonHeldItemCapacity({
      map: { ...base, encounterState: { ...base.encounterState!, effects: [suppression('actor')] } },
      sheet: activeSheet,
    })).toBe(1)
    expect(aa067PokemonHeldItemCapacity({ map: base, sheet: sheet({ slug: 'actor' }) })).toBe(1)
  })
})
