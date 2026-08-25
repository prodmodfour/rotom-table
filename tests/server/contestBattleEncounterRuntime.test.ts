import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteEncounterDocumentRepository } from '../../server/storage/encounterDocumentRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteMapInteractionModeRepository } from '../../server/storage/mapInteractionModeRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeContestCommandUseCase, loadContestUseCase } from '../../server/useCases/contests'
import { encounterSceneId } from '../../server/domain/moveAutomation/planSceneLifecycle'
import type { ContestGmProjectionV1, ContestPublicProjectionV1 } from '../../shared/contests/projections'
import type { TabletopMap } from '../../src/types/map'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const op = (id: string): string => `contest-op:v1:${id.replace(/[^a-z0-9-]/giu, '-').padEnd(8, 'x')}`
const base = (contestId: string, commandKind: string, id: string, expectedRevision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: op(id), expectedRevision, clientId: 'battle-encounter-runtime' })

const setup = (rosterSize = 3) => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const profiles = new Map<string, any>()
  for (const [side, trainerName, trainerSpeed] of [['north', 'Mara', 7], ['south', 'Dax', 8]] as const) {
    const trainerSlug = `trainer-${side}`, pokemonSlugs = Array.from({ length: rosterSize }, (_, index) => `pokemon-${side}-${index + 1}`)
    sheets.save({ kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: 1, document: { slug: trainerSlug, name: trainerName, level: 10, stats: { spd: { base: trainerSpeed } }, skills: { charm: { rankBonus: 1 }, command: { rankBonus: 2 } }, currentTeam: pokemonSlugs } })
    pokemonSlugs.forEach((slug, index) => sheets.save({ kind: 'pokemon', slug, revision: 0, updatedAt: 1, document: { slug, nickname: `${side} ${index + 1}`, species: 'Pikachu', level: 10, stats: { spd: { base: 10 + index } }, movelist: [{ name: 'Growl' }] } }))
    const profile = { id: `profile_${side}owner`, displayName: trainerName, linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }, ...pokemonSlugs.map(sheetSlug => ({ sheetKind: 'pokemon', sheetSlug }))], createdAt: 1, updatedAt: 1 }
    profiles.set(profile.id, profile)
  }
  const deps = {
    database,
    random: { nextInteger: (_minimum: number, maximum: number) => maximum },
    now: () => 900,
    readProfile: (id: unknown) => typeof id === 'string' ? profiles.get(id) ?? null : null,
    publishPersistedRealtimeEvent: () => {},
    reportAfterCommitPublicationFailure: () => {},
  }
  return { database, deps, profiles, rosterSize }
}

