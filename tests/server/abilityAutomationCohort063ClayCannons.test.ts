import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const actor = (): CharacterSheet => ({
  slug: 'actor', nickname: 'Actor', species: 'Eevee', level: 20, revision: 3, types: ['Water'],
  abilities: [{ name: 'Clay Cannons', automation: { schemaVersion: 1, instanceId: 'base:clay-cannons', canonicalId: 'Clay Cannons', definitionVersion: null, selections: [] } }],
  movelist: [{ name: 'Water Gun' }, { name: 'Karate Chop' }],
  stats: { hp: { added: 25 }, atk: { added: 20 }, def: { added: 10 }, satk: { added: 30 }, sdef: { added: 10 }, spd: { added: 10 } },
  combat: { currentHp: 100, conditions: [] },
})
const target = (): CharacterSheet => ({
  slug: 'target', nickname: 'Target', species: 'Eevee', level: 20, revision: 2, types: ['Normal'], abilities: [], movelist: [],
  stats: { hp: { added: 25 }, atk: { added: 10 }, def: { added: 10 }, satk: { added: 10 }, sdef: { added: 10 }, spd: { added: 10 } },
  combat: { currentHp: 100, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 7, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug: 'aa063-clay-cannons', name: 'Clay Cannons', revision: 5,
    dimensions: { x: 10, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: 'scene:aa063-clay-cannons' },
      turnResources: Object.fromEntries(placements.map(placement => [placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 })])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('AA-063 Clay Cannons', () => {
  it('aa063.clay-cannons.reviewed enables a bounded per-move virtual origin for Ranged Moves only', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    mapRepository.saveSetupMap(map())
    sheetRepository.saveSetupSheet('pokemon', 'actor', actor() as unknown as Record<string, unknown>)
    sheetRepository.saveSetupSheet('pokemon', 'target', target() as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
      schemaVersion: 1, requestId: 'request:clay-cannons', mapSlug: 'aa063-clay-cannons', baseRevision: 5,
      actorPlacementId: 'actor', abilityInstanceId: 'base:clay-cannons', canonicalId: 'Clay Cannons', modeId: 'activate',
    } }, dependencies)
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1, intentId: 'intent:clay-cannons', offerId: offer.offerId, offerSha256: offer.offerSha256,
      mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: 'actor', abilityInstanceId: 'base:clay-cannons',
      canonicalId: 'Clay Cannons', modeId: 'activate', selections: [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }],
    } }, dependencies)
    const activeMap = mapRepository.getBySlug('aa063-clay-cannons')!
    expect(activeMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability', duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      payload: { capabilityId: 'aa063.clay-cannons.virtual-origin', action: 'grant' },
    }))
    expect(activeMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    const sheets = new Map<string, CharacterSheet>([
      ['actor', sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet],
      ['target', sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet],
    ])
    expect(() => planAuthoritativeMoveState({
      map: activeMap, pokemonSheets: sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Water Gun', originCell: { x: 3, y: 0, z: 1 }, selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.5, now: () => 2_000, operationId: 'op_clay_cannons_water_gun',
    })).not.toThrow()
    expect(() => planAuthoritativeMoveState({
      map: activeMap, pokemonSheets: sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Karate Chop', originCell: { x: 3, y: 0, z: 1 }, selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.5, now: () => 2_000, operationId: 'op_clay_cannons_melee',
    })).toThrow(/Ranged Moves/)
    expect(() => planAuthoritativeMoveState({
      map: activeMap, pokemonSheets: sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Water Gun', originCell: { x: 5, y: 0, z: 1 }, selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.5, now: () => 2_000, operationId: 'op_clay_cannons_out_of_range',
    })).toThrow(/not authorized/)
  }, 20_000)
})
