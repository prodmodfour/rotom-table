import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA074_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa074'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { resolveAuthoritativeMoveUserAccuracy } from '../../server/domain/moveAutomation/accuracy'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import { aa074HeavyMetalInitiativeSpeedOffset } from '../../server/domain/abilityAutomation/mechanics/aa074StaticIntegration'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${id(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  abilities?: readonly string[]
  conditions?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: ['Normal'],
  abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [...(input.conditions ?? [])] },
})

const suppression = (placementId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa074.suppress.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})

const fixture = (input: {
  slug: string
  move?: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
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
    ['actor', sheet({ slug: 'actor', move: input.move, abilities: input.actorAbilities })],
    ['target', sheet({ slug: 'target', abilities: input.targetAbilities })],
  ])
  return { map, sheets }
}

const context = (input: Parameters<typeof fixture>[0]) => {
  const state = fixture(input)
  return buildAuthoritativeMoveRulesContext({
    map: state.map,
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: input.move ?? 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => 0.5,
    time: 1_000,
  })
}

const resolveMove = (input: Parameters<typeof fixture>[0]) => {
  const state = fixture(input)
  const plan = planAuthoritativeMoveState({
    map: state.map,
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: input.move ?? 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => 0.75,
    now: () => 1_000,
    operationId: `op_${input.slug}`,
  })
  const target = (plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
    ?? state.sheets.get('target')) as CharacterSheet
  return { plan, target }
}

const stage = (value: CharacterSheet, key: 'atk' | 'def' | 'satk' | 'sdef' | 'spd'): number => (
  value.stats?.[key]?.stage ?? value.combatStages?.[key] ?? 0
)

describe('AA-074 static abilities', () => {
  it('selects all twelve reviewed AA-074 runtimes', () => {
    expect(AA074_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Heavy Metal', 'Heliovolt', 'Helper', 'Honey Paws', 'Honey Thief',
      'Horde Break', 'Huge Power', 'Huge Power / Pure Power', 'Hunger Switch',
      'Hustle', 'Hydration', 'Hyper Cutter',
    ])
    for (const spec of AA074_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId,
        kind: 'abilityspec-v1',
        version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa074.ts',
      })
    }
  })

  it('aa074.heavy-metal.reviewed adjusts Weight, Defense, and Speed only while effective', () => {
    const ordinary = context({ slug: 'aa074-heavy-plain' }).actor.token
    const active = context({ slug: 'aa074-heavy-active', actorAbilities: ['Heavy Metal'] }).actor.token
    const suppressed = context({
      slug: 'aa074-heavy-suppressed', actorAbilities: ['Heavy Metal'], effects: [suppression('actor')],
    }).actor.token
    expect(active.weightClass).toBe((ordinary.weightClass ?? 0) + 2)
    expect(active.def).toBe(ordinary.def + 2)
    expect(active.spd).toBe(Math.max(1, (ordinary.spd ?? 0) - 2))
    expect(suppressed.weightClass).toBe(ordinary.weightClass)
    expect(suppressed.def).toBe(ordinary.def)
    expect(suppressed.spd).toBe(ordinary.spd)

    const activeState = fixture({ slug: 'aa074-heavy-initiative', actorAbilities: ['Heavy Metal'] })
    const suppressedState = fixture({
      slug: 'aa074-heavy-initiative-suppressed', actorAbilities: ['Heavy Metal'],
      effects: [suppression('actor')],
    })
    expect(aa074HeavyMetalInitiativeSpeedOffset({
      map: activeState.map,
      placement: activeState.map.placements[0]!,
      sheet: activeState.sheets.get('actor')!,
    })).toBe(-2)
    expect(aa074HeavyMetalInitiativeSpeedOffset({
      map: suppressedState.map,
      placement: suppressedState.map.placements[0]!,
      sheet: suppressedState.sheets.get('actor')!,
    })).toBe(0)
  })

  it('aa074.huge-power.reviewed and aa074.huge-power-pure-power.reviewed apply distinct Base Attack formulas and protection', () => {
    const ordinary = context({ slug: 'aa074-power-plain' }).actor.token
    const legacy = context({ slug: 'aa074-power-legacy', actorAbilities: ['Huge Power'] }).actor.token
    const legacySuppressed = context({
      slug: 'aa074-power-legacy-suppressed', actorAbilities: ['Huge Power'], effects: [suppression('actor')],
    }).actor.token
    const errata = context({
      slug: 'aa074-power-errata', actorAbilities: ['Huge Power / Pure Power'], effects: [suppression('actor')],
    }).actor.token
    expect(legacy.atk).toBeGreaterThan(ordinary.atk)
    expect(legacySuppressed.atk).toBe(ordinary.atk)
    expect(errata.atk).toBe(ordinary.atk + 7)
  })

  it('aa074.hustle.reviewed applies errata Accuracy and Damage modifiers to every attack', () => {
    const ordinaryContext = context({ slug: 'aa074-hustle-plain', move: 'Tackle' })
    const hustleContext = context({ slug: 'aa074-hustle-active', move: 'Tackle', actorAbilities: ['Hustle'] })
    expect(resolveAuthoritativeMoveUserAccuracy(hustleContext, { script: hustleContext.queries.rules.reviewedScriptFor('Tackle')! }).value)
      .toBe(resolveAuthoritativeMoveUserAccuracy(ordinaryContext, { script: ordinaryContext.queries.rules.reviewedScriptFor('Tackle')! }).value - 2)

    const ordinary = resolveMove({ slug: 'aa074-hustle-damage-plain', move: 'Tackle' })
    const active = resolveMove({ slug: 'aa074-hustle-damage', move: 'Tackle', actorAbilities: ['Hustle'] })
    expect(active.target.combat?.currentHp).toBeLessThan(ordinary.target.combat?.currentHp ?? 0)
    expect(JSON.stringify(active.plan.resolution.auditTrace)).toContain('ability.hustle.damage-roll-bonus')
  }, 30_000)

  it('aa074.hyper-cutter.reviewed blocks negative Attack Combat Stages and fails closed under suppression', () => {
    const ordinary = resolveMove({ slug: 'aa074-hyper-cutter-plain', move: 'Charm' })
    const active = resolveMove({
      slug: 'aa074-hyper-cutter-active', move: 'Charm', targetAbilities: ['Hyper Cutter'],
    })
    const suppressed = resolveMove({
      slug: 'aa074-hyper-cutter-suppressed', move: 'Charm', targetAbilities: ['Hyper Cutter'],
      effects: [suppression('target')],
    })
    expect(stage(ordinary.target, 'atk')).toBeLessThan(0)
    expect(stage(active.target, 'atk')).toBe(0)
    expect(stage(suppressed.target, 'atk')).toBe(stage(ordinary.target, 'atk'))
    expect(JSON.stringify(active.plan.resolution.auditTrace)).toContain('Hyper Cutter')
  }, 30_000)
})
