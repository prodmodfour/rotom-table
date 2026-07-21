import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const actorSheet = (): CharacterSheet => ({
  slug: 'actor-sheet', nickname: 'Actor', species: 'Squirtle', level: 20, revision: 3,
  types: ['Water'],
  abilities: [{
    name: 'Aqua Bullet', automation: {
      schemaVersion: 1, instanceId: 'base:actor:aqua-bullet', canonicalId: 'Aqua Bullet',
      definitionVersion: null, selections: [],
    },
  }],
  movelist: [{ name: 'Water Gun', type: 'Water', category: 'Special', db: 4, ac: 2, range: '4, 1 Target' }],
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
    schemaVersion: 2, slug: 'aa061-aqua-bullet', name: 'Aqua Bullet', revision: 5,
    dimensions: { x: 10, y: 5, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 } },
      { id: 'foe', sheetKind: 'pokemon', sheetSlug: 'foe-sheet', position: { x: 5, y: 0, z: 1 } },
    ],
    encounterState: {
      ...encounter,
      history: { ...encounter.history, sceneId: 'scene:aqua-bullet' },
      turnResources: { actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1 }) },
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const activate = (connection = false) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const actor = actorSheet(), foe = foeSheet()
  mapRepository.saveSetupMap(battleMap())
  sheetRepository.saveSetupSheet('pokemon', actor.slug, actor as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', foe.slug, foe as unknown as Record<string, unknown>)
  const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:aqua-bullet:${connection}`, mapSlug: 'aa061-aqua-bullet', baseRevision: 5,
    actorPlacementId: 'actor', abilityInstanceId: 'base:actor:aqua-bullet', canonicalId: 'Aqua Bullet', modeId: 'launch',
  } }, dependencies)
  const moveOptions = offer.declarations.find(entry => entry.declarationId === 'launch.move')!.options
  const move = connection ? moveOptions.at(-1)! : moveOptions[0]!
  const cell = offer.declarations.find(entry => entry.declarationId === 'launch.cell')!.options
    .find(option => option.hint.kind === 'cell' && option.hint.x === 4 && option.hint.y === 0 && option.hint.z === 1)!
  resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:aqua-bullet:${connection}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
    selections: [
      { declarationId: 'launch.move', kind: 'move', optionIds: [move.optionId] },
      { declarationId: 'launch.cell', kind: 'cell', optionIds: [cell.optionId] },
    ],
  } }, dependencies)
  return { mapRepository, actor, foe }
}

describe('AA-061 Aqua Bullet', () => {
  it('aa061.aqua-bullet.full-action-launch moves straight with Sky 10, prepays Full, and consumes on the move', () => {
    const harness = activate()
    const launched = harness.mapRepository.getBySlug('aa061-aqua-bullet')!
    expect(launched.placements.find(placement => placement.id === 'actor')?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(launched.encounterState?.turnResources.actor?.actions.full.spent).toBe(1)
    expect(launched.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Aqua Bullet' }))
    const draws = [0.5, 0, 0, 0]
    const plan = planAuthoritativeMoveState({
      map: launched,
      pokemonSheets: new Map([['actor-sheet', harness.actor], ['foe-sheet', harness.foe]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Water Gun', selection: { kind: 'single-target', targetPlacementId: 'foe' } },
      random: () => draws.shift() ?? 0, now: () => 2_000, operationId: 'op_aqua_bullet_attack',
    })
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.standard.spent).toBe(0)
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries.some(entry => entry.canonicalId === 'Aqua Bullet')).toBe(false)
  }, 20_000)

  it('provides the Aqua Jet Connection as an authoritative move entry while effective', () => {
    const harness = activate(true)
    const launched = harness.mapRepository.getBySlug('aa061-aqua-bullet')!
    const context = buildAuthoritativeMoveRulesContext({
      map: launched,
      pokemonSheets: new Map([['actor-sheet', harness.actor], ['foe-sheet', harness.foe]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Aqua Jet', selection: { kind: 'single-target', targetPlacementId: 'foe' } },
      selectedPlacementIds: ['foe'], random: () => 0, time: 2_000,
    })
    expect(context.queries.resolveActorMoveEntry('Aqua Jet')).toMatchObject({ ok: true })
  }, 20_000)
})
