import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { ENCOUNTER_EVENT_SCHEMA_VERSION, parseEncounterEvent } from '#shared/moveAutomation/events'
import { parseLivePlayOpId } from '#shared/livePlayCommands'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA078_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa078'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { resolveMovement } from '../../server/domain/movement/resolveMovement'
import { materializeMovementAttackOfOpportunity } from '../../server/domain/moveAutomation/attackOfOpportunity'
import { createAuthoritativeMoveRandom } from '../../server/domain/moveAutomation/random'
import { createAa078LeechSeedLifecycleHandler } from '../../server/domain/abilityAutomation/mechanics/aa078LifecycleIntegration'
import { aa078LightningRodBlocksElectric } from '../../server/domain/abilityAutomation/mechanics/aa078StaticIntegration'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${id(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  abilities?: readonly string[]
  currentHp?: number
  types?: readonly string[]
  conditions?: readonly string[]
  digestionFoods?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  ...(input.digestionFoods ? { items: { digestionFoods: [...input.digestionFoods] } } : {}),
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.currentHp ?? 300, injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})
const suppression = (placementId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa078.suppress.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})
const fixture = (input: {
  slug: string
  move?: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorHp?: number
  targetHp?: number
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  targetConditions?: readonly string[]
  targetPosition?: { x: number; y: number; z: number }
  effects?: readonly EncounterEffect[]
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: input.targetPosition ?? { x: 2, y: 0, z: 1 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 16, y: 4, z: 16 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
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
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
  const move = input.move ?? 'Tackle'
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move, abilities: input.actorAbilities, currentHp: input.actorHp, types: input.actorTypes })],
    ['target', sheet({
      slug: 'target', abilities: input.targetAbilities, currentHp: input.targetHp,
      types: input.targetTypes, conditions: input.targetConditions,
    })],
  ])
  return { map, sheets, move }
}
const context = (state: ReturnType<typeof fixture>) => buildAuthoritativeMoveRulesContext({
  map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName: state.move,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  selectedPlacementIds: ['target'], candidatePlacementIds: ['target'],
  random: () => 0.75, time: 1_000, resolutionId: `resolution:${state.map.slug}`,
})
const resolve = (state: ReturnType<typeof fixture>, targetBranchId?: string) => planAuthoritativeMoveState({
  map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName: state.move,
    ...(targetBranchId ? { targetBranchId } : {}),
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  random: () => 0.75, now: () => 1_000,
  operationId: `op_${state.map.slug.replace(/[^a-zA-Z0-9_]+/g, '_')}`,
})
const resolvedSheet = (
  state: ReturnType<typeof fixture>,
  plan: ReturnType<typeof resolve>,
  slug: 'actor' | 'target',
): CharacterSheet => (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet
  ?? state.sheets.get(slug)) as CharacterSheet
const hpAfter = (state: ReturnType<typeof fixture>, slug: 'actor' | 'target' = 'target'): number => {
  const plan = resolve(state)
  return resolvedSheet(state, plan, slug).combat?.currentHp ?? 0
}

