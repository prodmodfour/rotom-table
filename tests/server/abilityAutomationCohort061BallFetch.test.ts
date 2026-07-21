import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { applyAa061BallFetchSendOutTriggers } from '../../server/domain/abilityAutomation/mechanics/aa061PresenceIntegration'
import { buildAbilityClientCapabilityBundle } from '../../server/domain/abilityAutomation/clientCapabilities'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const ownerSheet = (): CharacterSheet => ({
  slug: 'owner-sheet', nickname: 'Fetcher', species: 'Yamper', level: 20, revision: 3,
  types: ['Electric'], capabilities: { overland: 4 },
  abilities: [{
    name: 'Ball Fetch', automation: {
      schemaVersion: 1, instanceId: 'base:owner:ball-fetch', canonicalId: 'Ball Fetch',
      definitionVersion: null, selections: [],
    },
  }],
  stats: { hp: { added: 20 }, def: { added: 10 }, sdef: { added: 10 } },
  combat: { currentHp: 80, conditions: [] },
})
const releasedSheet = (): CharacterSheet => ({
  slug: 'released-sheet', nickname: 'Released', species: 'Eevee', level: 20, revision: 3,
  types: ['Normal'], capabilities: { overland: 5 }, abilities: [],
  stats: { hp: { added: 20 }, def: { added: 10 }, sdef: { added: 10 } },
  combat: { currentHp: 80, conditions: [] },
})
const maps = (owner: CharacterSheet): { before: TabletopMap; after: TabletopMap } => {
  const encounter = createEmptyEncounterState()
  const before: TabletopMap = {
    schemaVersion: 2, slug: 'aa061-ball-fetch', name: 'Ball Fetch', revision: 4,
    dimensions: { x: 9, y: 3, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [{ id: 'owner', sheetKind: 'pokemon', sheetSlug: owner.slug, position: { x: 1, y: 0, z: 1 } }],
    encounterState: { ...encounter, history: { ...encounter.history, sceneId: 'scene:ball-fetch' } },
    initiative: { activeId: 'owner', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
  const after = applyAa061BallFetchSendOutTriggers({
    mapBefore: before,
    mapAfter: {
      ...before,
      revision: 5,
      placements: [...before.placements, {
        id: 'released', sheetKind: 'pokemon', sheetSlug: 'released-sheet', position: { x: 6, y: 0, z: 1 },
      }],
    },
    releasedPlacementId: 'released', operationId: 'op_ball_fetch_sendout',
    readPokemonSheet: slug => slug === owner.slug ? owner : null,
  })
  return { before, after }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const harness = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const owner = ownerSheet(), released = releasedSheet(), map = maps(owner).after
  mapRepository.saveSetupMap(map)
  sheetRepository.saveSetupSheet('pokemon', owner.slug, owner as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', released.slug, released as unknown as Record<string, unknown>)
  const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:ball-fetch:${databases.length}`, mapSlug: map.slug, baseRevision: 5,
    actorPlacementId: 'owner', abilityInstanceId: 'base:owner:ball-fetch', canonicalId: 'Ball Fetch', modeId: 'fetch',
  } }, dependencies)
  return { dependencies, mapRepository, offer }
}
const intentFor = (setup: ReturnType<typeof harness>, destinationX: number) => {
  const target = setup.offer.declarations.find(entry => entry.declarationId === 'fetch.target')!.options[0]!
  const cell = setup.offer.declarations.find(entry => entry.declarationId === 'fetch.cell')!.options.find(option => (
    option.hint.kind === 'cell' && option.hint.x === destinationX && option.hint.y === 0 && option.hint.z === 1
  ))!
  return {
    schemaVersion: 1 as const, intentId: `intent:ball-fetch:${destinationX}`,
    offerId: setup.offer.offerId, offerSha256: setup.offer.offerSha256,
    mapSlug: setup.offer.mapSlug, baseRevision: setup.offer.mapRevision,
    actorPlacementId: setup.offer.actorPlacementId, abilityInstanceId: setup.offer.abilityInstanceId,
    canonicalId: setup.offer.canonicalId, modeId: setup.offer.modeId,
    selections: [
      { declarationId: 'fetch.target', kind: 'token' as const, optionIds: [target.optionId] },
      { declarationId: 'fetch.cell', kind: 'cell' as const, optionIds: [cell.optionId] },
    ],
  }
}

describe('AA-061 Ball Fetch', () => {
  it('aa061.ball-fetch.send-out-shift consumes the durable trigger after a speed-bounded closer Shift', () => {
    const setup = harness()
    const pendingMap = setup.mapRepository.getBySlug('aa061-ball-fetch')!
    const pendingCapabilities = buildAbilityClientCapabilityBundle({
      role: 'gm', map: pendingMap, mapRevision: 5,
      pokemonSheets: [ownerSheet(), releasedSheet()], trainerSheets: [],
    })
    expect(pendingCapabilities.placements.find(entry => entry.placementId === 'owner')?.abilities[0])
      .toMatchObject({ status: 'ready', modes: expect.arrayContaining([expect.objectContaining({ modeId: 'fetch', invocable: true })]) })
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: intentFor(setup, 4) }, setup.dependencies)
    const resolved = setup.mapRepository.getBySlug('aa061-ball-fetch')!
    expect(resolved.placements.find(placement => placement.id === 'owner')?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(resolved.encounterState?.abilityOwnedState?.entries.some(entry => entry.canonicalId === 'Ball Fetch')).toBe(false)
    const settledCapabilities = buildAbilityClientCapabilityBundle({
      role: 'gm', map: resolved, mapRevision: 6,
      pokemonSheets: [ownerSheet(), releasedSheet()], trainerSheets: [],
    })
    expect(settledCapabilities.placements.find(entry => entry.placementId === 'owner')?.abilities[0])
      .toMatchObject({ status: 'passive', modes: expect.arrayContaining([expect.objectContaining({ modeId: 'fetch', invocable: false })]) })
  }, 20_000)

  it('rejects a Ball Fetch destination that does not end closer', () => {
    const setup = harness()
    expect(() => resolveAbilityDeclarationUseCase({ role: 'gm', intent: intentFor(setup, 0) }, setup.dependencies))
      .toThrow('Ball Fetch movement must end closer')
    expect(setup.mapRepository.getBySlug('aa061-ball-fetch')?.revision).toBe(5)
  }, 20_000)
})
