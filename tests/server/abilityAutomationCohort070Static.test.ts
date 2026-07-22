import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA070_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa070'
import { AA070_FLUTTER_NO_FLANK_CAPABILITY } from '#shared/abilityAutomation/aa070'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slugify(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  move?: string
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})

const numericEffect = (
  id: string,
  attribute: 'accuracy' | 'damage',
  value: number,
): EncounterEffect => parseEncounterEffect({
  id, kind: 'numeric-modifier', tags: ['ability', 'aa070', 'flavorful-aroma', attribute],
  source: { operationId: 'op_flavorful_source', moveId: 'aromatic-mist', placementId: 'actor' },
  affected: { placementIds: ['actor'], sideIds: [], cells: [{ x: 1, y: 0, z: 1 }] },
  createdRound: 1, createdTurn: 1,
  duration: { kind: 'rounds', boundary: 'end', remaining: 1 }, stacks: 1, charges: null,
  stackPolicy: { kind: 'refresh', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
  payload: { attribute, operation: 'add', value, rounding: 'none' },
  dispel: { policy: 'matching-tags', tags: ['flavorful-aroma'] },
  transferPolicy: 'expire', suppression: { sources: [] },
}, `effect.${id}`)

const fixture = (input: {
  slug: string
  move: string
  actorAbility?: string
  providerAbility?: string
  targetAbility?: string
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  effects?: readonly EncounterEffect[]
  random?: () => number
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'provider', sheetKind: 'pokemon', sheetSlug: 'provider', sideId: 'foes', position: { x: 3, y: 0, z: 1 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter, effects: [...(input.effects ?? [])],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', ability: input.actorAbility, move: input.move, types: input.actorTypes })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility, types: input.targetTypes })],
    ['provider', sheet({ slug: 'provider', ability: input.providerAbility })],
  ])
  return { map, sheets }
}

const resolve = (input: Parameters<typeof fixture>[0]) => {
  const state = fixture(input)
  const plan = planAuthoritativeMoveState({
    map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: input.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: input.random ?? (() => 0.99), now: () => 1_000, operationId: `op_${input.slug}`,
  })
  const targetWrite = plan.sheetWrites.find(write => write.slug === 'target')
  const target = (targetWrite?.nextSheet ?? state.sheets.get('target')) as CharacterSheet
  return { state, plan, target, hp: Number(target.combat?.currentHp ?? 150) }
}

describe('AA-070 static abilities', () => {
  it('selects all twelve reviewed AA-070 runtimes through exact manifest hashes', () => {
    expect(AA070_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Flame Body', 'Flame Tongue', 'Flare Boost', 'Flash Fire', 'Flavorful Aroma',
      'Flower Gift', 'Flower Power', 'Flower Veil', 'Fluffy', 'Fluffy Charge',
      'Flutter', 'Flying Fly Trap',
    ])
    for (const spec of AA070_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId, kind: 'abilityspec-v1', version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa070.ts',
      })
    }
  })

  it('aa070.flower-veil.reviewed blocks every lowered Combat Stat for a nearby Grass target', () => {
    const protectedResult = resolve({
      slug: 'aa070-flower-veil', move: 'Charm', providerAbility: 'Flower Veil', targetTypes: ['Grass'],
    })
    const selfProtected = resolve({
      slug: 'aa070-flower-veil-user', move: 'Charm', targetAbility: 'Flower Veil', targetTypes: ['Normal'],
    })
    const ordinary = resolve({
      slug: 'aa070-flower-veil-ordinary', move: 'Charm', targetTypes: ['Grass'],
    })
    expect(protectedResult.target.stats?.atk?.stage ?? protectedResult.target.combatStages?.atk).toBe(0)
    expect(selfProtected.target.stats?.atk?.stage ?? selfProtected.target.combatStages?.atk).toBe(0)
    expect(ordinary.target.stats?.atk?.stage ?? ordinary.target.combatStages?.atk).toBeLessThan(0)
    expect(JSON.stringify(protectedResult.plan.resolution.auditTrace)).toContain('Flower Veil')
  }, 30_000)

  it('aa070.fluffy.reviewed moves damaging Melee and Fire effectiveness one opposite step each', () => {
    const melee = resolve({ slug: 'aa070-fluffy-melee', move: 'Tackle', targetAbility: 'Fluffy' })
    const fire = resolve({ slug: 'aa070-fluffy-fire', move: 'Ember', targetAbility: 'Fluffy' })
    expect(JSON.stringify(melee.plan.resolution.auditTrace)).toContain('"finalMultiplier":0.5')
    expect(JSON.stringify(fire.plan.resolution.auditTrace)).toContain('"finalMultiplier":1.5')
    expect(JSON.stringify(melee.plan.resolution.auditTrace)).toContain('Fluffy')

    const multiHitPlain = resolve({
      slug: 'aa070-fluffy-multi-plain', move: 'Fury Swipes', random: () => 0.5,
    })
    const multiHitFluffy = resolve({
      slug: 'aa070-fluffy-multi', move: 'Fury Swipes', targetAbility: 'Fluffy', random: () => 0.5,
    })
    expect(multiHitFluffy.hp).toBeGreaterThan(multiHitPlain.hp)
    expect(JSON.stringify(multiHitFluffy.plan.resolution.auditTrace)).toContain('Fluffy')
  }, 30_000)

  it('aa070.flying-fly-trap.reviewed prevents Ground damage but preserves the Move effect', () => {
    const result = resolve({
      slug: 'aa070-flying-fly-trap', move: 'Mud-Slap', targetAbility: 'Flying Fly Trap',
    })
    expect(result.hp).toBe(150)
    expect(result.target.combatStages?.acc).toBe(-1)
    expect(JSON.stringify(result.plan.resolution.auditTrace)).toContain('ability.flying-fly-trap.damage-immunity')

    const fissure = resolve({
      slug: 'aa070-flying-fly-trap-direct-hp', move: 'Fissure',
      targetAbility: 'Flying Fly Trap', random: () => 0,
    })
    expect(fissure.hp).toBe(150)
    expect(JSON.stringify(fissure.plan.resolution.auditTrace)).toContain('Flying Fly Trap')

    const pinMissile = resolve({
      slug: 'aa070-flying-fly-trap-multi-hit', move: 'Pin Missile',
      targetAbility: 'Flying Fly Trap', random: () => 0.99,
    })
    expect(pinMissile.hp).toBe(150)
  }, 30_000)

  it('aa070.flavorful-aroma.reviewed numeric effects feed the authoritative Accuracy and Damage pipelines', () => {
    const plain = resolve({ slug: 'aa070-aroma-plain', move: 'Tackle' })
    const buffed = resolve({
      slug: 'aa070-aroma-buffed', move: 'Tackle',
      effects: [numericEffect('aroma-accuracy', 'accuracy', 1), numericEffect('aroma-damage', 'damage', 5)],
    })
    const refreshed = resolve({
      slug: 'aa070-aroma-refreshed', move: 'Tackle',
      effects: [
        numericEffect('aroma-accuracy-old', 'accuracy', 1),
        numericEffect('aroma-damage-old', 'damage', 5),
        numericEffect('aroma-accuracy-new', 'accuracy', 1),
        numericEffect('aroma-damage-new', 'damage', 5),
      ],
    })
    expect(buffed.hp).toBeLessThan(plain.hp)
    expect(refreshed.hp).toBe(buffed.hp)
    const trace = JSON.stringify(buffed.plan.resolution.auditTrace)
    expect(trace).toContain('Flavorful Aroma accuracy')
    expect(trace).toContain('ability.flavorful-aroma.damage-bonus')
  }, 30_000)

  it('aa070.flutter.reviewed encounter capability disables otherwise valid flanking geometry', () => {
    const state = fixture({ slug: 'aa070-flutter-flanking', move: 'Tackle' })
    state.map.placements[2] = {
      ...state.map.placements[2]!, sideId: 'heroes', position: { x: 3, y: 0, z: 1 },
    }
    state.map.encounterState = {
      ...state.map.encounterState!,
      effects: [parseEncounterEffect({
        id: 'flutter-no-flank', kind: 'capability', tags: ['ability', 'aa070', 'flutter'],
        source: { operationId: 'op_flutter', moveId: 'ability.flutter', placementId: 'target' },
        affected: { placementIds: ['target'], sideIds: [], cells: [{ x: 2, y: 0, z: 1 }] },
        createdRound: 1, createdTurn: 1,
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
        stacks: 1, charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
        payload: { capabilityId: AA070_FLUTTER_NO_FLANK_CAPABILITY, action: 'grant' },
        dispel: { policy: 'matching-tags', tags: ['flutter'] }, transferPolicy: 'expire', suppression: { sources: [] },
      }, 'flutter.effect')],
    }
    const context = buildAuthoritativeMoveRulesContext({
      map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      candidatePlacementIds: ['target'], selectedPlacementIds: ['target'],
      random: () => 0.5, time: 1_000, resolutionId: 'resolution:aa070-flutter-flanking',
    })
    expect(context.queries.flanking.resolve('target')).toMatchObject({
      flanked: false, reasonCode: 'target-cannot-be-flanked',
    })
  })
})