describe('AA-078 static integrations', () => {
  it('selects all twelve exact reviewed runtimes', () => {
    expect(AA078_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Lightning Kicks', 'Lightning Rod', 'Limber', 'Line Charge', 'Liquid Ooze',
      'Liquid Voice', 'Long Reach', 'Lullaby', 'Lunchbox', 'Mach Speed',
      'Maelstrom Pulse', 'Magic Bounce',
    ])
    for (const spec of AA078_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId, kind: 'abilityspec-v1', version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa078.ts',
      })
    }
  })

  it('aa078.limber-and-lightning-rod.reviewed block only their exact effective applications', () => {
    const limber = fixture({
      slug: 'aa078-limber', move: 'Thunder Wave', targetAbilities: ['Limber'],
    })
    const limberPlan = resolve(limber)
    expect(resolvedSheet(limber, limberPlan, 'target').combat?.conditions).not.toContain('Paralysis')
    expect(JSON.stringify(limberPlan.resolution.auditTrace)).toContain('"source":"Limber"')

    const suppressed = fixture({
      slug: 'aa078-limber-suppressed', move: 'Thunder Wave', targetAbilities: ['Limber'],
      effects: [suppression('target')],
    })
    expect(resolvedSheet(suppressed, resolve(suppressed), 'target').combat?.conditions).toContain('Paralysis')

    const rod = fixture({
      slug: 'aa078-lightning-rod-immunity', move: 'Thunder Shock', targetAbilities: ['Lightning Rod'],
    })
    expect(aa078LightningRodBlocksElectric({
      context: context(rod), recipientId: 'target', moveType: 'Electric',
    })).toBe(true)
    expect(aa078LightningRodBlocksElectric({
      context: context(rod), recipientId: 'target', moveType: 'Fire',
    })).toBe(false)
    const unrelated = fixture({
      slug: 'aa078-lightning-rod-unrelated', move: 'Ember', targetAbilities: ['Lightning Rod'],
    })
    expect(hpAfter(unrelated)).toBeLessThan(unrelated.sheets.get('target')!.combat!.currentHp!)
  })

  it('aa078.long-reach.reviewed adds and revalidates only the optional damaging range branch', () => {
    const state = fixture({
      slug: 'aa078-long-reach', actorAbilities: ['Long Reach'], targetPosition: { x: 8, y: 0, z: 1 },
    })
    const reviewedEntry = context(state).queries.resolveActorMoveEntry('Tackle')
    if (!reviewedEntry.ok) throw new Error(reviewedEntry.message)
    expect(reviewedEntry.entry.script.targetBranches).toContainEqual(expect.objectContaining({
      id: 'ability.long-reach.range-8', range: '8, 1 Target',
    }))
    expect(() => resolve(state)).toThrow(/range|target/i)
    expect(() => resolve(state, 'ability.long-reach.range-8')).not.toThrow()

    const suppressed = fixture({
      slug: 'aa078-long-reach-suppressed', actorAbilities: ['Long Reach'],
      targetPosition: { x: 8, y: 0, z: 1 }, effects: [suppression('actor')],
    })
    const suppressedEntry = context(suppressed).queries.resolveActorMoveEntry('Tackle')
    if (!suppressedEntry.ok) throw new Error(suppressedEntry.message)
    expect((suppressedEntry.entry.script.targetBranches ?? [])
      .some(branch => branch.id === 'ability.long-reach.range-8')).toBe(false)
    expect(() => resolve(suppressed, 'ability.long-reach.range-8')).toThrow(/branch|range|target/i)
  })

  it('aa078.mach-speed-and-liquid-ooze.reviewed preserve damage ordering and exact predicates', () => {
    const flyingPlain = fixture({ slug: 'aa078-mach-speed-plain', move: 'Wing Attack', actorHp: 80 })
    const flyingBoost = fixture({
      slug: 'aa078-mach-speed-boost', move: 'Wing Attack', actorHp: 80,
      actorAbilities: ['Mach Speed'],
    })
    expect(hpAfter(flyingBoost)).toBe(hpAfter(flyingPlain) - 5)

    const poisonPlain = fixture({ slug: 'aa078-liquid-ooze-poison-plain', move: 'Poison Sting' })
    const poisonResisted = fixture({
      slug: 'aa078-liquid-ooze-poison', move: 'Poison Sting', targetAbilities: ['Liquid Ooze'],
    })
    expect(hpAfter(poisonResisted)).toBeGreaterThan(hpAfter(poisonPlain))
    expect(JSON.stringify(resolve(poisonResisted).resolution.auditTrace)).toContain('Liquid Ooze')

    const drainPlain = fixture({
      slug: 'aa078-liquid-ooze-drain-plain', move: 'Absorb', actorHp: 200,
    })
    const drainOoze = fixture({
      slug: 'aa078-liquid-ooze-drain', move: 'Absorb', actorHp: 200,
      targetAbilities: ['Liquid Ooze'],
    })
    expect(hpAfter(drainPlain, 'actor')).toBeGreaterThan(200)
    expect(hpAfter(drainOoze, 'actor')).toBeLessThan(200)
    expect(JSON.stringify(resolve(drainOoze).resolution.auditTrace)).toContain('ability.liquid-ooze.recoil')
  })

  it('aa078.line-charge.reviewed enforces cardinal paths and suppresses movement opportunity attacks', () => {
    const state = fixture({ slug: 'aa078-line-charge', actorAbilities: ['Line Charge'] })
    const movement = resolveMovement({
      map: state.map, sheets: { pokemon: state.sheets, trainer: new Map() },
      placementId: 'actor', mode: 'shift', destination: { x: 3, y: 0, z: 3 },
    })
    if (!movement.ok) throw new Error(`Expected Line Charge movement: ${movement.message}`)
    expect(movement.path.every((cell, index) => index === 0
      || cell.x === movement.path[index - 1]!.x
      || cell.z === movement.path[index - 1]!.z)).toBe(true)
    expect(movement.cost).toBe(4)
    expect(materializeMovementAttackOfOpportunity({
      resolutionId: 'resolution:aa078-line-charge',
      originOpId: parseLivePlayOpId('op_aa078_line_charge'),
      originMapSlug: state.map.slug, declarationPreviousRevision: state.map.revision ?? 0,
      continuationMapRevision: state.map.revision ?? 0, createdAt: 1_000, map: state.map,
      movement, pokemonSheets: state.sheets, trainerSheets: new Map(),
      playerCharacterSheetKeys: new Set(),
    })).toBeNull()
  })

  it('aa078.liquid-ooze.reviewed reverses Leech Seed lifecycle loss without healing the seeded target', () => {
    const state = fixture({
      slug: 'aa078-liquid-ooze-leech-seed', move: 'Leech Seed',
      targetAbilities: ['Liquid Ooze'],
    })
    const plan = resolve(state)
    const seeded = plan.nextMap.encounterState?.effects.find(effect => effect.tags.includes('leech-seed'))
    if (!seeded) throw new Error('Expected Leech Seed effect.')
    const event = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION, eventId: 'event.aa078.turn-start',
      kind: 'turn-start', sourceOperationId: 'op.aa078.lifecycle', causalParentEventId: null,
      reasonCode: 'aa078.turn-start', round: 2, turn: 1,
      placementId: 'target', sideId: null,
    })
    const baseContext = {
      state: plan.nextMap.encounterState!, effectsAtEventStart: [seeded], event,
      depth: 0, eventSequence: 1, random: createAuthoritativeMoveRandom(() => 0.5),
      transitions: [],
    } as const
    const ordinary = createAa078LeechSeedLifecycleHandler({ liquidOozeTickByPlacementId: new Map() })
      .resolve(baseContext)
    expect(ordinary[0]?.operations.map(operation => operation.kind)).toEqual(['direct-hp', 'heal'])
    const reversed = createAa078LeechSeedLifecycleHandler({
      liquidOozeTickByPlacementId: new Map([['target', 35]]),
    }).resolve(baseContext)
    expect(reversed[0]?.operations).toHaveLength(1)
    expect(reversed[0]?.operations[0]).toMatchObject({
      kind: 'direct-hp', recipients: { kind: 'source-placement' },
      reasonCode: 'ability.liquid-ooze.leech-seed-reversal',
      payload: { mode: 'lose', calculation: { kind: 'fixed', value: 35 } },
    })
  })
})
