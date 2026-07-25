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

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${id(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  currentHp?: number
  level?: number
  digestionFoods?: readonly string[]
  honeyPawsFood?: string
  additionalAbilities?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: input.slug === 'actor' ? 'Shuckle' : 'Eevee',
  level: input.level ?? 20,
  revision: 3,
  types: ['Normal'],
  abilities: [
    ...(input.ability ? [ability(input.ability)] : []),
    ...(input.additionalAbilities ?? []).map(ability),
  ],
  movelist: [{ name: 'Tackle' }],
  ...(input.digestionFoods || input.honeyPawsFood
    ? {
        items: {
          ...(input.digestionFoods ? { digestionFoods: [...input.digestionFoods] } : {}),
          ...(input.honeyPawsFood ? { honeyPawsFood: input.honeyPawsFood } : {}),
        },
      }
    : {}),
  stats: {
    hp: { added: 80 }, atk: { added: 35 }, def: { added: 25 },
    satk: { added: 35 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 220, injuries: 0, conditions: [] },
})

const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 4, y: 0, z: 2 } },
    { id: 'target2', sheetKind: 'pokemon', sheetSlug: 'target2', sideId: 'foes', position: { x: 5, y: 0, z: 2 } },
    { id: 'far-foe', sheetKind: 'pokemon', sheetSlug: 'far-foe', sideId: 'foes', position: { x: 10, y: 0, z: 2 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 3, y: 0, z: 3 } },
  ]
  return {
    schemaVersion: 2,
    slug,
    name: slug,
    revision: 5,
    dimensions: { x: 14, y: 4, z: 14 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    encounterState: {
      ...encounter,
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
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const setup = (input: {
  slug: string
  ability: string
  currentHp?: number
  level?: number
  digestionFoods?: readonly string[]
  honeyPawsFood?: string
  additionalAbilities?: readonly string[]
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input.slug))
  for (const slug of ['actor', 'target', 'target2', 'far-foe', 'ally']) {
    sheetRepository.saveSetupSheet('pokemon', slug, sheet({
      slug,
      ...(slug === 'actor' ? {
        ability: input.ability,
        currentHp: input.currentHp,
        level: input.level,
        digestionFoods: input.digestionFoods,
        honeyPawsFood: input.honeyPawsFood,
        additionalAbilities: input.additionalAbilities,
      } : {}),
    }) as unknown as Record<string, unknown>)
  }
  return { mapRepository, sheetRepository, now: () => 1_000 }
}

type Dependencies = ReturnType<typeof setup>
const begin = (input: {
  dependencies: Dependencies
  slug: string
  canonicalId: string
  modeId?: string
  suffix?: string
}) => beginAbilityDeclarationUseCase({ role: 'gm', command: {
  schemaVersion: 1,
  requestId: `request:${input.slug}:${input.suffix ?? input.modeId ?? 'activate'}`,
  mapSlug: input.slug,
  baseRevision: input.dependencies.mapRepository.getBySlug(input.slug)!.revision,
  actorPlacementId: 'actor',
  abilityInstanceId: `base:${id(input.canonicalId)}`,
  canonicalId: input.canonicalId,
  modeId: input.modeId ?? 'activate',
} }, input.dependencies)

const resolveOffer = (input: {
  dependencies: Dependencies
  slug: string
  canonicalId: string
  modeId?: string
  suffix?: string
  select?: (declaration: ReturnType<typeof begin>['declarations'][number]) => readonly string[]
}) => {
  const offer = begin(input)
  const modeId = input.modeId ?? 'activate'
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1,
    intentId: `intent:${input.slug}:${input.suffix ?? modeId}`,
    offerId: offer.offerId,
    offerSha256: offer.offerSha256,
    mapSlug: input.slug,
    baseRevision: offer.mapRevision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${id(input.canonicalId)}`,
    canonicalId: input.canonicalId,
    modeId,
    selections: offer.declarations.map(declaration => ({
      declarationId: declaration.declarationId,
      kind: declaration.kind,
      optionIds: [...(input.select?.(declaration) ?? [])],
    })),
  } }, input.dependencies)
}

const savedSheet = (dependencies: Dependencies, slug = 'actor'): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)
const stage = (value: CharacterSheet, key: 'atk' | 'def' | 'satk' | 'sdef' | 'spd'): number => (
  value.stats?.[key]?.stage ?? value.combatStages?.[key] ?? 0
)
const resetActorSwift = (dependencies: Dependencies, slug: string): void => {
  const map = dependencies.mapRepository.getBySlug(slug)!
  const actor = createEncounterTurnResourceLedger({ placementId: 'actor', round: map.initiative?.round ?? 1 })
  dependencies.mapRepository.saveSetupMap({
    ...map,
    revision: (map.revision ?? 0) + 1,
    encounterState: {
      ...map.encounterState!,
      turnResources: { ...map.encounterState!.turnResources, actor },
    },
  })
}

describe('AA-076 activated integrations', () => {
  it('aa076.interference.reviewed applies -2 Accuracy to only foes within 3m for one full round and pays atomically', () => {
    const dependencies = setup({ slug: 'aa076-interference', ability: 'Interference' })
    resolveOffer({ dependencies, slug: 'aa076-interference', canonicalId: 'Interference' })
    const map = dependencies.mapRepository.getBySlug('aa076-interference')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Interference', spent: 1, limit: 1,
    }))
    const effect = map.encounterState?.effects.find(candidate => (
      candidate.kind === 'numeric-modifier'
      && candidate.tags.includes('interference')
    ))
    expect(effect).toMatchObject({
      affected: { placementIds: ['target', 'target2'], sideIds: [], cells: [] },
      duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
      payload: { attribute: 'accuracy', operation: 'add', value: -2, rounding: 'none' },
    })
    expect(effect?.affected.placementIds).not.toContain('far-foe')
    expect(effect?.affected.placementIds).not.toContain('ally')

    resetActorSwift(dependencies, 'aa076-interference')
    expect(() => resolveOffer({
      dependencies,
      slug: 'aa076-interference',
      canonicalId: 'Interference',
      suffix: 'exhausted',
    })).toThrow(/no uses remaining/i)
    expect(dependencies.mapRepository.getBySlug('aa076-interference')!
      .encounterState?.turnResources.actor?.actions.swift.spent).toBe(0)
  })

  it('aa076.intimidate.reviewed lowers one foe Attack, enforces range, and seals once-per-target Scene state', () => {
    const dependencies = setup({ slug: 'aa076-intimidate', ability: 'Intimidate' })
    const choose = (placementId: string) => (
      declaration: ReturnType<typeof begin>['declarations'][number],
    ) => declaration.options
      .filter(option => option.hint.kind === 'placement' && option.hint.placementId === placementId)
      .map(option => option.optionId)

    resolveOffer({
      dependencies,
      slug: 'aa076-intimidate',
      canonicalId: 'Intimidate',
      select: choose('target'),
    })
    expect(stage(savedSheet(dependencies, 'target'), 'atk')).toBe(-1)
    let map = dependencies.mapRepository.getBySlug('aa076-intimidate')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      source: expect.objectContaining({ placementId: 'actor' }),
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
      duration: { kind: 'scene', remaining: null },
    }))

    resetActorSwift(dependencies, 'aa076-intimidate')
    expect(() => resolveOffer({
      dependencies,
      slug: 'aa076-intimidate',
      canonicalId: 'Intimidate',
      suffix: 'same-target',
      select: choose('target'),
    })).toThrow(/already targeted this foe/i)
    map = dependencies.mapRepository.getBySlug('aa076-intimidate')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(0)
    expect(stage(savedSheet(dependencies, 'target'), 'atk')).toBe(-1)

    resolveOffer({
      dependencies,
      slug: 'aa076-intimidate',
      canonicalId: 'Intimidate',
      suffix: 'second-target',
      select: choose('target2'),
    })
    expect(stage(savedSheet(dependencies, 'target2'), 'atk')).toBe(-1)

    resetActorSwift(dependencies, 'aa076-intimidate')
    const offer = begin({
      dependencies,
      slug: 'aa076-intimidate',
      canonicalId: 'Intimidate',
      suffix: 'range-audit',
    })
    expect(offer.declarations[0]?.options.some(option => (
      option.hint.kind === 'placement' && option.hint.placementId === 'far-foe'
    ))).toBe(false)
    expect(offer.declarations[0]?.options.some(option => (
      option.hint.kind === 'placement' && option.hint.placementId === 'ally'
    ))).toBe(false)
  })

  it('aa076.juicy-energy.reviewed consumes one issued Berry Juice buff, heals Level, and pays Free plus Daily atomically', () => {
    const dependencies = setup({
      slug: 'aa076-juicy-energy',
      ability: 'Juicy Energy',
      currentHp: 40,
      level: 23,
      digestionFoods: ['Candy Bar', 'Shuckle’s Berry Juice'],
    })
    const offer = begin({
      dependencies,
      slug: 'aa076-juicy-energy',
      canonicalId: 'Juicy Energy',
    })
    expect(offer.declarations[0]?.options).toHaveLength(1)
    const selectedId = offer.declarations[0]!.options[0]!.optionId
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1,
      intentId: 'intent:aa076-juicy-energy:activate',
      offerId: offer.offerId,
      offerSha256: offer.offerSha256,
      mapSlug: 'aa076-juicy-energy',
      baseRevision: offer.mapRevision,
      actorPlacementId: 'actor',
      abilityInstanceId: 'base:juicy-energy',
      canonicalId: 'Juicy Energy',
      modeId: 'activate',
      selections: [{
        declarationId: offer.declarations[0]!.declarationId,
        kind: offer.declarations[0]!.kind,
        optionIds: [selectedId],
      }],
    } }, dependencies)
    const actor = savedSheet(dependencies)
    const map = dependencies.mapRepository.getBySlug('aa076-juicy-energy')!
    expect(actor.combat?.currentHp).toBe(63)
    expect(actor.items?.digestionFoods).toEqual(['Candy Bar'])
    expect(actor.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Juicy Energy', spent: 1, limit: 1,
    }))
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['digestion-buff-trade']),
      affected: expect.objectContaining({ placementIds: ['actor'] }),
    }))
  })

  it('aa076.juicy-energy.reviewed accepts Honey Paws storage only while that capacity is effective', () => {
    const unavailable = setup({
      slug: 'aa076-juicy-energy-honey-unavailable',
      ability: 'Juicy Energy',
      currentHp: 40,
      honeyPawsFood: 'Shuckle’s Berry Juice',
    })
    expect(() => begin({
      dependencies: unavailable,
      slug: 'aa076-juicy-energy-honey-unavailable',
      canonicalId: 'Juicy Energy',
    })).toThrow(/option|selection|available/i)

    const available = setup({
      slug: 'aa076-juicy-energy-honey',
      ability: 'Juicy Energy',
      additionalAbilities: ['Honey Paws'],
      currentHp: 40,
      level: 23,
      honeyPawsFood: 'Shuckle’s Berry Juice',
    })
    resolveOffer({
      dependencies: available,
      slug: 'aa076-juicy-energy-honey',
      canonicalId: 'Juicy Energy',
      select: declaration => [declaration.options[0]!.optionId],
    })
    expect(savedSheet(available).items?.honeyPawsFood).toBeUndefined()
    expect(savedSheet(available).combat?.currentHp).toBe(63)
  })

  it('aa076.juicy-energy.reviewed revalidates issued storage before payment', () => {
    const dependencies = setup({
      slug: 'aa076-juicy-energy-stale',
      ability: 'Juicy Energy',
      currentHp: 40,
      digestionFoods: ['Shuckle’s Berry Juice'],
    })
    const offer = begin({
      dependencies,
      slug: 'aa076-juicy-energy-stale',
      canonicalId: 'Juicy Energy',
    })
    const changed = structuredClone(savedSheet(dependencies))
    changed.items = { ...changed.items, digestionFoods: ['Candy Bar'] }
    dependencies.sheetRepository.saveSetupSheet(
      'pokemon',
      'actor',
      changed as unknown as Record<string, unknown>,
    )

    expect(() => resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1,
      intentId: 'intent:aa076-juicy-energy-stale:activate',
      offerId: offer.offerId,
      offerSha256: offer.offerSha256,
      mapSlug: 'aa076-juicy-energy-stale',
      baseRevision: offer.mapRevision,
      actorPlacementId: 'actor',
      abilityInstanceId: 'base:juicy-energy',
      canonicalId: 'Juicy Energy',
      modeId: 'activate',
      selections: [{
        declarationId: offer.declarations[0]!.declarationId,
        kind: offer.declarations[0]!.kind,
        optionIds: [offer.declarations[0]!.options[0]!.optionId],
      }],
    } }, dependencies)).toThrow(/no longer|changed|stale/i)
    expect(savedSheet(dependencies).combat?.currentHp).toBe(40)
    expect(dependencies.mapRepository.getBySlug('aa076-juicy-energy-stale')!
      .encounterState?.turnResources.actor?.actions.free.spent).toBe(0)
  })

  it('aa076.juicy-energy.reviewed exposes no forged item option and rejects a missing Berry Juice before payment', () => {
    const dependencies = setup({
      slug: 'aa076-juicy-energy-missing',
      ability: 'Juicy Energy',
      currentHp: 40,
      digestionFoods: ['Candy Bar'],
    })
    expect(() => begin({
      dependencies,
      slug: 'aa076-juicy-energy-missing',
      canonicalId: 'Juicy Energy',
    })).toThrow(/option|selection|available/i)
    expect(savedSheet(dependencies).combat?.currentHp).toBe(40)
    expect(dependencies.mapRepository.getBySlug('aa076-juicy-energy-missing')!
      .encounterState?.turnResources.actor?.actions.free.spent).toBe(0)
  })
})
