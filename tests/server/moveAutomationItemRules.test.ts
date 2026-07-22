import { describe, expect, it } from 'vitest'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseMoveExpression } from '#shared/moveAutomation/expressions'
import { moveItemEffectBindingId } from '#shared/moveAutomation/itemEffects'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  evaluateMoveExpression,
} from '~~/server/domain/moveAutomation/evaluateExpression'
import {
  createEncounterGlobalFieldZone,
} from '~~/server/domain/moveAutomation/fieldLifecycle'
import {
  MOVE_AUTOMATION_NATURAL_GIFT_BERRY_COUNT,
  resolveMoveAutomationItemRuleIdentity,
  resolveMoveAutomationItemRuleProfile,
} from '~~/server/domain/moveAutomation/itemRuleData'
import {
  MoveAutomationItemRuleError,
} from '~~/server/domain/moveAutomation/itemRules'
import {
  resolveAuthoritativeMoveItemResources,
} from '~~/server/domain/moveAutomation/itemResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const actorId = 'item-rule-actor'
const targetId = 'item-rule-target'
const actorRequirementId = 'item-rules.actor-equipped'
const targetRequirementId = 'item-rules.target-equipped'

const placement = (id: string, slug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: slug,
  position: { x, y: 0, z: 0 },
})

const sheet = (input: {
  readonly slug: string
  readonly species: string
  readonly held?: string
  readonly digestionFood?: string
  readonly revision?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: input.species,
  level: 30,
  revision: input.revision ?? 3,
  combat: { currentHp: 60 },
  movelist: [{ name: 'Scratch' }],
  ...(input.held || input.digestionFood
    ? {
        items: {
          ...(input.held ? { held: input.held } : {}),
          ...(input.digestionFood ? { digestionFood: input.digestionFood } : {}),
        },
      }
    : {}),
})

