import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${id(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (slug: string, canonicalId?: string): CharacterSheet => ({
  slug, nickname: slug, species: 'Eevee', level: 30, revision: 3,
  types: ['Normal'], abilities: canonicalId ? [ability(canonicalId)] : [],
  movelist: [{ name: 'Tackle' }],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 358, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 10, y: 4, z: 10 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 }, metadata: {},
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (slug: string, canonicalId: string) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(slug))
  for (const value of [sheet('actor', canonicalId), sheet('target')]) {
    sheetRepository.saveSetupSheet('pokemon', value.slug, value as unknown as Record<string, unknown>)
  }
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
type Dependencies = ReturnType<typeof setup>
const activate = (input: {
  dependencies: Dependencies
  slug: string
  canonicalId: string
  typeId?: string
  suffix?: string
}) => {
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${input.slug}:${input.suffix ?? 'activate'}`,
    mapSlug: input.slug, baseRevision: input.dependencies.mapRepository.getBySlug(input.slug)!.revision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${id(input.canonicalId)}`,
    canonicalId: input.canonicalId, modeId: 'activate',
  } }, input.dependencies)
  const selections = offer.declarations.map(declaration => ({
    declarationId: declaration.declarationId,
    kind: declaration.kind,
    optionIds: input.typeId
      ? declaration.options.filter(option => option.hint.kind === 'type'
        && option.hint.valueId === input.typeId).map(option => option.optionId)
      : [],
  }))
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${input.slug}:${input.suffix ?? 'activate'}`,
    offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: input.slug, baseRevision: offer.mapRevision, actorPlacementId: 'actor',
    abilityInstanceId: `base:${id(input.canonicalId)}`,
    canonicalId: input.canonicalId, modeId: 'activate', selections,
  } }, input.dependencies)
}

describe('AA-081 activated integrations', () => {
  it('Mud Shield pays Swift/Scene and grants exactly two Ticks of non-stacking Temporary HP', () => {
    const slug = 'aa081-mud-shield'
    const dependencies = setup(slug, 'Mud Shield')
    activate({ dependencies, slug, canonicalId: 'Mud Shield' })
    const map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.temporaryHitPoints?.byPlacementId.actor).toBe(70)
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Mud Shield', spent: 1, limit: 1,
    }))
    expect(() => activate({
      dependencies, slug, canonicalId: 'Mud Shield', suffix: 'repeat',
    })).toThrow(/remaining|spent|uses/i)
  })

  it('Multitype exposes only canonical Types, pays a Free Action, and projects a source-ability form snapshot', () => {
    const slug = 'aa081-multitype'
    const dependencies = setup(slug, 'Multitype')
    const result = activate({ dependencies, slug, canonicalId: 'Multitype', typeId: 'fire' })
    expect(result.kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityTransformations?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Multitype', duration: { kind: 'source-ability' },
      mechanics: expect.objectContaining({ typeIds: ['fire'] }),
    }))
    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet],
      ['target', dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet],
    ])
    const context = buildAuthoritativeMoveRulesContext({
      map, pokemonSheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      candidatePlacementIds: ['target'], selectedPlacementIds: ['target'], random: () => 0.75, time: 1_000,
    })
    expect(context.actor.token.defenderTypes).toEqual(['fire'])
    expect(context.queries.abilities.has('actor', 'Multitype')).toBe(true)
  })
})
