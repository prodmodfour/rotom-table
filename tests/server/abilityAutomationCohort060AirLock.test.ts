import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { planEncounterLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const sheet = (): CharacterSheet => ({
  slug: 'actor-sheet', nickname: 'Actor', species: 'Pikachu', level: 20, revision: 3,
  abilities: [{
    name: 'Air Lock',
    automation: {
      schemaVersion: 1, instanceId: 'base:actor:0', canonicalId: 'Air Lock',
      definitionVersion: null, selections: [],
    },
  }],
  combat: { currentHp: 50, conditions: [] },
})
const initialMap = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa060-air-lock', name: 'Air Lock', revision: 5,
    dimensions: { x: 5, y: 2, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [{ kind: 'sunny' }], terrains: [], rooms: [] },
    placements: [{ id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 } }],
    encounterState: { ...encounter, history: { ...encounter.history, sceneId: 'scene:air-lock' } },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const beginCommand = (modeId: 'activate' | 'sustain', requestId: string, baseRevision: number) => ({
  schemaVersion: 1, requestId, mapSlug: 'aa060-air-lock', baseRevision,
  actorPlacementId: 'actor', abilityInstanceId: 'base:actor:0', canonicalId: 'Air Lock', modeId,
})
const intentFor = (offer: ReturnType<typeof beginAbilityDeclarationUseCase>, intentId: string) => ({
  schemaVersion: 1, intentId, offerId: offer.offerId, offerSha256: offer.offerSha256,
  mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
  abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
  selections: offer.declarations.map(declaration => ({
    declarationId: declaration.declarationId, kind: declaration.kind, optionIds: [],
  })),
})
const weatherContext = (map: TabletopMap, actorSheet: CharacterSheet) => buildAuthoritativeMoveRulesContext({
  map,
  pokemonSheets: new Map([['actor-sheet', actorSheet]]),
  trainerSheets: new Map(),
  intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Scratch', selection: { kind: 'self' } },
  random: () => 0,
  time: 2_000,
})
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('AA-060 Air Lock production lifecycle', () => {
  it('aa060.air-lock.activate-sustain-cleanup pays, suppresses, sustains, retries, and expires', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const actorSheet = sheet()
    mapRepository.saveSetupMap(initialMap())
    sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', actorSheet as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }

    const offer = beginAbilityDeclarationUseCase({
      role: 'gm', command: beginCommand('activate', 'request:air-lock:activate', 5),
    }, dependencies)
    const intent = intentFor(offer, 'intent:air-lock:activate')
    const accepted = resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)
    expect(accepted).toMatchObject({ kind: 'accepted', previousRevision: 5, revision: 6 })
    expect(resolveAbilityDeclarationUseCase({ role: 'gm', intent }, dependencies)).toEqual(accepted)
    const roundOne = mapRepository.getBySlug('aa060-air-lock')!
    expect(roundOne.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Air Lock', spent: 1, limit: 1,
    }))
    expect(roundOne.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      payload: { kind: 'mark', markId: 'aa060.air-lock.active:1' },
    }))
    expect(roundOne.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(weatherContext(roundOne, actorSheet).queries.weather.active()).toEqual([])

    const roundTwoUnsustained: TabletopMap = { ...roundOne, revision: 7, initiative: { activeId: 'actor', round: 2 } }
    expect(weatherContext(roundTwoUnsustained, actorSheet).queries.weather.active()).toEqual([
      expect.objectContaining({ kind: 'sunny' }),
    ])
    expect(mapRepository.applyLivePlayUpdate({
      slug: roundOne.slug, expectedRevision: 6, nextMap: roundTwoUnsustained,
    })).toBe('applied')
    const sustainOffer = beginAbilityDeclarationUseCase({
      role: 'gm', command: beginCommand('sustain', 'request:air-lock:sustain', 7),
    }, dependencies)
    const sustain = resolveAbilityDeclarationUseCase({
      role: 'gm', intent: intentFor(sustainOffer, 'intent:air-lock:sustain'),
    }, dependencies)
    expect(sustain).toMatchObject({ kind: 'accepted', previousRevision: 7, revision: 8 })
    const roundTwo = mapRepository.getBySlug('aa060-air-lock')!
    expect(roundTwo.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(weatherContext(roundTwo, actorSheet).queries.weather.active()).toEqual([])

    const sceneEnded = planEncounterLifecycle({
      map: roundTwo,
      events: [{
        schemaVersion: 2, eventId: 'event.scene.end.air-lock', kind: 'scene-end',
        sourceOperationId: 'op.scene.end.air-lock', causalParentEventId: null,
        reasonCode: 'scene-ended', sceneId: 'scene:air-lock',
      }],
      time: 3_000,
      loadSheets: () => ({ pokemonSheets: new Map([['actor-sheet', actorSheet]]), trainerSheets: new Map() }),
    })
    expect(sceneEnded.currentEncounterState.abilityOwnedState?.entries ?? []).toEqual([])
    expect(weatherContext(sceneEnded.nextMap, actorSheet).queries.weather.active()).toEqual([
      expect.objectContaining({ kind: 'sunny' }),
    ])
  }, 15_000)

  it('rejects sustain without prior-round ownership and disables suppression on source loss', () => {
    const actorSheet = sheet()
    const base = initialMap()
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    mapRepository.saveSetupMap({ ...base, initiative: { activeId: 'actor', round: 2 } })
    sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', actorSheet as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
    const offer = beginAbilityDeclarationUseCase({
      role: 'gm', command: beginCommand('sustain', 'request:air-lock:orphan', 5),
    }, dependencies)
    expect(() => resolveAbilityDeclarationUseCase({
      role: 'gm', intent: intentFor(offer, 'intent:air-lock:orphan'),
    }, dependencies)).toThrow(/immediately previous round/)
    expect(mapRepository.getBySlug(base.slug)?.revision).toBe(5)

    const suppression = creatureRuleOverlayEncounterEffectFixture({
      domain: 'ability', action: 'suppress', values: ['Air Lock'],
      referencePlacementId: null, suppressionScope: 'listed',
    })
    const activeState = {
      ...base.encounterState!,
      abilityOwnedState: {
        schemaVersion: 1 as const,
        entries: [{
          stateId: 'base:actor:0:air-lock:1', version: 1, ownerPlacementId: 'actor',
          sourceAbilityInstanceId: 'base:actor:0', canonicalId: 'Air Lock', targetPlacementIds: [],
          lifecycle: { kind: 'source-ability' as const, targetPolicy: null },
          payload: { kind: 'mark' as const, markId: 'aa060.air-lock.active:1' },
          createdOperationId: 'op.air-lock', lastOperationId: 'op.air-lock',
        }],
        receipts: [],
      },
      effects: [{
        ...suppression, id: 'effect.suppress.air-lock',
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      }],
    }
    const suppressedMap = { ...base, encounterState: activeState }
    expect(weatherContext(suppressedMap, actorSheet).queries.weather.active()).toEqual([
      expect.objectContaining({ kind: 'sunny' }),
    ])
  })
})
