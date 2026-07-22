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
import { planInitiativeLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'

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
  ability?: string
  hp?: number
  conditions?: readonly string[]
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
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 1 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
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
const setup = (input: { slug: string; canonicalId: string }) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input.slug))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet({
    slug: 'actor', ability: input.canonicalId,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet({
    slug: 'target', hp: 100, conditions: ['Asleep'],
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'ally', sheet({
    slug: 'ally', hp: 100, conditions: ['Asleep'],
  }) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
const activate = (dependencies: ReturnType<typeof setup>, slug: string, canonicalId: string) => {
  const revision = dependencies.mapRepository.getBySlug(slug)!.revision
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${slug}`, mapSlug: slug, baseRevision: revision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, modeId: 'activate',
  } }, dependencies)
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${slug}`, offerId: offer.offerId,
    offerSha256: offer.offerSha256, mapSlug: slug, baseRevision: offer.mapRevision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, modeId: 'activate', selections: [{
      declarationId: 'activate.none', kind: 'none', optionIds: [],
    }],
  } }, dependencies)
}

describe('AA-068 activated abilities', () => {
  it('aa068.dreamspinner.reviewed drains only Sleeping foes in 3m and grants one Tick of Temporary HP', () => {
    const dependencies = setup({ slug: 'aa068-dreamspinner', canonicalId: 'Dreamspinner' })
    const targetBefore = dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet
    const crossingHp = Math.floor(pokemonHpSnapshot(targetBefore).fullMaxHp / 2) + 1
    dependencies.sheetRepository.saveSetupSheet('pokemon', 'target', {
      ...targetBefore,
      combat: { ...targetBefore.combat, currentHp: crossingHp },
    } as unknown as Record<string, unknown>)
    activate(dependencies, 'aa068-dreamspinner', 'Dreamspinner')
    const target = dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet
    const ally = dependencies.sheetRepository.getByRef('pokemon', 'ally')!.sheet as unknown as CharacterSheet
    expect(target.combat?.currentHp).toBeLessThan(crossingHp)
    expect(target.combat?.injuries).toBe(1)
    expect(ally.combat?.currentHp).toBe(100)
    const map = dependencies.mapRepository.getBySlug('aa068-dreamspinner')!
    expect(map.temporaryHitPoints?.byPlacementId.actor).toBeGreaterThan(0)
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Dreamspinner', limit: 3, spent: 1,
    }))
  })

  for (const [canonicalId, kind, fieldId] of [
    ['Drizzle', 'weather', 'rainy'],
    ['Drought', 'weather', 'sunny'],
    ['Electric Surge', 'terrain', 'electric'],
  ] as const) {
    it(`aa068.${canonicalId.toLowerCase().replaceAll(' ', '-')}.reviewed applies its one-round field atomically`, () => {
      const slug = `aa068-${canonicalId.toLowerCase().replaceAll(' ', '-')}`
      const dependencies = setup({ slug, canonicalId })
      activate(dependencies, slug, canonicalId)
      const map = dependencies.mapRepository.getBySlug(slug)!
      const zone = map.encounterState?.zones.find(candidate => candidate.kind === kind)
      expect(zone).toMatchObject({
        kind,
        duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      })
      expect(zone?.payload).toMatchObject(kind === 'weather'
        ? { weatherId: fieldId }
        : { terrainId: fieldId })
      expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
        canonicalId, limit: 3, spent: 1,
      }))
      expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)

      const expired = planInitiativeLifecycle({
        map,
        previous: { activeId: 'target', round: 1 },
        current: { activeId: 'actor', round: 2 },
        orderIds: ['actor', 'target', 'ally'],
        operationId: `op_expire_${slug}`,
        time: 2_000,
        loadSheets: () => ({
          pokemonSheets: new Map(['actor', 'target', 'ally'].map(sheetSlug => [
            sheetSlug,
            dependencies.sheetRepository.getByRef('pokemon', sheetSlug)!.sheet as unknown as CharacterSheet,
          ])),
          trainerSheets: new Map(),
        }),
      })
      expect(expired.currentEncounterState.zones.some(candidate => candidate.kind === kind)).toBe(false)
    })
  }
})
