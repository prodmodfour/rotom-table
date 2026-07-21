import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import {
  resolveAbilityDeclarationForControllerUseCase,
  resolveAbilityDeclarationUseCase,
} from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const actorSheet = (): CharacterSheet => ({
  slug: 'actor-sheet', nickname: 'Actor', species: 'Bulbasaur', level: 20, revision: 3,
  types: ['Grass', 'Poison'],
  abilities: [{
    name: 'Anticipation',
    automation: {
      schemaVersion: 1, instanceId: 'base:actor:0', canonicalId: 'Anticipation',
      definitionVersion: null, selections: [],
    },
  }],
  combat: { currentHp: 50, conditions: [] },
})
const targetSheet = (): CharacterSheet => ({
  slug: 'target-sheet', nickname: 'Target', species: 'Charmander', level: 20, revision: 3,
  types: ['Fire'],
  movelist: [
    { name: 'Ember', type: 'Fire', category: 'Special', db: 4 },
    { name: 'Growl', type: 'Normal', category: 'Status' },
  ],
  combat: { currentHp: 50, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa060-anticipation', name: 'Anticipation', revision: 5,
    dimensions: { x: 5, y: 2, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-sheet', position: { x: 2, y: 0, z: 1 } },
    ],
    encounterState: { ...encounter, history: { ...encounter.history, sceneId: 'scene:anticipation' } },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const command = (requestId: string, baseRevision: number) => ({
  schemaVersion: 1, requestId, mapSlug: 'aa060-anticipation', baseRevision,
  actorPlacementId: 'actor', abilityInstanceId: 'base:actor:0', canonicalId: 'Anticipation', modeId: 'activate',
})
const intentFor = (offer: ReturnType<typeof beginAbilityDeclarationUseCase>, intentId: string) => ({
  schemaVersion: 1, intentId, offerId: offer.offerId, offerSha256: offer.offerSha256,
  mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
  abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
  selections: offer.declarations.map(declaration => ({
    declarationId: declaration.declarationId,
    kind: declaration.kind,
    optionIds: [declaration.options.find(option => option.hint.kind === 'placement' && option.hint.placementId === 'target')!.optionId],
  })),
})
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('AA-060 Anticipation private declaration', () => {
  it('aa060.anticipation.private-binary returns only the authorized binary result and persists target usage', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    mapRepository.saveSetupMap(map())
    sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', actorSheet() as unknown as Record<string, unknown>)
    sheetRepository.saveSetupSheet('pokemon', 'target-sheet', targetSheet() as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }

    const offer = beginAbilityDeclarationUseCase({
      role: 'gm', command: command('request:anticipation:first', 5),
    }, dependencies)
    const intent = intentFor(offer, 'intent:anticipation:first')
    const envelope = resolveAbilityDeclarationForControllerUseCase({ role: 'gm', intent }, dependencies)
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      result: { kind: 'accepted', previousRevision: 5, revision: 6 },
      controllerPresentationKey: 'ability.anticipation.super-effective-present',
    })
    expect(JSON.stringify(envelope.result)).not.toContain('super-effective-present')
    expect(JSON.stringify(envelope)).not.toContain('Ember')
    expect(resolveAbilityDeclarationForControllerUseCase({ role: 'gm', intent }, dependencies)).toEqual(envelope)
    const persisted = mapRepository.getBySlug('aa060-anticipation')!
    expect(persisted.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(persisted.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      targetPlacementIds: ['target'],
      payload: { kind: 'mark', markId: 'aa060.anticipation.used' },
    }))

    const repeatOffer = beginAbilityDeclarationUseCase({
      role: 'gm', command: command('request:anticipation:repeat', 6),
    }, dependencies)
    expect(() => resolveAbilityDeclarationUseCase({
      role: 'gm', intent: intentFor(repeatOffer, 'intent:anticipation:repeat'),
    }, dependencies)).toThrow(/already queried/)
    expect(mapRepository.getBySlug('aa060-anticipation')?.revision).toBe(6)
  })

  it('authorizes before replaying a private duplicate result', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    mapRepository.saveSetupMap(map())
    sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', actorSheet() as unknown as Record<string, unknown>)
    sheetRepository.saveSetupSheet('pokemon', 'target-sheet', targetSheet() as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: command('request:private', 5) }, dependencies)
    const intent = intentFor(offer, 'intent:private')
    resolveAbilityDeclarationForControllerUseCase({ role: 'gm', intent }, dependencies)
    expect(() => resolveAbilityDeclarationForControllerUseCase({
      role: 'player', playerProfile: null, intent,
    }, dependencies)).toThrow(/not controlled/)
  })
})
