import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { executeContestCommandUseCase, loadContestUseCase, ContestUseCaseError } from '../../server/useCases/contests'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import type { ContestGmProjectionV1, ContestOwnerProjectionV1, ContestPublicProjectionV1 } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const op = (value: string) => `contest-op:v1:${value.padEnd(8, 'x')}`
const common = (contestId: string, commandKind: string, operationId: string, expectedRevision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: op(operationId), expectedRevision, clientId: 'authority-test' })
const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  for (let index = 0; index < 3; index += 1) {
    sheets.save({ kind: 'trainer', slug: `trainer-${index}`, revision: 0, updatedAt: 1, document: { slug: `trainer-${index}`, name: `Trainer ${index}`, level: 5, skills: {}, inventory: {} } })
    sheets.save({ kind: 'pokemon', slug: `pokemon-${index}`, revision: 0, updatedAt: 1, document: { slug: `pokemon-${index}`, nickname: `Partner ${index}`, species: 'Pikachu', level: 10, totalExp: 100, stats: { spd: { base: 20 } }, movelist: [{ name: 'Charm' }, { name: 'Growl' }] } })
  }
  const player = { id: 'profile_player01', displayName: 'Player', linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-0' }, { sheetKind: 'pokemon', sheetSlug: 'pokemon-0' }], createdAt: 1, updatedAt: 1 } as any
  const spectator = { id: 'profile_spectate1', displayName: 'Spectator', linkedCharacters: [], createdAt: 1, updatedAt: 1 } as any
  const deps = { database, random: createSeededContestRandomSource(22), now: () => 100, readProfile: (id: unknown) => id === player.id ? player : id === spectator.id ? spectator : null, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} }
  return { database, sheets, player, spectator, deps }
}
const createAndEnroll = (context: ReturnType<typeof setup>, prizeDeclared = true, contestId = 'contest:v1:authority', awardRibbon = true) => {
  const tag = contestId.split(':').at(-1)!.slice(-12)
  let response = executeContestCommandUseCase({ ...common(contestId, 'create-contest', `create-${tag}`, 0), settings: { name: 'Private Contest', hallName: 'Hall', description: '', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon, prize: { declared: prizeDeclared, money: 500, items: [{ itemId: 'Poffin', quantity: 1, targetTrainerSlug: null }], notes: 'GM private prize' }, gmNotes: 'Private note' } }, { role: 'gm' }, context.deps)
  for (let index = 0; index < 3; index += 1) response = executeContestCommandUseCase({ ...common(contestId, 'enroll-contestant', `enroll-${tag}-${index}`, response.result.revision), contestantId: `contestant:a${index}`, trainerSheetSlug: `trainer-${index}`, pokemonSheetSlugs: [`pokemon-${index}`], controller: index === 0 ? { kind: 'profile', profileId: context.player.id } : { kind: 'gm' }, rotationOrder: [] }, { role: 'gm' }, context.deps)
  return { contestId, response }
}
const reachPerformance = (context: ReturnType<typeof setup>, contestId = 'contest:v1:authority', awardRibbon = true) => {
  const created = createAndEnroll(context, true, contestId, awardRibbon); let response = created.response
  const tag = contestId.split(':').at(-1)!.slice(-12)
  response = executeContestCommandUseCase(common(created.contestId, 'start-introduction', `startintro-${tag}`, response.result.revision), { role: 'gm' }, context.deps)
  for (let index = 0; index < 3; index += 1) response = executeContestCommandUseCase({ ...common(created.contestId, 'declare-introduction', `intro-${tag}-${index}`, response.result.revision), contestantId: `contestant:a${index}`, skillId: 'charm', generatedStatId: 'cute' }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(common(created.contestId, 'start-performance', `startperf-${tag}`, response.result.revision), { role: 'gm' }, context.deps)
  return { contestId: created.contestId, response }
}

describe('Contest role, concurrency, and rollback authority', () => {
  it('projects owner planning structurally and withholds GM/private prize fields from spectators', () => {
    const context = setup(); const { contestId } = createAndEnroll(context, false)
    const gm = loadContestUseCase(contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    const owner = loadContestUseCase(contestId, { role: 'player', playerProfile: context.player }, context.deps) as ContestOwnerProjectionV1
    const spectator = loadContestUseCase(contestId, { role: 'player', playerProfile: context.spectator }, context.deps) as ContestPublicProjectionV1
    expect(gm.gmNotes).toBe('Private note')
    expect(gm.policy.prize.notes).toBe('GM private prize')
    expect(owner.audience).toBe('owner')
    expect(owner.ownContestant.performers[0]!.moves.length).toBeGreaterThan(0)
    expect('contestants' in spectator).toBe(false)
    expect(spectator.declaredPrize).toBeNull()
    expect(JSON.stringify(spectator)).not.toContain('Private note')
    expect(JSON.stringify(spectator)).not.toContain('GM private prize')
  })

  it('allows only the assigned player controller to declare a private decision', () => {
    const context = setup(); const created = createAndEnroll(context)
    let response = executeContestCommandUseCase(common(created.contestId, 'start-introduction', 'introstart', created.response.result.revision), { role: 'gm' }, context.deps)
    response = executeContestCommandUseCase({ ...common(created.contestId, 'declare-introduction', 'ownintro', response.result.revision), contestantId: 'contestant:a0', skillId: 'charm', generatedStatId: 'cute' }, { role: 'player', playerProfile: context.player }, context.deps)
    expect((response.projection as ContestOwnerProjectionV1).ownContestant.introduction.status).toBe('accepted')
    expect(() => executeContestCommandUseCase({ ...common(created.contestId, 'declare-introduction', 'forgedintro', response.result.revision), contestantId: 'contestant:a1', skillId: 'charm', generatedStatId: 'cute' }, { role: 'player', playerProfile: context.player }, context.deps)).toThrowError(ContestUseCaseError)
  })

  it('rejects stale, forged, overspent, and conflicting operations without a score or journal write', () => {
    const context = setup(); const reached = reachPerformance(context)
    const before = reached.response.projection as ContestGmProjectionV1
    const actor = before.contestants.find(row => row.contestantId === before.activeContestantId)!
    const performer = actor.performers[0]!
    const validMove = performer.moves.find(row => row.available)!
    const stale = { ...common(reached.contestId, 'declare-appeal', 'staleop', before.revision - 1), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: validMove.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }
    expect(() => executeContestCommandUseCase(stale, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
    const forged = { ...stale, operationId: op('forged'), expectedRevision: before.revision, moveOptionId: 'move:not-offered' }
    expect(() => executeContestCommandUseCase(forged, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
    const overspent = { ...stale, operationId: op('overspend'), expectedRevision: before.revision, spentDice: { beauty: 0, cool: 0, cute: 4, smart: 0, tough: 0 } }
    expect(() => executeContestCommandUseCase(overspent, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
    const current = loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    expect(current.revision).toBe(before.revision)
    expect(current.acceptedAppeals).toHaveLength(0)
    const valid = { ...stale, operationId: op('sameid'), expectedRevision: before.revision }
    executeContestCommandUseCase(valid, { role: 'gm' }, context.deps)
    expect(() => executeContestCommandUseCase({ ...valid, moveOptionId: performer.moves.find(row => row.available && row.optionId !== validMove.optionId)!.optionId }, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
  })

  it('charges ordinary Trainer AP exactly once for a Contest Feature intervention', () => {
    const context = setup()
    const stored = context.sheets.getByRef('trainer', 'trainer-0')!
    const trainer = structuredClone(stored.sheet) as any
    trainer.ap = { max: 5, spent: 0, bound: 0, drained: 0 }
    trainer.features = [{ name: 'Reliable Performance', automation: { schemaVersion: 1, instanceId: 'feature:reliable-performance:1', canonicalId: 'Reliable Performance', definitionVersion: 1, rank: 1, choices: [], acquisition: { kind: 'gm', sourceId: 'authority-test' }, prerequisiteOverride: null } }]
    expect(context.sheets.applyLivePlayUpdate({ kind: 'trainer', slug: 'trainer-0', expectedRevision: stored.revision, nextSheet: trainer, sourceOperationId: op('grantfeature') })).toBe('applied')
    const reached = reachPerformance(context); let response = reached.response
    while ((response.projection as ContestGmProjectionV1).activeContestantId !== 'contestant:a0') {
      const projection = response.projection as ContestGmProjectionV1
      const actor = projection.contestants.find(row => row.contestantId === projection.activeContestantId)!
      const performer = actor.performers[0]!, move = performer.moves.find(row => row.available)!
      response = executeContestCommandUseCase({ ...common(reached.contestId, 'declare-appeal', `wait${response.result.revision}`, response.result.revision), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
    }
    const projection = response.projection as ContestGmProjectionV1
    const actor = projection.contestants.find(row => row.contestantId === 'contestant:a0')!
    const intervention = { ...common(reached.contestId, 'use-intervention', 'reliable', response.result.revision), contestantId: actor.contestantId, interventionId: 'Reliable Performance', targetContestantId: null, appealId: null, choices: {} }
    response = executeContestCommandUseCase(intervention, { role: 'gm' }, context.deps)
    expect((context.sheets.getByRef('trainer', 'trainer-0')!.sheet as any).featureApState.spent).toBe(2)
    expect(executeContestCommandUseCase(intervention, { role: 'gm' }, context.deps).result.exactRetry).toBe(true)
    expect((context.sheets.getByRef('trainer', 'trainer-0')!.sheet as any).featureApState.spent).toBe(2)
    expect(() => executeContestCommandUseCase({ ...intervention, operationId: op('reliabletwice'), expectedRevision: response.result.revision }, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
    expect((context.sheets.getByRef('trainer', 'trainer-0')!.sheet as any).featureApState.spent).toBe(2)
    const performer = actor.performers[0]!, move = performer.moves.find(row => row.available)!
    response = executeContestCommandUseCase({ ...common(reached.contestId, 'declare-appeal', 'reliableappeal', response.result.revision), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
    expect((response.projection as ContestGmProjectionV1).acceptedAppeals.at(-1)!.acceptedResults.every(value => value === 0)).toBe(true)
  })

  it('withdraws an inactive provider before its next Contest decision', () => {
    const context = setup()
    const stored = context.sheets.getByRef('pokemon', 'pokemon-0')!, pokemon = structuredClone(stored.sheet) as any
    pokemon.abilities = [{ name: 'Fashion Designer' }]
    expect(context.sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'pokemon-0', expectedRevision: stored.revision, nextSheet: pokemon, sourceOperationId: op('granttemporary') })).toBe('applied')
    const reached = reachPerformance(context); let response = reached.response
    while ((response.projection as ContestGmProjectionV1).activeContestantId !== 'contestant:a0') {
      const projection = response.projection as ContestGmProjectionV1, actor = projection.contestants.find(row => row.contestantId === projection.activeContestantId)!, performer = actor.performers[0]!, move = performer.moves.find(row => row.available)!
      response = executeContestCommandUseCase({ ...common(reached.contestId, 'declare-appeal', `providerwait${response.result.revision}`, response.result.revision), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
    }
    const current = context.sheets.getByRef('pokemon', 'pokemon-0')!, withoutAbility = structuredClone(current.sheet) as any
    withoutAbility.abilities = []
    expect(context.sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'pokemon-0', expectedRevision: current.revision, nextSheet: withoutAbility, sourceOperationId: op('removeprovider') })).toBe('applied')
    const refreshed = loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    const actor = refreshed.contestants.find(row => row.contestantId === 'contestant:a0')!
    expect(actor.performers[0]!.providerIds).not.toContain('ability:Fashion Designer')
    expect((loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1).revision).toBe(refreshed.revision)
    expect(() => executeContestCommandUseCase({ ...common(reached.contestId, 'use-intervention', 'staleprovider', refreshed.revision), contestantId: actor.contestantId, interventionId: 'Fashion Designer', targetContestantId: null, appealId: null, choices: {} }, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
    expect((context.sheets.getByRef('pokemon', 'pokemon-0')!.sheet as any).abilityUsage).toBeUndefined()
  })

  it('does not admit providers acquired after enrollment', () => {
    const context = setup()
    const reached = reachPerformance(context, 'contest:v1:later-provider')
    const stored = context.sheets.getByRef('pokemon', 'pokemon-0')!, pokemon = structuredClone(stored.sheet) as any
    pokemon.abilities = [{ name: 'Fashion Designer' }]
    expect(context.sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'pokemon-0', expectedRevision: stored.revision, nextSheet: pokemon, sourceOperationId: op('grantlater') })).toBe('applied')
    const refreshed = loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    const actor = refreshed.contestants.find(row => row.contestantId === 'contestant:a0')!
    expect(actor.performers[0]!.providerIds).not.toContain('ability:Fashion Designer')
    expect(() => executeContestCommandUseCase({ ...common(reached.contestId, 'use-intervention', 'laterprovider', refreshed.revision), contestantId: actor.contestantId, interventionId: 'Fashion Designer', targetContestantId: null, appealId: null, choices: {} }, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
    expect((context.sheets.getByRef('pokemon', 'pokemon-0')!.sheet as any).abilityUsage).toBeUndefined()
  })

  it('keeps an enrolled Contest snapshot readable while an ordinary sheet is missing', () => {
    const context = setup()
    const reached = reachPerformance(context, 'contest:v1:missing-sheet')
    const before = reached.response.projection as ContestGmProjectionV1
    const enrolled = before.contestants.find(row => row.contestantId === 'contestant:a0')!
    context.sheets.delete('pokemon', 'pokemon-0')
    const recovered = loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    const snapshot = recovered.contestants.find(row => row.contestantId === 'contestant:a0')!
    expect(snapshot.displayName).toBe(enrolled.displayName)
    expect(snapshot.performers[0]!.displayName).toBe(enrolled.performers[0]!.displayName)
    expect(snapshot.performers[0]!.moves).toEqual(enrolled.performers[0]!.moves)
    expect(recovered.revision).toBe(before.revision)
  })

  it('withdraws a passive Style Expert contribution once and keeps later loads stable', () => {
    const context = setup()
    const stored = context.sheets.getByRef('trainer', 'trainer-0')!, trainer = structuredClone(stored.sheet) as any
    trainer.features = [{ name: 'Style Expert', automation: { schemaVersion: 1, instanceId: 'feature:style-expert:1', canonicalId: 'Style Expert', definitionVersion: 1, rank: 1, choices: [{ choiceId: 'contestStat', values: ['Cute'] }], acquisition: { kind: 'gm', sourceId: 'authority-test' }, prerequisiteOverride: null } }]
    expect(context.sheets.applyLivePlayUpdate({ kind: 'trainer', slug: 'trainer-0', expectedRevision: stored.revision, nextSheet: trainer, sourceOperationId: op('grantstyle') })).toBe('applied')
    const reached = reachPerformance(context)
    const before = reached.response.projection as ContestGmProjectionV1
    const beforePool = before.contestants.find(row => row.contestantId === 'contestant:a0')!.performers[0]!.dicePools.cute
    const current = context.sheets.getByRef('trainer', 'trainer-0')!, withoutStyle = structuredClone(current.sheet) as any
    withoutStyle.features = []
    expect(context.sheets.applyLivePlayUpdate({ kind: 'trainer', slug: 'trainer-0', expectedRevision: current.revision, nextSheet: withoutStyle, sourceOperationId: op('removestyle') })).toBe('applied')
    const refreshed = loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    const afterPool = refreshed.contestants.find(row => row.contestantId === 'contestant:a0')!.performers[0]!.dicePools.cute
    expect(afterPool.total).toBe(beforePool.total - 2)
    expect(afterPool.contributors).toContainEqual(expect.objectContaining({ id: 'feature:style-expert:cute', active: false }))
    expect((loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1).revision).toBe(refreshed.revision)
  })

  it('charges Fashion Designer against the ordinary Pokémon Daily ledger', () => {
    const context = setup()
    const stored = context.sheets.getByRef('pokemon', 'pokemon-0')!
    const pokemon = structuredClone(stored.sheet) as any
    pokemon.abilities = [{ name: 'Fashion Designer' }]
    expect(context.sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'pokemon-0', expectedRevision: stored.revision, nextSheet: pokemon, sourceOperationId: op('grantfashion') })).toBe('applied')
    const reached = reachPerformance(context); let response = reached.response
    while ((response.projection as ContestGmProjectionV1).activeContestantId !== 'contestant:a0') {
      const projection = response.projection as ContestGmProjectionV1
      const actor = projection.contestants.find(row => row.contestantId === projection.activeContestantId)!, performer = actor.performers[0]!, move = performer.moves.find(row => row.available)!
      response = executeContestCommandUseCase({ ...common(reached.contestId, 'declare-appeal', `fashionwait${response.result.revision}`, response.result.revision), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
    }
    const projection = response.projection as ContestGmProjectionV1
    const actor = projection.contestants.find(row => row.contestantId === 'contestant:a0')!
    response = executeContestCommandUseCase({ ...common(reached.contestId, 'use-intervention', 'fashionuse', response.result.revision), contestantId: actor.contestantId, interventionId: 'Fashion Designer', targetContestantId: null, appealId: null, choices: {} }, { role: 'gm' }, context.deps)
    const usage = (context.sheets.getByRef('pokemon', 'pokemon-0')!.sheet as any).abilityUsage
    expect(usage.entries.find((row: any) => row.canonicalId === 'Fashion Designer')).toMatchObject({ spent: 1, limit: 1, clauseId: 'contest-decorative-twine' })
    const performer = actor.performers[0]!, move = performer.moves.find(row => row.available)!
    response = executeContestCommandUseCase({ ...common(reached.contestId, 'declare-appeal', 'fashionappeal', response.result.revision), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
    expect((response.projection as ContestGmProjectionV1).acceptedAppeals.at(-1)!.contributors.some(row => row.id === 'accepted-intervention' && row.dice === 2)).toBe(true)

    const driveToOwnedTurn = (journey: ReturnType<typeof reachPerformance>, tag: string) => {
      let current = journey.response
      while ((current.projection as ContestGmProjectionV1).activeContestantId !== 'contestant:a0') {
        const projected = current.projection as ContestGmProjectionV1, currentActor = projected.contestants.find(row => row.contestantId === projected.activeContestantId)!, currentPerformer = currentActor.performers[0]!, currentMove = currentPerformer.moves.find(row => row.available && row.optionId !== currentActor.lastMoveOptionId)!
        current = executeContestCommandUseCase({ ...common(journey.contestId, 'declare-appeal', `${tag}-${current.result.revision}`, current.result.revision), contestantId: currentActor.contestantId, performerId: currentPerformer.performerId, moveOptionId: currentMove.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
      }
      return current
    }
    const sameDay = reachPerformance(context, 'contest:v1:fashion-same-day'), sameDayResponse = driveToOwnedTurn(sameDay, 'samewait'), sameDayActor = (sameDayResponse.projection as ContestGmProjectionV1).contestants.find(row => row.contestantId === 'contestant:a0')!
    expect(() => executeContestCommandUseCase({ ...common(sameDay.contestId, 'use-intervention', 'fashionsameday', sameDayResponse.result.revision), contestantId: sameDayActor.contestantId, interventionId: 'Fashion Designer', targetContestantId: null, appealId: null, choices: {} }, { role: 'gm' }, context.deps)).toThrow(/already been used this campaign day/)
    expect((context.sheets.getByRef('pokemon', 'pokemon-0')!.sheet as any).abilityUsage.entries.find((row: any) => row.canonicalId === 'Fashion Designer').spent).toBe(1)

    const clockOperationId = `breeding-operation:v1:${'8'.repeat(32)}`
    context.database.connection.prepare("INSERT INTO breeding_operations (operation_id, command_sha256, command_kind, command_json, status, result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute) VALUES (?, ?, 'advance-campaign-clock', '{}', 'pending', NULL, NULL, 0, NULL)").run(clockOperationId, '8'.repeat(64))
    context.database.connection.prepare('UPDATE campaign_clock SET campaign_minute = 1440, revision = 1, last_operation_id = ?').run(clockOperationId)
    const nextDayResponse = driveToOwnedTurn({ contestId: reached.contestId, response } as ReturnType<typeof reachPerformance>, 'nextwait'), nextDayActor = (nextDayResponse.projection as ContestGmProjectionV1).contestants.find(row => row.contestantId === 'contestant:a0')!
    const nextDayCommand = { ...common(reached.contestId, 'use-intervention', 'fashionnextday', nextDayResponse.result.revision), contestantId: nextDayActor.contestantId, interventionId: 'Fashion Designer', targetContestantId: null, appealId: null, choices: {} }
    expect(executeContestCommandUseCase(nextDayCommand, { role: 'gm' }, context.deps).result.exactRetry).toBe(false)
    expect(executeContestCommandUseCase(nextDayCommand, { role: 'gm' }, context.deps).result.exactRetry).toBe(true)
    expect((context.sheets.getByRef('pokemon', 'pokemon-0')!.sheet as any).abilityUsage).toMatchObject({ dayKey: 'campaign-day:1', entries: [expect.objectContaining({ spent: 1 })] })
  })

  it('rolls back a Fashion Designer Daily charge when the Contest write fails', () => {
    const context = setup()
    const stored = context.sheets.getByRef('pokemon', 'pokemon-0')!, pokemon = structuredClone(stored.sheet) as any
    pokemon.abilities = [{ name: 'Fashion Designer' }]
    expect(context.sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'pokemon-0', expectedRevision: stored.revision, nextSheet: pokemon, sourceOperationId: op('grantrollback') })).toBe('applied')
    const reached = reachPerformance(context); let response = reached.response
    while ((response.projection as ContestGmProjectionV1).activeContestantId !== 'contestant:a0') {
      const projection = response.projection as ContestGmProjectionV1, actor = projection.contestants.find(row => row.contestantId === projection.activeContestantId)!, performer = actor.performers[0]!, move = performer.moves.find(row => row.available)!
      response = executeContestCommandUseCase({ ...common(reached.contestId, 'declare-appeal', `rollbackwait${response.result.revision}`, response.result.revision), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
    }
    const beforeRevision = response.result.revision, actor = (response.projection as ContestGmProjectionV1).contestants.find(row => row.contestantId === 'contestant:a0')!
    const base = createSqliteContestRepository(context.database)
    const contests = { ...base, replace: () => { throw new Error('injected Contest write failure') } }
    expect(() => executeContestCommandUseCase({ ...common(reached.contestId, 'use-intervention', 'fashionrollback', beforeRevision), contestantId: actor.contestantId, interventionId: 'Fashion Designer', targetContestantId: null, appealId: null, choices: {} }, { role: 'gm' }, { ...context.deps, contests, sheets: context.sheets })).toThrow(/injected Contest write failure/)
    expect((context.sheets.getByRef('pokemon', 'pokemon-0')!.sheet as any).abilityUsage).toBeUndefined()
    expect((loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1).revision).toBe(beforeRevision)
  })

  it('records explicit no-Ribbon evidence when the locked policy disables the award', () => {
    const context = setup(); const reached = reachPerformance(context, 'contest:v1:no-ribbon', false); let response = reached.response
    let appealIndex = 0
    while (response.result.stage === 'performance') {
      const projection = response.projection as ContestGmProjectionV1
      const actor = projection.contestants.find(row => row.contestantId === projection.activeContestantId)!, performer = actor.performers[0]!
      const move = performer.moves.find(row => row.available && row.optionId !== actor.lastMoveOptionId)!
      response = executeContestCommandUseCase({ ...common(reached.contestId, 'declare-appeal', `noribbon${appealIndex++}`, response.result.revision), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
    }
    response = executeContestCommandUseCase(common(reached.contestId, 'prepare-settlement', 'noribbonprep', response.result.revision), { role: 'gm' }, context.deps)
    response = executeContestCommandUseCase(common(reached.contestId, 'commit-settlement', 'noribboncommit', response.result.revision), { role: 'gm' }, context.deps)
    const projection = response.projection as ContestGmProjectionV1
    const winner = projection.contestants.find(row => row.finalPlacement === 1)!
    const pokemon = context.sheets.getByRef('pokemon', winner.performers[0]!.pokemonSheetSlug)!.sheet as any
    const trainer = context.sheets.getByRef('trainer', winner.trainerSheetSlug)!.sheet as any
    expect(pokemon.contestRibbons ?? []).toHaveLength(0)
    expect(trainer.contestResults.at(-1)).toMatchObject({ ribbonAwarded: false, ribbonIds: [] })
    expect(projection.settlement!.entries.find(row => row.placement === 1)!.ribbon).toBe(false)
  })

  it('rolls back Contest and ordinary sheets when a settlement write fails midway', () => {
    const context = setup(); const reached = reachPerformance(context); let response = reached.response
    let appealIndex = 0
    while (response.result.stage === 'performance') {
      const projection = response.projection as ContestGmProjectionV1
      const actor = projection.contestants.find(row => row.contestantId === projection.activeContestantId)!
      const performer = actor.performers[0]!
      const move = performer.moves.find(row => row.available && row.optionId !== actor.lastMoveOptionId)!
      response = executeContestCommandUseCase({ ...common(reached.contestId, 'declare-appeal', `appeal${appealIndex}`, response.result.revision), contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { role: 'gm' }, context.deps)
      appealIndex += 1
    }
    response = executeContestCommandUseCase(common(reached.contestId, 'prepare-settlement', 'prepare', response.result.revision), { role: 'gm' }, context.deps)
    const contests = createSqliteContestRepository(context.database)
    const original = context.sheets.applyLivePlayUpdate.bind(context.sheets)
    let calls = 0
    ;(context.sheets as any).applyLivePlayUpdate = (input: unknown) => ++calls === 2 ? 'conflict' : original(input as never)
    expect(() => executeContestCommandUseCase(common(reached.contestId, 'commit-settlement', 'rollback', response.result.revision), { role: 'gm' }, { ...context.deps, contests, sheets: context.sheets })).toThrowError(ContestUseCaseError)
    expect((loadContestUseCase(reached.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1).stage).toBe('settling')
    for (let index = 0; index < 3; index += 1) {
      expect((context.sheets.getByRef('trainer', `trainer-${index}`)!.sheet as any).contestResults).toBeUndefined()
      expect((context.sheets.getByRef('pokemon', `pokemon-${index}`)!.sheet as any).contestRibbons).toBeUndefined()
      expect(Object.values((context.sheets.getByRef('trainer', `trainer-${index}`)!.sheet as any).inventory ?? {}).flat().some((row: any) => row.name === 'Poffin')).toBe(false)
    }
  })
})
