import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { MoveItemMutation } from '../../server/domain/moveAutomation/itemMutationTypes'
import { planMoveItemMutations } from '../../server/domain/moveAutomation/planItemMutations'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: 'base:honey-paws',
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const actorSheet = (input: {
  held: string
  ability?: boolean
  digestionFood?: string
  digestionFoods?: readonly string[]
  revision?: number
}): CharacterSheet => ({
  slug: 'actor',
  nickname: 'actor',
  species: 'Teddiursa',
  level: 20,
  revision: input.revision ?? 3,
  abilities: input.ability ? [ability('Honey Paws')] : [],
  items: {
    held: input.held,
    ...(input.digestionFood ? { digestionFood: input.digestionFood } : {}),
    ...(input.digestionFoods ? { digestionFoods: [...input.digestionFoods] } : {}),
  },
})
const mapFixture = (input: { readonly suppressed?: boolean; readonly prepared?: boolean } = {}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const suppression = creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  })
  return {
    schemaVersion: 2,
    slug: input.suppressed ? 'aa074-honey-paws-suppressed' : 'aa074-honey-paws',
    name: 'Honey Paws',
    revision: 5,
    dimensions: { x: 8, y: 2, z: 8 },
    voxels: [],
    hazards: [],
    placements: [{
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor',
      sideId: 'heroes', position: { x: 1, y: 0, z: 1 },
    }],
    encounterState: {
      ...encounter,
      effects: [
        ...(input.suppressed ? [{
          ...suppression,
          id: 'effect.aa074.honey-paws.suppressed',
          affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        }] : []),
        ...(input.prepared ? [{
          id: 'effect.aa074.honey-paws.prepared',
          kind: 'capability' as const,
          source: {
            operationId: 'op_honey_paws_prepared',
            moveId: 'ability.honey-paws',
            placementId: 'actor',
          },
          affected: { placementIds: ['actor'], sideIds: [], cells: [] },
          createdRound: 1, createdTurn: 1,
          duration: { kind: 'scene' as const, remaining: null },
          stacks: 1, charges: 1,
          stackPolicy: { kind: 'replace' as const, maxStacks: null },
          chargePolicy: { kind: 'consume-on-trigger' as const, amount: 1 },
          tags: ['ability', 'aa074', 'honey-paws', 'prepared'],
          payload: {
            capabilityId: 'aa074.honey-paws.prepared:base:honey-paws',
            action: 'grant' as const,
          },
          dispel: { policy: 'matching-tags' as const, tags: ['honey-paws', 'prepared'] },
          transferPolicy: 'expire' as const,
          suppression: { sources: [] },
        }] : []),
      ],
      history: { ...encounter.history, sceneId: 'scene:aa074-honey-paws' },
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' } },
    },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const owner = (revision: number) => ({
  kind: 'sheet' as const,
  sheetKind: 'pokemon' as const,
  slug: 'actor',
  revision,
})
const storeOperation = (revision: number): MoveItemMutation => ({
  id: 'ability.honey-paws.store',
  kind: 'store-digestion-buff',
  reasonCode: 'ability.honey-paws.consume-honey',
  source: {
    schemaVersion: 1,
    kind: 'pokemon-held',
    itemId: 'held:1',
    canonicalItemId: 'honey',
    owner: owner(revision),
    quantity: 1,
    stack: 'singleton',
    equip: 'pokemon-held',
  },
  destination: { kind: 'digestion-buff', owner: owner(revision) },
  quantity: 1,
  consumptionId: 'consumption.honey-paws.honey',
})

describe('AA-074 item integrations', () => {
  it('aa074.honey-paws.reviewed stores Honey as a separate Leftovers-equivalent buff', () => {
    const map = mapFixture({ prepared: true })
    const initial = actorSheet({
      held: 'Honey', ability: true,
      digestionFoods: ['Candy Bar', 'Oran Berry', 'Cheri Berry'],
    })
    const stored = planMoveItemMutations({
      map,
      pokemonSheets: new Map([['actor', initial]]),
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: [storeOperation(initial.revision!)],
      consumedItems: [],
      originOperationId: 'op_aa074_honey_paws_store',
      plannedAt: 1_000,
    })
    const next = stored.sheetWrites[0]!.nextSheet as CharacterSheet
    expect(next.items).toMatchObject({
      digestionFoods: ['Candy Bar', 'Oran Berry', 'Cheri Berry'],
      honeyPawsFood: 'Leftovers',
    })
    expect(next.items?.held).toBeUndefined()
    expect(stored.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId.startsWith('aa074.honey-paws.prepared:')
    ))).toBe(false)
    expect(stored.operationResults[0]).toMatchObject({
      kind: 'store-digestion-buff',
      quantityEffects: [{ canonicalItemId: 'honey', delta: -1 }],
    })

    const digested = planMoveItemMutations({
      map: stored.nextMap,
      pokemonSheets: new Map([['actor', next]]),
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: [{
        id: 'ability.honey-paws.digest',
        kind: 'digest-buff',
        reasonCode: 'ability.honey-paws.trade-leftovers',
        owner: owner(next.revision!),
        canonicalItemIds: ['leftovers'],
        storageSlot: 4,
        sourceMoveId: 'ability.honey-paws',
        sourcePlacementId: 'actor',
      }],
      consumedItems: stored.consumedItems,
      originOperationId: 'op_aa074_honey_paws_digest',
      plannedAt: 2_000,
    })
    const afterDigest = digested.sheetWrites[0]!.nextSheet as CharacterSheet
    expect(afterDigest.items?.digestionFoods).toEqual(['Candy Bar', 'Oran Berry', 'Cheri Berry'])
    expect(afterDigest.items?.honeyPawsFood).toBeUndefined()
    expect(digested.operationResults[0]).toMatchObject({
      kind: 'digest-buff',
      quantityEffects: [{ canonicalItemId: 'leftovers', delta: 0 }],
    })
  })

  it('aa074.honey-paws.reviewed revalidates effective ability authority at the item mutation boundary', () => {
    const map = mapFixture({ suppressed: true, prepared: true })
    const initial = actorSheet({ held: 'Honey', ability: true })
    const stored = planMoveItemMutations({
      map,
      pokemonSheets: new Map([['actor', initial]]),
      trainerSheets: new Map(),
      groupInventories: new Map(),
      operations: [storeOperation(initial.revision!)],
      consumedItems: [],
      originOperationId: 'op_aa074_honey_paws_suppressed',
      plannedAt: 1_000,
    })
    const next = stored.sheetWrites[0]!.nextSheet as CharacterSheet
    expect(next.items?.digestionFood).toBe('Honey')
    expect(next.items?.honeyPawsFood).toBeUndefined()
    expect(stored.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId.startsWith('aa074.honey-paws.prepared:')
    ))).toBe(true)
  })
})
