import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { activePokemonHeldEquipmentState } from '../fixtures/equipment'
import { splitSheetItemNames } from '~/utils/sheetItemNames'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { aa067MoveOverlayOperations } from '../../server/domain/abilityAutomation/mechanics/aa067MoveIntegration'
import {
  aa067DiamondDefenseMoveFrequency,
  aa067MoveResistance,
  aa067StealthRockDamageProfile,
} from '../../server/domain/abilityAutomation/mechanics/aa067StaticIntegration'
import { aa067PokemonHeldItemCapacity } from '../../server/domain/abilityAutomation/mechanics/aa067ItemIntegration'
import { planInitiativeLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { resolveWeatherResidualImmunity } from '../../server/domain/moveAutomation/weatherLifecycle'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { resolveAuthoritativeMoveItemResources } from '../../server/domain/moveAutomation/itemResources'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  move?: string
  types?: readonly string[]
  held?: string
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  gender: 'Male', types: [...(input.types ?? ['Normal'])],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  items: input.held ? { held: input.held } : {},
  equipmentState: activePokemonHeldEquipmentState({
    ownerSlug: input.slug,
    canonicalItemIds: splitSheetItemNames(input.held),
  }),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const mapFixture = (input: {
  slug: string
  actorAbility?: string
  targetAbility?: string
  weather?: 'sunny' | 'rainy' | 'sandstorm'
  effects?: NonNullable<TabletopMap['encounterState']>['effects']
}): { map: TabletopMap; sheets: Map<string, CharacterSheet> } => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: {
      weather: input.weather ? [{ kind: input.weather }] : [], terrains: [], rooms: [],
    },
    placements,
    encounterState: {
      ...encounter,
      effects: [...(input.effects ?? [])],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
  return {
    map,
    sheets: new Map([
      ['actor', sheet({ slug: 'actor', ability: input.actorAbility, move: 'Spore' })],
      ['target', sheet({ slug: 'target', ability: input.targetAbility })],
    ]),
  }
}
const suppression = (placementId: string, canonicalId: string) => parseEncounterEffect({
  id: `suppress.${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  kind: 'creature-rule-overlay',
  source: { operationId: 'op_suppress', moveId: 'ability.suppression', placementId },
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
  createdRound: 1, createdTurn: 1,
  duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
  tags: ['test', 'suppression'],
  payload: {
    domain: 'ability', action: 'suppress', values: [canonicalId],
    referencePlacementId: null, suppressionScope: 'listed',
  },
  dispel: { policy: 'matching-tags', tags: ['suppression'] },
  transferPolicy: 'retain', suppression: { sources: [] },
})

const context = (fixture: ReturnType<typeof mapFixture>, moveName = 'Ember') => (
  buildAuthoritativeMoveRulesContext({
    map: fixture.map, pokemonSheets: fixture.sheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    candidatePlacementIds: ['target'], selectedPlacementIds: ['target'],
    random: () => 0.5, time: 1_000, resolutionId: `resolution:${fixture.map.slug}`,
  })
)

describe('AA-067 static abilities', () => {
  it('aa067.delivery-bird.reviewed raises held-item capacity to two only for an effective owner', () => {
    const active = mapFixture({ slug: 'aa067-delivery', actorAbility: 'Delivery Bird' })
    expect(aa067PokemonHeldItemCapacity({ map: active.map, sheet: active.sheets.get('actor')! })).toBe(2)
    active.map.encounterState = {
      ...active.map.encounterState!, effects: [suppression('actor', 'Delivery Bird')],
    }
    expect(aa067PokemonHeldItemCapacity({ map: active.map, sheet: active.sheets.get('actor')! })).toBe(1)
  })

  it('aa067.delivery-bird.reviewed opens a durable owner choice when Fling affects one of two items', () => {
    const fixture = mapFixture({ slug: 'aa067-delivery-choice', actorAbility: 'Delivery Bird' })
    fixture.sheets.set('actor', sheet({
      slug: 'actor', ability: 'Delivery Bird', move: 'Fling', held: 'Leftovers, Iron Ball',
    }))
    const itemResources = resolveAuthoritativeMoveItemResources({
      map: fixture.map, actorPlacementId: 'actor', selectedTargetPlacementIds: ['target'],
      pokemonSheets: fixture.sheets, trainerSheets: new Map(), groupInventories: new Map(),
      consumedItems: [],
      requirements: [{ id: 'fling.actor-held', source: { kind: 'actor-equipped' } }],
    })
    const declaration = planAuthoritativeMoveStateExecution({
      map: fixture.map, pokemonSheets: fixture.sheets, trainerSheets: new Map(), itemResources,
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Fling',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, now: () => 1_000,
      operationId: 'op_aa067_delivery_fling', pendingResolutionId: 'resolution:aa067-delivery-fling',
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Delivery Bird item choice.')
    const pending = declaration.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    expect(window.kind).toBe('choice')
    expect(window.options).toHaveLength(2)
    const execution = resumeMoveSpec({
      pendingResolution: pending, map: declaration.nextMap,
      pokemonSheets: fixture.sheets, trainerSheets: new Map(), itemResources,
      response: { requestId: window.windowId, optionId: window.options[1]!.id },
      now: 2_000, random: () => 0.5,
    })
    expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed Fling.')
    const planned = planResumedMoveState({
      pendingResolution: pending, declarationPlan: declaration.suspension.preWindowPlan,
      responseOpId: 'op_aa067_delivery_fling_response', responseWindowId: window.windowId,
      responseOptionId: window.options[1]!.id, chosenBy: { kind: 'actor', id: null },
      map: declaration.nextMap, pokemonSheets: fixture.sheets, trainerSheets: new Map(),
      itemResources, execution, plannedAt: 2_000,
    })
    const actor = planned.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
    expect(actor.items?.held).toBe('Leftovers')
    expect(actor.equipmentState?.instances).toHaveLength(1)
    expect(planned.nextMap.encounterState?.groundItems).toContainEqual(expect.objectContaining({
      canonicalItemName: 'Iron Ball', ownerPlacementId: 'actor',
    }))
  }, 30_000)

  it('aa073.handyman.reviewed opens the same durable affected-item choice for either held item', () => {
    const fixture = mapFixture({ slug: 'aa073-handyman-choice', actorAbility: 'Handyman' })
    fixture.sheets.set('actor', sheet({
      slug: 'actor', ability: 'Handyman', move: 'Fling', held: 'Leftovers, Iron Ball',
    }))
    const itemResources = resolveAuthoritativeMoveItemResources({
      map: fixture.map, actorPlacementId: 'actor', selectedTargetPlacementIds: ['target'],
      pokemonSheets: fixture.sheets, trainerSheets: new Map(), groupInventories: new Map(),
      consumedItems: [],
      requirements: [{ id: 'fling.actor-held', source: { kind: 'actor-equipped' } }],
    })
    const declaration = planAuthoritativeMoveStateExecution({
      map: fixture.map, pokemonSheets: fixture.sheets, trainerSheets: new Map(), itemResources,
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Fling',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, now: () => 1_000,
      operationId: 'op_aa073_handyman_fling', pendingResolutionId: 'resolution:aa073-handyman-fling',
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Handyman item choice.')
    const window = declaration.suspension.pendingResolution.outstandingWindows[0]!
    expect(window.kind).toBe('choice')
    expect(window.promptKey).toBe('ability.handyman.choose-affected-item')
    expect(window.options).toHaveLength(2)
  }, 30_000)

  it('aa067.desert-weather.reviewed grants Sunny Fire resistance, Sandstorm immunity, and Rainy turn-end Temp HP', () => {
    const sunny = mapFixture({ slug: 'aa067-desert-sunny', targetAbility: 'Desert Weather', weather: 'sunny' })
    sunny.sheets.set('actor', sheet({ slug: 'actor', move: 'Ember' }))
    const sunnyContext = context(sunny)
    expect(aa067MoveResistance({
      context: sunnyContext, recipientId: 'target', moveType: 'Fire', multiplier: 1,
    })).toMatchObject({ multiplier: 0.5, relation: 'resistant', sources: ['Desert Weather'] })
    const targetPlacement = sunny.map.placements.find(value => value.id === 'target')!
    expect(resolveWeatherResidualImmunity({
      weatherKind: 'sandstorm', context: sunnyContext,
      recipient: {
        placement: targetPlacement,
        token: sunnyContext.queries.tokens.get('target')!,
        sheet: sunnyContext.queries.sheets.forPlacement(targetPlacement)!,
      },
    }).blockedBy).toBe('Desert Weather')
    const suppressed = mapFixture({
      slug: 'aa067-desert-suppressed', targetAbility: 'Desert Weather', weather: 'sunny',
      effects: [suppression('target', 'Desert Weather')],
    })
    expect(aa067MoveResistance({
      context: context(suppressed), recipientId: 'target', moveType: 'Fire', multiplier: 1,
    }).sources).toEqual([])
    const sunnyPlan = planAuthoritativeMoveState({
      map: sunny.map, pokemonSheets: sunny.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, now: () => 1_500, operationId: 'op_aa067_desert_sunny',
    })
    expect(JSON.stringify(sunnyPlan.resolution.auditTrace)).toContain('Desert Weather')

    const rainy = mapFixture({ slug: 'aa067-desert-rainy', actorAbility: 'Desert Weather', weather: 'rainy' })
    const lifecycle = planInitiativeLifecycle({
      map: rainy.map,
      previous: { activeId: 'actor', round: 1 }, current: { activeId: 'target', round: 1 },
      orderIds: ['actor', 'target'], operationId: 'op_aa067_desert_rainy', time: 2_000,
      loadSheets: () => ({ pokemonSheets: rainy.sheets, trainerSheets: new Map() }),
    })
    expect(lifecycle.currentTemporaryHitPoints?.byPlacementId.actor).toBeGreaterThan(0)
    expect(lifecycle.reduction.operations).toContainEqual(expect.objectContaining({
      reasonCode: 'ability.desert-weather.rainy-turn-end',
    }))
  })

  it('aa067.designer.reviewed resists only the two authoritative current suit Types', () => {
    const effect = parseEncounterEffect({
      id: 'designer.fire', kind: 'capability',
      source: { operationId: 'op_designer', moveId: 'ability.designer', placementId: 'target' },
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 1, duration: { kind: 'until-triggered', remaining: null },
      stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null }, tags: ['ability', 'aa067', 'designer', 'type.fire'],
      payload: { capabilityId: 'aa067.designer.resistance.fire', action: 'grant', value: 1 },
      dispel: { policy: 'matching-tags', tags: ['designer'] }, transferPolicy: 'retain', suppression: { sources: [] },
    })
    const fixture = mapFixture({ slug: 'aa067-designer-static', targetAbility: 'Designer', effects: [effect] })
    fixture.sheets.set('actor', sheet({ slug: 'actor', move: 'Ember' }))
    const rules = context(fixture)
    expect(aa067MoveResistance({ context: rules, recipientId: 'target', moveType: 'Fire', multiplier: 2 }).multiplier).toBe(1.5)
    expect(aa067MoveResistance({ context: rules, recipientId: 'target', moveType: 'Water', multiplier: 2 }).multiplier).toBe(2)
    const suppressedFixture = mapFixture({
      slug: 'aa067-designer-suppressed', targetAbility: 'Designer',
      effects: [effect, suppression('target', 'Designer')],
    })
    expect(aa067MoveResistance({
      context: context(suppressedFixture), recipientId: 'target', moveType: 'Fire', multiplier: 2,
    }).multiplier).toBe(2)
    const plan = planAuthoritativeMoveState({
      map: fixture.map, pokemonSheets: fixture.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, now: () => 1_500, operationId: 'op_aa067_designer_damage',
    })
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('Designer')
  })

  it('aa067.diamond-defense.reviewed grants Scene x2 Stealth Rock and chooses the more effective Rock/Fairy Type', () => {
    const fixture = mapFixture({ slug: 'aa067-diamond', actorAbility: 'Diamond Defense' })
    fixture.sheets.set('actor', sheet({
      slug: 'actor', ability: 'Diamond Defense', move: 'Stealth Rock',
    }))
    fixture.sheets.set('target', sheet({ slug: 'target', types: ['Fighting'] }))
    fixture.map.moveUsage = {
      scene: { name: 'Scene', startedAt: 100 },
      byPlacementId: {
        actor: {
          'stealth-rock': {
            moveName: 'Stealth Rock', frequency: 'scene', uses: 1,
            lastUsedRound: 1, updatedAt: 900,
          },
        },
      },
    }
    const rules = context(fixture, 'Stealth Rock')
    const available = rules.queries.resolveActorMoveEntry('Stealth Rock')
    expect(available.ok && available.entry.frequency).toBe('Scene x2')
    expect(available.ok && available.entry.usage?.available).toBe(true)
    expect(aa067DiamondDefenseMoveFrequency({
      context: rules, script: { moveName: 'Stealth Rock' }, frequency: 'Scene',
    })).toBe('Scene x2')
    expect(aa067StealthRockDamageProfile({
      context: rules, sourcePlacementId: 'actor', defenderTypeIds: ['fighting'],
    })).toEqual({ type: 'Fairy', multiplier: 1.5 })
    expect(aa067StealthRockDamageProfile({
      context: rules, sourcePlacementId: null, defenderTypeIds: ['fighting'],
    })).toEqual({ type: 'Rock', multiplier: 0.5 })
    const suppressed = mapFixture({
      slug: 'aa067-diamond-suppressed', actorAbility: 'Diamond Defense',
      effects: [suppression('actor', 'Diamond Defense')],
    })
    suppressed.sheets.set('target', sheet({ slug: 'target', types: ['Fighting'] }))
    expect(aa067StealthRockDamageProfile({
      context: context(suppressed, 'Stealth Rock'),
      sourcePlacementId: 'actor', defenderTypeIds: ['fighting'],
    })).toEqual({ type: 'Rock', multiplier: 0.5 })
  })

  it('aa067.dire-spore.reviewed appends Poisoned only to a successful Spore hit', () => {
    const fixture = mapFixture({ slug: 'aa067-dire-spore', actorAbility: 'Dire Spore' })
    const operations = aa067MoveOverlayOperations({
      context: context(fixture, 'Spore'),
      script: { moveName: 'Spore', damageClass: 'Status' } as never,
      moveSourceId: 'move.spore', authoritativeTargetIds: ['target'],
    })
    expect(operations).toContainEqual(expect.objectContaining({
      kind: 'condition', recipients: { kind: 'hit-targets' },
      reasonCode: 'ability.dire-spore.poisoned',
      payload: expect.objectContaining({ conditionId: 'poisoned' }),
    }))
    const plan = planAuthoritativeMoveState({
      map: fixture.map, pokemonSheets: fixture.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Spore',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.99, now: () => 2_000, operationId: 'op_aa067_dire_spore',
    })
    const target = plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(target.combat?.conditions).toEqual(expect.arrayContaining(['Sleep', 'Poisoned']))
    const suppressed = mapFixture({
      slug: 'aa067-dire-spore-suppressed', actorAbility: 'Dire Spore',
      effects: [suppression('actor', 'Dire Spore')],
    })
    expect(aa067MoveOverlayOperations({
      context: context(suppressed, 'Spore'),
      script: { moveName: 'Spore', damageClass: 'Status' } as never,
      moveSourceId: 'move.spore', authoritativeTargetIds: ['target'],
    }).some(operation => operation.reasonCode === 'ability.dire-spore.poisoned')).toBe(false)
  })
})
