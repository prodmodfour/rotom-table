import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA072_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa072'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-')
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
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string
  move: string
  actorAbility?: string
  targetAbility?: string
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  actorPosition?: GridAnchor
  targetPosition?: GridAnchor
  effects?: readonly EncounterEffect[]
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
  return {
    map,
    sheets: new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', move: input.move, ability: input.actorAbility, types: input.actorTypes })],
      ['target', sheet({ slug: 'target', ability: input.targetAbility, types: input.targetTypes })],
    ]),
  }
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
    attackStage: target.stats?.atk?.stage ?? target.combatStages?.atk ?? 0,
    trace: JSON.stringify(plan.resolution.auditTrace),
  }
}

describe('AA-072 static abilities', () => {
  it('selects all twelve reviewed AA-072 runtimes through exact manifest hashes', () => {
    expect(AA072_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Fur Coat', 'Gale Wings', 'Galvanize', 'Gardener', 'Gentle Vibe', 'Giver',
      'Glisten', 'Gluttony', 'Gooey', 'Gore', 'Gorilla Tactics', 'Grass Pelt',
    ])
    for (const spec of AA072_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId,
        kind: 'abilityspec-v1',
        version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa072.ts',
      })
    }
  })

  it('aa072.fur-coat.reviewed resists physical damage one step but not special damage', () => {
    const physical = resolve({ slug: 'aa072-fur-coat-physical', move: 'Tackle', targetAbility: 'Fur Coat' })
    const physicalPlain = resolve({ slug: 'aa072-fur-coat-physical-plain', move: 'Tackle' })
    expect(physical.hp).toBeGreaterThan(physicalPlain.hp)
    expect(physical.trace).toContain('Fur Coat')

    const special = resolve({ slug: 'aa072-fur-coat-special', move: 'Water Gun', targetAbility: 'Fur Coat' })
    const specialPlain = resolve({ slug: 'aa072-fur-coat-special-plain', move: 'Water Gun' })
    expect(special.hp).toBe(specialPlain.hp)

    const multi = resolve({ slug: 'aa072-fur-coat-multi', move: 'Fury Swipes', targetAbility: 'Fur Coat' })
    const multiPlain = resolve({ slug: 'aa072-fur-coat-multi-plain', move: 'Fury Swipes' })
    const suppressAll = {
      ...creatureRuleOverlayEncounterEffectFixture({
        domain: 'ability', action: 'suppress', values: [],
        referencePlacementId: null, suppressionScope: 'all',
      }),
      id: 'effect.aa072.suppress-fur-coat',
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
    }
    const suppressed = resolve({
      slug: 'aa072-fur-coat-suppressed', move: 'Tackle', targetAbility: 'Fur Coat',
      effects: [suppressAll],
    })
    expect(multi.hp).toBeGreaterThan(multiPlain.hp)
    expect(suppressed.hp).toBe(physicalPlain.hp)
    expect(multi.trace).toContain('Fur Coat')
  }, 30_000)

  it('aa072.glisten.reviewed prevents a Fairy attack without suppressing unrelated attacks', () => {
    const immune = resolve({ slug: 'aa072-glisten-fairy', move: 'Fairy Wind', targetAbility: 'Glisten' })
    const ordinary = resolve({ slug: 'aa072-glisten-normal', move: 'Tackle', targetAbility: 'Glisten' })
    const fairyStatus = resolve({
      slug: 'aa072-glisten-fairy-status', move: 'Baby-Doll Eyes', targetAbility: 'Glisten',
    })
    const fairyStatusPlain = resolve({ slug: 'aa072-glisten-fairy-status-plain', move: 'Baby-Doll Eyes' })
    const suppressAll = {
      ...creatureRuleOverlayEncounterEffectFixture({
        domain: 'ability', action: 'suppress', values: [],
        referencePlacementId: null, suppressionScope: 'all',
      }),
      id: 'effect.aa072.suppress-glisten',
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
    }
    const suppressed = resolve({
      slug: 'aa072-glisten-suppressed', move: 'Fairy Wind', targetAbility: 'Glisten',
      effects: [suppressAll],
    })
    expect(immune.hp).toBe(150)
    expect(ordinary.hp).toBeLessThan(150)
    expect(fairyStatus.attackStage).toBe(0)
    expect(fairyStatusPlain.attackStage).toBeLessThan(0)
    expect(suppressed.hp).toBeLessThan(150)
    expect(immune.trace).toContain('Glisten')
  }, 30_000)
})
