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

const providerSheet = (): CharacterSheet => ({
  slug: 'provider-sheet', nickname: 'Provider', species: 'Charjabug', level: 20, revision: 3,
  types: ['Bug', 'Electric'], abilities: [{
    name: 'Battery',
    automation: {
      schemaVersion: 1, instanceId: 'base:provider:battery', canonicalId: 'Battery',
      definitionVersion: null, selections: [],
    },
  }],
  stats: { def: { added: 10 }, sdef: { added: 10 } }, combat: { currentHp: 60, conditions: [] },
})
const allySheet = (): CharacterSheet => ({
  slug: 'ally-sheet', nickname: 'Ally', species: 'Pikachu', level: 20, revision: 3,
  types: ['Electric'], abilities: [],
  movelist: [
    { name: 'Ember', type: 'Fire', category: 'Special', db: 4, ac: 2, range: '4, 1 Target' },
    { name: 'Thunder Shock', type: 'Electric', category: 'Special', db: 4, ac: 2, range: '4, 1 Target' },
  ],
  stats: { satk: { added: 20 }, def: { added: 10 }, sdef: { added: 10 } },
  combat: { currentHp: 60, conditions: [] },
})
const foeSheet = (): CharacterSheet => ({
  slug: 'foe-sheet', nickname: 'Foe', species: 'Snorlax', level: 20, revision: 3,
  types: ['Normal'], stats: { hp: { added: 20 }, def: { added: 10 }, sdef: { added: 10 } },
  combat: { currentHp: 100, conditions: [] },
})
const battleMap = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa061-battery', name: 'Battery', revision: 5,
    dimensions: { x: 8, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'provider', sheetKind: 'pokemon', sheetSlug: 'provider-sheet', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
      { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally-sheet', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
      { id: 'foe', sheetKind: 'pokemon', sheetSlug: 'foe-sheet', sideId: 'foes', position: { x: 3, y: 0, z: 1 } },
    ],
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: 'scene:battery' },
      turnResources: {
        provider: createEncounterTurnResourceLedger({ placementId: 'provider', round: 1 }),
        ally: createEncounterTurnResourceLedger({ placementId: 'ally', round: 1 }),
      },
    },
    initiative: { activeId: 'provider', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const activate = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const provider = providerSheet(), ally = allySheet(), foe = foeSheet()
  mapRepository.saveSetupMap(battleMap())
  for (const current of [provider, ally, foe]) {
    sheetRepository.saveSetupSheet('pokemon', current.slug, current as unknown as Record<string, unknown>)
  }
  const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: 'request:battery', mapSlug: 'aa061-battery', baseRevision: 5,
    actorPlacementId: 'provider', abilityInstanceId: 'base:provider:battery', canonicalId: 'Battery', modeId: 'activate',
  } }, dependencies)
  const target = offer.declarations[0]!.options.find(option => option.hint.kind === 'placement' && option.hint.placementId === 'ally')!
  resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: 'intent:battery', offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
    selections: [{ declarationId: 'activate.target', kind: 'token', optionIds: [target.optionId] }],
  } }, dependencies)
  return { mapRepository, provider, ally, foe }
}

describe('AA-061 Battery', () => {
  it('aa061.battery.next-special pays Scene x2/Swift, rolls the normal bonus, and consumes once', () => {
    const harness = activate()
    const activated = harness.mapRepository.getBySlug('aa061-battery')!
    expect(activated.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Battery', spent: 1, limit: 2 }))
    expect(activated.encounterState?.turnResources.provider?.actions.swift.spent).toBe(1)
    expect(activated.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Battery', targetPlacementIds: ['ally'], payload: { kind: 'mark', markId: 'aa061.battery.next-special' },
    }))
    const draws = [0.5, 0, 0, 0, 0, 0]
    const plan = planAuthoritativeMoveState({
      map: activated,
      pokemonSheets: new Map([['provider-sheet', harness.provider], ['ally-sheet', harness.ally], ['foe-sheet', harness.foe]]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'ally', moveName: 'Ember', selection: { kind: 'single-target', targetPlacementId: 'foe' } },
      random: () => draws.shift() ?? 0,
      now: () => 2_000,
      operationId: 'op_battery_ember',
    })
    expect(plan.resolution.rollLedger).toContainEqual(expect.objectContaining({
      reason: 'ability.battery.damage-bonus',
      formula: { kind: 'dice', count: 2, sides: 6, modifier: 4 },
    }))
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries.some(entry => entry.canonicalId === 'Battery')).toBe(false)
  }, 20_000)

  it('uses the larger reviewed Electric bonus formula', () => {
    const harness = activate()
    const activated = harness.mapRepository.getBySlug('aa061-battery')!
    const draws = [0.5, 0, 0, 0, 0, 0, 0]
    const plan = planAuthoritativeMoveState({
      map: activated,
      pokemonSheets: new Map([['provider-sheet', harness.provider], ['ally-sheet', harness.ally], ['foe-sheet', harness.foe]]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'ally', moveName: 'Thunder Shock', selection: { kind: 'single-target', targetPlacementId: 'foe' } },
      random: () => draws.shift() ?? 0,
      now: () => 2_000,
      operationId: 'op_battery_electric',
    })
    expect(plan.resolution.rollLedger).toContainEqual(expect.objectContaining({
      reason: 'ability.battery.electric-damage-bonus',
      formula: { kind: 'dice', count: 3, sides: 6, modifier: 6 },
    }))
  }, 20_000)
})
