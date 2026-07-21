import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const ability = (canonicalId: string, instanceId: string) => ({
  name: canonicalId,
  automation: { schemaVersion: 1 as const, instanceId, canonicalId, definitionVersion: null, selections: [] },
})
const sheet = (canonicalId: string, conditions: string[] = []): CharacterSheet => ({
  slug: 'actor', nickname: 'Actor', species: 'Eevee', level: 20, revision: 3, types: ['Normal'],
  abilities: [ability(canonicalId, `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`)], movelist: [],
  stats: { hp: { added: 30 }, atk: { added: 10 }, def: { added: 10 }, satk: { added: 10 }, sdef: { added: 10 }, spd: { added: 10 } },
  combat: { currentHp: 100, conditions },
})
const battleMap = (slug: string, sunny: boolean): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 8, y: 4, z: 5 }, groundLevelY: 0,
    playerVisible: true, voxels: [], hazards: [],
    fieldEffects: { weather: sunny ? [{ kind: 'sunny', source: 'test' }] : [], terrains: [], rooms: [] },
    placements: [{ id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } }],
    encounterState: {
      ...encounter, sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: { actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1 }) },
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (slug: string, actor: CharacterSheet, sunny = false) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(slug, sunny))
  sheetRepository.saveSetupSheet('pokemon', actor.slug, actor as unknown as Record<string, unknown>)
  return { database, mapRepository, sheetRepository, now: () => 1_000 }
}
const invoke = (input: { dependencies: ReturnType<typeof setup>; slug: string; canonicalId: string; suffix?: string }) => {
  const instanceId = `base:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`
  const suffix = input.suffix ?? 'first'
  const revision = input.dependencies.mapRepository.getBySlug(input.slug)?.revision ?? 5
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${input.slug}:${suffix}`, mapSlug: input.slug, baseRevision: revision,
    actorPlacementId: 'actor', abilityInstanceId: instanceId, canonicalId: input.canonicalId, modeId: 'activate',
  } }, input.dependencies)
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${input.slug}:${suffix}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: 'actor', abilityInstanceId: instanceId,
    canonicalId: input.canonicalId, modeId: 'activate',
    selections: [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }],
  } }, input.dependencies)
}

describe('AA-063 activated abilities', () => {
  it('aa063.cherry-power.reviewed pays Swift/Daily, grants 15 temp HP, and cures only persistent statuses', () => {
    const actor = sheet('Cherry Power', ['Burned', 'Poisoned', 'Sleep'])
    const dependencies = setup('aa063-cherry-power', actor)
    invoke({ dependencies, slug: 'aa063-cherry-power', canonicalId: 'Cherry Power' })
    const nextMap = dependencies.mapRepository.getBySlug('aa063-cherry-power')!
    const nextSheet = dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet
    expect(nextMap.temporaryHitPoints?.byPlacementId.actor).toBe(15)
    expect(nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(nextSheet.combat?.conditions).toEqual(['Sleep'])
    expect(nextSheet.abilityUsage?.entries[0]).toMatchObject({ canonicalId: 'Cherry Power', spent: 1, limit: 1 })
    expect(() => invoke({
      dependencies, slug: 'aa063-cherry-power', canonicalId: 'Cherry Power', suffix: 'exhausted',
    })).toThrow()
  })

  it('aa063.cloud-nine.reviewed pays Free/Scene and removes every weather projection and zone', () => {
    const actor = sheet('Cloud Nine')
    const dependencies = setup('aa063-cloud-nine', actor, true)
    invoke({ dependencies, slug: 'aa063-cloud-nine', canonicalId: 'Cloud Nine' })
    const nextMap = dependencies.mapRepository.getBySlug('aa063-cloud-nine')!
    expect(nextMap.fieldEffects?.weather).toEqual([])
    expect(nextMap.encounterState?.zones.filter(zone => zone.kind === 'weather')).toEqual([])
    expect(nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(nextMap.encounterState?.abilityUsage?.entries[0]).toMatchObject({ canonicalId: 'Cloud Nine', spent: 1, limit: 1 })
  })
})
