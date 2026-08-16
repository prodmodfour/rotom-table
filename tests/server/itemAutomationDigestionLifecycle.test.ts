import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterCapabilityEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { planInitiativeLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import {
  ITEM_DIGESTION_EFFECT_TAG,
  ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX,
  ITEM_DIGESTION_TURN_HEAL_REASON,
} from '../../server/domain/itemAutomation/digestionBuffTrade'

const sheet = (slug: string, currentHp: number): CharacterSheet => ({
  slug, nickname: slug, species: 'Snorlax', level: 20, revision: slug === 'target' ? 5 : 3,
  stats: { hp: { added: 53 } }, combat: { currentHp, injuries: 0, conditions: [] },
})

const effect = (): EncounterCapabilityEffect => ({
  id: 'effect.item.leftovers.turn-heal', kind: 'capability',
  source: { operationId: 'op_digest_leftovers_01', moveId: 'item:leftovers', placementId: 'target' },
  affected: { placementIds: ['target'], sideIds: [], cells: [] },
  createdRound: 1, createdTurn: 0,
  duration: { kind: 'encounter', remaining: null }, stacks: 1, charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
  tags: [ITEM_DIGESTION_EFFECT_TAG, 'item-digestion-source:0123456789abcdef0123456789abcdef'],
  payload: { capabilityId: `${ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX}16`, action: 'grant', value: 1 },
  dispel: { policy: 'matching-tags', tags: [ITEM_DIGESTION_EFFECT_TAG] },
  transferPolicy: 'expire', suppression: { sources: [] },
})

const mapFixture = (activeEffect = effect()): TabletopMap => ({
  schemaVersion: 2, slug: 'digestion-lifecycle-arena', name: 'Digestion Lifecycle Arena', revision: 8,
  dimensions: { x: 6, y: 3, z: 6 }, voxels: [],
  placements: [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 } },
  ],
  initiative: { activeId: 'actor', round: 1 },
  encounterState: { ...createEmptyEncounterState(), effects: [activeEffect] },
})

const plan = (activeEffect = effect()) => {
  const map = mapFixture(activeEffect)
  const actor = sheet('actor', 100)
  const target = sheet('target', 50)
  return planInitiativeLifecycle({
    map,
    previous: { activeId: 'actor', round: 1 },
    current: { activeId: 'target', round: 1 },
    orderIds: ['actor', 'target'], operationId: 'op_digestion_turn_01', time: 1_000,
    loadSheets: () => ({
      pokemonSheets: new Map([['actor', actor], ['target', target]]),
      trainerSheets: new Map<string, TrainerSheet>(),
    }),
  })
}

describe('Digestion Buff encounter lifecycle', () => {
  it('heals the authoritative turn actor by the reviewed fraction and retains encounter duration', () => {
    const result = plan()
    const write = result.sheetWrites.find(candidate => candidate.slug === 'target')!
    const previousHp = (write.previousSheet as CharacterSheet).combat?.currentHp ?? 0
    const nextHp = (write.nextSheet as CharacterSheet).combat?.currentHp ?? 0
    expect(nextHp - previousHp).toBe(Math.floor(pokemonHpSnapshot(write.previousSheet as CharacterSheet).fullMaxHp / 16))
    expect(write.changedFields).toContain('hp')
    expect(result.reduction.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heal', reasonCode: ITEM_DIGESTION_TURN_HEAL_REASON }),
    ]))
    expect(result.currentEncounterState.effects).toContainEqual(expect.objectContaining({
      id: 'effect.item.leftovers.turn-heal', duration: { kind: 'encounter', remaining: null },
    }))
  })

  it('does not heal while the exact effect is suppressed', () => {
    const suppressed = effect()
    suppressed.suppression = { sources: [{ effectId: 'effect.test.suppression', reasonCode: 'test' }] }
    const suppressionSource: EncounterCapabilityEffect = {
      ...effect(), id: 'effect.test.suppression', tags: ['test-suppression'],
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      payload: { capabilityId: 'test-suppression', action: 'grant' },
      suppression: { sources: [] },
    }
    const map = mapFixture(suppressed)
    map.encounterState = { ...map.encounterState!, effects: [suppressed, suppressionSource] }
    const actor = sheet('actor', 100)
    const target = sheet('target', 50)
    const result = planInitiativeLifecycle({
      map, previous: { activeId: 'actor', round: 1 }, current: { activeId: 'target', round: 1 },
      orderIds: ['actor', 'target'], operationId: 'op_digestion_turn_suppressed', time: 1_000,
      loadSheets: () => ({ pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map() }),
    })
    expect(result.reduction.operations.some(operation => operation.reasonCode === ITEM_DIGESTION_TURN_HEAL_REASON)).toBe(false)
    expect(result.sheetWrites).toEqual([])
  })
})
