import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { aa069EnduringRagePreventsSave } from '../../server/domain/abilityAutomation/mechanics/aa069StaticIntegration'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA069_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa069'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slugify(canonicalId)}`,
    canonicalId, definitionVersion: canonicalId === 'Fabulous Trim' ? 1 : null,
    selections: canonicalId === 'Fabulous Trim' ? [{ parameterId: 'trim', optionIds: [] }] : [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  move?: string
  types?: readonly string[]
  conditions?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [...(input.conditions ?? [])] },
})
const fixture = (input: {
  slug: string
  move: string
  actorAbility?: string
  allyAbility?: string
  targetAbility?: string
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  targetConditions?: readonly string[]
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 1, y: 0, z: 2 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
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
    ['actor', sheet({
      slug: 'actor', ability: input.actorAbility, move: input.move, types: input.actorTypes,
    })],
    ['target', sheet({
      slug: 'target', ability: input.targetAbility, types: input.targetTypes,
      conditions: input.targetConditions,
    })],
    ['ally', sheet({ slug: 'ally', ability: input.allyAbility })],
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
    random: () => 0.5, now: () => 1_000, operationId: `op_${input.slug}`,
  })
  const target = plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
  return { state, plan, hp: Number(target?.combat?.currentHp ?? 150) }
}

describe('AA-069 static abilities', () => {
  it('selects all twelve reviewed AA-069 runtimes through exact manifest hashes', () => {
    expect(AA069_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Electrodash', 'Emergency Exit', 'Empower', 'Enduring Rage', 'Enfeebling Lips',
      'Exploit', 'Fabulous Trim', 'Fade Away', 'Fairy Aura', 'Fashion Designer',
      'Fiery Crash', 'Filter',
    ])
    for (const spec of AA069_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId, kind: 'abilityspec-v1', version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa069.ts',
      })
    }
  })

  it('aa069.exploit-and-filter.reviewed applies +5 before effectiveness and Filter -5 after it', () => {
    const plain = resolve({ slug: 'aa069-super-plain', move: 'Ember', targetTypes: ['Grass'] })
    const exploited = resolve({
      slug: 'aa069-super-exploit', move: 'Ember', actorAbility: 'Exploit', targetTypes: ['Grass'],
    })
    const filtered = resolve({
      slug: 'aa069-super-filter', move: 'Ember', targetAbility: 'Filter', targetTypes: ['Grass'],
    })
    expect(exploited.hp).toBeLessThan(plain.hp)
    expect(filtered.hp - plain.hp).toBe(5)
    expect(JSON.stringify(exploited.plan.resolution.auditTrace)).toContain('ability.exploit.super-effective-damage')
    expect(JSON.stringify(filtered.plan.resolution.auditTrace)).toContain('ability.filter.super-effective-reduction')
  }, 30_000)

  it('aa069.enduring-rage.reviewed reduces incoming damage and blocks only Enraged Save Checks', () => {
    const plain = resolve({
      slug: 'aa069-rage-plain', move: 'Tackle', targetConditions: ['Enraged'],
    })
    const enduring = resolve({
      slug: 'aa069-rage-active', move: 'Tackle', targetAbility: 'Enduring Rage',
      targetConditions: ['Enraged'],
    })
    expect(enduring.hp - plain.hp).toBe(5)
    expect(aa069EnduringRagePreventsSave({
      map: enduring.state.map,
      placement: enduring.state.map.placements[1]!,
      sheet: enduring.state.sheets.get('target')!,
      condition: 'Enraged',
    })).toBe(true)
    expect(aa069EnduringRagePreventsSave({
      map: enduring.state.map,
      placement: enduring.state.map.placements[1]!,
      sheet: enduring.state.sheets.get('target')!,
      condition: 'Sleep',
    })).toBe(false)
  }, 30_000)

  it('aa069.fairy-aura.reviewed raises Fairy Damage Base for the effective user and allies', () => {
    const plain = resolve({ slug: 'aa069-fairy-plain', move: 'Fairy Wind' })
    const aura = resolve({
      slug: 'aa069-fairy-aura', move: 'Fairy Wind', actorAbility: 'Fairy Aura',
    })
    const alliedAura = resolve({
      slug: 'aa069-fairy-allied-aura', move: 'Fairy Wind', allyAbility: 'Fairy Aura',
    })
    expect(aura.hp).toBeLessThan(plain.hp)
    expect(alliedAura.hp).toBe(aura.hp)
    expect(JSON.stringify(aura.plan.resolution.auditTrace)).toContain('"damageBase":5')
    expect(JSON.stringify(aura.plan.resolution.auditTrace)).toContain('Fairy Aura')
  }, 30_000)
})
