import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION } from '#shared/livePlayMoveResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { ITEM_DIGESTION_EFFECT_TAG } from '../../server/domain/itemAutomation/digestionBuffTrade'

const pokemon = (slug: string, digestionFood?: string): CharacterSheet => ({
  slug, nickname: slug, species: slug === 'actor' ? 'Snorlax' : 'Pikachu', level: 20, revision: 3,
  movelist: slug === 'actor' ? [{ name: 'Bug Bite' }] : [],
  stats: { hp: { added: 25 }, atk: { added: 20 }, def: { added: 10 }, satk: { added: 10 }, sdef: { added: 10 }, spd: { added: 10 } },
  combat: { currentHp: slug === 'actor' ? 50 : 100, conditions: [], injuries: 0 },
  ...(digestionFood ? { items: { digestionFood } } : {}),
})

const fixture = (digestionFood: string) => {
  const actor = pokemon('actor', digestionFood)
  const target = pokemon('target')
  const map: TabletopMap = {
    schemaVersion: 2, slug: `digestion-trade-${digestionFood.toLowerCase().replaceAll(' ', '-')}`,
    name: 'Digestion Trade', revision: 7, dimensions: { x: 6, y: 3, z: 5 }, groundLevelY: 0,
    playerVisible: true, voxels: [], hazards: [], lights: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor-token', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 } },
      { id: 'target-token', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 } },
    ],
    initiative: { activeId: 'actor-token', round: 1 }, activeScene: { name: 'Snack Scene', startedAt: 1 },
    encounterState: createEmptyEncounterState(), createdAt: 1, updatedAt: 1,
  }
  return { actor, target, map }
}

const plan = (digestionFood: string) => {
  const state = fixture(digestionFood)
  const draws = [0.95, 0, 0, 0, 0, 0]
  const result = planAuthoritativeMoveState({
    map: state.map,
    pokemonSheets: new Map([['actor', state.actor], ['target', state.target]]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token', moveName: 'Bug Bite',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    },
    random: () => draws.shift() ?? 0,
    now: () => 5_000,
    operationId: `op_digest_${digestionFood.toLowerCase().replaceAll(' ', '_')}`,
  })
  return { state, result }
}

describe('Snack trade integration', () => {
  it('atomically clears Candy Bar and restores the fixed 5 HP through the move plan', () => {
    const { state, result } = plan('Candy Bar')
    const actorWrite = result.sheetWrites.find(write => write.slug === 'actor')!
    const previous = actorWrite.previousSheet as CharacterSheet
    const next = actorWrite.nextSheet as CharacterSheet
    expect(next.items?.digestionFood).toBeUndefined()
    expect(pokemonHpSnapshot(next).currentHp - pokemonHpSnapshot(previous).currentHp).toBe(5)
    expect(state.actor.items?.digestionFood).toBe('Candy Bar')
    expect(JSON.stringify(result.resolution.auditTrace)).toContain('item.digestion-buff.trade-heal')
  })

  it('atomically clears reviewed Black Sludge and stores its 1/8-Max-HP turn-start source', () => {
    const { result } = plan('Black Sludge')
    const actorWrite = result.sheetWrites.find(write => write.slug === 'actor')!
    expect((actorWrite.nextSheet as CharacterSheet).items?.digestionFood).toBeUndefined()
    expect(result.nextMap.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability', duration: { kind: 'encounter', remaining: null },
        payload: { capabilityId: 'item-digestion-turn-heal:8', action: 'grant', value: 1 },
        affected: expect.objectContaining({ placementIds: ['actor-token'] }),
        tags: expect.arrayContaining([ITEM_DIGESTION_EFFECT_TAG]),
      }),
    ]))
  })

  it('atomically clears Leftovers and stores one encounter-duration healing source', () => {
    const { result } = plan('Leftovers')
    const actorWrite = result.sheetWrites.find(write => write.slug === 'actor')!
    expect((actorWrite.nextSheet as CharacterSheet).items?.digestionFood).toBeUndefined()
    expect(result.nextMap.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability', duration: { kind: 'encounter', remaining: null },
        affected: expect.objectContaining({ placementIds: ['actor-token'] }),
        tags: expect.arrayContaining([ITEM_DIGESTION_EFFECT_TAG]),
      }),
    ]))
  })
})