const prepare = (context: ReturnType<typeof setup>) => {
  const contestId = 'contest:v1:battle-encounter-runtime'
  let response = executeContestCommandUseCase({
    ...base(contestId, 'create-contest', 'create', 0),
    settings: { name: 'Neon Team Clash', hallName: 'Castelia Hall', description: '', variantId: 'battle', participantVariantId: null, participantMethodId: null, contestTypeId: 'cool', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private encounter plan' },
  }, { role: 'gm' }, context.deps)
  for (const side of ['north', 'south'] as const) response = executeContestCommandUseCase({
    ...base(contestId, 'enroll-contestant', `enroll-${side}`, response.result.revision), contestantId: `contestant:battle-${side}`, trainerSheetSlug: `trainer-${side}`,
    pokemonSheetSlugs: Array.from({ length: context.rosterSize }, (_, index) => `pokemon-${side}-${index + 1}`), controller: { kind: 'profile', profileId: `profile_${side}owner` }, rotationOrder: [],
  }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(base(contestId, 'start-introduction', 'start', response.result.revision), { role: 'gm' }, context.deps)
  for (const [side, skillId, statId] of [['north', 'command', 'cool'], ['south', 'charm', 'cute']] as const) response = executeContestCommandUseCase({
    ...base(contestId, 'declare-introduction', `intro-${side}`, response.result.revision), contestantId: `contestant:battle-${side}`, skillId, generatedStatId: statId, bonusStatIds: {},
  }, { role: 'gm' }, context.deps)
  return { contestId, response }
}

const linkCommand = (contestId: string, revision: number, id = 'link-encounter') => base(contestId, 'create-battle-encounter', id, revision)

describe('Battle Contest Encounter creation and immutable linking', () => {
  it('atomically creates normal opening Encounter authority and advances the Contest without Contest initiative', () => {
    const context = setup(); const { contestId, response } = prepare(context)
    const command = linkCommand(contestId, response.result.revision)
    const linked = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    expect(linked.result).toMatchObject({ commandKind: 'create-battle-encounter', exactRetry: false, stage: 'performance', revision: response.result.revision + 1 })

    const contest = createSqliteContestRepository(context.database).get(contestId)!.document
    const binding = contest.battle?.encounter
    expect(binding).not.toBeNull()
    expect(contest).toMatchObject({ stage: 'performance', round: 1, turnIndex: 0, currentRoundContestTypeId: 'cool' })
    expect(contest.contestants.every(team => team.letter === null)).toBe(true)
    expect(binding?.teams.map(team => team.pokemon.filter(member => member.openingPlacementId !== null).length)).toEqual([1, 1])
    expect(binding?.teams.map(team => team.pokemon.filter(member => member.openingPlacementId === null).length)).toEqual([2, 2])

    const encounterRepository = createSqliteEncounterDocumentRepository(context.database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(context.database)
    const encounter = encounterRepository.get(binding!.link.encounterId)!
    const map = mapRepository.getBySlug(binding!.link.linkedMapSlug)!
    expect(encounter).toMatchObject({ revision: 0, lifecycle: 'active', recipe: 'trainer-duel', linkedMapSlug: map.slug })
    expect(encounter.battleContest).toEqual(binding)
    expect(encounter.reserves.filter(reserve => reserve.status === 'deployed')).toHaveLength(2)
    expect(encounter.reserves.filter(reserve => reserve.status === 'ready')).toHaveLength(4)
    expect(encounter.castRoles).toHaveLength(4)
    expect(map).toMatchObject({ revision: 0, playerVisible: true, initiative: { activeId: binding!.openingActivePlacementId, round: 1 } })
    expect(map.placements).toHaveLength(4)
    expect(Object.keys(map.encounterState?.sides ?? {})).toEqual(['battle-team-1', 'battle-team-2'])
    expect(binding!.openingInitiativeOrderIds).toEqual(['battle-pokemon-1', 'battle-pokemon-2', 'battle-trainer-2', 'battle-trainer-1'])
    expect(new Set(binding!.openingInitiativeOrderIds)).toEqual(new Set(map.placements.map(placement => placement.id)))
    expect(map.activeScene).toBeDefined()
    expect(binding!.sceneId).toBe(encounterSceneId(map.slug, map.activeScene!))
    expect(createSqliteMapInteractionModeRepository(context.database).get(map.slug)).toEqual({ slug: map.slug, interactionMode: 'live-play', updatedAt: 900 })
    expect(binding!.link.contestRosterSha256).toMatch(/^[0-9a-f]{64}$/u)

    const publicProjection = loadContestUseCase(contestId, { role: 'player' }, context.deps) as ContestPublicProjectionV1
    expect(publicProjection.battle?.encounter).toEqual({ status: 'linked', encounterId: encounter.encounterId, mapSlug: map.slug, openingRound: 1, deployedCount: 4, readyReserveCount: 4 })
    const publicJson = JSON.stringify(publicProjection)
    for (const forbidden of ['battle-contest-link:v1:', 'contestRosterSha256', 'sceneId', 'openingInitiativeOrderIds', 'sheetSlug', 'providerIds', 'operationId', 'trainer-north', 'pokemon-north-', 'private encounter plan']) expect(publicJson).not.toContain(forbidden)
  })

  it('creates all twelve maximum-scale reserve records while still deploying one normal active Pokémon per side', () => {
    const context = setup(6); const { contestId, response } = prepare(context)
    executeContestCommandUseCase(linkCommand(contestId, response.result.revision, 'maximum-link'), { role: 'gm' }, context.deps)
    const contest = createSqliteContestRepository(context.database).get(contestId)!.document
    const encounter = createSqliteEncounterDocumentRepository(context.database).get(contest.battle!.encounter!.link.encounterId)!
    expect(contest.battle).toMatchObject({ declaredPokemonPerTrainer: 6, roundBudget: 12 })
    expect(encounter.reserves).toHaveLength(12)
    expect(encounter.reserves.filter(reserve => reserve.status === 'deployed')).toHaveLength(2)
    expect(encounter.reserves.filter(reserve => reserve.status === 'ready')).toHaveLength(10)
    expect(createSqliteMapRepository<TabletopMap>(context.database).getBySlug(encounter.linkedMapSlug)?.placements).toHaveLength(4)
  })

  it('returns an exact retry without creating duplicate maps, encounters, scenes, or initiative', () => {
    const context = setup(); const { contestId, response } = prepare(context)
    const command = linkCommand(contestId, response.result.revision, 'exact-link')
    const accepted = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    const retry = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    expect(retry.result).toMatchObject({ exactRetry: true, revision: accepted.result.revision, stage: 'performance' })
    expect(createSqliteMapRepository<TabletopMap>(context.database).list()).toHaveLength(1)
    expect(createSqliteEncounterDocumentRepository(context.database).list()).toHaveLength(1)
    expect(createSqliteContestRepository(context.database).get(contestId)?.document.history.filter(row => row.type === 'battle-encounter-linked')).toHaveLength(1)
    expect(() => executeContestCommandUseCase({ ...command, expectedRevision: accepted.result.revision }, { role: 'gm' }, context.deps)).toThrow(/operation ID was reused with changed input/i)
  })

  it('rejects player creation and client-authored map, placement, or initiative material before writes', () => {
    const context = setup(); const { contestId, response } = prepare(context)
    const command = linkCommand(contestId, response.result.revision, 'role-link')
    expect(() => executeContestCommandUseCase(command, { role: 'player', playerProfile: context.profiles.get('profile_northowner') }, context.deps)).toThrow(/Only the GM/i)
    expect(() => executeContestCommandUseCase({ ...command, operationId: op('forged-link'), mapSlug: 'forged-map', activePokemonPerformerId: 'pokemon:forged', initiativeOrderIds: [] }, { role: 'gm' }, context.deps)).toThrow(/not recognized/i)
    expect(createSqliteMapRepository<TabletopMap>(context.database).list()).toHaveLength(0)
    expect(createSqliteEncounterDocumentRepository(context.database).list()).toHaveLength(0)
    expect(createSqliteContestRepository(context.database).get(contestId)?.revision).toBe(response.result.revision)
  })

  it.each(['encounter', 'contest', 'realtime'] as const)('rolls back every authority when the %s write fails', (failure) => {
    const context = setup(); const { contestId, response } = prepare(context)
    const realtimeCountBefore = (context.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count
    const ordinaryEncounters = createSqliteEncounterDocumentRepository(context.database)
    const ordinaryContests = createSqliteContestRepository(context.database)
    const ordinaryRealtime = createSqliteRealtimeEventRepository({ database: context.database })
    const dependencies = failure === 'encounter'
      ? { ...context.deps, encounters: { ...ordinaryEncounters, create: (document: Parameters<typeof ordinaryEncounters.create>[0]) => { ordinaryEncounters.create(document); throw new Error('injected encounter write failure') } } }
      : failure === 'contest'
        ? { ...context.deps, contests: { ...ordinaryContests, replace: () => { throw new Error('injected Contest write failure') } } }
        : { ...context.deps, realtimeEvents: { database: context.database, appendMany: (inputs: Parameters<typeof ordinaryRealtime.appendMany>[0]) => { ordinaryRealtime.appendMany(inputs); throw new Error('injected realtime write failure') } } }
    expect(() => executeContestCommandUseCase(linkCommand(contestId, response.result.revision, `rollback-${failure}`), { role: 'gm' }, dependencies)).toThrow(/injected/i)
    expect(createSqliteContestRepository(context.database).get(contestId)?.revision).toBe(response.result.revision)
    expect(createSqliteContestRepository(context.database).get(contestId)?.document.battle?.encounter).toBeNull()
    expect(createSqliteMapRepository<TabletopMap>(context.database).list()).toHaveLength(0)
    expect(createSqliteEncounterDocumentRepository(context.database).list()).toHaveLength(0)
    expect((context.database.connection.prepare('SELECT COUNT(*) AS count FROM map_interaction_modes').get() as { count: number }).count).toBe(0)
    expect((context.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count).toBe(realtimeCountBefore)
    expect(createSqliteContestRepository(context.database).findOperation(op(`rollback-${failure}`))).toBeNull()
  })

  it('fails closed when a required roster sheet disappears before linking', () => {
    const context = setup(); const { contestId, response } = prepare(context)
    context.database.connection.prepare("DELETE FROM sheets WHERE kind = 'pokemon' AND slug = ?").run('pokemon-north-1')
    expect(() => executeContestCommandUseCase(linkCommand(contestId, response.result.revision, 'missing-sheet'), { role: 'gm' }, context.deps)).toThrow(/sheet pokemon-north-1 is unavailable/i)
    expect(createSqliteContestRepository(context.database).get(contestId)?.revision).toBe(response.result.revision)
    expect(createSqliteMapRepository<TabletopMap>(context.database).list()).toHaveLength(0)
    expect(createSqliteEncounterDocumentRepository(context.database).list()).toHaveLength(0)
  })

  it('keeps ordinary Contest Performance creation isolated from Encounter repositories', () => {
    const context = setup(); const { contestId } = prepare(context)
    const gm = loadContestUseCase(contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    expect(gm.variantId).toBe('battle')
    expect(createSqliteMapRepository<TabletopMap>(context.database).list()).toHaveLength(0)
    expect(createSqliteEncounterDocumentRepository(context.database).list()).toHaveLength(0)
  })
})
