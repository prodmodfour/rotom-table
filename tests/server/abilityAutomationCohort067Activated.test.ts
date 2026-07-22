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

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  species?: string
  ability?: string
  hp?: number
  injuries?: number
  conditions?: readonly string[]
  def?: number
  sdef?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: input.species ?? 'Eevee', level: 20, revision: 3,
  gender: 'Male', types: ['Normal'], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: input.def ?? 25 },
    satk: { added: 25 }, sdef: { added: input.sdef ?? 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.hp ?? 150,
    injuries: input.injuries ?? 0,
    conditions: [...(input.conditions ?? [])],
  },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
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
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
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
  actor?: Partial<Parameters<typeof sheet>[0]>
  target?: Partial<Parameters<typeof sheet>[0]>
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input.slug))
  const actor = sheet({ slug: 'actor', ability: input.canonicalId, ...input.actor })
  const target = sheet({ slug: 'target', ...input.target })
  sheetRepository.saveSetupSheet('pokemon', 'actor', actor as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', target as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
const begin = (dependencies: ReturnType<typeof setup>, slug: string, canonicalId: string) => {
  const revision = dependencies.mapRepository.getBySlug(slug)!.revision
  return beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${slug}:${revision}`, mapSlug: slug,
    baseRevision: revision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, modeId: 'activate',
  } }, dependencies)
}
const resolve = (
  dependencies: ReturnType<typeof setup>,
  offer: ReturnType<typeof begin>,
  canonicalId: string,
  selections: readonly unknown[],
) => resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
  schemaVersion: 1, intentId: `intent:${offer.mapSlug}:${offer.offerId}`,
  offerId: offer.offerId, offerSha256: offer.offerSha256, mapSlug: offer.mapSlug,
  baseRevision: offer.mapRevision, actorPlacementId: 'actor',
  abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  canonicalId, modeId: 'activate', selections,
} }, dependencies)
const persistedSheet = (dependencies: ReturnType<typeof setup>, slug = 'actor'): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)

const selection = (
  offer: ReturnType<typeof begin>,
  declarationId: string,
  predicate: (value: unknown) => boolean,
) => {
  const declaration = offer.declarations.find(value => value.declarationId === declarationId)!
  const chosen = declaration.options.filter(option => predicate(option.hint))
  return { declarationId, kind: declaration.kind, optionIds: chosen.map(option => option.optionId) }
}

describe('AA-067 activated abilities', () => {
  it('aa067.defy-death.reviewed removes chosen Injuries, heals one Tick each, and enforces its separate Daily x3 ledger', () => {
    const dependencies = setup({
      slug: 'aa067-defy-death', canonicalId: 'Defy Death',
      actor: { hp: 20, injuries: 3 },
    })
    const offer = begin(dependencies, 'aa067-defy-death', 'Defy Death')
    expect(offer.declarations[0]?.options.map(option => option.hint)).toEqual([
      { kind: 'branch', valueId: 'remove-1' },
      { kind: 'branch', valueId: 'remove-2' },
      { kind: 'branch', valueId: 'remove-3' },
    ])
    resolve(dependencies, offer, 'Defy Death', [selection(
      offer, 'activate.injury-count',
      value => (value as { valueId?: string }).valueId === 'remove-2',
    )])
    const current = persistedSheet(dependencies)
    expect(current.combat?.injuries).toBe(1)
    expect(current.combat?.currentHp).toBeGreaterThan(20)
    expect(current.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Defy Death', clauseId: 'injuries', limit: 3, spent: 2,
    }))
    expect(dependencies.mapRepository.getBySlug('aa067-defy-death')
      ?.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)

    const next = begin(dependencies, 'aa067-defy-death', 'Defy Death')
    expect(next.declarations[0]?.options).toHaveLength(1)
  })

  it('aa067.designer.reviewed persists exactly two chosen Type resistances and atomically replaces the old suit', () => {
    const dependencies = setup({ slug: 'aa067-designer', canonicalId: 'Designer' })
    const first = begin(dependencies, 'aa067-designer', 'Designer')
    resolve(dependencies, first, 'Designer', [selection(
      first, 'activate.types',
      value => (value as { valueId?: string }).valueId === 'fire'
        || (value as { valueId?: string }).valueId === 'water',
    )])
    let effects = dependencies.mapRepository.getBySlug('aa067-designer')!.encounterState!.effects
      .filter(effect => effect.tags.includes('designer'))
    expect(effects).toHaveLength(2)
    expect(effects.map(effect => effect.tags.find(tag => tag.startsWith('type.'))).sort())
      .toEqual(['type.fire', 'type.water'])

    const second = begin(dependencies, 'aa067-designer', 'Designer')
    resolve(dependencies, second, 'Designer', [selection(
      second, 'activate.types',
      value => (value as { valueId?: string }).valueId === 'grass'
        || (value as { valueId?: string }).valueId === 'psychic',
    )])
    effects = dependencies.mapRepository.getBySlug('aa067-designer')!.encounterState!.effects
      .filter(effect => effect.tags.includes('designer'))
    expect(effects).toHaveLength(2)
    expect(effects.map(effect => effect.tags.find(tag => tag.startsWith('type.'))).sort())
      .toEqual(['type.grass', 'type.psychic'])
  })

  it('aa067.discipline.reviewed is initiative-bound and cures all four eligible conditions for Scene/Free', () => {
    const dependencies = setup({
      slug: 'aa067-discipline', canonicalId: 'Discipline',
      actor: { conditions: ['Confused', 'Enraged', 'Infatuated: ally', 'Flinched', 'Burned'] },
    })
    const offer = begin(dependencies, 'aa067-discipline', 'Discipline')
    resolve(dependencies, offer, 'Discipline', [{
      declarationId: 'activate.none', kind: 'none', optionIds: [],
    }])
    expect(persistedSheet(dependencies).combat?.conditions).toEqual(['Burned'])
    const map = dependencies.mapRepository.getBySlug('aa067-discipline')!
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Discipline', spent: 1,
    }))

    const rejected = setup({ slug: 'aa067-discipline-rejected', canonicalId: 'Discipline' })
    const rejectedOffer = begin(rejected, 'aa067-discipline-rejected', 'Discipline')
    expect(() => resolve(rejected, rejectedOffer, 'Discipline', [{
      declarationId: 'activate.none', kind: 'none', optionIds: [],
    }])).toThrow('no eligible current condition')
    expect(rejected.mapRepository.getBySlug('aa067-discipline-rejected')
      ?.encounterState?.turnResources.actor?.actions.free.spent).toBe(0)
  })

  it('aa067.download.reviewed compares authoritative staged defenses and raises the corresponding Stage', () => {
    const dependencies = setup({
      slug: 'aa067-download', canonicalId: 'Download',
      target: { def: 5, sdef: 35 },
    })
    const offer = begin(dependencies, 'aa067-download', 'Download')
    resolve(dependencies, offer, 'Download', [
      selection(offer, 'activate.target', value => (
        (value as { placementId?: string }).placementId === 'target'
      )),
      { declarationId: 'activate.tie-stat', kind: 'stat', optionIds: [] },
    ])
    const actor = persistedSheet(dependencies)
    expect(actor.stats?.atk?.stage ?? actor.combatStages?.atk).toBe(1)
    const map = dependencies.mapRepository.getBySlug('aa067-download')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Download', spent: 1,
    }))

    const tied = setup({
      slug: 'aa067-download-tie', canonicalId: 'Download', target: { species: 'Mew' },
    })
    const tiedOffer = begin(tied, 'aa067-download-tie', 'Download')
    resolve(tied, tiedOffer, 'Download', [
      selection(tiedOffer, 'activate.target', value => (
        (value as { placementId?: string }).placementId === 'target'
      )),
      selection(tiedOffer, 'activate.tie-stat', value => (
        (value as { valueId?: string }).valueId === 'speed'
      )),
    ])
    const tiedActor = persistedSheet(tied)
    expect(tiedActor.stats?.spd?.stage ?? tiedActor.combatStages?.spd).toBe(1)
  })
})
