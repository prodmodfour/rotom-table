import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const sheet = (slug: string, species: string, conditions: string[], ability = false): CharacterSheet => ({
  slug, nickname: slug, species, level: 20, revision: 3, types: ['Normal'],
  abilities: ability ? [{
    name: 'Bad Dreams',
    automation: {
      schemaVersion: 1, instanceId: 'base:actor:bad-dreams', canonicalId: 'Bad Dreams',
      definitionVersion: null, selections: [],
    },
  }] : [],
  stats: { hp: { added: 20 }, def: { added: 10 }, sdef: { added: 10 } },
  combat: { currentHp: 60, conditions },
})
const battleMap = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa061-bad-dreams', name: 'Bad Dreams', revision: 5,
    dimensions: { x: 12, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 } },
      { id: 'sleeping', sheetKind: 'pokemon', sheetSlug: 'sleeping-sheet', position: { x: 3, y: 0, z: 1 } },
      { id: 'awake', sheetKind: 'pokemon', sheetSlug: 'awake-sheet', position: { x: 4, y: 0, z: 1 } },
      { id: 'far', sheetKind: 'pokemon', sheetSlug: 'far-sheet', position: { x: 10, y: 0, z: 1 } },
    ],
    encounterState: {
      ...encounter,
      history: { ...encounter.history, sceneId: 'scene:bad-dreams' },
      turnResources: { actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1 }) },
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Dream Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('AA-061 Bad Dreams', () => {
  it('aa061.bad-dreams.sleeping-area loses one tick in range and grants one temporary tick on any loss', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    mapRepository.saveSetupMap(battleMap())
    const sheets = [
      sheet('actor-sheet', 'Darkrai', [], true),
      sheet('sleeping-sheet', 'Snorlax', ['Sleep']),
      sheet('awake-sheet', 'Pikachu', []),
      sheet('far-sheet', 'Snorlax', ['Sleep']),
    ]
    for (const current of sheets) sheetRepository.saveSetupSheet('pokemon', current.slug, current as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
      schemaVersion: 1, requestId: 'request:bad-dreams', mapSlug: 'aa061-bad-dreams', baseRevision: 5,
      actorPlacementId: 'actor', abilityInstanceId: 'base:actor:bad-dreams', canonicalId: 'Bad Dreams', modeId: 'activate',
    } }, dependencies)
    const result = resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1, intentId: 'intent:bad-dreams', offerId: offer.offerId, offerSha256: offer.offerSha256,
      mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
      abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
      selections: [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }],
    } }, dependencies)
    expect(result).toMatchObject({ kind: 'accepted', status: 'committed' })
    const persistedSleeping = sheetRepository.get('pokemon', 'sleeping-sheet')!.document as unknown as CharacterSheet
    const persistedAwake = sheetRepository.get('pokemon', 'awake-sheet')!.document as unknown as CharacterSheet
    const persistedFar = sheetRepository.get('pokemon', 'far-sheet')!.document as unknown as CharacterSheet
    expect(persistedSleeping.combat?.currentHp).toBeLessThan(60)
    expect(persistedAwake.combat?.currentHp).toBe(60)
    expect(persistedFar.combat?.currentHp).toBe(60)
    const persistedMap = mapRepository.getBySlug('aa061-bad-dreams')!
    expect(persistedMap.temporaryHitPoints?.byPlacementId.actor).toBeGreaterThan(0)
    expect(persistedMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
  }, 20_000)
})