const mapFixture = (input: {
  readonly magicRoom?: boolean
  readonly embargo?: boolean
} = {}): TabletopMap => {
  const state = createEmptyEncounterState()
  const zones = input.magicRoom
    ? [createEncounterGlobalFieldZone({
        kind: 'room',
        fieldId: 'magic',
        source: {
          kind: 'operation',
          operationId: 'operation.magic-room',
          moveId: 'move.magic-room',
          placementId: targetId,
        },
        sideId: null,
        duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
        replacementGroup: 'field.room.magic',
      })]
    : []
  const effects = input.embargo
    ? [parseEncounterEffect({
        id: 'effect.item.embargo.actor',
        kind: 'item-suppression',
        source: {
          operationId: 'operation.embargo',
          moveId: 'move.embargo',
          placementId: targetId,
        },
        affected: { placementIds: [actorId], sideIds: [], cells: [] },
        createdRound: 1,
        createdTurn: 0,
        duration: { kind: 'scene', remaining: null },
        stacks: 1,
        charges: null,
        stackPolicy: { kind: 'independent-instance', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['item', 'item-suppression'],
        payload: {
          familyId: 'embargo.items',
          scope: 'all-equipped',
          itemBindingIds: [],
          blocksUse: true,
          blocksBenefit: true,
        },
        dispel: { policy: 'matching-tags', tags: ['item-suppression'] },
        transferPolicy: 'expire',
        suppression: { sources: [] },
      })]
    : []
  return {
    schemaVersion: 2,
    slug: 'item-rule-arena',
    name: 'Item Rule Arena',
    revision: 7,
    dimensions: { x: 8, y: 2, z: 8 },
    voxels: [],
    placements: [
      placement(actorId, 'item-rule-actor-sheet', 1),
      placement(targetId, 'item-rule-target-sheet', 2),
    ],
    lights: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: { ...state, zones, effects },
  }
}

const sheetsFixture = (actorHeld = 'Fire Type Plate') => new Map<string, CharacterSheet>([
  ['item-rule-actor-sheet', sheet({
    slug: 'item-rule-actor-sheet',
    species: 'Pikachu',
    held: actorHeld,
    digestionFood: 'Cheri Berry',
    revision: 3,
  })],
  ['item-rule-target-sheet', sheet({
    slug: 'item-rule-target-sheet',
    species: 'Rotom',
    held: 'Iron Ball',
    revision: 5,
  })],
])

const intent = (): ResolveMoveIntent => ({
  schemaVersion: 1,
  placementId: actorId,
  moveName: 'Scratch',
  selection: { kind: 'single-target', targetPlacementId: targetId },
})

const contextFixture = (input: {
  readonly map?: TabletopMap
  readonly sheets?: ReadonlyMap<string, CharacterSheet>
} = {}) => {
  const map = input.map ?? mapFixture()
  const sheets = input.sheets ?? sheetsFixture()
  const resources = resolveAuthoritativeMoveItemResources({
    map,
    actorPlacementId: actorId,
    selectedTargetPlacementIds: [targetId],
    pokemonSheets: sheets,
    trainerSheets: new Map<string, TrainerSheet>(),
    groupInventories: new Map(),
    requirements: [{
      id: actorRequirementId,
      source: { kind: 'actor-equipped' },
    }, {
      id: targetRequirementId,
      source: { kind: 'selected-target-equipped' },
    }],
  })
  return buildAuthoritativeMoveRulesContext({
    map,
    pokemonSheets: sheets,
    trainerSheets: new Map(),
    intent: intent(),
    selectedPlacementIds: [targetId],
    random: () => { throw new Error('item rule queries do not use RNG') },
    time: 1_000,
    itemResources: resources,
  })
}

const itemExpression = (input: {
  readonly subject?: 'actor' | 'current-target'
  readonly query: 'eligible' | 'family' | 'category' | 'power' | 'move-type' | 'damage-base' | 'effect'
  readonly source?: 'equipped' | 'digestion-buff'
  readonly families: readonly ('berry' | 'plate' | 'drive' | 'memory' | 'other')[]
  readonly requirementId?: string | null
  readonly timing?: 'static' | 'trigger' | 'activated' | 'consumable'
}) => parseMoveExpression({
  kind: 'item',
  subject: { kind: input.subject ?? 'actor' },
  query: input.query,
  source: input.source ?? 'equipped',
  families: input.families,
  requirementId: input.requirementId === undefined
    ? actorRequirementId
    : input.requirementId,
  timing: input.timing ?? 'static',
})

const evaluate = (
  context: ReturnType<typeof contextFixture>,
  expression: ReturnType<typeof parseMoveExpression>,
) => evaluateMoveExpression({
  context,
  expression,
  selectorState: {
    targetIds: [targetId],
    hitTargetIds: [targetId],
    missedTargetIds: [],
    damagedTargetIds: [],
    faintedTargetIds: [],
  },
}).value

describe('authoritative item-dependent move rules', () => {
  it('uses reviewed Berry, Plate, Drive, Memory, Fling category, power, and effect metadata', () => {
    expect(MOVE_AUTOMATION_NATURAL_GIFT_BERRY_COUNT).toBe(67)
    expect(resolveMoveAutomationItemRuleIdentity('Fire Type Plate')).toMatchObject({
      canonicalItemId: 'fire-type-plate',
      canonicalItemName: 'Fire Type Plate',
      family: 'plate',
      moveType: 'fire',
    })
    expect(resolveMoveAutomationItemRuleProfile('Cheri Berry')).toMatchObject({
      canonicalItemId: 'cheri-berry',
      family: 'berry',
      moveType: 'fire',
      naturalGiftDamageBase: 6,
      flingCategory: 'consumable',
      flingPower: null,
      flingEffect: 'fling.consume-thrown-item',
    })
    expect(resolveMoveAutomationItemRuleProfile('Douse Drive')).toMatchObject({
      canonicalItemId: 'douse-drive',
      family: 'drive',
      moveType: 'water',
      flingCategory: 'held-item',
      flingPower: 7,
    })
    expect(resolveMoveAutomationItemRuleProfile('Fairy Memory Disc')).toMatchObject({
      canonicalItemId: 'fairy-memory-disc',
      family: 'memory',
      moveType: 'fairy',
    })
    expect(resolveMoveAutomationItemRuleIdentity('Lucky Leaf')).toMatchObject({
      canonicalItemId: 'grass-type-booster',
      canonicalItemName: 'Grass Type Booster',
      moveType: 'grass',
    })
    expect(resolveMoveAutomationItemRuleIdentity('Dew Cup')).toMatchObject({
      canonicalItemId: 'occa-berry', canonicalItemName: 'Occa Berry', family: 'berry',
    })
    expect(resolveMoveAutomationItemRuleIdentity('Thorn Mantle')).toMatchObject({
      canonicalItemId: 'coba-berry', canonicalItemName: 'Coba Berry', family: 'berry',
    })
    expect(resolveMoveAutomationItemRuleIdentity('Chewy Cluster')).toMatchObject({
      canonicalItemId: 'leftovers', canonicalItemName: 'Leftovers',
    })
    expect(resolveMoveAutomationItemRuleIdentity('Decorative Twine')).toMatchObject({
      canonicalItemId: 'decorative-twine', canonicalItemName: 'Decorative Twine',
      referenceCategories: ['Held Item'],
    })
    expect(resolveMoveAutomationItemRuleProfile('Iron Ball')).toMatchObject({
      flingCategory: 'lagging-item',
      flingPower: 12,
      flingEffect: 'fling.none',
    })
    expect(resolveMoveAutomationItemRuleProfile('Basic Ball')).toMatchObject({
      flingCategory: 'poke-ball',
      flingPower: 3,
      flingEffect: 'fling.capture-attempt',
    })
    expect(resolveMoveAutomationItemRuleProfile('Kitchen Knife')).toMatchObject({
      flingCategory: 'weapon',
      flingPower: null,
      flingEffect: 'fling.ranged-struggle',
    })
    expect(resolveMoveAutomationItemRuleProfile('Metal Powder')).toMatchObject({
      flingCategory: 'held-item',
      flingPower: 7,
    })
    expect(resolveMoveAutomationItemRuleProfile('Metal Powder', {
      rareBenefitEligible: true,
    })).toMatchObject({
      flingCategory: 'rare-item',
      flingPower: 10,
    })
  })

  it('evaluates primitives for all item-dependent move families from authoritative state', () => {
    const context = contextFixture()
    const beforeMap = structuredClone(context.map)
    const beforeActorSheet = structuredClone(context.actor.sheet.sheet)

    const holdingItem = parseMoveExpression({
      kind: 'item',
      subject: { kind: 'actor' },
      query: 'holding-item',
    })
    const holdingNothing = parseMoveExpression({
      kind: 'item',
      subject: { kind: 'actor' },
      query: 'holding-nothing',
    })
    const targetHoldingItem = parseMoveExpression({
      kind: 'item',
      subject: { kind: 'current-target' },
      query: 'holding-item',
    })

    expect(evaluate(context, holdingItem)).toBe(true)
    expect(evaluate(context, holdingNothing)).toBe(false)
    expect(evaluate(context, targetHoldingItem)).toBe(true)

    // Natural Gift: stored Berry type and DB.
    expect(evaluate(context, itemExpression({
      query: 'move-type',
      source: 'digestion-buff',
      families: ['berry'],
      requirementId: null,
      timing: 'consumable',
    }))).toBe('fire')
    expect(evaluate(context, itemExpression({
      query: 'damage-base',
      source: 'digestion-buff',
      families: ['berry'],
      requirementId: null,
      timing: 'consumable',
    }))).toBe(6)

    // Fling: reviewed branch, DB/power, and typed effect.
    expect(evaluate(context, itemExpression({
      query: 'category',
      families: ['plate'],
      timing: 'activated',
    }))).toBe('fire-item')
    expect(evaluate(context, itemExpression({
      query: 'power',
      families: ['plate'],
      timing: 'activated',
    }))).toBe(3)
    expect(evaluate(context, itemExpression({
      query: 'effect',
      families: ['plate'],
      timing: 'activated',
    }))).toBe('fling.burn')

    // Judgment, Techno Blast, and Multi-Attack use progressively broader
    // reviewed family filters over the same type contribution.
    expect(evaluate(context, itemExpression({ query: 'move-type', families: ['plate'] }))).toBe('fire')
    expect(evaluate(context, itemExpression({ query: 'move-type', families: ['plate', 'drive'] }))).toBe('fire')
    expect(evaluate(context, itemExpression({
      query: 'move-type',
      families: ['plate', 'drive', 'memory'],
    }))).toBe('fire')

    expect(context.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'item-rule-actor-sheet', revision: 3 },
      { kind: 'pokemon', slug: 'item-rule-target-sheet', revision: 5 },
    ])
    expect(context.map).toEqual(beforeMap)
    expect(context.actor.sheet.sheet).toEqual(beforeActorSheet)
  })

  it('derives holding-nothing from physical state even when an item has no mechanics profile', () => {
    const unknownSheets = sheetsFixture('Unreviewed Campaign Relic')
    const unknownContext = contextFixture({ sheets: unknownSheets })
    expect(evaluate(unknownContext, parseMoveExpression({
      kind: 'item',
      subject: { kind: 'actor' },
      query: 'holding-nothing',
    }))).toBe(false)
    expect(unknownContext.queries.itemRules.resolve({
      placementId: actorId,
      query: 'eligible',
      source: 'equipped',
      families: ['other'],
      requirementId: actorRequirementId,
      timing: 'activated',
    }).value).toBe(false)

    const emptySheets = sheetsFixture('')
    const emptyContext = contextFixture({ sheets: emptySheets })
    expect(evaluate(emptyContext, parseMoveExpression({
      kind: 'item',
      subject: { kind: 'actor' },
      query: 'holding-nothing',
    }))).toBe(true)
  })

  it('suppresses static benefits under Magic Room without creating holding-nothing', () => {
    const context = contextFixture({ map: mapFixture({ magicRoom: true }) })

    expect(evaluate(context, itemExpression({
      query: 'move-type',
      families: ['plate'],
      timing: 'static',
    }))).toBeNull()
    expect(context.queries.itemRules.resolve({
      placementId: actorId,
      query: 'eligible',
      source: 'equipped',
      families: ['plate'],
      requirementId: actorRequirementId,
      timing: 'static',
    })).toMatchObject({
      value: false,
      physicalItemCount: 1,
      reasonCode: 'item-rule.suppressed',
      candidates: [{
        canonicalItemId: 'fire-type-plate',
        suppressed: true,
        suppression: {
          reasonCode: 'item-effect.magic-room-suppressed',
          sourceZoneId: expect.any(String),
        },
      }],
    })
    expect(evaluate(context, parseMoveExpression({
      kind: 'item',
      subject: { kind: 'actor' },
      query: 'holding-nothing',
    }))).toBe(false)
    // Magic Room explicitly exempts activated item use such as a Fling branch.
    expect(evaluate(context, itemExpression({
      query: 'power',
      families: ['plate'],
      timing: 'activated',
    }))).toBe(3)
    expect((context.actor.sheet.sheet as CharacterSheet).items?.held).toBe('Fire Type Plate')
  })

  it('suppresses Embargo use and benefits while retaining the equipped item', () => {
    const context = contextFixture({ map: mapFixture({ embargo: true }) })
    const before = structuredClone(context.actor.sheet.sheet)

    for (const expression of [
      itemExpression({ query: 'move-type', families: ['plate'], timing: 'static' }),
      itemExpression({ query: 'power', families: ['plate'], timing: 'activated' }),
    ]) {
      expect(evaluate(context, expression)).toBeNull()
    }
    expect(context.queries.itemRules.resolve({
      placementId: actorId,
      query: 'eligible',
      source: 'equipped',
      families: ['plate'],
      requirementId: actorRequirementId,
      timing: 'activated',
    })).toMatchObject({
      value: false,
      reasonCode: 'item-rule.suppressed',
      candidates: [{
        suppression: {
          reasonCode: 'item-effect.encounter-suppressed',
          sourceEffectIds: ['effect.item.embargo.actor'],
        },
      }],
    })
    expect(evaluate(context, parseMoveExpression({
      kind: 'item',
      subject: { kind: 'actor' },
      query: 'holding-item',
    }))).toBe(true)
    expect(context.actor.sheet.sheet).toEqual(before)
  })

  it('applies opaque item-binding suppression only to the addressed contribution', () => {
    const sheets = sheetsFixture('Fire Type Plate, Shock Drive')
    const baseMap = mapFixture()
    const resources = resolveAuthoritativeMoveItemResources({
      map: baseMap,
      actorPlacementId: actorId,
      selectedTargetPlacementIds: [],
      pokemonSheets: sheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      requirements: [{ id: actorRequirementId, source: { kind: 'actor-equipped' } }],
    })
    const plate = resources.candidates.find(candidate => (
      candidate.reference.canonicalItemId === 'fire-type-plate'
    ))!.reference
    const map: TabletopMap = {
      ...baseMap,
      encounterState: {
        ...baseMap.encounterState!,
        effects: [parseEncounterEffect({
          id: 'effect.item.corrosive-gas.plate',
          kind: 'item-suppression',
          source: {
            operationId: 'operation.corrosive-gas',
            moveId: 'move.corrosive-gas',
            placementId: targetId,
          },
          affected: { placementIds: [actorId], sideIds: [], cells: [] },
          createdRound: 1,
          createdTurn: 0,
          duration: { kind: 'scene', remaining: null },
          stacks: 1,
          charges: null,
          stackPolicy: { kind: 'independent-instance', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null },
          tags: ['item', 'item-suppression'],
          payload: {
            familyId: 'corrosive-gas.items',
            scope: 'item-bindings',
            itemBindingIds: [moveItemEffectBindingId(plate)],
            blocksUse: false,
            blocksBenefit: true,
          },
          dispel: { policy: 'matching-tags', tags: ['item-suppression'] },
          transferPolicy: 'expire',
          suppression: { sources: [] },
        })],
      },
    }
    const context = contextFixture({ map, sheets })

    expect(evaluate(context, itemExpression({
      query: 'move-type',
      families: ['plate'],
      timing: 'static',
    }))).toBeNull()
    expect(evaluate(context, itemExpression({
      query: 'move-type',
      families: ['drive'],
      timing: 'static',
    }))).toBe('electric')
    expect((context.actor.sheet.sheet as CharacterSheet).items?.held)
      .toBe('Fire Type Plate, Shock Drive')
  })

  it('preserves typed variant identities and rejects ambiguous scalar contributions', () => {
    const map = mapFixture()
    const sheets = sheetsFixture('Fire Type Plate, Shock Drive')
    const resources = resolveAuthoritativeMoveItemResources({
      map,
      actorPlacementId: actorId,
      selectedTargetPlacementIds: [],
      pokemonSheets: sheets,
      trainerSheets: new Map(),
      groupInventories: new Map(),
      requirements: [{ id: actorRequirementId, source: { kind: 'actor-equipped' } }],
    })
    expect(resources.candidates.map(candidate => candidate.reference.canonicalItemId)).toEqual([
      'fire-type-plate',
      'shock-drive',
    ])
    const context = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map(),
      intent: intent(),
      random: () => { throw new Error('item rule queries do not use RNG') },
      time: 1_000,
      itemResources: resources,
    })
    const before = structuredClone(sheets)

    expect(() => context.queries.itemRules.resolve({
      placementId: actorId,
      query: 'move-type',
      source: 'equipped',
      families: ['plate', 'drive'],
      requirementId: actorRequirementId,
      timing: 'static',
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationItemRuleError.name,
      code: 'ambiguous-item-value',
    }))
    expect(() => context.queries.itemRules.resolve({
      placementId: actorId,
      query: 'client-item-power',
      source: 'equipped',
      families: ['plate'],
      requirementId: actorRequirementId,
      timing: 'static',
    } as never)).toThrowError(expect.objectContaining({
      name: MoveAutomationItemRuleError.name,
      code: 'invalid-query',
    }))
    expect(sheets).toEqual(before)
  })
})
