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

const actorSheet = (db = 4): CharacterSheet => ({
  slug: 'actor-sheet', nickname: 'Actor', species: 'Charmander', level: 20, revision: 3,
  types: ['Fire'], stats: { satk: { added: 20 } },
  abilities: [{
    name: 'Ambush',
    automation: { schemaVersion: 1, instanceId: 'base:actor:0', canonicalId: 'Ambush', definitionVersion: null, selections: [] },
  }],
  movelist: [{ name: 'Ember', type: 'Fire', category: 'Special', db, ac: 2, range: '4, 1 Target' }],
  combat: { currentHp: 60, conditions: [] },
})
const targetSheet = (): CharacterSheet => ({
  slug: 'target-sheet', nickname: 'Target', species: 'Snorlax', level: 20, revision: 3,
  types: ['Normal'], combat: { currentHp: 100, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa060-ambush', name: 'Ambush', revision: 5,
    dimensions: { x: 6, y: 2, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 2, y: 0, z: 1 } },
    ],
    encounterState: { ...encounter, history: { ...encounter.history, sceneId: 'scene:ambush' } },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const command = (requestId: string) => ({
  schemaVersion: 1, requestId, mapSlug: 'aa060-ambush', baseRevision: 5,
  actorPlacementId: 'actor', abilityInstanceId: 'base:actor:0', canonicalId: 'Ambush', modeId: 'activate',
})
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const activate = (db = 4) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const actor = actorSheet(db)
  const target = targetSheet()
  mapRepository.saveSetupMap(map())
  sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', actor as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target-sheet', target as unknown as Record<string, unknown>)
  const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: command(`request:ambush:${db}`) }, dependencies)
  const intent = {
    schemaVersion: 1, intentId: `intent:ambush:${db}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
    selections: [{ declarationId: 'activate.move', kind: 'move', optionIds: [offer.declarations[0]!.options[0]!.optionId] }],
  }
  return { actor, target, mapRepository, dependencies, intent }
}

describe('AA-060 Ambush continuation', () => {
  it('aa060.ambush.priority-hit-effects grants Priority and one-round hit effects, then consumes', () => {
    const harness = activate()
    const accepted = resolveAbilityDeclarationUseCase({ role: 'gm', intent: harness.intent }, harness.dependencies)
    expect(resolveAbilityDeclarationUseCase({ role: 'gm', intent: harness.intent }, harness.dependencies)).toEqual(accepted)
    const activated = harness.mapRepository.getBySlug('aa060-ambush')!
    expect(activated.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ spent: 1, limit: 1 }))
    const draws = [0.5, 0, 0, 0]
    const plan = planAuthoritativeMoveState({
      map: activated,
      pokemonSheets: new Map([['actor-sheet', harness.actor], ['target-sheet', harness.target]]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Ember', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => draws.shift() ?? 0,
      now: () => 2_000,
      operationId: 'op_ambush_hit',
    })
    expect(plan.resolution.abilityPriorityOverride).toBe(true)
    const effects = plan.nextMap.encounterState?.effects.filter(effect => effect.source.placementId === 'actor') ?? []
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'condition', affected: expect.objectContaining({ placementIds: ['target'] }),
        payload: expect.objectContaining({ conditionId: 'flinch' }),
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      }),
      expect.objectContaining({
        kind: 'numeric-modifier', affected: expect.objectContaining({ placementIds: ['target'] }),
        payload: expect.objectContaining({ attribute: 'accuracy', operation: 'add', value: -2 }),
        duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      }),
    ]))
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Ambush')).toBe(false)
  }, 15_000)

  it('applies no hit-only effect on a miss and rejects DB above six before committing', () => {
    const missHarness = activate()
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: missHarness.intent }, missHarness.dependencies)
    const activated = missHarness.mapRepository.getBySlug('aa060-ambush')!
    const miss = planAuthoritativeMoveState({
      map: activated,
      pokemonSheets: new Map([['actor-sheet', missHarness.actor], ['target-sheet', missHarness.target]]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Ember', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0,
      now: () => 2_000,
      operationId: 'op_ambush_miss',
    })
    expect(miss.resolution.transaction.hitTargetIds).toEqual([])
    expect(miss.nextMap.encounterState?.effects.filter(effect => effect.source.placementId === 'actor') ?? []).toEqual([])
    expect(miss.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Ambush')).toBe(false)

    const invalid = activate(7)
    expect(() => resolveAbilityDeclarationUseCase({ role: 'gm', intent: invalid.intent }, invalid.dependencies))
      .toThrow(/Damage Base 6 or lower/)
    expect(invalid.mapRepository.getBySlug('aa060-ambush')?.revision).toBe(5)
  }, 15_000)
})
