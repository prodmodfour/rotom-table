import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { acquireServerRolledAbilityParameters } from '../../server/domain/abilityAutomation/parameterAcquisition'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (slug: string, canonicalId?: string, hp = 100): CharacterSheet => ({
  slug, nickname: slug, species: 'Eevee', level: 20, revision: 3, types: ['Normal'],
  abilities: canonicalId ? [ability(canonicalId)] : [], movelist: [],
  stats: { hp: { added: 30 }, atk: { added: 10 }, def: { added: 10 }, satk: { added: 10 }, sdef: { added: 10 }, spd: { added: 10 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: hp, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 3, y: 0, z: 1 } },
    { id: 'far-ally', sheetKind: 'pokemon', sheetSlug: 'far-ally', sideId: 'heroes', position: { x: 7, y: 0, z: 1 } },
    { id: 'enemy', sheetKind: 'pokemon', sheetSlug: 'enemy', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 12, y: 4, z: 6 }, groundLevelY: 0,
    playerVisible: true, voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: Object.fromEntries(placements.map(placement => [placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 })])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (slug: string, canonicalId: string, hp = 100, physicalLoadPounds?: number) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const arena = battleMap(slug)
  const actorSheet = sheet('actor', canonicalId, hp)
  if (physicalLoadPounds !== undefined) {
    actorSheet.capabilities = { power: 4 }
    arena.metadata = { capabilityObjects: [{
      id: 'crate', pounds: physicalLoadPounds, position: { x: 1, y: 0, z: 1 },
      attachmentKind: 'physical-power-load', attachedCapabilityCanonicalId: 'Power',
      attachedCapabilityInstanceId: 'capability:actor:Power:value-4', attachedToPlacementId: 'actor',
      physicalLoadOperationId: 'load-operation', physicalLoadLastMovedRound: null,
      physicalLoadLastCheckRound: 1,
    }] }
  }
  mapRepository.saveSetupMap(arena)
  for (const entry of [actorSheet, sheet('ally'), sheet('far-ally'), sheet('enemy')]) {
    sheetRepository.saveSetupSheet('pokemon', entry.slug, entry as unknown as Record<string, unknown>)
  }
  return { database, mapRepository, sheetRepository, now: () => 1_000 }
}
const begin = (dependencies: ReturnType<typeof setup>, slug: string, canonicalId: string) => beginAbilityDeclarationUseCase({
  role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${slug}`, mapSlug: slug, baseRevision: 5,
    actorPlacementId: 'actor', abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, modeId: 'activate',
  },
}, dependencies)
const resolve = (dependencies: ReturnType<typeof setup>, offer: ReturnType<typeof begin>, canonicalId: string, selections: unknown[]) => (
  resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${offer.mapSlug}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: 'actor',
    abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, modeId: 'activate', selections,
  } }, dependencies)
)
const persisted = (dependencies: ReturnType<typeof setup>, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)

describe('AA-064 activated abilities', () => {
  it('aa064.comatose.reviewed pays a Move Action, applies Sleep, and heals one Tick', () => {
    const dependencies = setup('aa064-comatose', 'Comatose', 10)
    const offer = begin(dependencies, 'aa064-comatose', 'Comatose')
    resolve(dependencies, offer, 'Comatose', [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }])
    expect(persisted(dependencies, 'actor').combat?.conditions).toContain('Sleep')
    expect(persisted(dependencies, 'actor').combat?.currentHp).toBeGreaterThan(10)
    expect(dependencies.mapRepository.getBySlug('aa064-comatose')?.encounterState
      ?.turnResources.actor?.actions.standard.spent).toBe(1)
  })

  it('blocks Comatose’s Standard Move Action while the actor carries Staggering Weight', () => {
    const dependencies = setup('aa064-comatose-staggering', 'Comatose', 10, 71)
    expect(() => begin(dependencies, 'aa064-comatose-staggering', 'Comatose'))
      .toThrow(/Staggering Weight/)
    expect(persisted(dependencies, 'actor').combat?.conditions).not.toContain('Sleep')
    expect(dependencies.mapRepository.getBySlug('aa064-comatose-staggering')?.encounterState
      ?.turnResources.actor?.actions.standard.spent).toBe(0)
  })

  it('aa064.confidence.reviewed offers only Combat Stats and raises nearby allies with Scene payment', () => {
    const dependencies = setup('aa064-confidence', 'Confidence')
    const offer = begin(dependencies, 'aa064-confidence', 'Confidence')
    const declaration = offer.declarations[0]!
    expect(declaration.options).toHaveLength(5)
    const defense = declaration.options.find(option => option.hint.kind === 'stat' && option.hint.valueId === 'defense')!
    resolve(dependencies, offer, 'Confidence', [{
      declarationId: declaration.declarationId, kind: 'stat', optionIds: [defense.optionId],
    }])
    expect(persisted(dependencies, 'ally').stats?.def?.stage).toBe(1)
    expect(persisted(dependencies, 'far-ally').stats?.def?.stage ?? 0).toBe(0)
    expect(persisted(dependencies, 'enemy').stats?.def?.stage ?? 0).toBe(0)
    const nextMap = dependencies.mapRepository.getBySlug('aa064-confidence')!
    expect(nextMap.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(nextMap.encounterState?.abilityUsage?.entries[0]).toMatchObject({ canonicalId: 'Confidence', spent: 1 })
  })

  it('aa064.color-theory.reviewed rolls new acquisition data server-side and preserves it', () => {
    const requested = sheet('painted') as unknown as Record<string, unknown>
    requested.abilities = [{
      name: 'Color Theory',
      automation: {
        schemaVersion: 1, instanceId: 'client:forged', canonicalId: 'Color Theory', definitionVersion: 1,
        selections: [{ parameterId: 'color', optionIds: ['red'] }],
      },
    }]
    const acquired = acquireServerRolledAbilityParameters({
      kind: 'pokemon', slug: 'painted', currentRevision: 4, currentSheet: sheet('painted') as unknown as Record<string, unknown>,
      requestedSheet: requested, randomInt: () => 9,
    }) as unknown as CharacterSheet
    expect(acquired.abilities?.[0]?.automation?.selections[0]?.optionIds).toEqual(['blue-violet'])
    expect(acquired.abilities?.[0]?.automation?.instanceId).not.toBe('client:forged')
    const preserved = acquireServerRolledAbilityParameters({
      kind: 'pokemon', slug: 'painted', currentRevision: 5,
      currentSheet: acquired as unknown as Record<string, unknown>, requestedSheet: acquired as unknown as Record<string, unknown>,
      randomInt: () => { throw new Error('must not reroll') },
    }) as unknown as CharacterSheet
    expect(preserved.abilities?.[0]?.automation).toEqual(acquired.abilities?.[0]?.automation)
  })
})
