import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { planInitiativeLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { aa061AuraBreakMarkId } from '../../server/domain/abilityAutomation/mechanics/aa061MoveIntegration'
import { reduceAbilityOwnedStateCommand } from '../../server/domain/abilityAutomation/ownedState'
import {
  aa066DarkAuraDamageBaseBonus,
  aa066DefeatistInitiativeBonus,
} from '../../server/domain/abilityAutomation/mechanics/aa066StaticIntegration'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})

const sheet = (input: {
  slug: string
  move?: string
  abilities?: readonly string[]
  hp?: number
  conditions?: readonly string[]
  stages?: Partial<NonNullable<CharacterSheet['combatStages']>>
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
    hp: { added: 45 },
    atk: { added: 25, stage: input.stages?.atk ?? 0 },
    def: { added: 25, stage: input.stages?.def ?? 0 },
    satk: { added: 25, stage: input.stages?.satk ?? 0 },
    sdef: { added: 25, stage: input.stages?.sdef ?? 0 },
    spd: { added: 25, stage: input.stages?.spd ?? 0 },
  },
  combatStages: {
    atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0,
    ...input.stages,
  },
  combat: {
    currentHp: input.hp ?? 150,
    injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})

const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2,
    slug,
    name: slug,
    revision: 5,
    dimensions: { x: 16, y: 4, z: 8 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${slug}`,
        currentRound: 1,
        currentTurn: { round: 1, turn: 2, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 1 },
  }
}

const sheetsFor = (input: {
  move: string
  actorAbilities?: readonly string[]
  actorHp?: number
  targetAbilities?: readonly string[]
  targetHp?: number
  targetConditions?: readonly string[]
  targetStages?: Partial<NonNullable<CharacterSheet['combatStages']>>
  allyAbilities?: readonly string[]
}) => new Map<string, CharacterSheet>([
  ['actor', sheet({ slug: 'actor', move: input.move, abilities: input.actorAbilities, hp: input.actorHp })],
  ['ally', sheet({ slug: 'ally', abilities: input.allyAbilities })],
  ['target', sheet({
    slug: 'target', abilities: input.targetAbilities, hp: input.targetHp,
    conditions: input.targetConditions, stages: input.targetStages,
  })],
])

const targetHpAfter = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  actorHp?: number
  targetAbilities?: readonly string[]
  targetHp?: number
  allyAbilities?: readonly string[]
  random?: number
}): number => {
  const result = planAuthoritativeMoveState({
    map: battleMap(input.slug),
    pokemonSheets: sheetsFor(input),
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: input.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => input.random ?? 0.5,
    now: () => 1_000,
    operationId: `op_${input.slug}`,
  })
  const write = result.sheetWrites.find(entry => entry.slug === 'target')?.nextSheet as CharacterSheet | undefined
  return write?.combat?.currentHp ?? input.targetHp ?? 150
}

const moveContext = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  allyAbilities?: readonly string[]
  map?: TabletopMap
}) => buildAuthoritativeMoveRulesContext({
  map: input.map ?? battleMap(input.slug),
  pokemonSheets: sheetsFor(input),
  trainerSheets: new Map(),
  intent: {
    schemaVersion: 1,
    placementId: 'actor',
    moveName: input.move,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  selectedPlacementIds: ['target'],
  random: () => 0.5,
  time: 1_000,
})

const stage = (value: CharacterSheet | undefined, key: 'atk' | 'def' | 'satk' | 'sdef'): number => (
  value?.stats?.[key]?.stage ?? value?.combatStages?.[key] ?? 0
)

describe('AA-066 static abilities', () => {
  it('aa066.dark-art.reviewed grants Last Chance only for low-HP Dark damage', () => {
    const baseline = targetHpAfter({ slug: 'aa066-dark-art-base', move: 'Bite', actorHp: 40 })
    const active = targetHpAfter({
      slug: 'aa066-dark-art-active', move: 'Bite', actorAbilities: ['Dark Art'], actorHp: 40,
    })
    const aboveThreshold = targetHpAfter({
      slug: 'aa066-dark-art-high', move: 'Bite', actorAbilities: ['Dark Art'], actorHp: 100,
    })
    expect(active).toBe(baseline - 5)
    expect(aboveThreshold).toBe(baseline)
  })

  it('aa066.dark-aura.reviewed raises allied Dark DB and Aura Break inverts the selected provider', () => {
    const active = moveContext({
      slug: 'aa066-dark-aura', move: 'Bite', allyAbilities: ['Dark Aura'],
    })
    expect(aa066DarkAuraDamageBaseBonus({ context: active, moveType: 'Dark' })).toBe(1)
    expect(aa066DarkAuraDamageBaseBonus({ context: active, moveType: 'Water' })).toBe(0)
    const baselineHp = targetHpAfter({ slug: 'aa066-dark-aura-base', move: 'Bite' })
    const auraHp = targetHpAfter({
      slug: 'aa066-dark-aura-damage', move: 'Bite', allyAbilities: ['Dark Aura'],
    })
    expect(auraHp).toBeLessThan(baselineHp)

    const map = battleMap('aa066-dark-aura-inverted')
    const encounter = parseEncounterState(map.encounterState)
    const reduced = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
      operationId: 'op_aa066_aura_break',
      kind: 'create',
      stateId: 'base:aura-break:dark-aura',
      expectedVersion: null,
      entry: {
        stateId: 'base:aura-break:dark-aura',
        ownerPlacementId: 'target',
        sourceAbilityInstanceId: 'base:aura-break',
        canonicalId: 'Aura Break',
        targetPlacementIds: ['ally'],
        lifecycle: { kind: 'scene', targetPolicy: null },
        payload: { kind: 'mark', markId: aa061AuraBreakMarkId('base:dark-aura') },
      },
    })
    map.encounterState = parseEncounterState({ ...encounter, abilityOwnedState: reduced.state })
    const inverted = moveContext({
      slug: 'aa066-dark-aura-inverted', move: 'Bite', allyAbilities: ['Dark Aura'],
      targetAbilities: ['Aura Break'], map,
    })
    expect(aa066DarkAuraDamageBaseBonus({ context: inverted, moveType: 'Dark' })).toBe(-1)
  })

  it('aa066.dauntless-shield.reviewed adds one default Defense stage, caps, and honors suppression', () => {
    const active = moveContext({
      slug: 'aa066-dauntless', move: 'Tackle', targetAbilities: ['Dauntless Shield'],
    })
    expect(active.queries.stats.combatStage('target', {
      stage: 'def', stageModifierPolicy: 'honor',
    })?.authoredStage).toBe(1)
    const baselineHp = targetHpAfter({ slug: 'aa066-dauntless-base', move: 'Tackle' })
    const shieldHp = targetHpAfter({
      slug: 'aa066-dauntless-damage', move: 'Tackle', targetAbilities: ['Dauntless Shield'],
    })
    expect(shieldHp).toBeGreaterThan(baselineHp)

    const cappedSheets = sheetsFor({
      move: 'Tackle', targetAbilities: ['Dauntless Shield'], targetStages: { def: 6 },
    })
    const capped = buildAuthoritativeMoveRulesContext({
      map: battleMap('aa066-dauntless-cap'), pokemonSheets: cappedSheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      selectedPlacementIds: ['target'], random: () => 0.5, time: 1_000,
    })
    expect(capped.queries.stats.combatStage('target', {
      stage: 'def', stageModifierPolicy: 'honor',
    })?.authoredStage).toBe(6)

    const suppressedMap = battleMap('aa066-dauntless-suppressed')
    suppressedMap.encounterState = {
      ...suppressedMap.encounterState!,
      effects: [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'suppress', values: ['Dauntless Shield'],
          referencePlacementId: null, suppressionScope: 'listed',
        }),
        affected: { placementIds: ['target'], sideIds: [], cells: [] },
      }],
    }
    const suppressed = moveContext({
      slug: 'aa066-dauntless-suppressed', move: 'Tackle',
      targetAbilities: ['Dauntless Shield'], map: suppressedMap,
    })
    expect(suppressed.queries.stats.combatStage('target', {
      stage: 'def', stageModifierPolicy: 'honor',
    })?.authoredStage).toBe(0)
  })

  it('aa066.deep-sleep.reviewed heals one Tick only at a sleeping effective owner turn end', () => {
    const map = battleMap('aa066-deep-sleep')
    map.encounterState = {
      ...map.encounterState!,
      history: {
        ...map.encounterState!.history,
        currentTurn: { round: 1, turn: 2, placementId: 'target' },
      },
    }
    const pokemonSheets = sheetsFor({
      move: 'Tackle', targetAbilities: ['Deep Sleep'], targetHp: 80,
      targetConditions: ['Sleep'],
    })
    const lifecycle = planInitiativeLifecycle({
      map,
      previous: { activeId: 'target', round: 1 },
      current: { activeId: 'actor', round: 1 },
      orderIds: ['actor', 'ally', 'target'],
      operationId: 'op_aa066_deep_sleep_end',
      time: 2_000,
      loadSheets: () => ({ pokemonSheets, trainerSheets: new Map() }),
    })
    const healed = lifecycle.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(healed.combat?.currentHp).toBe(98)

    pokemonSheets.set('target', sheet({ slug: 'target', abilities: ['Deep Sleep'], hp: 80 }))
    const awake = planInitiativeLifecycle({
      map,
      previous: { activeId: 'target', round: 1 },
      current: { activeId: 'actor', round: 1 },
      orderIds: ['actor', 'ally', 'target'],
      operationId: 'op_aa066_deep_sleep_awake',
      time: 2_001,
      loadSheets: () => ({ pokemonSheets, trainerSheets: new Map() }),
    })
    expect(awake.sheetWrites.find(write => write.slug === 'target')).toBeUndefined()

    const suppressedMap = battleMap('aa066-deep-sleep-suppressed')
    suppressedMap.encounterState = {
      ...suppressedMap.encounterState!,
      history: {
        ...suppressedMap.encounterState!.history,
        currentTurn: { round: 1, turn: 2, placementId: 'target' },
      },
      effects: [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'suppress', values: ['Deep Sleep'],
          referencePlacementId: null, suppressionScope: 'listed',
        }),
        affected: { placementIds: ['target'], sideIds: [], cells: [] },
      }],
    }
    pokemonSheets.set('target', sheet({
      slug: 'target', abilities: ['Deep Sleep'], hp: 80, conditions: ['Sleep'],
    }))
    const suppressed = planInitiativeLifecycle({
      map: suppressedMap,
      previous: { activeId: 'target', round: 1 },
      current: { activeId: 'actor', round: 1 },
      orderIds: ['actor', 'ally', 'target'],
      operationId: 'op_aa066_deep_sleep_suppressed', time: 2_002,
      loadSheets: () => ({ pokemonSheets, trainerSheets: new Map() }),
    })
    expect(suppressed.sheetWrites.find(write => write.slug === 'target')).toBeUndefined()
  })

  it('aa066.defeatist.reviewed applies its two HP branches and low-HP Initiative', () => {
    const baselineHigh = targetHpAfter({ slug: 'aa066-defeatist-high-base', move: 'Tackle', actorHp: 100 })
    const high = targetHpAfter({
      slug: 'aa066-defeatist-high', move: 'Tackle', actorAbilities: ['Defeatist'], actorHp: 100,
    })
    expect(high).toBeLessThan(baselineHigh)

    const baselineLow = targetHpAfter({ slug: 'aa066-defeatist-low-base', move: 'Tackle', actorHp: 50 })
    const low = targetHpAfter({
      slug: 'aa066-defeatist-low', move: 'Tackle', actorAbilities: ['Defeatist'], actorHp: 50,
    })
    expect(low).toBe(baselineLow + 5)

    const map = battleMap('aa066-defeatist-initiative')
    const actorSheet = sheet({ slug: 'actor', abilities: ['Defeatist'], hp: 50 })
    expect(aa066DefeatistInitiativeBonus({
      map, placement: map.placements[0]!, sheet: actorSheet,
    })).toBe(10)
    actorSheet.combat!.currentHp = 100
    expect(aa066DefeatistInitiativeBonus({
      map, placement: map.placements[0]!, sheet: actorSheet,
    })).toBe(0)
  })

  it('aa066.defiant.reviewed responds to external lowering alongside Competitive but not its own Move', () => {
    const pokemonSheets = sheetsFor({
      move: 'Confide', targetAbilities: ['Defiant', 'Competitive'],
    })
    const result = planAuthoritativeMoveState({
      map: battleMap('aa066-defiant'), pokemonSheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Confide',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, now: () => 1_000, operationId: 'op_aa066_defiant',
    })
    const target = result.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(stage(target, 'atk')).toBe(2)
    expect(stage(target, 'satk')).toBe(1)

    const ownSheets = sheetsFor({ move: 'Close Combat', actorAbilities: ['Defiant'] })
    const own = planAuthoritativeMoveState({
      map: battleMap('aa066-defiant-own'), pokemonSheets: ownSheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Close Combat',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, now: () => 1_000, operationId: 'op_aa066_defiant_own',
    })
    const actor = own.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
    expect(stage(actor, 'def')).toBe(-1)
    expect(stage(actor, 'sdef')).toBe(-1)
    expect(stage(actor, 'atk')).toBe(0)
  }, 20_000)

  it('aa065.damp.reviewed adds its supplemental recorded 1d10 Water damage bonus', () => {
    const baseline = targetHpAfter({ slug: 'aa065-damp-water-base', move: 'Water Gun' })
    const damp = targetHpAfter({
      slug: 'aa065-damp-water', move: 'Water Gun', actorAbilities: ['Damp'],
    })
    expect(damp).toBeLessThan(baseline)
  })
})
