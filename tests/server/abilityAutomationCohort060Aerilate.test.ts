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

const actorSheet = (move: 'Tackle' | 'Ember' = 'Tackle'): CharacterSheet => ({
  slug: 'actor-sheet', nickname: 'Actor', species: 'Eevee', level: 20, revision: 3,
  types: ['Normal'],
  abilities: [{
    name: 'Aerilate',
    automation: {
      schemaVersion: 1, instanceId: 'base:actor:0', canonicalId: 'Aerilate',
      definitionVersion: null, selections: [],
    },
  }],
  stats: { atk: { added: 30 } },
  movelist: move === 'Tackle'
    ? [{ name: 'Tackle', type: 'Normal', category: 'Physical', db: 5, ac: 2, range: 'Melee, 1 Target' }]
    : [{ name: 'Ember', type: 'Fire', category: 'Special', db: 4, ac: 2, range: '4, 1 Target' }],
  combat: { currentHp: 60, conditions: [] },
})
const targetSheet = (): CharacterSheet => ({
  slug: 'target-sheet', nickname: 'Target', species: 'Bulbasaur', level: 20, revision: 3,
  types: ['Grass'], combat: { currentHp: 100, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa060-aerilate', name: 'Aerilate', revision: 5,
    dimensions: { x: 5, y: 2, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 2, y: 0, z: 1 } },
    ],
    encounterState: { ...encounter, history: { ...encounter.history, sceneId: 'scene:aerilate' } },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const command = (requestId: string) => ({
  schemaVersion: 1, requestId, mapSlug: 'aa060-aerilate', baseRevision: 5,
  actorPlacementId: 'actor', abilityInstanceId: 'base:actor:0', canonicalId: 'Aerilate', modeId: 'activate',
})
const targetHp = (plan: ReturnType<typeof planAuthoritativeMoveState>): number => (
  (plan.sheetWrites.find(write => write.slug === 'target-sheet')?.nextSheet as CharacterSheet | undefined)?.combat?.currentHp ?? 100
)
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('AA-060 Aerilate declaration and move conversion', () => {
  it('aa060.aerilate.declare-and-convert validates, converts before STAB/effectiveness, consumes, and retries', () => {
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
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: command('request:aerilate') }, dependencies)
    const option = offer.declarations[0]!.options[0]!
    const intent = {
      schemaVersion: 1, intentId: 'intent:aerilate', offerId: offer.offerId, offerSha256: offer.offerSha256,
      mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
      abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
      selections: [{ declarationId: 'activate.move', kind: 'move', optionIds: [option.optionId] }],
    }
    const accepted = resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)
    expect(accepted).toMatchObject({ kind: 'accepted', previousRevision: 5, revision: 6 })
    expect(resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)).toEqual(accepted)
    const activatedMap = mapRepository.getBySlug('aa060-aerilate')!
    expect(activatedMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(activatedMap.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Aerilate', payload: expect.objectContaining({ markId: expect.stringContaining('aa060.aerilate.next-move:') }),
    }))

    const sheets = new Map([['actor-sheet', actor], ['target-sheet', target]])
    const run = (inputMap: TabletopMap) => {
      const draws = [0.5, 0, 0, 0]
      return planAuthoritativeMoveState({
        map: inputMap, pokemonSheets: sheets, trainerSheets: new Map(),
        intent: {
          schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
          selection: { kind: 'single-target', targetPlacementId: 'target' },
        },
        random: () => draws.shift() ?? 0,
        now: () => 2_000,
        operationId: `op_aerilate_${inputMap.encounterState?.abilityOwnedState?.entries.length ? 'active' : 'base'}`,
      })
    }
    const baseMap: TabletopMap = {
      ...structuredClone(activatedMap),
      encounterState: {
        ...structuredClone(activatedMap.encounterState!),
        abilityOwnedState: { schemaVersion: 1, entries: [], receipts: [] },
      },
    }
    const base = run(baseMap)
    const converted = run(activatedMap)
    expect(converted.resolution.script.type).toBe('Flying')
    expect(targetHp(converted)).toBeLessThan(targetHp(base))
    expect(converted.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Aerilate')).toBe(false)
  }, 15_000)

  it('rejects a non-Normal move before committing action state', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    mapRepository.saveSetupMap(map())
    sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', actorSheet('Ember') as unknown as Record<string, unknown>)
    sheetRepository.saveSetupSheet('pokemon', 'target-sheet', targetSheet() as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: command('request:aerilate:invalid') }, dependencies)
    expect(() => resolveAbilityDeclarationUseCase({
      role: 'gm',
      intent: {
        schemaVersion: 1, intentId: 'intent:aerilate:invalid', offerId: offer.offerId,
        offerSha256: offer.offerSha256, mapSlug: offer.mapSlug, baseRevision: offer.mapRevision,
        actorPlacementId: offer.actorPlacementId, abilityInstanceId: offer.abilityInstanceId,
        canonicalId: offer.canonicalId, modeId: offer.modeId,
        selections: [{ declarationId: 'activate.move', kind: 'move', optionIds: [offer.declarations[0]!.options[0]!.optionId] }],
      },
    }, dependencies)).toThrow(/Normal-Type damaging move/)
    expect(mapRepository.getBySlug('aa060-aerilate')?.revision).toBe(5)
  })
})
