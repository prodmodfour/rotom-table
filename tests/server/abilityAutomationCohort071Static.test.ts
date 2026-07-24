import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  AA071_FOREST_LORD_ORIGIN_CAPABILITY,
  aa071ForewarnMoveCapabilityId,
} from '#shared/abilityAutomation/aa071'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA071_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa071'

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
  ability?: string
  move?: string
  types?: readonly string[]
  hp?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 150, injuries: 0, conditions: [] },
})

const capabilityEffect = (input: {
  id: string
  sourceId?: string
  affectedId: string
  capabilityId: string
  value?: number
  cells?: readonly GridAnchor[]
  tags?: readonly string[]
}): EncounterEffect => parseEncounterEffect({
  id: input.id,
  kind: 'capability',
  tags: [...(input.tags ?? ['ability', 'aa071'])],
  source: {
    operationId: `operation:${input.id}`,
    moveId: `ability:${input.id}`,
    placementId: input.sourceId ?? input.affectedId,
  },
  affected: {
    placementIds: [input.affectedId], sideIds: [],
    cells: (input.cells ?? []).map(cell => ({ ...cell })),
  },
  createdRound: 1,
  createdTurn: 1,
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  payload: {
    capabilityId: input.capabilityId,
    action: 'grant',
    ...(input.value === undefined ? {} : { value: input.value }),
  },
  dispel: { policy: 'matching-tags', tags: [...(input.tags ?? ['aa071'])] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
}, `effect.${input.id}`)

const fixture = (input: {
  slug: string
  move: string
  actorAbility?: string
  targetAbility?: string
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  actorHp?: number
  actorPosition?: GridAnchor
  targetPosition?: GridAnchor
  weather?: NonNullable<TabletopMap['fieldEffects']>['weather']
  effects?: readonly EncounterEffect[]
  treeCell?: GridAnchor
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes',
      position: input.actorPosition ?? { x: 1, y: 0, z: 1 },
    },
    {
      id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes',
      position: input.targetPosition ?? { x: 2, y: 0, z: 1 },
    },
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 16, y: 4, z: 16 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: input.treeCell
      ? [{ ...input.treeCell, materialId: 'tree', tags: ['fully-grown-tree'] }]
      : [],
    hazards: [],
    fieldEffects: { weather: [...(input.weather ?? [])], terrains: [], rooms: [] },
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
      slug: 'actor', ability: input.actorAbility, move: input.move,
      types: input.actorTypes, hp: input.actorHp,
    })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility, types: input.targetTypes })],
  ])
  return { map, sheets }
}

const resolve = (input: Parameters<typeof fixture>[0] & {
  random?: () => number
  originCell?: GridAnchor
}) => {
  const state = fixture(input)
  const plan = planAuthoritativeMoveState({
    map: state.map,
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: input.move,
      ...(input.originCell ? { originCell: { ...input.originCell } } : {}),
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: input.random ?? (() => 0.99),
    now: () => 1_000,
    operationId: `op_${input.slug}`,
  })
  const targetWrite = plan.sheetWrites.find(write => write.slug === 'target')
  const target = (targetWrite?.nextSheet ?? state.sheets.get('target')) as CharacterSheet
  return {
    state,
    plan,
    target,
    hp: Number(target.combat?.currentHp ?? 150),
    trace: JSON.stringify(plan.resolution.auditTrace),
  }
}

