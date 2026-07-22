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
import { AA070_FLUTTER_NO_FLANK_CAPABILITY } from '#shared/abilityAutomation/aa070'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slugify(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  conditions?: readonly string[]
  hp?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: ['Normal'], abilities: input.ability ? [ability(input.ability)] : [], movelist: [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 150, injuries: 0, conditions: [...(input.conditions ?? [])] },
})
const battleMap = (slug: string, sunny = false): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: { weather: sunny ? [{ kind: 'sunny' }] : [], terrains: [], rooms: [] },
    placements,
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
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: {
  slug: string
  canonicalId: string
  sunny?: boolean
  conditions?: readonly string[]
  hp?: number
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input.slug, input.sunny))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet({
    slug: 'actor', ability: input.canonicalId, conditions: input.conditions, hp: input.hp,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet({ slug: 'target' }) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}

const offer = (dependencies: ReturnType<typeof setup>, slug: string, canonicalId: string) => (
  beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${slug}`, mapSlug: slug,
    baseRevision: dependencies.mapRepository.getBySlug(slug)!.revision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${slugify(canonicalId)}`,
    canonicalId, modeId: 'activate',
  } }, dependencies)
)

const resolve = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  canonicalId: string
  offer: ReturnType<typeof offer>
  selections: readonly { declarationId: string; kind: 'none' | 'stat'; optionIds: readonly string[] }[]
}) => resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
  schemaVersion: 1, intentId: `intent:${input.slug}`, offerId: input.offer.offerId,
  offerSha256: input.offer.offerSha256, mapSlug: input.slug, baseRevision: input.offer.mapRevision,
  actorPlacementId: 'actor', abilityInstanceId: `base:${slugify(input.canonicalId)}`,
  canonicalId: input.canonicalId, modeId: 'activate', selections: input.selections,
} }, input.dependencies)

const savedSheet = (dependencies: ReturnType<typeof setup>, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)

describe('AA-070 activated abilities', () => {
  it('aa070.flare-boost.reviewed requires Burn and atomically raises Attack and Special Attack by three', () => {
    const dependencies = setup({
      slug: 'aa070-flare-boost', canonicalId: 'Flare Boost', conditions: ['Burned'],
    })
    const declaration = offer(dependencies, 'aa070-flare-boost', 'Flare Boost')
    resolve({
      dependencies, slug: 'aa070-flare-boost', canonicalId: 'Flare Boost', offer: declaration,
      selections: [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }],
    })
    const actor = savedSheet(dependencies, 'actor')
    expect(actor.stats?.atk?.stage ?? actor.combatStages?.atk).toBe(3)
    expect(actor.stats?.satk?.stage ?? actor.combatStages?.satk).toBe(3)
    const map = dependencies.mapRepository.getBySlug('aa070-flare-boost')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Flare Boost', spent: 1,
    }))

    const rejected = setup({ slug: 'aa070-flare-boost-rejected', canonicalId: 'Flare Boost' })
    const rejectedOffer = offer(rejected, 'aa070-flare-boost-rejected', 'Flare Boost')
    expect(() => resolve({
      dependencies: rejected, slug: 'aa070-flare-boost-rejected', canonicalId: 'Flare Boost', offer: rejectedOffer,
      selections: [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }],
    })).toThrow('Flare Boost requires the user to be Burned.')
  })

  it('aa070.flower-gift.reviewed chooses two Stats and raises self by two and every nearby target by one', () => {
    const dependencies = setup({ slug: 'aa070-flower-gift', canonicalId: 'Flower Gift', sunny: true })
    const declaration = offer(dependencies, 'aa070-flower-gift', 'Flower Gift')
    const stats = declaration.declarations.find(entry => entry.declarationId === 'activate.stats')!
    const selected = ['attack', 'speed'].map(statId => stats.options.find(option => (
      option.hint.kind === 'stat' && option.hint.valueId === statId
    ))!.optionId)
    resolve({
      dependencies, slug: 'aa070-flower-gift', canonicalId: 'Flower Gift', offer: declaration,
      selections: [{ declarationId: 'activate.stats', kind: 'stat', optionIds: selected }],
    })
    const actor = savedSheet(dependencies, 'actor')
    const target = savedSheet(dependencies, 'target')
    expect(actor.stats?.atk?.stage ?? actor.combatStages?.atk).toBe(2)
    expect(actor.stats?.spd?.stage ?? actor.combatStages?.spd).toBe(2)
    expect(target.stats?.atk?.stage ?? target.combatStages?.atk).toBe(1)
    expect(target.stats?.spd?.stage ?? target.combatStages?.spd).toBe(1)
    const map = dependencies.mapRepository.getBySlug('aa070-flower-gift')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Flower Gift', spent: 1,
    }))
  })

  it('aa070.flower-gift.reviewed rejects a full-HP activation outside Sunny Weather', () => {
    const dependencies = setup({ slug: 'aa070-flower-gift-rejected', canonicalId: 'Flower Gift' })
    const declaration = offer(dependencies, 'aa070-flower-gift-rejected', 'Flower Gift')
    const stats = declaration.declarations[0]!
    expect(() => resolve({
      dependencies, slug: 'aa070-flower-gift-rejected', canonicalId: 'Flower Gift', offer: declaration,
      selections: [{ declarationId: stats.declarationId, kind: 'stat', optionIds: stats.options.slice(0, 2).map(option => option.optionId) }],
    })).toThrow('Flower Gift requires Sunny Weather or HP below 50%.')
  })

  it('aa070.flutter.reviewed spends Shift and creates bounded evasion and anti-flanking effects', () => {
    const dependencies = setup({ slug: 'aa070-flutter', canonicalId: 'Flutter' })
    const declaration = offer(dependencies, 'aa070-flutter', 'Flutter')
    resolve({
      dependencies, slug: 'aa070-flutter', canonicalId: 'Flutter', offer: declaration,
      selections: [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }],
    })
    const map = dependencies.mapRepository.getBySlug('aa070-flutter')!
    expect(map.encounterState?.turnResources.actor?.actions.shift.spent).toBe(1)
    expect(map.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'numeric-modifier', duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
        payload: { attribute: 'evasion', operation: 'add', value: 3, rounding: 'none' },
      }),
      expect.objectContaining({
        kind: 'capability',
        payload: { capabilityId: AA070_FLUTTER_NO_FLANK_CAPABILITY, action: 'grant' },
      }),
    ]))
  })
})
