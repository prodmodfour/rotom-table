import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { assertAa060AnchoredDestination } from '../../server/domain/abilityAutomation/mechanics/aa060'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const actorSheet = (): CharacterSheet => ({
  slug: 'actor-sheet', nickname: 'Anchor', species: 'Dhelmise', level: 30, revision: 3,
  types: ['Ghost', 'Grass'],
  stats: { hp: { added: 20 }, atk: { added: 20 }, satk: { added: 40 }, def: { added: 10 }, sdef: { added: 10 } },
  abilities: [{
    name: 'Anchored',
    automation: {
      schemaVersion: 1, instanceId: 'base:actor:anchored', canonicalId: 'Anchored',
      definitionVersion: null, selections: [],
    },
  }],
  movelist: [{ name: 'Ember', type: 'Fire', category: 'Special', db: 4, ac: 2, range: '4, 1 Target' }],
  combat: { currentHp: 80, conditions: [] },
})
const targetSheet = (): CharacterSheet => ({
  slug: 'target-sheet', nickname: 'Target', species: 'Snorlax', level: 30, revision: 3,
  types: ['Normal'],
  stats: { hp: { added: 20 }, def: { added: 20 }, sdef: { added: 20 } },
  combat: { currentHp: 120, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa060-anchored', name: 'Anchored', revision: 5,
    dimensions: { x: 10, y: 6, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 2, y: 0, z: 3 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 6, y: 0, z: 3 } },
    ],
    encounterState: {
      ...encounter,
      history: { ...encounter.history, sceneId: 'scene:anchored' },
      turnResources: { actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1 }) },
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const activate = (withMove: boolean) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const actor = actorSheet()
  const target = targetSheet()
  mapRepository.saveSetupMap(map())
  sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', actor as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target-sheet', target as unknown as Record<string, unknown>)
  const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
  const command = {
    schemaVersion: 1, requestId: `request:anchored:${withMove}`, mapSlug: 'aa060-anchored', baseRevision: 5,
    actorPlacementId: 'actor', abilityInstanceId: 'base:actor:anchored', canonicalId: 'Anchored', modeId: 'shift-anchor',
  }
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command }, dependencies)
  const cell = offer.declarations.find(entry => entry.declarationId === 'shift-anchor.cell')!
    .options.find(option => option.hint.kind === 'cell' && option.hint.x === 5 && option.hint.z === 3)!
  const move = offer.declarations.find(entry => entry.declarationId === 'shift-anchor.move')?.options[0]
  const selections: Array<{ declarationId: string; kind: 'cell' | 'move'; optionIds: string[] }> = [
    { declarationId: 'shift-anchor.cell', kind: 'cell', optionIds: [cell.optionId] },
    { declarationId: 'shift-anchor.move', kind: 'move', optionIds: withMove && move ? [move.optionId] : [] },
  ]
  const intent = {
    schemaVersion: 1, intentId: `intent:anchored:${withMove}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
    selections,
  }
  const accepted = resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)
  return { actor, target, mapRepository, accepted }
}

describe('AA-060 Anchored durable entity and attack continuation', () => {
  it('aa060.anchored.entity-shift-attack shifts a sheetless anchor and resolves the selected move from it', () => {
    const harness = activate(true)
    const shifted = harness.mapRepository.getBySlug('aa060-anchored')!
    expect(shifted.placements.find(placement => placement.id === 'actor')?.position).toEqual({ x: 2, y: 0, z: 3 })
    expect(shifted.encounterState?.abilityEntities?.entries).toContainEqual(expect.objectContaining({
      entityId: 'base:actor:anchored:anchor', kind: 'anchor', position: { x: 5, y: 0, z: 3 },
      occupancy: 'non-blocking', targetability: 'untargetable',
    }))
    expect(shifted.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Anchored', payload: expect.objectContaining({ kind: 'mark' }),
    }))
    expect(shifted.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)

    const draws = [0.5, 0, 0, 0, 0, 0, 0]
    const plan = planAuthoritativeMoveState({
      map: shifted,
      pokemonSheets: new Map([['actor-sheet', harness.actor], ['target-sheet', harness.target]]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Ember', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => draws.shift() ?? 0,
      now: () => 2_000,
      operationId: 'op_anchored_attack',
    })
    expect(plan.resolution.script).toMatchObject({ range: 'Melee, 1 Target', damageClass: 'Physical' })
    expect(plan.resolution.rollLedger).toContainEqual(expect.objectContaining({
      reason: 'ability.anchored.damage-bonus', formula: { kind: 'dice', count: 2, sides: 6, modifier: 0 },
    }))
    expect(plan.resolution.transaction.hitTargetIds).toEqual(['target'])
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Anchored' && entry.payload.kind === 'mark')).toBe(false)
  }, 15_000)

  it('supports shifting without an attack and rejects movement beyond the durable anchor radius', () => {
    const harness = activate(false)
    const shifted = harness.mapRepository.getBySlug('aa060-anchored')!
    expect(shifted.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Anchored' && entry.payload.kind === 'mark')).toBe(false)
    expect(() => assertAa060AnchoredDestination({
      map: shifted,
      placementId: 'actor',
      destination: { x: 9, y: 0, z: 3 },
    })).toThrow(/limits movement to 3 meters/i)
    expect(() => planAuthoritativeMoveState({
      map: shifted,
      pokemonSheets: new Map([['actor-sheet', harness.actor], ['target-sheet', harness.target]]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Ember', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0,
      now: () => 2_000,
      operationId: 'op_anchored_unmarked_range',
    })).not.toThrow()
  }, 15_000)
})
