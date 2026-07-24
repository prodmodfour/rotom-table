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

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
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
  currentHp?: number
  injuries?: number
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.currentHp ?? 150,
    injuries: input.injuries ?? 0,
    conditions: [...(input.conditions ?? [])],
  },
})

const battleMap = (input: {
  slug: string
  hayFeverTrigger?: boolean
  weather?: 'rainy' | 'sunny'
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
    { id: 'foe', sheetKind: 'pokemon', sheetSlug: 'foe', sideId: 'foes', position: { x: 1, y: 0, z: 3 } },
    { id: 'immune', sheetKind: 'pokemon', sheetSlug: 'immune', sideId: 'foes', position: { x: 2, y: 0, z: 2 } },
    { id: 'distant', sheetKind: 'pokemon', sheetSlug: 'distant', sideId: 'foes', position: { x: 9, y: 0, z: 9 } },
  ]
  const completedStatusMove = {
    eventId: 'event.growl.completed',
    sourceOperationId: 'op.growl',
    resolutionId: 'resolution.growl',
    canonicalId: 'Growl',
    specVersion: 2,
    actorPlacementId: 'actor',
    actionType: 'standard' as const,
    origin: { kind: 'direct' as const },
    moveListSource: { kind: 'placement' as const, placementId: 'actor' },
    attackedTargetIds: ['foe'],
    hitTargetIds: ['foe'],
    outcome: 'hit' as const,
    succeeded: true,
    branches: [],
  }
  return {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [{ x: 1, y: 0, z: 1, materialId: 'water', tags: ['water', 'deep'] }],
    hazards: [],
    fieldEffects: {
      weather: input.weather ? [{ kind: input.weather, rounds: 2 }] : [],
      terrains: [], rooms: [],
    },
    placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${input.slug}`,
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
        ...(input.hayFeverTrigger ? {
          actedThisTurnPlacementIds: ['actor'],
          lastCompletedMoves: [completedStatusMove],
        } : {}),
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: {
  slug: string
  ability: string
  hayFeverTrigger?: boolean
  weather?: 'rainy' | 'sunny'
  actorHp?: number
  actorInjuries?: number
  actorConditions?: readonly string[]
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input))
  const sheets = [
    sheet({
      slug: 'actor', ability: input.ability, currentHp: input.actorHp,
      injuries: input.actorInjuries, conditions: input.actorConditions,
    }),
    sheet({ slug: 'ally', conditions: ['Burned', 'Confused'] }),
    sheet({ slug: 'foe' }),
    sheet({ slug: 'immune', types: ['Bug'] }),
    sheet({ slug: 'distant' }),
  ]
  for (const value of sheets) {
    sheetRepository.saveSetupSheet('pokemon', value.slug, value as unknown as Record<string, unknown>)
  }
  return { mapRepository, sheetRepository, now: () => 1_000 }
}

const execute = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  ability: string
  modeId: string
  targetId?: string
  directionId?: string
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
  const selections = declaration.declarations.map((offered) => {
    const option = input.targetId
      ? offered.options.find(candidate => candidate.hint.kind === 'placement'
        && candidate.hint.placementId === input.targetId)
      : input.directionId
        ? offered.options.find(candidate => candidate.hint.kind === 'direction'
          && candidate.hint.valueId === input.directionId)
        : undefined
    return {
      declarationId: offered.declarationId,
      kind: offered.kind,
      optionIds: option ? [option.optionId] : [],
    }
  })
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
    selections,
  } }, input.dependencies)
}

const savedSheet = (dependencies: ReturnType<typeof setup>, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)

describe('AA-073 activated abilities', () => {
  it('aa073.grassy-surge.reviewed applies one-round Grassy Terrain and pays Swift/Scene x3 atomically', () => {
    const dependencies = setup({ slug: 'aa073-grassy-surge', ability: 'Grassy Surge' })
    execute({ dependencies, slug: 'aa073-grassy-surge', ability: 'Grassy Surge', modeId: 'activate' })
    const map = dependencies.mapRepository.getBySlug('aa073-grassy-surge')!
    expect(map.encounterState?.zones).toContainEqual(expect.objectContaining({
      kind: 'terrain',
      payload: expect.objectContaining({ terrainId: 'grassy' }),
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
    }))
    expect(map.fieldEffects?.terrains).toContainEqual(expect.objectContaining({
      kind: 'grassy', scope: 'field', rounds: 1,
    }))
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Grassy Surge', limit: 3, spent: 1,
    }))
  })

  it('aa073.gulp.reviewed requires deep-water submersion, heals 25%, removes one Injury, and spends Daily', () => {
    const dependencies = setup({
      slug: 'aa073-gulp', ability: 'Gulp', actorHp: 50, actorInjuries: 2,
    })
    execute({ dependencies, slug: 'aa073-gulp', ability: 'Gulp', modeId: 'activate' })
    const actor = savedSheet(dependencies, 'actor')
    expect(actor.combat?.currentHp).toBeGreaterThan(50)
    expect(actor.combat?.injuries).toBe(1)
    expect(actor.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Gulp', limit: 1, spent: 1,
    }))

    const dry = setup({ slug: 'aa073-gulp-dry', ability: 'Gulp', actorHp: 50 })
    const map = dry.mapRepository.getBySlug('aa073-gulp-dry')!
    dry.mapRepository.saveSetupMap({ ...map, voxels: [], revision: map.revision })
    expect(() => execute({ dependencies: dry, slug: 'aa073-gulp-dry', ability: 'Gulp', modeId: 'activate' }))
      .toThrow('fully submerged')
  })

  it('aa073.healer.reviewed cures every status on one issued adjacent ally and spends Free/Scene', () => {
    const dependencies = setup({ slug: 'aa073-healer', ability: 'Healer' })
    execute({
      dependencies, slug: 'aa073-healer', ability: 'Healer', modeId: 'activate', targetId: 'ally',
    })
    expect(savedSheet(dependencies, 'ally').combat?.conditions).toEqual([])
    const map = dependencies.mapRepository.getBySlug('aa073-healer')!
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Healer', spent: 1,
    }))
  })

  it('aa073.hay-fever.reviewed derives Burst 2 targets, excludes immune Types, and rejects forbidden weather', () => {
    const dependencies = setup({
      slug: 'aa073-hay-fever', ability: 'Hay Fever', hayFeverTrigger: true,
    })
    execute({ dependencies, slug: 'aa073-hay-fever', ability: 'Hay Fever', modeId: 'burst' })
    expect(savedSheet(dependencies, 'actor').combat?.currentHp).toBe(150)
    expect(savedSheet(dependencies, 'ally').combat?.currentHp).toBeLessThan(150)
    expect(savedSheet(dependencies, 'foe').combat?.currentHp).toBeLessThan(150)
    expect(savedSheet(dependencies, 'immune').combat?.currentHp).toBe(150)
    expect(savedSheet(dependencies, 'distant').combat?.currentHp).toBe(150)
    expect(dependencies.mapRepository.getBySlug('aa073-hay-fever')!
      .encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)

    const rainy = setup({
      slug: 'aa073-hay-fever-rain', ability: 'Hay Fever', hayFeverTrigger: true, weather: 'rainy',
    })
    expect(() => execute({
      dependencies: rainy, slug: 'aa073-hay-fever-rain', ability: 'Hay Fever', modeId: 'burst',
    })).toThrow('cannot be activated')
  })
})
