import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { AA072_GARDENER_METADATA_KEY, parseAa072GardenerMetadata } from '#shared/abilityAutomation/aa072'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { capabilityEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${slugify(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  conditions?: readonly string[]
  stage?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [],
  stats: {
    hp: { added: 45 }, atk: { added: 25, stage: input.stage ?? 0 }, def: { added: 25, stage: input.stage ?? 0 },
    satk: { added: 25, stage: input.stage ?? 0 }, sdef: { added: 25, stage: input.stage ?? 0 }, spd: { added: 25, stage: input.stage ?? 0 },
  },
  combatStages: {
    atk: input.stage ?? 0, def: input.stage ?? 0, satk: input.stage ?? 0,
    sdef: input.stage ?? 0, spd: input.stage ?? 0, acc: input.stage ?? 0,
  },
  combat: { currentHp: 150, injuries: 0, conditions: [...(input.conditions ?? [])] },
})
const battleMap = (slug: string, temporaryHp?: number, healingBlocked = false): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'distant', sheetKind: 'pokemon', sheetSlug: 'distant', sideId: 'foes', position: { x: 8, y: 0, z: 8 } },
  ]
  return {
    schemaVersion: 2,
    slug,
    name: slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [{ x: 4, y: 0, z: 1, materialId: 'plant', tags: ['yielding-plant'] }],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    encounterState: {
      ...encounter,
      effects: healingBlocked ? [{
        ...capabilityEncounterEffectFixture(),
        id: 'ability.cruelty.healing-block.actor',
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        duration: { kind: 'scene', remaining: null },
        payload: { capabilityId: 'aa065.cruelty.healing-blocked', action: 'grant' },
        tags: ['ability', 'aa065', 'cruelty', 'healing-blocked'],
      }] : [],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${slug}`,
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    ...(temporaryHp === undefined ? {} : {
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 100 },
        byPlacementId: { actor: temporaryHp },
      },
    }),
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: {
  slug: string
  ability: string
  conditions?: readonly string[]
  stage?: number
  temporaryHp?: number
  healingBlocked?: boolean
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input.slug, input.temporaryHp, input.healingBlocked))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet({
    slug: 'actor', ability: input.ability, conditions: input.conditions, stage: input.stage,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet({
    slug: 'target', conditions: input.conditions, stage: input.stage,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'distant', sheet({
    slug: 'distant', conditions: input.conditions, stage: input.stage,
  }) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
const execute = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  ability: string
  modeId: string
  selectCell?: boolean
}) => {
  const declaration = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1,
    requestId: `request:${input.slug}`,
    mapSlug: input.slug,
    baseRevision: input.dependencies.mapRepository.getBySlug(input.slug)!.revision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${slugify(input.ability)}`,
    canonicalId: input.ability,
    modeId: input.modeId,
  } }, input.dependencies)
  const offered = declaration.declarations[0]!
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1,
    intentId: `intent:${input.slug}`,
    offerId: declaration.offerId,
    offerSha256: declaration.offerSha256,
    mapSlug: input.slug,
    baseRevision: declaration.mapRevision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${slugify(input.ability)}`,
    canonicalId: input.ability,
    modeId: input.modeId,
    selections: [{
      declarationId: offered.declarationId,
      kind: input.selectCell ? 'cell' : 'none',
      optionIds: input.selectCell ? [offered.options[0]!.optionId] : [],
    }],
  } }, input.dependencies)
}
const savedSheet = (dependencies: ReturnType<typeof setup>, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)


describe('AA-072 activated abilities', () => {
  it('aa072.gardener.reviewed raises one issued yielding plant and spends one of three Daily uses', () => {
    const dependencies = setup({ slug: 'aa072-gardener', ability: 'Gardener' })
    execute({ dependencies, slug: 'aa072-gardener', ability: 'Gardener', modeId: 'cultivate', selectCell: true })
    const map = dependencies.mapRepository.getBySlug('aa072-gardener')!
    const state = parseAa072GardenerMetadata(map.metadata?.[AA072_GARDENER_METADATA_KEY])
    expect(state.plants['4:0:1']).toEqual({ soilQuality: 1, lastAppliedDayKey: 'campaign-day:initial' })
    expect(savedSheet(dependencies, 'actor').abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Gardener', spent: 1, limit: 3,
    }))
    expect(() => execute({
      dependencies, slug: 'aa072-gardener', ability: 'Gardener', modeId: 'cultivate', selectCell: true,
    })).toThrow()
  })

  it('aa072.gentle-vibe.reviewed resets stages and cures volatile conditions only within Burst 2', () => {
    const dependencies = setup({
      slug: 'aa072-gentle-vibe', ability: 'Gentle Vibe', stage: 3,
      conditions: ['Confused', 'Burned'],
    })
    execute({ dependencies, slug: 'aa072-gentle-vibe', ability: 'Gentle Vibe', modeId: 'activate' })
    for (const slug of ['actor', 'target']) {
      expect(savedSheet(dependencies, slug).stats).toMatchObject({
        atk: { stage: 0 }, def: { stage: 0 }, satk: { stage: 0 },
        sdef: { stage: 0 }, spd: { stage: 0 },
      })
      expect(savedSheet(dependencies, slug).combatStages?.acc).toBe(0)
      expect(savedSheet(dependencies, slug).combat?.conditions).toEqual(['Burned'])
    }
    expect(savedSheet(dependencies, 'distant').stats?.atk?.stage).toBe(3)
    expect(savedSheet(dependencies, 'distant').combat?.conditions).toEqual(['Confused', 'Burned'])
    const map = dependencies.mapRepository.getBySlug('aa072-gentle-vibe')!
    expect(map.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Gentle Vibe', spent: 1,
    }))
  })

  it('aa072.grass-pelt.reviewed grants the higher two-tick temporary HP value and spends Swift/Scene', () => {
    const dependencies = setup({
      slug: 'aa072-grass-pelt', ability: 'Grass Pelt', temporaryHp: 100,
    })
    execute({ dependencies, slug: 'aa072-grass-pelt', ability: 'Grass Pelt', modeId: 'activate' })
    const map = dependencies.mapRepository.getBySlug('aa072-grass-pelt')!
    expect(map.temporaryHitPoints?.byPlacementId.actor).toBe(100)
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Grass Pelt', spent: 1,
    }))
  })

  it('aa072.grass-pelt.reviewed respects authoritative temporary-HP prevention', () => {
    const dependencies = setup({
      slug: 'aa072-grass-pelt-blocked', ability: 'Grass Pelt', healingBlocked: true,
    })
    execute({
      dependencies, slug: 'aa072-grass-pelt-blocked', ability: 'Grass Pelt', modeId: 'activate',
    })
    const map = dependencies.mapRepository.getBySlug('aa072-grass-pelt-blocked')!
    expect(map.temporaryHitPoints?.byPlacementId.actor ?? 0).toBe(0)
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Grass Pelt', spent: 1,
    }))
  })
})
