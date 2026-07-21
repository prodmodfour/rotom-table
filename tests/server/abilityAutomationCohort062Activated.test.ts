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
const sheet = (input: {
  slug: string
  species: string
  ability?: ReturnType<typeof ability>
  hp?: number
  conditions?: string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: input.species, level: 20, revision: 3,
  types: ['Normal'], abilities: input.ability ? [input.ability] : [], movelist: [],
  stats: {
    hp: { added: 30 }, atk: { added: 10 }, def: { added: 10 },
    satk: { added: 20, stage: 0 }, sdef: { added: 10 }, spd: { added: 10 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 100, conditions: input.conditions ?? [] },
})
const battleMap = (slug: string, placements: TabletopMap['placements']): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 10, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: placements[0]!.id, round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (slug: string, sheets: CharacterSheet[], placements: TabletopMap['placements']) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(slug, placements))
  for (const entry of sheets) sheetRepository.saveSetupSheet('pokemon', entry.slug, entry as unknown as Record<string, unknown>)
  return { database, mapRepository, sheetRepository, now: () => 1_000 }
}
const invokeNoTarget = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  actorId: string
  canonicalId: string
  instanceId: string
  modeId: string
  requestId: string
}) => {
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: input.requestId, mapSlug: input.slug, baseRevision: 5,
    actorPlacementId: input.actorId, abilityInstanceId: input.instanceId,
    canonicalId: input.canonicalId, modeId: input.modeId,
  } }, input.dependencies)
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${input.requestId}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
    selections: [{ declarationId: `${input.modeId}.none`, kind: 'none', optionIds: [] }],
  } }, input.dependencies)
}

describe('AA-062 activated abilities', () => {
  it('aa062.beautiful.branches raises Special Attack and cures only nearby allies in battle', () => {
    const actor = sheet({ slug: 'beautiful', species: 'Milotic', ability: ability('Beautiful', 'base:beautiful') })
    const ally = sheet({ slug: 'ally', species: 'Eevee', conditions: ['Enraged'] })
    const enemy = sheet({ slug: 'enemy', species: 'Pikachu', conditions: ['Enraged'] })
    const placements: TabletopMap['placements'] = [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: actor.slug, sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
      { id: 'ally', sheetKind: 'pokemon', sheetSlug: ally.slug, sideId: 'heroes', position: { x: 3, y: 0, z: 1 } },
      { id: 'enemy', sheetKind: 'pokemon', sheetSlug: enemy.slug, sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
    ]
    const dependencies = setup('aa062-beautiful-battle', [actor, ally, enemy], placements)
    invokeNoTarget({ dependencies, slug: 'aa062-beautiful-battle', actorId: 'actor', canonicalId: 'Beautiful', instanceId: 'base:beautiful', modeId: 'battle', requestId: 'beautiful-battle' })
    const actorAfter = dependencies.sheetRepository.getByRef('pokemon', actor.slug)!.sheet as unknown as CharacterSheet
    const allyAfter = dependencies.sheetRepository.getByRef('pokemon', ally.slug)!.sheet as unknown as CharacterSheet
    const enemyAfter = dependencies.sheetRepository.getByRef('pokemon', enemy.slug)!.sheet as unknown as CharacterSheet
    expect(actorAfter.stats?.satk?.stage).toBe(1)
    expect(allyAfter.combat?.conditions).not.toContain('Enraged')
    expect(enemyAfter.combat?.conditions).toContain('Enraged')
    expect(dependencies.mapRepository.getBySlug('aa062-beautiful-battle')?.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
  }, 20_000)

  it('records the contest branch as a private scene-bound +2 Beauty Dice provider', () => {
    const actor = sheet({ slug: 'beautiful', species: 'Milotic', ability: ability('Beautiful', 'base:beautiful') })
    const placements: TabletopMap['placements'] = [{ id: 'actor', sheetKind: 'pokemon', sheetSlug: actor.slug, position: { x: 1, y: 0, z: 1 } }]
    const dependencies = setup('aa062-beautiful-contest', [actor], placements)
    invokeNoTarget({ dependencies, slug: 'aa062-beautiful-contest', actorId: 'actor', canonicalId: 'Beautiful', instanceId: 'base:beautiful', modeId: 'contest', requestId: 'beautiful-contest' })
    expect(dependencies.mapRepository.getBySlug('aa062-beautiful-contest')?.encounterState?.abilityOwnedState?.entries)
      .toContainEqual(expect.objectContaining({
        canonicalId: 'Beautiful', lifecycle: { kind: 'scene', targetPolicy: null },
        payload: { kind: 'token', tokenId: 'aa062.beautiful.beauty-dice', quantity: 2, maximum: 2 },
      }))
  }, 20_000)

  it('aa062.blessed-touch.daily-healing pays Standard and Daily usage while healing one adjacent target', () => {
    const actor = sheet({ slug: 'blesser', species: 'Chansey', ability: ability('Blessed Touch', 'base:blessed-touch') })
    const target = sheet({ slug: 'target', species: 'Eevee', hp: 10 })
    const placements: TabletopMap['placements'] = [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: actor.slug, position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: target.slug, position: { x: 2, y: 0, z: 1 } },
    ]
    const dependencies = setup('aa062-blessed-touch', [actor, target], placements)
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
      schemaVersion: 1, requestId: 'blessed-touch', mapSlug: 'aa062-blessed-touch', baseRevision: 5,
      actorPlacementId: 'actor', abilityInstanceId: 'base:blessed-touch', canonicalId: 'Blessed Touch', modeId: 'activate',
    } }, dependencies)
    const option = offer.declarations[0]!.options.find(entry => entry.hint.kind === 'placement' && entry.hint.placementId === 'target')!
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1, intentId: 'intent:blessed-touch', offerId: offer.offerId, offerSha256: offer.offerSha256,
      mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
      abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
      selections: [{ declarationId: 'activate.target', kind: 'token', optionIds: [option.optionId] }],
    } }, dependencies)
    const actorAfter = dependencies.sheetRepository.getByRef('pokemon', actor.slug)!.sheet as unknown as CharacterSheet
    const targetAfter = dependencies.sheetRepository.getByRef('pokemon', target.slug)!.sheet as unknown as CharacterSheet
    expect(targetAfter.combat?.currentHp).toBeGreaterThan(10)
    expect(actorAfter.abilityUsage?.entries[0]).toMatchObject({ canonicalId: 'Blessed Touch', spent: 1, limit: 2 })
    expect(dependencies.mapRepository.getBySlug('aa062-blessed-touch')?.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
  }, 20_000)
})
