import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const sheet = (slug: string, options: { ability?: boolean; types?: string[]; sky?: number } = {}): CharacterSheet => ({
  slug, nickname: slug, species: slug === 'source-sheet' ? 'Diglett' : 'Pikachu', level: 20, revision: 3,
  types: options.types ?? ['Normal'],
  abilities: options.ability ? [{
    name: 'Arena Trap', automation: {
      schemaVersion: 1, instanceId: 'base:source:arena-trap', canonicalId: 'Arena Trap',
      definitionVersion: null, selections: [],
    },
  }] : [],
  movelist: slug === 'source-sheet' ? [{ name: 'Tackle' }] : [],
  capabilities: options.sky === undefined ? {} : { sky: options.sky },
  stats: { atk: { added: 10 }, def: { added: 10 }, sdef: { added: 10 } },
  combat: { currentHp: 50, conditions: [] },
})
const arenaMap = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa061-arena-trap', name: 'Arena Trap', revision: 5,
    dimensions: { x: 12, y: 5, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'source', sheetKind: 'pokemon', sheetSlug: 'source-sheet', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
      { id: 'enemy', sheetKind: 'pokemon', sheetSlug: 'enemy-sheet', sideId: 'foes', position: { x: 3, y: 0, z: 1 } },
      { id: 'flying', sheetKind: 'pokemon', sheetSlug: 'flying-sheet', sideId: 'foes', position: { x: 4, y: 0, z: 1 } },
      { id: 'sky', sheetKind: 'pokemon', sheetSlug: 'sky-sheet', sideId: 'foes', position: { x: 5, y: 0, z: 1 } },
      { id: 'outside', sheetKind: 'pokemon', sheetSlug: 'outside-sheet', sideId: 'foes', position: { x: 10, y: 0, z: 1 } },
    ],
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: 'scene:arena-trap' },
      turnResources: { source: createEncounterTurnResourceLedger({ placementId: 'source', round: 1 }) },
    },
    initiative: { activeId: 'source', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('AA-061 Arena Trap', () => {
  it('aa061.arena-trap.dynamic-aura applies dynamic exclusions and can be ended', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const sheets = new Map<string, CharacterSheet>([
      ['source-sheet', sheet('source-sheet', { ability: true })],
      ['enemy-sheet', sheet('enemy-sheet')],
      ['flying-sheet', sheet('flying-sheet', { types: ['Flying'] })],
      ['sky-sheet', sheet('sky-sheet', { sky: 4 })],
      ['outside-sheet', sheet('outside-sheet')],
    ])
    mapRepository.saveSetupMap(arenaMap())
    for (const current of sheets.values()) sheetRepository.saveSetupSheet('pokemon', current.slug, current as unknown as Record<string, unknown>)
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
    const use = (modeId: 'activate' | 'end', revision: number, suffix: string) => {
      const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
        schemaVersion: 1, requestId: `request:arena:${suffix}`, mapSlug: 'aa061-arena-trap', baseRevision: revision,
        actorPlacementId: 'source', abilityInstanceId: 'base:source:arena-trap', canonicalId: 'Arena Trap', modeId,
      } }, dependencies)
      return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
        schemaVersion: 1, intentId: `intent:arena:${suffix}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
        mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
        abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
        selections: [{ declarationId: `${modeId}.none`, kind: 'none', optionIds: [] }],
      } }, dependencies)
    }
    use('activate', 5, 'on')
    const activeMap = mapRepository.getBySlug('aa061-arena-trap')!
    const context = buildAuthoritativeMoveRulesContext({
      map: activeMap, pokemonSheets: sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'source', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'enemy' } },
      selectedPlacementIds: ['enemy'], random: () => 0, time: 2_000,
    })
    expect(context.queries.tokens.get('enemy')?.conditions).toEqual(expect.arrayContaining(['Slowed', 'Trapped']))
    expect(context.queries.tokens.get('flying')?.conditions).not.toContain('Trapped')
    expect(context.queries.tokens.get('sky')?.conditions).not.toContain('Trapped')
    expect(context.queries.tokens.get('outside')?.conditions).not.toContain('Trapped')
    expect(activeMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Arena Trap', spent: 1 }))

    use('end', 6, 'off')
    expect(mapRepository.getBySlug('aa061-arena-trap')?.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Arena Trap')).toBe(false)
  }, 20_000)
})
