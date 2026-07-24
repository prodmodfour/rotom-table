import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import {
  AA071_FOREST_LORD_ORIGIN_CAPABILITY,
  AA071_FOX_FIRE_WISP_CAPABILITY,
  aa071ForewarnMoveCapabilityId,
} from '#shared/abilityAutomation/aa071'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import {
  resolveAbilityDeclarationForControllerUseCase,
  resolveAbilityDeclarationUseCase,
} from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { buildAbilityClientCapabilityBundle } from '../../server/domain/abilityAutomation/clientCapabilities'

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
  types?: readonly string[]
  moves?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: (input.moves ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const battleMap = (input: {
  slug: string
  weather?: TabletopMap['fieldEffects'] extends infer _Effects ? NonNullable<TabletopMap['fieldEffects']>['weather'] : never
  tree?: boolean
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: input.tree
      ? [{ x: 4, y: 0, z: 1, materialId: 'tree', tags: ['tree', 'fully-grown'] }]
      : [],
    hazards: [],
    fieldEffects: { weather: [...(input.weather ?? [])], terrains: [], rooms: [] },
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
  canonicalId: string
  targetAbility?: string
  targetMoves?: readonly string[]
  weather?: NonNullable<TabletopMap['fieldEffects']>['weather']
  tree?: boolean
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet({
    slug: 'actor', ability: input.canonicalId,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet({
    slug: 'target', ability: input.targetAbility, moves: input.targetMoves,
  }) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
const begin = (dependencies: ReturnType<typeof setup>, slug: string, canonicalId: string, modeId = 'activate') => (
  beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1,
    requestId: `request:${slug}`,
    mapSlug: slug,
    baseRevision: dependencies.mapRepository.getBySlug(slug)!.revision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${slugify(canonicalId)}`,
    canonicalId,
    modeId,
  } }, dependencies)
)
const resolve = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  canonicalId: string
  modeId?: string
  declaration: ReturnType<typeof begin>
  selection: { declarationId: string; kind: 'none' | 'type' | 'cell' | 'token'; optionIds: readonly string[] }
}) => resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
  schemaVersion: 1,
  intentId: `intent:${input.slug}`,
  offerId: input.declaration.offerId,
  offerSha256: input.declaration.offerSha256,
  mapSlug: input.slug,
  baseRevision: input.declaration.mapRevision,
  actorPlacementId: 'actor',
  abilityInstanceId: `base:${slugify(input.canonicalId)}`,
  canonicalId: input.canonicalId,
  modeId: input.modeId ?? 'activate',
  selections: [input.selection],
} }, input.dependencies)
const resolveController = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  canonicalId: string
  declaration: ReturnType<typeof begin>
  selection: { declarationId: string; kind: 'token'; optionIds: readonly string[] }
}) => resolveAbilityDeclarationForControllerUseCase({ role: 'gm', intent: {
  schemaVersion: 1,
  intentId: `intent:${input.slug}`,
  offerId: input.declaration.offerId,
  offerSha256: input.declaration.offerSha256,
  mapSlug: input.slug,
  baseRevision: input.declaration.mapRevision,
  actorPlacementId: 'actor',
  abilityInstanceId: `base:${slugify(input.canonicalId)}`,
  canonicalId: input.canonicalId,
  modeId: 'activate',
  selections: [input.selection],
} }, input.dependencies)

const savedSheet = (dependencies: ReturnType<typeof setup>, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)

const optionFor = (
  declaration: ReturnType<typeof begin>,
  declarationId: string,
  valueId: string,
): string => declaration.declarations.find(entry => entry.declarationId === declarationId)!
  .options.find(option => option.hint.kind === 'type' && option.hint.valueId === valueId)!.optionId

describe('AA-071 activated abilities', () => {
  it('aa071.forecast.reviewed exposes a no-cost configuration mode only for ambiguous weather', () => {
    const actor = sheet({ slug: 'actor', ability: 'Forecast' })
    const target = sheet({ slug: 'target' })
    const capability = (weather: NonNullable<TabletopMap['fieldEffects']>['weather']) => {
      const activeWeather = weather ?? []
      return buildAbilityClientCapabilityBundle({
        role: 'gm',
        map: battleMap({ slug: `forecast-capability-${activeWeather.length}`, weather: activeWeather }),
        mapRevision: 5,
        pokemonSheets: [actor, target],
        trainerSheets: [],
      }).placements.find(placement => placement.placementId === 'actor')!.abilities[0]!
    }
    expect(capability([{ kind: 'sunny' }])).toMatchObject({
      status: 'passive', modes: [{ modeId: 'choose-weather', kind: 'configuration', invocable: false }],
    })
    expect(capability([{ kind: 'sunny' }, { kind: 'rainy' }])).toMatchObject({
      status: 'ready', modes: [{ modeId: 'choose-weather', kind: 'configuration', invocable: true }],
    })
    const unambiguous = setup({
      slug: 'aa071-forecast-unambiguous', canonicalId: 'Forecast', weather: [{ kind: 'sunny' }],
    })
    expect(() => begin(
      unambiguous, 'aa071-forecast-unambiguous', 'Forecast', 'choose-weather',
    )).toThrow('available only while its Weather choice is unresolved')
  })

  it('aa071.forecast.reviewed offers only active concurrent weather Types and persists the issued choice', () => {
    const dependencies = setup({
      slug: 'aa071-forecast', canonicalId: 'Forecast',
      weather: [{ kind: 'sunny' }, { kind: 'rainy' }],
    })
    const declaration = begin(dependencies, 'aa071-forecast', 'Forecast', 'choose-weather')
    const typeDeclaration = declaration.declarations[0]!
    expect(typeDeclaration.options.map(option => (
      option.hint.kind === 'type' ? option.hint.valueId : null
    ))).toEqual(['fire', 'water'])
    resolve({
      dependencies, slug: 'aa071-forecast', canonicalId: 'Forecast', modeId: 'choose-weather', declaration,
      selection: {
        declarationId: 'choose-weather.type', kind: 'type',
        optionIds: [optionFor(declaration, 'choose-weather.type', 'water')],
      },
    })
    const map = dependencies.mapRepository.getBySlug('aa071-forecast')!
    expect(map.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability',
        payload: { capabilityId: 'aa071.forecast.type.water', action: 'grant' },
      }),
    ]))
  })

  it('aa071.forest-lord.reviewed offers only fully-grown trees within ten meters and prepares a turn origin', () => {
    const dependencies = setup({ slug: 'aa071-forest-lord', canonicalId: 'Forest Lord', tree: true })
    const declaration = begin(dependencies, 'aa071-forest-lord', 'Forest Lord')
    expect(declaration.declarations[0]?.options).toHaveLength(1)
    resolve({
      dependencies, slug: 'aa071-forest-lord', canonicalId: 'Forest Lord', declaration,
      selection: {
        declarationId: 'activate.tree', kind: 'cell',
        optionIds: [declaration.declarations[0]!.options[0]!.optionId],
      },
    })
    const map = dependencies.mapRepository.getBySlug('aa071-forest-lord')!
    expect(map.encounterState?.turnResources.actor?.actions.shift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Forest Lord', limit: 2, spent: 1,
    }))
    expect(map.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability',
        affected: expect.objectContaining({ cells: [{ x: 4, y: 0, z: 1 }] }),
        payload: { capabilityId: AA071_FOREST_LORD_ORIGIN_CAPABILITY, action: 'grant' },
      }),
    ]))
  })

  it('aa071.forewarn.reviewed marks every highest-Damage-Dice tie and pays Free/Scene', () => {
    const dependencies = setup({
      slug: 'aa071-forewarn', canonicalId: 'Forewarn',
      targetMoves: ['Tackle', 'Hyper Beam', 'Giga Impact'],
    })
    const declaration = begin(dependencies, 'aa071-forewarn', 'Forewarn')
    const envelope = resolveController({
      dependencies, slug: 'aa071-forewarn', canonicalId: 'Forewarn', declaration,
      selection: {
        declarationId: 'activate.target', kind: 'token',
        optionIds: [declaration.declarations[0]!.options[0]!.optionId],
      },
    })
    expect(envelope).toMatchObject({
      controllerPresentationKey: 'ability.forewarn.moves-revealed',
      controllerPresentationValues: ['Giga Impact', 'Hyper Beam'],
    })
    expect(JSON.stringify(envelope.result)).not.toContain('Giga Impact')
    const map = dependencies.mapRepository.getBySlug('aa071-forewarn')!
    const capabilities = (map.encounterState?.effects ?? []).flatMap(effect => (
      effect.kind === 'capability' ? [effect.payload.capabilityId] : []
    ))
    expect(capabilities).toEqual(expect.arrayContaining([
      aa071ForewarnMoveCapabilityId('Hyper Beam'),
      aa071ForewarnMoveCapabilityId('Giga Impact'),
    ]))
    expect(capabilities).not.toContain(aa071ForewarnMoveCapabilityId('Tackle'))
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Forewarn', spent: 1,
    }))
  })

  it('aa071.fox-fire.reviewed spends Standard/Scene and creates exactly three durable wisps', () => {
    const dependencies = setup({ slug: 'aa071-fox-fire', canonicalId: 'Fox Fire' })
    const declaration = begin(dependencies, 'aa071-fox-fire', 'Fox Fire')
    resolve({
      dependencies, slug: 'aa071-fox-fire', canonicalId: 'Fox Fire', declaration,
      selection: { declarationId: 'activate.none', kind: 'none', optionIds: [] },
    })
    const map = dependencies.mapRepository.getBySlug('aa071-fox-fire')!
    const wisps = (map.encounterState?.effects ?? []).filter(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA071_FOX_FIRE_WISP_CAPABILITY
    ))
    expect(wisps).toHaveLength(3)
    expect(map.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Fox Fire', spent: 1,
    }))
  })

  it('aa071.frighten.reviewed lowers Speed by two but Full Metal Body prevents a foe source', () => {
    const applied = setup({ slug: 'aa071-frighten', canonicalId: 'Frighten' })
    const declaration = begin(applied, 'aa071-frighten', 'Frighten')
    resolve({
      dependencies: applied, slug: 'aa071-frighten', canonicalId: 'Frighten', declaration,
      selection: {
        declarationId: 'activate.target', kind: 'token',
        optionIds: [declaration.declarations[0]!.options[0]!.optionId],
      },
    })
    const appliedTarget = savedSheet(applied, 'target')
    expect(appliedTarget.stats?.spd?.stage ?? appliedTarget.combatStages?.spd).toBe(-2)

    const blocked = setup({
      slug: 'aa071-frighten-blocked', canonicalId: 'Frighten', targetAbility: 'Full Metal Body',
    })
    const blockedDeclaration = begin(blocked, 'aa071-frighten-blocked', 'Frighten')
    resolve({
      dependencies: blocked, slug: 'aa071-frighten-blocked', canonicalId: 'Frighten', declaration: blockedDeclaration,
      selection: {
        declarationId: 'activate.target', kind: 'token',
        optionIds: [blockedDeclaration.declarations[0]!.options[0]!.optionId],
      },
    })
    const blockedTarget = savedSheet(blocked, 'target')
    expect(blockedTarget.stats?.spd?.stage ?? blockedTarget.combatStages?.spd).toBe(0)
    const blockedMap = blocked.mapRepository.getBySlug('aa071-frighten-blocked')!
    expect(blockedMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
  })
})