describe('AA-071 static abilities', () => {
  it('selects all twelve reviewed AA-071 runtimes through exact manifest hashes', () => {
    expect(AA071_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Focus', 'Forecast', 'Forest Lord', 'Forewarn', 'Fox Fire', 'Freezing Point',
      'Friend Guard', 'Frighten', 'Frisk', 'Frostbite', 'Full Guard', 'Full Metal Body',
    ])
    for (const spec of AA071_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId,
        kind: 'abilityspec-v1',
        version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa071.ts',
      })
    }
  })

  it('aa071.focus-and-freezing-point.reviewed add Last Chance damage only at one-third HP', () => {
    const fightingPlain = resolve({ slug: 'aa071-focus-plain', move: 'Karate Chop', actorHp: 50 })
    const fightingFocus = resolve({
      slug: 'aa071-focus', move: 'Karate Chop', actorAbility: 'Focus', actorHp: 50,
    })
    const fightingHigh = resolve({
      slug: 'aa071-focus-high', move: 'Karate Chop', actorAbility: 'Focus', actorHp: 150,
    })
    expect(fightingFocus.hp).toBeLessThan(fightingPlain.hp)
    expect(fightingHigh.hp).toBe(fightingPlain.hp)
    expect(fightingFocus.trace).toContain('ability.focus.last-chance')

    const icePlain = resolve({ slug: 'aa071-freezing-plain', move: 'Ice Shard', actorHp: 50 })
    const iceBoosted = resolve({
      slug: 'aa071-freezing-point', move: 'Ice Shard', actorAbility: 'Freezing Point', actorHp: 50,
    })
    expect(iceBoosted.hp).toBe(icePlain.hp - 5)
    expect(iceBoosted.trace).toContain('ability.freezing-point.last-chance')
  }, 30_000)

  it('aa071.forecast.reviewed projects one weather Type and fails closed on an unchosen concurrent weather', () => {
    const sunny = fixture({
      slug: 'aa071-forecast-sunny', move: 'Tackle', targetAbility: 'Forecast',
      weather: [{ kind: 'sunny' }],
    })
    const sunnyContext = buildAuthoritativeMoveRulesContext({
      map: sunny.map, pokemonSheets: sunny.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      candidatePlacementIds: ['target'], selectedPlacementIds: ['target'],
      random: () => 0.5, time: 1_000, resolutionId: 'resolution:forecast-sunny',
    })
    expect(sunnyContext.queries.tokens.get('target')?.defenderTypes).toEqual(['fire'])

    expect(() => resolve({
      slug: 'aa071-forecast-ambiguous', move: 'Tackle', targetAbility: 'Forecast',
      weather: [{ kind: 'sunny' }, { kind: 'rainy' }],
    })).toThrow('must choose one active weather Type')

    const selected = resolve({
      slug: 'aa071-forecast-selected', move: 'Tackle', targetAbility: 'Forecast',
      weather: [{ kind: 'sunny' }, { kind: 'rainy' }],
      effects: [capabilityEffect({
        id: 'forecast-water', affectedId: 'target', capabilityId: 'aa071.forecast.type.water',
        tags: ['ability', 'aa071', 'forecast'],
      })],
    })
    expect(selected.trace).toContain('"defenderTypes":["Water"]')
  }, 30_000)

  it('aa071.forest-lord-and-frisk.reviewed add exact authoritative Accuracy bonuses', () => {
    const tree = { x: 4, y: 0, z: 1 }
    const forest = resolve({
      slug: 'aa071-forest-accuracy', move: 'Vine Whip', actorAbility: 'Forest Lord',
      treeCell: tree, originCell: tree,
      effects: [capabilityEffect({
        id: 'forest-origin', affectedId: 'actor', capabilityId: AA071_FOREST_LORD_ORIGIN_CAPABILITY,
        cells: [tree], tags: ['ability', 'aa071', 'forest-lord'],
      })],
    })
    expect(forest.trace).toContain('Forest Lord Accuracy')
    expect(forest.trace).toContain('"value":2')

    const adjacent = resolve({ slug: 'aa071-frisk', move: 'Water Gun', actorAbility: 'Frisk' })
    const distant = resolve({
      slug: 'aa071-frisk-distant', move: 'Water Gun', actorAbility: 'Frisk',
      targetPosition: { x: 5, y: 0, z: 1 },
    })
    expect(adjacent.trace).toContain('Frisk Accuracy')
    expect(distant.trace).not.toContain('Frisk Accuracy')
  }, 30_000)

  it('aa071.forewarn.reviewed applies only the exact revealed Move penalty', () => {
    const effect = capabilityEffect({
      id: 'forewarn-tackle', sourceId: 'provider', affectedId: 'actor',
      capabilityId: aa071ForewarnMoveCapabilityId('Tackle'), value: 2,
      tags: ['ability', 'aa071', 'forewarn', 'accuracy-penalty'],
    })
    const tackle = resolve({ slug: 'aa071-forewarn-tackle', move: 'Tackle', effects: [effect] })
    const waterGun = resolve({ slug: 'aa071-forewarn-water-gun', move: 'Water Gun', effects: [effect] })
    expect(tackle.trace).toContain('Forewarn Accuracy Penalty')
    expect(tackle.trace).toContain('"value":-2')
    expect(waterGun.trace).not.toContain('Forewarn Accuracy Penalty')
  }, 30_000)

  it('aa071.frostbite.reviewed slows on 18+, expands Freeze range, and adds Freeze on 20 when absent', () => {
    const iceBeam = resolve({
      slug: 'aa071-frostbite-ice-beam', move: 'Ice Beam', actorAbility: 'Frostbite', random: () => 0.85,
    })
    expect(iceBeam.target.combat?.conditions).toEqual(expect.arrayContaining(['Slowed', 'Frozen']))
    expect(iceBeam.trace).toContain('ability.frostbite.slowed')

    const iceShard = resolve({
      slug: 'aa071-frostbite-ice-shard', move: 'Ice Shard', actorAbility: 'Frostbite', random: () => 0.99,
    })
    expect(iceShard.target.combat?.conditions).toEqual(expect.arrayContaining(['Slowed', 'Frozen']))

    const icicleSpear = resolve({
      slug: 'aa071-frostbite-multi-hit', move: 'Icicle Spear', actorAbility: 'Frostbite', random: () => 0.99,
    })
    expect(icicleSpear.target.combat?.conditions).toEqual(expect.arrayContaining(['Slowed', 'Frozen']))
    expect(icicleSpear.trace).toContain('ability.frostbite.frozen')
  }, 30_000)

  it('aa071.full-metal-body.reviewed blocks foe Move stage loss without blocking unrelated damage', () => {
    const blocked = resolve({
      slug: 'aa071-full-metal-body', move: 'Mud-Slap', targetAbility: 'Full Metal Body',
    })
    const ordinary = resolve({ slug: 'aa071-full-metal-body-ordinary', move: 'Mud-Slap' })
    expect(blocked.target.combatStages?.acc).toBe(0)
    expect(ordinary.target.combatStages?.acc).toBe(-1)
    expect(blocked.hp).toBeLessThan(150)
    expect(blocked.trace).toContain('Full Metal Body')
  }, 30_000)
})
