import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const actorSheet = (type = 'Fire'): CharacterSheet => ({
  slug: 'actor-sheet', nickname: 'Actor', species: 'Charmander', level: 20, revision: 3,
  types: [type], stats: { satk: { added: 20 }, spd: { added: 10 } },
  abilities: [{
    name: 'Accelerate',
    automation: { schemaVersion: 1, instanceId: 'base:actor:0', canonicalId: 'Accelerate', definitionVersion: null, selections: [] },
  }],
  movelist: [{ name: 'Ember', type: 'Fire', category: 'Special', db: 4, ac: 2, range: '4, 1 Target' }],
  combat: { currentHp: 60, conditions: [] },
})
const targetSheet = (): CharacterSheet => ({
  slug: 'target-sheet', nickname: 'Target', species: 'Snorlax', level: 20, revision: 3,
  types: ['Normal'], combat: { currentHp: 100, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa060-accelerate', name: 'Accelerate', revision: 5,
    dimensions: { x: 6, y: 2, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 2, y: 0, z: 1 } },
    ],
    encounterState: { ...encounter, history: { ...encounter.history, sceneId: 'scene:accelerate' } },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const command = (requestId: string) => ({
  schemaVersion: 1, requestId, mapSlug: 'aa060-accelerate', baseRevision: 5,
  actorPlacementId: 'actor', abilityInstanceId: 'base:actor:0', canonicalId: 'Accelerate', modeId: 'activate',
})
const targetHp = (plan: ReturnType<typeof planAuthoritativeMoveState>): number => (
  (plan.sheetWrites.find(write => write.slug === 'target-sheet')?.nextSheet as CharacterSheet | undefined)?.combat?.currentHp ?? 100
)
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('AA-060 Accelerate continuation', () => {
  it('aa060.accelerate.activation-and-move spends, grants Priority/damage, consumes, and replays exactly', () => {
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
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: command('request:accelerate') }, dependencies)
    const intent = {
      schemaVersion: 1, intentId: 'intent:accelerate', offerId: offer.offerId, offerSha256: offer.offerSha256,
      mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
      abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
      selections: [{ declarationId: 'activate.move', kind: 'move', optionIds: [offer.declarations[0]!.options[0]!.optionId] }],
    }
    const accepted = resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)
    expect(resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)).toEqual(accepted)
    const activated = mapRepository.getBySlug('aa060-accelerate')!
    expect(activated.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ spent: 1, limit: 2 }))
    expect(activated.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)

    const baseMap: TabletopMap = {
      ...structuredClone(activated),
      encounterState: {
        ...structuredClone(activated.encounterState!),
        abilityOwnedState: { schemaVersion: 1, entries: [], receipts: [] },
      },
    }
    const sheets = new Map([['actor-sheet', actor], ['target-sheet', target]])
    const run = (inputMap: TabletopMap) => {
      const draws = [0.5, 0, 0, 0]
      return planAuthoritativeMoveState({
        map: inputMap, pokemonSheets: sheets, trainerSheets: new Map(),
        intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Ember', selection: { kind: 'single-target', targetPlacementId: 'target' } },
        random: () => draws.shift() ?? 0, now: () => 2_000,
        operationId: `op_accelerate_${inputMap.encounterState?.abilityOwnedState?.entries.length ? 'active' : 'base'}`,
      })
    }
    const base = run(baseMap)
    const accelerated = run(activated)
    expect(accelerated.resolution.abilityPriorityOverride).toBe(true)
    expect(targetHp(accelerated)).toBeLessThan(targetHp(base))
    expect(accelerated.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Accelerate')).toBe(false)
  }, 15_000)

  it('rejects a damaging move that does not receive STAB without committing', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    mapRepository.saveSetupMap(map())
    sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', actorSheet('Water') as unknown as Record<string, unknown>)
    sheetRepository.saveSetupSheet('pokemon', 'target-sheet', targetSheet() as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: command('request:accelerate:invalid') }, dependencies)
    expect(() => resolveAbilityDeclarationUseCase({
      role: 'gm',
      intent: {
        schemaVersion: 1, intentId: 'intent:accelerate:invalid', offerId: offer.offerId,
        offerSha256: offer.offerSha256, mapSlug: offer.mapSlug, baseRevision: offer.mapRevision,
        actorPlacementId: offer.actorPlacementId, abilityInstanceId: offer.abilityInstanceId,
        canonicalId: offer.canonicalId, modeId: offer.modeId,
        selections: [{ declarationId: 'activate.move', kind: 'move', optionIds: [offer.declarations[0]!.options[0]!.optionId] }],
      },
    }, dependencies)).toThrow(/receives STAB/)
    expect(mapRepository.getBySlug('aa060-accelerate')?.revision).toBe(5)
  })
})
