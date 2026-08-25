import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { parseEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { battleContestHandoffCanonicalJson } from '#shared/contests/battleBlend'
import { CONTEST_STAT_IDS } from '#shared/contests/ids'
import { projectContestGm, projectContestOwner, projectContestPublic } from '#shared/contests/projections'
import { parseContestDocument } from '#shared/contests/document'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { initiativeOrderIdsForPlacements } from '~/utils/initiativeOrderEntries'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { TabletopMap } from '~/types/map'
import { pokemonExperienceNeededForLevel } from '~/utils/sheets/pokemonExperience'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteEncounterDocumentRepository } from '../../server/storage/encounterDocumentRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import {
  applyBattleContestVoltageLifecycleUseCase,
  endBattleContestUseCase,
  executeContestCommandUseCase,
  loadContestUseCase,
  scoreBattleContestAcceptedMoveUseCase,
} from '../../server/useCases/contests'
import { applyEncounterDirectorCommandUseCase } from '../../server/useCases/encounterDocuments'
import { prepareFinishEncounter } from '../../server/useCases/prepareFinishEncounter'
import { createSqliteEncounterSettlementRepository } from '../../server/storage/encounterSettlementRepository'
import { deriveBattleContestAcceptedMoveDelivery } from '../../server/domain/contests/battleAcceptedMove'
import {
  executeBattleContestLiveplayCommandUseCase,
  loadBattleContestLiveplayUseCase,
} from '../../server/useCases/battleContestLiveplay'
import { createLivePlayCommandHash } from '../../server/livePlay/opResult'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../../server/livePlay/sqliteCommandExecutor'
import { executeBattleContestAcceptedMoveAppeal } from '../../server/domain/contests/battleAppeal'
import { executeBattleContestVoltageLifecycle } from '../../server/domain/contests/battleVoltageLifecycle'
import { assertBattleContestSingleSpendConvergence } from '../../server/domain/contests/battleAccounting'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'

const harnesses: LivePlayIntegrationHarness[] = []
afterEach(() => { while (harnesses.length) harnesses.pop()!.dispose() })
const contestOp = (id: string): string => `contest-op:v1:${id.replace(/[^a-z0-9-]/giu, '-').padEnd(8, 'x')}`
const base = (contestId: string, commandKind: string, id: string, expectedRevision: number) => ({
  schemaVersion: 1, contestId, commandKind, operationId: contestOp(id), expectedRevision, clientId: 'battle-appeal-runtime',
})
const emptySpend = () => ({ beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 })
const opposingActivePokemon = (actorSheetSlug: string): string => actorSheetSlug.includes('-north-')
  ? 'battle-pokemon-south-1'
  : 'battle-pokemon-north-1'

const pokemon = (slug: string, nickname: string, speed: number, moves: string[]): CharacterSheet => ({
  slug, nickname, species: 'Pikachu', level: 20, revision: 0, types: ['Electric'],
  capabilities: { overland: 6 },
  stats: {
    hp: { base: 5, added: 20 }, atk: { base: 5, added: 5, stage: 0 }, def: { base: 5, added: 5, stage: 0 },
    satk: { base: 5, added: 5, stage: 0 }, sdef: { base: 5, added: 5, stage: 0 }, spd: { base: speed, added: 5, stage: 0 },
  },
  combatStages: { acc: 0 }, combat: { currentHp: 100, injuries: 0, conditions: [] },
  movelist: moves.map(name => ({ name })),
})
const trainer = (slug: string, name: string, team: string[], speed: number): TrainerSheet => ({
  slug, name, level: 10, currentTeam: team,
  stats: { hp: { base: 5 }, atk: { base: 5 }, def: { base: 5 }, satk: { base: 5 }, sdef: { base: 5 }, spd: { base: speed } },
  skills: { charm: { rankBonus: 2 }, command: { rankBonus: 3 } },
}) as TrainerSheet

const setup = () => {
  const harness = LivePlayIntegrationHarness.create({ random: () => 0.5 }); harnesses.push(harness)
  const profiles = new Map<string, any>()
  for (const [side, name] of [['north', 'Mara'], ['south', 'Dax']] as const) {
    const trainerSlug = `battle-trainer-${side}`
    const pokemonSlugs = Array.from({ length: 3 }, (_, index) => `battle-pokemon-${side}-${index + 1}`)
    harness.sheetRepository.save({ kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: 1, document: trainer(trainerSlug, name, pokemonSlugs, side === 'north' ? 8 : 7) as unknown as Record<string, unknown> })
    pokemonSlugs.forEach((slug, index) => harness.sheetRepository.save({
      kind: 'pokemon', slug, revision: 0, updatedAt: 1,
      document: pokemon(slug, `${name} ${index + 1}`, side === 'north' ? 30 - index : 15 - index, index === 0 ? ['Agility', 'Tackle', 'Thunder Wave', 'Follow Me', 'Rising Voltage', 'Howl', 'Wildbolt Storm', 'Triple Arrows'] : ['Focus Energy', 'Meditate', 'Growl']) as unknown as Record<string, unknown>,
    }))
    const profile = {
      id: `profile_battle_${side}`, displayName: name,
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }, ...pokemonSlugs.map(sheetSlug => ({ sheetKind: 'pokemon', sheetSlug }))],
    }
    profiles.set(profile.id, profile)
  }
  const deps = {
    database: harness.database,
    random: { nextInteger: (_minimum: number, maximum: number) => maximum },
    now: () => 2_000,
    readProfile: (id: unknown) => typeof id === 'string' ? profiles.get(id) ?? null : null,
    publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {},
  }
  return { harness, deps, profiles }
}

const prepareLinked = (context: ReturnType<typeof setup>) => {
  const contestId = 'contest:v1:battle-accepted-move'
  let response = executeContestCommandUseCase({
    ...base(contestId, 'create-contest', 'create', 0),
    settings: {
      name: 'Accepted Move Showcase', hallName: 'Castelia Hall', description: '', variantId: 'battle', participantVariantId: null,
      participantMethodId: null, contestTypeId: 'cool', significanceMultiplier: 1, awardRibbon: true,
      prize: { declared: true, money: 500, items: [{ itemId: 'Potion', quantity: 2, targetTrainerSlug: null }], notes: '' }, gmNotes: 'private battle plan',
    },
  }, { role: 'gm' }, context.deps)
  for (const side of ['north', 'south'] as const) response = executeContestCommandUseCase({
    ...base(contestId, 'enroll-contestant', `enroll-${side}`, response.result.revision), contestantId: `contestant:battle-${side}`,
    trainerSheetSlug: `battle-trainer-${side}`, pokemonSheetSlugs: Array.from({ length: 3 }, (_, index) => `battle-pokemon-${side}-${index + 1}`),
    controller: { kind: 'profile', profileId: `profile_battle_${side}` }, rotationOrder: [],
  }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(base(contestId, 'start-introduction', 'start-intro', response.result.revision), { role: 'gm' }, context.deps)
  for (const [side, skillId, statId] of [['north', 'command', 'cool'], ['south', 'charm', 'cute']] as const) response = executeContestCommandUseCase({
    ...base(contestId, 'declare-introduction', `intro-${side}`, response.result.revision), contestantId: `contestant:battle-${side}`,
    skillId, generatedStatId: statId, bonusStatIds: {},
  }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(base(contestId, 'create-battle-encounter', 'link', response.result.revision), { role: 'gm' }, context.deps)
  return { contestId, response }
}

const performAgility = async (
  context: ReturnType<typeof setup>,
  contestId: string,
  sourceOperationId = 'op_battle_agility_001',
) => {
  const contestRepository = createSqliteContestRepository(context.harness.database)
  const contest = contestRepository.get(contestId)!.document
  const binding = contest.battle!.encounter!
  const map = createSqliteMapRepository<TabletopMap>(context.harness.database).getBySlug(binding.link.linkedMapSlug)!
  const actorPlacementId = map.initiative?.activeId ?? ''
  const actorTeam = binding.teams.find(team => team.pokemon.some(member => member.openingPlacementId === actorPlacementId))!
  expect(actorTeam).toBeDefined()
  const intent = { schemaVersion: 1 as const, placementId: actorPlacementId, moveName: 'Agility', selection: { kind: 'self' as const } }
  const scopes = buildResolveMoveScopes({ map, intent, candidateScopePlacementIds: [] })
  if (!scopes.ok) throw new Error(scopes.message)
  const command = {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION, opId: sourceOperationId, mapSlug: map.slug, baseRevision: map.revision!,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE, scopes: scopes.scopes, payload: intent,
  }
  const accepted = await context.harness.resolveMove({ actor: { role: 'gm', clientId: 'battle-move-gm' }, command })
  assertAccepted(accepted.result)
  expect(contestRepository.get(contestId)!.document).toEqual(contest)
  const acceptedMap = createSqliteMapRepository<TabletopMap>(context.harness.database).getBySlug(map.slug)!
  const history = parseEncounterHistory(acceptedMap.encounterState!.history)
  const move = history.moveUses.find(row => row.completion?.sourceOperationId === sourceOperationId)!
  if (!move) throw new Error(`Agility history missing: ${JSON.stringify({ result: accepted.result, history, mapRevision: acceptedMap.revision, state: acceptedMap.encounterState })}`)
  expect(move).toMatchObject({ canonicalId: 'Agility', actorPlacementId, completion: { round: 1, succeeded: true } })
  return { sourceOperationId, sourceResolutionId: move.resolutionId, acceptedMap, actorContestantId: actorTeam.contestantId, actorSheetSlug: actorTeam.pokemon[0]!.sheetSlug, command }
}

describe('Battle Contest Appeals from accepted Encounter Move results', () => {
  it('scores one source-bound Appeal, spends the Trainer-team pool once, preserves Encounter authority, and exact-replays', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const source = await performAgility(context, contestId)
    const contestBefore = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounterRepository = createSqliteEncounterDocumentRepository(context.harness.database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(context.harness.database)
    const encounterBefore = structuredClone(encounterRepository.get(contestBefore.battle!.encounter!.link.encounterId)!)
    const mapBefore = structuredClone(mapRepository.getBySlug(source.acceptedMap.slug)!)
    const opBefore = structuredClone(context.harness.opRepository.getStoredOpRecord(source.acceptedMap.slug, source.sourceOperationId)!)
    const spentStat = source.actorContestantId.endsWith('south') ? 'cute' as const : 'cool' as const
    const spentDice = { ...emptySpend(), [spentStat]: 1 }
    const input = {
      contestId, expectedRevision: response.result.revision, sourceOperationId: source.sourceOperationId,
      sourceResolutionId: source.sourceResolutionId, spentDice, clientId: 'battle-move-gm',
    }
    const scored = scoreBattleContestAcceptedMoveUseCase(input, context.deps)
    expect(scored.result).toMatchObject({ commandKind: 'score-battle-accepted-move', exactRetry: false, revision: response.result.revision + 1, stage: 'performance' })
    const after = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    expect(after.appealLedger).toHaveLength(1)
    expect(after.appealLedger[0]).toMatchObject({
      round: 1, contestantId: source.actorContestantId, moveLabel: 'Agility', moveTypeId: 'cool', contestTypeId: 'cool',
      performerId: expect.stringContaining(source.actorSheetSlug), spentDice: { [spentStat]: 1 },
    })
    expect(after.appealLedger[0]!.acceptedResults.length).toBe(after.appealLedger[0]!.assembledDice)
    expect(after.appealLedger[0]!.acceptedResults.every(value => value === 6)).toBe(true)
    expect(after.appealLedger[0]).toMatchObject({ appealDelta: after.appealLedger[0]!.acceptedResults.length * 2, fumbleDelta: 0, voltageBefore: 0, voltageAfter: 1, adjacentContestantIds: [expect.stringMatching(/^contestant:battle-/u)], consequences: [] })
    expect(after.battleHandoffReceipts).toEqual([expect.objectContaining({
      handoffId: expect.stringMatching(/^battle-contest-handoff:v1:/u), sourceResultId: expect.any(String), outcome: 'scored-appeal',
      appealId: after.appealLedger[0]!.appealId, contestRevisionBefore: response.result.revision, contestRevisionAfter: response.result.revision + 1,
    })])
    const actorTeam = after.contestants.find(row => row.contestantId === source.actorContestantId)!
    expect(actorTeam.battleTeamDiceSpendJournal).toHaveLength(1)
    expect(actorTeam.battleTeamDiceSpendJournal[0]).toMatchObject({ operationId: after.appealLedger[0]!.operationId, performerId: after.appealLedger[0]!.performerId, spentDice: { [spentStat]: 1 } })
    expect(actorTeam.teamContestDiceSpent).toBe(1)
    const acceptedDelivery = deriveBattleContestAcceptedMoveDelivery({
      document: contestBefore, encounterDocument: encounterBefore, map: mapBefore, sourceOperation: opBefore,
      sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId,
      contestOperationId: scored.result.operationId,
    })
    const accounting = assertBattleContestSingleSpendConvergence({ before: contestBefore, after, delivery: acceptedDelivery, sourceOperation: opBefore })
    expect(accounting).toMatchObject({
      exactRetry: false,
      encounterFrequency: { kind: 'eot', spendDelta: 1 },
      encounterAction: { actionType: 'standard', spendDelta: 1 },
      contestDiceSpent: 1,
      acceptedAppeals: 1,
      contestRandom: { drawCount: after.appealLedger[0]!.assembledDice },
    })
    const changedFrequency = structuredClone(opBefore) as any
    const changedFrequencyPatch = changedFrequency.result.patches.find((patch: any) => patch.type === 'move.state')
    const changedFrequencyMove = changedFrequencyPatch.payload.move
    changedFrequencyPatch.payload.changes.moveUsage.current.byPlacementId[changedFrequencyMove.actorPlacementId][changedFrequencyMove.moveKey].uses += 1
    expect(() => assertBattleContestSingleSpendConvergence({ before: contestBefore, after, delivery: acceptedDelivery, sourceOperation: changedFrequency })).toThrow(/frequency must spend exactly once/i)
    const changedAction = structuredClone(opBefore) as any
    const changedActionPatch = changedAction.result.patches.find((patch: any) => patch.type === 'move.state')
    changedActionPatch.payload.changes.encounterState.current.turnResources[source.acceptedMap.initiative!.activeId!].actions.standard.spent += 1
    expect(() => assertBattleContestSingleSpendConvergence({ before: contestBefore, after, delivery: acceptedDelivery, sourceOperation: changedAction })).toThrow(/action resource must spend exactly once/i)

    const rederived = deriveBattleContestAcceptedMoveDelivery({
      document: after, encounterDocument: encounterBefore, map: mapBefore, sourceOperation: opBefore,
      sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId,
      contestOperationId: scored.result.operationId,
    })
    expect(rederived.readSet.contestRevision).toBe(after.revision)
    expect(after.battleHandoffReceipts[0]).toMatchObject({ handoffId: rederived.fact.handoffId, handoffSha256: rederived.handoffSha256, sourceResultId: rederived.fact.sourceResultId })
    const duplicateDelivery = { ...rederived, operationId: 'contest-op:v1:duplicate-handoff-delivery' }
    const duplicate = executeBattleContestAcceptedMoveAppeal({
      document: after, delivery: duplicateDelivery, actorPokemonSheetSlug: source.actorSheetSlug,
      adjacentPokemonSheetSlugs: [opposingActivePokemon(source.actorSheetSlug)], spentDice, now: 2_002,
      random: { nextInteger: () => { throw new Error('duplicate delivery must not draw randomness') } },
    })
    expect(duplicate).toMatchObject({ exactRetry: true, document: after, receipt: after.battleHandoffReceipts[0] })
    expect(assertBattleContestSingleSpendConvergence({ before: after, after: duplicate.document, delivery: duplicateDelivery, sourceOperation: opBefore })).toMatchObject({
      exactRetry: true, proofSha256: accounting.proofSha256,
    })
    expect(encounterRepository.get(encounterBefore.encounterId)).toEqual(encounterBefore)
    expect(context.harness.operationRecordCount()).toBe(1)
    expect(mapRepository.getBySlug(mapBefore.slug)).toEqual(mapBefore)
    expect(context.harness.opRepository.getStoredOpRecord(mapBefore.slug, source.sourceOperationId)).toEqual(opBefore)

    const publicProjection = loadContestUseCase(contestId, { role: 'player' }, context.deps)
    expect(publicProjection.acceptedAppeals).toHaveLength(1)
    const diagnostic = loadContestUseCase(contestId, { role: 'gm', diagnostic: true }, context.deps) as any
    expect(diagnostic.battleHandoffReceipts).toEqual(after.battleHandoffReceipts)
    const publicJson = JSON.stringify(publicProjection)
    for (const forbidden of [source.sourceOperationId, source.sourceResolutionId, 'battle-contest-handoff:v1:', 'journalIds', 'operationId', 'providerIds', 'pokemonSheetSlug', 'trainerSheetSlug', 'private battle plan']) expect(publicJson).not.toContain(forbidden)

    const acceptedDocument = structuredClone(createSqliteContestRepository(context.harness.database).get(contestId)!.document)
    const retry = scoreBattleContestAcceptedMoveUseCase(input, {
      ...context.deps,
      random: { nextInteger: () => { throw new Error('reconnect exact retry must not draw randomness') } },
    })
    expect(retry.result).toMatchObject({ exactRetry: true, revision: scored.result.revision })
    const retryDocument = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    expect(retryDocument).toEqual(acceptedDocument)
    const retryAccounting = assertBattleContestSingleSpendConvergence({ before: acceptedDocument, after: retryDocument, delivery: rederived, sourceOperation: opBefore })
    expect(retryAccounting).toMatchObject({ exactRetry: true, proofSha256: accounting.proofSha256, encounterFrequency: { spendDelta: 1 }, encounterAction: { spendDelta: 1 }, contestDiceSpent: 1 })
    expect(() => scoreBattleContestAcceptedMoveUseCase({ ...input, spentDice: emptySpend() }, context.deps)).toThrow(/operation ID was reused with changed input/i)
  })

  it('reinterprets canonical effects against the acting Pokémon and every opposing on-field Pokémon', async () => {
    const context = setup(); const { contestId } = prepareLinked(context)
    const source = await performAgility(context, contestId)
    const initial = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounter = createSqliteEncounterDocumentRepository(context.harness.database).get(initial.battle!.encounter!.link.encounterId)!
    const sourceOperation = context.harness.opRepository.getStoredOpRecord(source.acceptedMap.slug, source.sourceOperationId)!
    const baseDelivery = deriveBattleContestAcceptedMoveDelivery({
      document: initial, encounterDocument: encounter, map: source.acceptedMap, sourceOperation,
      sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId,
      contestOperationId: 'contest-op:v1:effect-base',
    })
    if (baseDelivery.fact.kind !== 'accepted-move') throw new Error('Expected accepted Move handoff.')
    const actorTeam = initial.battle!.encounter!.teams.find(team => team.contestantId === source.actorContestantId)!
    const opposingTeam = initial.battle!.encounter!.teams.find(team => team.contestantId !== source.actorContestantId)!
    for (const team of initial.battle!.encounter!.teams) {
      const contestant = initial.contestants.find(row => row.contestantId === team.contestantId)!
      expect(Object.keys(contestant.performerVoltages).sort()).toEqual(team.pokemon.map(row => row.performerId).sort())
      expect(Object.values(contestant.performerVoltages)).toEqual([0, 0, 0])
      expect(contestant.voltage).toBe(0)
    }
    const actorSlug = actorTeam.pokemon[0]!.sheetSlug
    const opposingSlug = opposingTeam.pokemon[0]!.sheetSlug
    const actorPerformerId = actorTeam.pokemon[0]!.performerId
    const opposingPerformerId = opposingTeam.pokemon[0]!.performerId
    const delivery = (document: typeof initial, moveName: string, sequence: number, actingTeam = actorTeam) => {
      const hexadecimal = (sequence % 16).toString(16)
      const fact = {
        ...baseDelivery.fact,
        handoffId: `battle-contest-handoff:v1:effect-${sequence}` as const,
        sourceResultId: `event.battle.effect.${sequence}`,
        sourceResultSha256: hexadecimal.repeat(64),
        occurredAt: 2_100 + sequence,
        payload: {
          ...baseDelivery.fact.payload,
          completionEventId: `event.move.effect.${sequence}`,
          sourceOperationId: `op_battle_effect_${String(sequence).padStart(3, '0')}`,
          resolutionId: `resolution.battle.effect.${sequence}`,
          round: 1,
          completionOrder: sequence,
          actorPlacementId: actingTeam.pokemon[0]!.openingPlacementId!,
          canonicalMoveId: moveName,
        },
      }
      return {
        ...baseDelivery,
        operationId: contestOp(`effect-${sequence}`),
        readSet: { ...baseDelivery.readSet, contestRevision: document.revision },
        fact,
        handoffSha256: createHash('sha256').update(battleContestHandoffCanonicalJson(fact)).digest('hex'),
      }
    }
    const execute = (document: typeof initial, moveName: string, sequence: number, actingTeam = actorTeam, adjacentMemberIndexes: readonly number[] = [0]) => executeBattleContestAcceptedMoveAppeal({
      document,
      delivery: delivery(document, moveName, sequence, actingTeam),
      actorPokemonSheetSlug: actingTeam.pokemon[0]!.sheetSlug,
      adjacentPokemonSheetSlugs: adjacentMemberIndexes.map(index => (actingTeam === actorTeam ? opposingTeam : actorTeam).pokemon[index]!.sheetSlug),
      spentDice: emptySpend(),
      now: 2_100 + sequence,
      random: { nextInteger: (_minimum, maximum) => maximum },
    })

    expect(() => executeBattleContestAcceptedMoveAppeal({
      document: initial,
      delivery: delivery(initial, 'Thunder Wave', 1),
      actorPokemonSheetSlug: actorSlug,
      adjacentPokemonSheetSlugs: [],
      spentDice: emptySpend(),
      now: 2_101,
      random: { nextInteger: () => { throw new Error('invalid adjacency must not roll') } },
    })).toThrow(/exactly every opposing on-field Pokémon/i)

    let document = execute(initial, 'Thunder Wave', 1).document
    expect(document.contestants.find(row => row.contestantId === actorTeam.contestantId)!.performerVoltages[actorPerformerId]).toBe(2)
    document = execute(document, 'Thunder Wave', 2, opposingTeam).document
    expect(document.contestants.find(row => row.contestantId === opposingTeam.contestantId)!.performerVoltages[opposingPerformerId]).toBe(2)

    const attention = execute(document, 'Rising Voltage', 3)
    document = attention.document
    expect(attention.appeal).toMatchObject({
      effectId: 'attention-grabber',
      adjacentContestantIds: [opposingTeam.contestantId],
      consequences: expect.arrayContaining([
        expect.objectContaining({ contestantId: actorTeam.contestantId, performerId: actorPerformerId, voltageDelta: 2, reason: 'Attention Grabber' }),
        expect.objectContaining({ contestantId: opposingTeam.contestantId, performerId: opposingPerformerId, voltageDelta: -2, reason: 'Attention Grabber' }),
      ]),
    })
    expect(document.contestants.find(row => row.contestantId === actorTeam.contestantId)!.performerVoltages[actorPerformerId]).toBe(4)
    expect(document.contestants.find(row => row.contestantId === opposingTeam.contestantId)!.performerVoltages[opposingPerformerId]).toBe(0)

    const teased = execute(document, 'Follow Me', 4)
    expect(teased.appeal).toMatchObject({
      effectId: 'tease',
      consequences: [expect.objectContaining({ contestantId: opposingTeam.contestantId, performerId: null, fumbleDelta: teased.appeal!.acceptedResults.length, reason: 'Tease' })],
    })
    expect(teased.document.contestants.find(row => row.contestantId === opposingTeam.contestantId)!.fumble).toBe(teased.appeal!.acceptedResults.length)
    expect(teased.document.contestants.every(row => row.voltage === 0)).toBe(true)
    expect(teased.document.contestants.find(row => row.contestantId === actorTeam.contestantId)!.performerVoltages).toMatchObject({ [actorPerformerId]: 4 })
    expect(teased.document.contestants.find(row => row.contestantId === actorTeam.contestantId)!.performerVoltages).not.toHaveProperty(actorSlug)
    expect(opposingSlug).toBe(opposingActivePokemon(actorSlug))

    const pluralAdjacency = execute(teased.document, 'Triple Arrows', 5, actorTeam, [0, 1])
    expect(pluralAdjacency.appeal).toMatchObject({
      effectId: 'special-attention',
      adjacentPerformerIds: [opposingTeam.pokemon[0]!.performerId, opposingTeam.pokemon[1]!.performerId],
    })
    expect(pluralAdjacency.appeal!.consequences.filter(row => row.reason === 'Special Attention')).toHaveLength(2)
    expect(pluralAdjacency.document.contestants.find(row => row.contestantId === opposingTeam.contestantId)!.performerVoltages).toMatchObject({
      [opposingTeam.pokemon[0]!.performerId]: 1,
      [opposingTeam.pokemon[1]!.performerId]: 1,
    })

    const publicProjection = projectContestPublic(pluralAdjacency.document)
    const publicActor = publicProjection.scoreboard.find(row => row.contestantId === actorTeam.contestantId)!
    expect(publicActor.performers).toHaveLength(3)
    expect(publicActor.performers.map(row => row.voltage)).toContain(4)
    expect(JSON.stringify(publicProjection)).not.toContain(actorSlug)
    expect(JSON.stringify(publicProjection)).not.toContain(actorPerformerId)
    expect(JSON.stringify(publicProjection)).not.toContain('providerIds')
    const ownerProfileId = actorTeam.contestantId.endsWith('north') ? 'profile_battle_north' : 'profile_battle_south'
    const ownerProjection = projectContestOwner(teased.document, ownerProfileId)!
    expect(ownerProjection.ownContestant.performerVoltages[actorPerformerId]).toBe(4)
    expect(ownerProjection.ownContestant.teamDicePools).toBeDefined()
    const gmProjection = projectContestGm(teased.document)
    expect(gmProjection.contestants.find(row => row.contestantId === opposingTeam.contestantId)!.performerVoltages[opposingPerformerId]).toBe(0)
    expect(publicProjection.scoreboard.every(row => !Object.hasOwn(row, 'teamDicePools'))).toBe(true)
    expect(JSON.stringify(publicProjection)).not.toContain('adjacentPerformerIds')

    const forgedEffect = structuredClone(teased.document) as any
    const forgedAppeal = forgedEffect.appealLedger.find((row: any) => row.effectId === 'attention-grabber')
    forgedAppeal.consequences.find((row: any) => row.contestantId === opposingTeam.contestantId).voltageDelta += 1
    forgedEffect.contestants.find((row: any) => row.contestantId === opposingTeam.contestantId).performerVoltages[opposingPerformerId] += 1
    expect(() => parseContestDocument(forgedEffect)).toThrow(/canonical Battle Contest Effect consequences/i)
    const forgedVoltage = structuredClone(teased.document) as any
    forgedVoltage.contestants.find((row: any) => row.contestantId === actorTeam.contestantId).performerVoltages[actorPerformerId] = 5
    expect(() => parseContestDocument(forgedVoltage)).toThrow(/does not reconcile with accepted Battle Pokémon Appeal, Effect, and lifecycle evidence/i)
  })

  it('preserves an exact mixed-case live-play operation identity through history and scoring', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const sourceOperationId = 'op_Battle_Agility_Upper_001'
    const source = await performAgility(context, contestId, sourceOperationId)
    const scored = scoreBattleContestAcceptedMoveUseCase({
      contestId,
      expectedRevision: response.result.revision,
      sourceOperationId,
      sourceResolutionId: source.sourceResolutionId,
      spentDice: emptySpend(),
    }, context.deps)
    expect(scored.result).toMatchObject({ exactRetry: false, revision: response.result.revision + 1 })
    const diagnostic = loadContestUseCase(contestId, { role: 'gm', diagnostic: true }, context.deps) as any
    expect(diagnostic.battleHandoffReceipts[0]).toMatchObject({
      handoffId: expect.stringMatching(/^battle-contest-handoff:v1:/u),
      sourceResultId: expect.stringMatching(/^event\.move\./u),
    })
  })

  it('rejects public command ingress, manual Battle Appeals, and missing or mismatched accepted source authority without writes', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const linked = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const serverCommand = {
      ...base(contestId, 'score-battle-accepted-move', 'forged-handoff', response.result.revision),
      sourceOperationId: 'op_forged_move_001', sourceResolutionId: 'resolution.forged', spentDice: emptySpend(),
    }
    expect(() => executeContestCommandUseCase(serverCommand, { role: 'gm' }, context.deps)).toThrow(/server coordinator/i)
    const performer = linked.contestants[0]!.performers[0]!
    expect(() => executeContestCommandUseCase({
      ...base(contestId, 'declare-appeal', 'manual-appeal', response.result.revision), contestantId: linked.contestants[0]!.contestantId,
      performerId: performer.performerId, moveOptionId: performer.moves[0]!.optionId, partnerEffectTargetPerformerId: null, spentDice: emptySpend(),
    }, { role: 'gm' }, context.deps)).toThrow(/typed accepted Encounter Move results/i)
    expect(() => scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId: 'op_missing_move_001', sourceResolutionId: 'resolution.missing', spentDice: emptySpend(),
    }, context.deps)).toThrow(/operation is unavailable/i)
    expect(() => scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId: 'op_missing_move_002', sourceResolutionId: 'resolution.missing-two', spentDice: emptySpend(),
      map: { revision: 99 }, roll: [6, 6, 6], actorPlacementId: 'forged-actor', round: 9,
    } as any, context.deps)).toThrow(/accepts no client-authored result/i)
    expect(createSqliteContestRepository(context.harness.database).get(contestId)!.document).toEqual(linked)
  })

  it('fails closed on malformed history, stale Scene, actor mismatch, and unavailable Contest Move authority', async () => {
    const context = setup(); const { contestId } = prepareLinked(context)
    const source = await performAgility(context, contestId)
    const document = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounter = createSqliteEncounterDocumentRepository(context.harness.database).get(document.battle!.encounter!.link.encounterId)!
    const sourceOperation = context.harness.opRepository.getStoredOpRecord(source.acceptedMap.slug, source.sourceOperationId)!
    const derive = (map: TabletopMap, sourceResolutionId = source.sourceResolutionId) => deriveBattleContestAcceptedMoveDelivery({
      document, encounterDocument: encounter, map, sourceOperation,
      sourceOperationId: source.sourceOperationId, sourceResolutionId,
      contestOperationId: 'contest-op:v1:fail-closed-source',
    })
    expect(() => derive(source.acceptedMap, 'resolution.absent')).toThrow(/no matching completed Move history row/i)
    const malformedMap = structuredClone(source.acceptedMap) as any
    malformedMap.encounterState.history.moveUses[0].completion.branches = [{ selectionId: 'duplicate', recipientId: null, branchId: 'one' }, { selectionId: 'duplicate', recipientId: null, branchId: 'two' }]
    expect(() => derive(malformedMap)).toThrow(/history is malformed/i)
    const staleSceneMap = structuredClone(source.acceptedMap)
    staleSceneMap.activeScene = { ...staleSceneMap.activeScene!, startedAt: Number(staleSceneMap.activeScene!.startedAt ?? 0) + 1 }
    expect(() => derive(staleSceneMap)).toThrow(/active linked Encounter Scene/i)

    const delivery = derive(source.acceptedMap)
    expect(() => executeBattleContestAcceptedMoveAppeal({
      document, delivery, actorPokemonSheetSlug: 'not-enrolled', adjacentPokemonSheetSlugs: [opposingActivePokemon(source.actorSheetSlug)], spentDice: emptySpend(), now: 2_001,
      random: { nextInteger: () => { throw new Error('invalid actor must never roll') } },
    })).toThrow(/not one enrolled Pokémon/i)
    const unavailable = structuredClone(document) as any
    const actor = unavailable.contestants.flatMap((row: any) => row.performers).find((row: any) => row.pokemonSheetSlug === source.actorSheetSlug)
    const option = actor.moves.find((row: any) => row.canonicalMoveId === 'Agility')
    option.available = false
    option.unavailableCode = 'contest.test-unavailable'
    option.unavailableReason = 'Test unavailable source.'
    expect(() => executeBattleContestAcceptedMoveAppeal({
      document: unavailable, delivery, actorPokemonSheetSlug: source.actorSheetSlug, adjacentPokemonSheetSlugs: [opposingActivePokemon(source.actorSheetSlug)], spentDice: emptySpend(), now: 2_001,
      random: { nextInteger: () => { throw new Error('unavailable Move must never roll') } },
    })).toThrow(/exactly one available app-owned canonical Contest identity/i)
  })

  it('scores a performed Move even when the accepted Encounter outcome misses', async () => {
    const context = setup(); const { contestId } = prepareLinked(context)
    const source = await performAgility(context, contestId)
    const document = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounter = createSqliteEncounterDocumentRepository(context.harness.database).get(document.battle!.encounter!.link.encounterId)!
    const sourceOperation = context.harness.opRepository.getStoredOpRecord(source.acceptedMap.slug, source.sourceOperationId)!
    const baseDelivery = deriveBattleContestAcceptedMoveDelivery({
      document, encounterDocument: encounter, map: source.acceptedMap, sourceOperation,
      sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId,
      contestOperationId: 'contest-op:v1:miss-source-base',
    })
    if (baseDelivery.fact.kind !== 'accepted-move') throw new Error('Expected accepted Move handoff.')
    const targetPlacementId = document.battle!.encounter!.teams.find(team => team.contestantId !== source.actorContestantId)!.pokemon[0]!.openingPlacementId!
    const missFact = {
      ...baseDelivery.fact,
      handoffId: `battle-contest-handoff:v1:${'b'.repeat(40)}` as const,
      sourceResultId: 'event.move.miss-consumer-test',
      payload: {
        ...baseDelivery.fact.payload,
        canonicalMoveId: 'Tackle', sourceActionKind: 'pokemon-move' as const,
        attackedTargetIds: [targetPlacementId], hitTargetIds: [], outcome: 'miss' as const, succeeded: false,
      },
    }
    const delivery = {
      ...baseDelivery,
      operationId: 'contest-op:v1:accepted-miss-appeal',
      fact: missFact,
      handoffSha256: createHash('sha256').update(battleContestHandoffCanonicalJson(missFact)).digest('hex'),
    }
    let rolls = 0
    const scored = executeBattleContestAcceptedMoveAppeal({
      document, delivery, actorPokemonSheetSlug: source.actorSheetSlug, adjacentPokemonSheetSlugs: [opposingActivePokemon(source.actorSheetSlug)], spentDice: emptySpend(), now: 2_001,
      random: { nextInteger: (_minimum, maximum) => { rolls += 1; return maximum } },
    })
    expect(scored).toMatchObject({ exactRetry: false, appeal: { moveLabel: 'Tackle', appealDelta: expect.any(Number) }, receipt: { outcome: 'scored-appeal' } })
    expect(scored.appeal!.acceptedResults).toHaveLength(rolls)
    expect(rolls).toBeGreaterThan(0)
  })

  it('records Struggle as a canonical no-roll exclusion and rejects maneuver-shaped sources before Contest mutation', async () => {
    const context = setup(); const { contestId } = prepareLinked(context)
    const source = await performAgility(context, contestId)
    const document = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounter = createSqliteEncounterDocumentRepository(context.harness.database).get(document.battle!.encounter!.link.encounterId)!
    const map = structuredClone(source.acceptedMap)
    const sourceOperation = structuredClone(context.harness.opRepository.getStoredOpRecord(map.slug, source.sourceOperationId)!) as any
    const history = map.encounterState!.history as any
    for (const row of [...history.moveUses, ...history.lastDeclaredMoves, ...history.lastCompletedMoves]) row.canonicalId = 'Struggle'
    sourceOperation.command.payload.moveName = 'Struggle'
    sourceOperation.commandHash = createLivePlayCommandHash(sourceOperation.command)
    const movePatch = sourceOperation.result.patches.find((patch: any) => patch.type === 'move.state')
    const patchHistory = movePatch.payload.changes.encounterState.current.history
    for (const row of [...patchHistory.moveUses, ...patchHistory.lastDeclaredMoves, ...patchHistory.lastCompletedMoves]) row.canonicalId = 'Struggle'
    movePatch.payload.move.moveName = 'Struggle'
    movePatch.payload.move.canonicalMoveName = 'Struggle'
    movePatch.payload.move.trace.program.canonicalId = 'Struggle'
    movePatch.payload.presentation.move.name = 'Struggle'
    sourceOperation.result.presentation.source.canonicalId = 'Struggle'
    sourceOperation.result.presentation.source.displayName = 'Struggle'
    const delivery = deriveBattleContestAcceptedMoveDelivery({
      document, encounterDocument: encounter, map, sourceOperation,
      sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId,
      contestOperationId: 'contest-op:v1:struggle-exclusion',
    })
    expect(delivery.fact).toMatchObject({ kind: 'accepted-move', payload: { canonicalMoveId: 'Struggle', sourceActionKind: 'struggle-attack' } })
    const excluded = executeBattleContestAcceptedMoveAppeal({
      document, delivery, actorPokemonSheetSlug: source.actorSheetSlug, adjacentPokemonSheetSlugs: [opposingActivePokemon(source.actorSheetSlug)], spentDice: emptySpend(), now: 2_001,
      random: { nextInteger: () => { throw new Error('Struggle exclusion must never roll') } },
    })
    expect(excluded).toMatchObject({ exactRetry: false, appeal: null, receipt: { outcome: 'canonical-exclusion', appealId: null } })
    expect(excluded.document.appealLedger).toHaveLength(0)
    expect(excluded.document.diceJournal).toHaveLength(document.diceJournal.length)
    expect(excluded.document.contestants.map(row => row.teamContestDiceSpent)).toEqual(document.contestants.map(row => row.teamContestDiceSpent))
    expect(assertBattleContestSingleSpendConvergence({ before: document, after: excluded.document, delivery, sourceOperation })).toMatchObject({
      encounterFrequency: { spendDelta: 1 }, encounterAction: { spendDelta: 1 },
      contestRandom: { drawCount: 0 }, contestDiceSpent: 0, acceptedAppeals: 0,
    })

    const maneuverSource = structuredClone(sourceOperation)
    maneuverSource.command.type = LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER
    expect(() => deriveBattleContestAcceptedMoveDelivery({
      document, encounterDocument: encounter, map, sourceOperation: maneuverSource,
      sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId,
      contestOperationId: 'contest-op:v1:maneuver-exclusion',
    })).toThrow(/source command does not match/i)
    expect(document.battleHandoffReceipts).toHaveLength(0)
  })

  it('rejects a linked-map revision change during the final handoff re-read without Contest writes', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const source = await performAgility(context, contestId)
    const contestRepository = createSqliteContestRepository(context.harness.database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(context.harness.database)
    const before = contestRepository.get(contestId)!.document
    let reads = 0
    expect(() => scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId, spentDice: emptySpend(),
    }, {
      ...context.deps,
      maps: {
        ...mapRepository,
        getBySlug: (slug: string) => {
          const current = mapRepository.getBySlug(slug)
          reads += 1
          return current && reads > 1 ? { ...current, revision: Number(current.revision) + 1 } : current
        },
      },
    })).toThrow(/authority changed during handoff/i)
    expect(contestRepository.get(contestId)!.document).toEqual(before)
    expect(before.battleHandoffReceipts).toHaveLength(0)
  })

  it('scores a KO replacement with Center of Attention exactly for its first authoritative acting turn', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const contestRepository = createSqliteContestRepository(context.harness.database)
    const encounterRepository = createSqliteEncounterDocumentRepository(context.harness.database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(context.harness.database)
    const binding = contestRepository.get(contestId)!.document.battle!.encounter!
    let map = mapRepository.getBySlug(binding.link.linkedMapSlug)!
    const attackerId = map.initiative!.activeId!
    const attacker = map.placements.find(row => row.id === attackerId)!
    const knockedOut = map.placements.find(row => row.sheetKind === 'pokemon' && row.sideId !== attacker.sideId)!
    const knockedOutStored = context.harness.sheetRepository.get('pokemon', knockedOut.sheetSlug!)!
    const lowHp = structuredClone(knockedOutStored.document) as any
    lowHp.combat.currentHp = 1
    expect(context.harness.sheetRepository.applyLivePlayUpdate({ kind: 'pokemon', slug: knockedOutStored.slug, expectedRevision: knockedOutStored.revision, nextSheet: lowHp })).toBe('applied')
    const adjacentMap = {
      ...map,
      revision: Number(map.revision) + 1,
      placements: map.placements.map(row => row.id === knockedOut.id
        ? { ...row, position: { x: attacker.position.x + 1, y: attacker.position.y, z: attacker.position.z } }
        : row),
    }
    expect(mapRepository.applyLivePlayUpdate({ slug: map.slug, expectedRevision: Number(map.revision), nextMap: adjacentMap })).toBe('applied')
    map = mapRepository.getBySlug(map.slug)!
    const koIntent = { schemaVersion: 1 as const, placementId: attackerId, moveName: 'Tackle', selection: { kind: 'single-target' as const, targetPlacementId: knockedOut.id } }
    const koScopes = buildResolveMoveScopes({ map, intent: koIntent, candidateScopePlacementIds: [knockedOut.id] })
    if (!koScopes.ok) throw new Error(koScopes.message)
    const koOperationId = 'op_battle_replacement_ko_001'
    assertAccepted((await context.harness.resolveMove({ actor: { role: 'gm', clientId: 'replacement-gm' }, command: {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION, opId: koOperationId, mapSlug: map.slug, baseRevision: map.revision!,
      type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE, scopes: koScopes.scopes, payload: koIntent,
    } })).result)
    map = mapRepository.getBySlug(map.slug)!
    const knockout = parseEncounterHistory(map.encounterState!.history).knockouts.find(row => row.sourceOperationId === koOperationId)!
    expect(knockout).toMatchObject({ targetPlacementId: knockedOut.id, actorPlacementId: attackerId, canonicalId: 'Tackle' })

    const deleteOperationId = 'op_battle_replacement_recall_001'
    assertAccepted((await context.harness.deleteToken({ actor: { role: 'gm', clientId: 'replacement-gm' }, command: {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION, opId: deleteOperationId, mapSlug: map.slug, baseRevision: map.revision!,
      type: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
      scopes: [{ kind: 'token', placementId: knockedOut.id, field: 'delete' }],
      payload: { placementId: knockedOut.id },
    } })).result)
    map = mapRepository.getBySlug(map.slug)!
    const recall = parseEncounterHistory(map.encounterState!.history).switches.find(row => row.sourceOperationId === deleteOperationId)!
    expect(recall).toMatchObject({ kind: 'recall', recalledPlacementId: knockedOut.id, sentOutPlacementId: null, sideId: knockedOut.sideId, round: 1 })
    const recalledVoltage = applyBattleContestVoltageLifecycleUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId: deleteOperationId,
      sourceResultId: recall.eventId, clientId: 'replacement-gm',
    }, context.deps)
    expect(recalledVoltage.result).toMatchObject({ exactRetry: false, revision: response.result.revision + 1 })
    expect(contestRepository.get(contestId)!.document.battleVoltageLifecycleLedger.at(-1)).toMatchObject({
      rule: 'recall', sourceResultId: recall.eventId, transitions: [{ voltageBefore: 0, voltageAfter: 0, ruleDelta: -2 }],
    })
    const replacementTeam = binding.teams.find(team => team.sideId === knockedOut.sideId)!
    const replacementMember = replacementTeam.pokemon.find(member => member.openingPlacementId === null)!
    const trainerPlacement = map.placements.find(row => row.sheetKind === 'trainer' && row.sideId === replacementTeam.sideId)!
    const occupied = new Set(map.placements.map(row => `${row.position.x}:${row.position.y}:${row.position.z}`))
    const replacementPosition = [
      { x: trainerPlacement.position.x + 1, y: trainerPlacement.position.y, z: trainerPlacement.position.z },
      { x: trainerPlacement.position.x - 1, y: trainerPlacement.position.y, z: trainerPlacement.position.z },
      { x: trainerPlacement.position.x, y: trainerPlacement.position.y, z: trainerPlacement.position.z + 1 },
      { x: trainerPlacement.position.x, y: trainerPlacement.position.y, z: trainerPlacement.position.z - 1 },
    ].find(cell => cell.x >= 0 && cell.x < map.dimensions.x && cell.z >= 0 && cell.z < map.dimensions.z && !occupied.has(`${cell.x}:${cell.y}:${cell.z}`))!
    const replacementPlacementId = 'battle-ko-replacement-token'
    const sendOutOperationId = 'op_battle_replacement_sendout_001'
    assertAccepted((await context.harness.sendOutPokemon({ actor: { role: 'gm', clientId: 'replacement-gm' }, command: {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION, opId: sendOutOperationId, mapSlug: map.slug, baseRevision: map.revision!,
      type: LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
      scopes: [
        { kind: 'token', placementId: trainerPlacement.id, field: 'sendOut' },
        { kind: 'token', placementId: replacementPlacementId, field: 'spawn' },
      ],
      payload: { trainerId: trainerPlacement.id, pokemonSlug: replacementMember.sheetSlug, tokenId: replacementPlacementId, position: replacementPosition, facing: 'south-east' },
    } })).result)
    map = mapRepository.getBySlug(map.slug)!
    expect(parseEncounterHistory(map.encounterState!.history).knockoutReplacements).toEqual([expect.objectContaining({
      knockoutEventId: knockout.eventId,
      knockedOutPlacementId: knockedOut.id,
      replacementPlacementId,
      sideId: replacementTeam.sideId,
      firstTurnEventId: null,
    })])

    const advanceToReplacement = async (cycle: number) => {
      let advanced = false
      for (let step = 0; step < 12; step += 1) {
        map = mapRepository.getBySlug(map.slug)!
        if (advanced && map.initiative?.activeId === replacementPlacementId) return map
        const orderIds = initiativeOrderIdsForPlacements(map.placements, (kind, slug) => {
          const stored = context.harness.sheetRepository.get(kind, slug)
          return stored ? { sheet: stored.document, revision: stored.revision } : null
        })
        const operationId = `op_replacement_turn_${cycle}_${String(step).padStart(3, '0')}`
        assertAccepted((await context.harness.nextInitiative({ actor: { role: 'gm', clientId: 'replacement-gm' }, command: {
          ...context.harness.nextInitiativeCommand({ opId: operationId, baseRevision: map.revision!, orderIds, activeId: map.initiative?.activeId ?? null, round: map.initiative?.round ?? 1 }),
          mapSlug: map.slug,
        } })).result)
        advanced = true
      }
      throw new Error('Replacement did not receive an authoritative acting turn.')
    }
    const resolveReplacementMove = async (moveName: 'Focus Energy' | 'Meditate', operationId: string) => {
      map = mapRepository.getBySlug(map.slug)!
      const intent = { schemaVersion: 1 as const, placementId: replacementPlacementId, moveName, selection: { kind: 'self' as const } }
      const scopes = buildResolveMoveScopes({ map, intent, candidateScopePlacementIds: [] })
      if (!scopes.ok) throw new Error(scopes.message)
      assertAccepted((await context.harness.resolveMove({ actor: { role: 'gm', clientId: 'replacement-gm' }, command: {
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION, opId: operationId, mapSlug: map.slug, baseRevision: map.revision!,
        type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE, scopes: scopes.scopes, payload: intent,
      } })).result)
      map = mapRepository.getBySlug(map.slug)!
      const move = parseEncounterHistory(map.encounterState!.history).moveUses.find(row => row.completion?.sourceOperationId === operationId)!
      expect(move).toMatchObject({ actorPlacementId: replacementPlacementId, canonicalId: moveName })
      return move
    }

    await advanceToReplacement(1)
    const firstTurnHistory = parseEncounterHistory(map.encounterState!.history)
    const replacement = firstTurnHistory.knockoutReplacements[0]!
    expect(firstTurnHistory.currentTurn).not.toBeNull()
    expect(replacement).toMatchObject({ firstTurnEventId: expect.any(String), firstActingRound: firstTurnHistory.currentTurn!.round, firstActingTurn: firstTurnHistory.currentTurn!.turn })
    const firstMove = await resolveReplacementMove('Focus Energy', 'op_replacement_focus_energy_001')
    const firstContest = contestRepository.get(contestId)!.document
    const firstDelivery = deriveBattleContestAcceptedMoveDelivery({
      document: firstContest,
      encounterDocument: encounterRepository.get(binding.link.encounterId)!,
      map,
      sourceOperation: context.harness.opRepository.getStoredOpRecord(map.slug, 'op_replacement_focus_energy_001')!,
      sourceOperationId: 'op_replacement_focus_energy_001', sourceResolutionId: firstMove.resolutionId,
      contestOperationId: contestOp('replacement-center-first'),
    })
    expect(firstDelivery.fact).toMatchObject({ kind: 'accepted-move', payload: { replacementAttention: {
      knockoutEventId: knockout.eventId,
      replacementEventId: expect.any(String),
      turnStartEventId: replacement.firstTurnEventId,
      encounterTurn: replacement.firstActingTurn,
    } } })
    scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: firstContest.revision, sourceOperationId: 'op_replacement_focus_energy_001',
      sourceResolutionId: firstMove.resolutionId, spentDice: emptySpend(), clientId: 'replacement-gm',
    }, context.deps)
    let scoredDocument = contestRepository.get(contestId)!.document
    const firstAppeal = scoredDocument.appealLedger.at(-1)!
    expect(firstAppeal).toMatchObject({ performerId: replacementMember.performerId, centerOfAttention: true })
    expect(firstAppeal.appealDelta).toBe(firstAppeal.acceptedResults.length * 3)
    const forgedCenter = structuredClone(scoredDocument) as any
    forgedCenter.appealLedger.at(-1).centerOfAttention = false
    expect(() => parseContestDocument(forgedCenter)).toThrow(/score deltas do not match accepted roll evidence/i)
    const replacementPublic = projectContestPublic(scoredDocument)
    expect(replacementPublic.acceptedAppeals.at(-1)?.centerOfAttention).toBe(true)
    const replacementPublicJson = JSON.stringify(replacementPublic)
    for (const privateIdentity of [knockout.eventId, replacement.replacementEventId, replacement.firstTurnEventId, koOperationId, sendOutOperationId]) {
      expect(replacementPublicJson).not.toContain(String(privateIdentity))
    }
    const acceptedFirstDocument = structuredClone(scoredDocument)
    expect(scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: firstContest.revision, sourceOperationId: 'op_replacement_focus_energy_001',
      sourceResolutionId: firstMove.resolutionId, spentDice: emptySpend(), clientId: 'replacement-gm',
    }, context.deps).result.exactRetry).toBe(true)
    expect(contestRepository.get(contestId)!.document).toEqual(acceptedFirstDocument)

    const firstActingRound = replacement.firstActingRound!
    await advanceToReplacement(2)
    expect(map.initiative!.round).toBeGreaterThan(firstActingRound)
    const secondMove = await resolveReplacementMove('Meditate', 'op_replacement_meditate_002')
    const secondDelivery = deriveBattleContestAcceptedMoveDelivery({
      document: scoredDocument,
      encounterDocument: encounterRepository.get(binding.link.encounterId)!,
      map,
      sourceOperation: context.harness.opRepository.getStoredOpRecord(map.slug, 'op_replacement_meditate_002')!,
      sourceOperationId: 'op_replacement_meditate_002', sourceResolutionId: secondMove.resolutionId,
      contestOperationId: contestOp('replacement-center-expired'),
    })
    expect(secondDelivery.fact).toMatchObject({ kind: 'accepted-move', payload: { replacementAttention: null } })
    scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: scoredDocument.revision, sourceOperationId: 'op_replacement_meditate_002',
      sourceResolutionId: secondMove.resolutionId, spentDice: emptySpend(), clientId: 'replacement-gm',
    }, context.deps)
    scoredDocument = contestRepository.get(contestId)!.document
    const secondAppeal = scoredDocument.appealLedger.at(-1)!
    expect(secondAppeal).toMatchObject({ performerId: replacementMember.performerId, centerOfAttention: false })
    expect(secondAppeal.appealDelta).toBe(secondAppeal.acceptedResults.length * 2)
    expect(() => parseContestDocument(scoredDocument)).not.toThrow()
  })

  it.each(['contest', 'realtime'] as const)('rolls back the Contest receipt, Appeal, pool spend, operation, and realtime rows when %s persistence fails', async (failure) => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const source = await performAgility(context, contestId)
    const contestRepository = createSqliteContestRepository(context.harness.database)
    const realtimeRepository = createSqliteRealtimeEventRepository({ database: context.harness.database })
    const before = contestRepository.get(contestId)!.document
    const realtimeCount = Number((context.harness.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count)
    const expectedContestOperationId = `contest-op:v1:battle-move-${createHash('sha256').update(`${contestId}\n${source.sourceOperationId}\n${source.sourceResolutionId}`).digest('hex').slice(0, 40)}`
    const injected = failure === 'contest'
      ? { ...context.deps, contests: { ...contestRepository, replace: () => { throw new Error('injected Battle Appeal Contest failure') } } }
      : {
          ...context.deps,
          realtimeEvents: {
            database: context.harness.database,
            appendMany: (inputs: Parameters<typeof realtimeRepository.appendMany>[0]) => { realtimeRepository.appendMany(inputs); throw new Error('injected Battle Appeal realtime failure') },
          },
        }
    expect(() => scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId, spentDice: emptySpend(),
    }, injected)).toThrow(/injected Battle Appeal (Contest|realtime) failure/i)
    expect(contestRepository.get(contestId)!.document).toEqual(before)
    expect(contestRepository.findOperation(expectedContestOperationId)).toBeNull()
    expect(Number((context.harness.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count)).toBe(realtimeCount)
  })
})

describe('Battle Contest KO, damage-over-time, and recall Voltage lifecycle', () => {
  it('applies capped source-bound KO/recall transitions, canonical exceptions, retries, and private evidence', async () => {
    const context = setup(); const { contestId } = prepareLinked(context)
    const source = await performAgility(context, contestId)
    const initial = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounter = createSqliteEncounterDocumentRepository(context.harness.database).get(initial.battle!.encounter!.link.encounterId)!
    const sourceOperation = context.harness.opRepository.getStoredOpRecord(source.acceptedMap.slug, source.sourceOperationId)!
    const baseDelivery = deriveBattleContestAcceptedMoveDelivery({
      document: initial, encounterDocument: encounter, map: source.acceptedMap, sourceOperation,
      sourceOperationId: source.sourceOperationId, sourceResolutionId: source.sourceResolutionId,
      contestOperationId: contestOp('lifecycle-base'),
    })
    const actorTeam = initial.battle!.encounter!.teams.find(team => team.contestantId === source.actorContestantId)!
    const opposingTeam = initial.battle!.encounter!.teams.find(team => team.contestantId !== source.actorContestantId)!
    const actor = actorTeam.pokemon[0]!, opponent = opposingTeam.pokemon[0]!
    const delivery = (document: typeof initial, sequence: number, kind: 'attack' | 'dot' | 'recall', options: { canonicalId?: string | null, providerId?: string | null } = {}) => {
      const sourceResultSha256 = (sequence % 16).toString(16).repeat(64)
      const common = {
        schemaVersion: 1 as const,
        handoffId: `battle-contest-handoff:v1:lifecycle-${sequence}` as const,
        linkId: initial.battle!.encounter!.link.linkId,
        sourceResultId: `event.battle.lifecycle.${sequence}`,
        sourceResultSha256,
        occurredAt: 3_000 + sequence,
      }
      const fact = kind === 'recall' ? {
        ...common,
        kind: 'switch' as const,
        payload: {
          eventId: common.sourceResultId, sourceOperationId: `switch.lifecycle.${sequence}`,
          sceneId: initial.battle!.encounter!.sceneId, round: 1,
          switchKind: 'recall' as const, recalledPlacementId: actor.openingPlacementId!, sentOutPlacementId: null,
          causalResolutionId: `resolution.lifecycle.${sequence}`,
          causalCanonicalId: options.canonicalId ?? null,
          causalProviderId: options.providerId ?? null,
        },
      } : {
        ...common,
        kind: 'knockout' as const,
        payload: {
          eventId: common.sourceResultId, sourceOperationId: `op_lifecycle_${String(sequence).padStart(8, '0')}`,
          sceneId: initial.battle!.encounter!.sceneId, round: 1,
          targetPlacementId: kind === 'attack' ? opponent.openingPlacementId! : actor.openingPlacementId!,
          sourcePlacementId: kind === 'attack' ? actor.openingPlacementId! : null,
          causalResolutionId: kind === 'attack' ? `resolution.lifecycle.${sequence}` : null,
          causalCanonicalId: kind === 'attack' ? options.canonicalId ?? 'Tackle' : null,
          cause: kind === 'attack' ? 'attack' as const : 'damage-over-time' as const,
        },
      }
      return {
        ...baseDelivery,
        operationId: contestOp(`lifecycle-${sequence}`),
        readSet: { ...baseDelivery.readSet, contestRevision: document.revision, encounterRevision: source.acceptedMap.revision! },
        fact,
        handoffSha256: createHash('sha256').update(battleContestHandoffCanonicalJson(fact)).digest('hex'),
      }
    }
    const execute = (document: typeof initial, sequence: number, kind: 'attack' | 'dot' | 'recall', options: { canonicalId?: string | null, providerId?: string | null, active?: readonly string[] } = {}) => executeBattleContestVoltageLifecycle({
      document,
      delivery: delivery(document, sequence, kind, options),
      targetPokemonSheetSlug: kind === 'attack' ? opponent.sheetSlug : kind === 'dot' ? actor.sheetSlug : null,
      sourcePokemonSheetSlug: kind === 'attack' ? actor.sheetSlug : null,
      recalledPokemonSheetSlug: kind === 'recall' ? actor.sheetSlug : null,
      sentOutPokemonSheetSlug: null,
      opposingActivePokemonSheetSlugs: kind === 'dot' ? options.active ?? [opponent.sheetSlug] : [],
      now: 3_000 + sequence,
    })

    const attack = execute(initial, 1, 'attack')
    expect(attack.lifecycle).toMatchObject({ rule: 'attack-knockout', sourceKind: 'knockout', causalCanonicalId: 'Tackle', transitions: [{ performerId: actor.performerId, ruleDelta: 2, voltageBefore: 0, voltageAfter: 2 }] })
    expect(attack.document.contestants.find(row => row.contestantId === actorTeam.contestantId)!.performerVoltages[actor.performerId]).toBe(2)
    expect(attack.document.battleHandoffReceipts[0]).toMatchObject({ outcome: 'lifecycle-applied', appealId: null })
    const exact = executeBattleContestVoltageLifecycle({
      document: attack.document, delivery: delivery(initial, 1, 'attack'),
      targetPokemonSheetSlug: null, sourcePokemonSheetSlug: null, recalledPokemonSheetSlug: null,
      sentOutPokemonSheetSlug: null, opposingActivePokemonSheetSlugs: [], now: 99_999,
    })
    expect(exact).toMatchObject({ exactRetry: true, document: attack.document, lifecycle: attack.lifecycle })
    expect(() => executeBattleContestVoltageLifecycle({
      document: attack.document, delivery: delivery(attack.document, 1, 'attack', { canonicalId: 'Changed Move' }),
      targetPokemonSheetSlug: opponent.sheetSlug, sourcePokemonSheetSlug: actor.sheetSlug,
      recalledPokemonSheetSlug: null, sentOutPokemonSheetSlug: null, opposingActivePokemonSheetSlugs: [], now: 9_999,
    })).toThrow(/different handoff material/i)
    const attackAgain = execute(attack.document, 11, 'attack')
    const attackCapped = execute(attackAgain.document, 12, 'attack')
    expect(attackCapped.lifecycle.transitions).toEqual([expect.objectContaining({ ruleDelta: 2, voltageBefore: 4, voltageAfter: 5 })])
    const floorRecall = execute(initial, 13, 'recall', { canonicalId: 'Teleport' })
    expect(floorRecall.lifecycle.transitions).toEqual([expect.objectContaining({ ruleDelta: -2, voltageBefore: 0, voltageAfter: 0 })])

    const dot = execute(attack.document, 2, 'dot')
    expect(dot.lifecycle).toMatchObject({ rule: 'damage-over-time-knockout', transitions: [{ performerId: opponent.performerId, ruleDelta: 2, voltageBefore: 0, voltageAfter: 2 }] })
    expect(() => execute(attack.document, 20, 'dot', { active: [opponent.sheetSlug, opposingTeam.pokemon[1]!.sheetSlug] })).toThrow(/exactly one current opposing active Pokémon/i)

    const recalled = execute(dot.document, 3, 'recall', { canonicalId: 'Teleport' })
    expect(recalled.lifecycle).toMatchObject({ rule: 'recall', recallExceptionId: null, transitions: [{ performerId: actor.performerId, ruleDelta: -2, voltageBefore: 2, voltageAfter: 0 }] })
    for (const [index, exception] of ['Baton Pass', 'U-Turn', 'Volt Switch'].entries()) {
      const exempt = execute(attack.document, 30 + index, 'recall', { canonicalId: exception })
      expect(exempt.lifecycle).toMatchObject({ rule: 'recall-exception', recallExceptionId: exception, transitions: [{ ruleDelta: 0, voltageBefore: 2, voltageAfter: 2 }] })
    }
    const juggler = execute(attack.document, 40, 'recall', { providerId: 'feature:Quick Switch' })
    expect(juggler.lifecycle).toMatchObject({ rule: 'recall-exception', recallExceptionId: 'Juggler-equivalent-switch', causalProviderId: 'feature:Quick Switch', transitions: [{ voltageAfter: 2 }] })
    const unknownProvider = execute(attack.document, 41, 'recall', { providerId: 'feature:Unreviewed Switch' })
    expect(unknownProvider.lifecycle).toMatchObject({ rule: 'recall', recallExceptionId: null, transitions: [{ voltageAfter: 0 }] })

    const forged = structuredClone(recalled.document) as any
    forged.battleVoltageLifecycleLedger.at(-1).transitions[0].voltageAfter = 1
    expect(() => parseContestDocument(forged)).toThrow(/canonical capped Voltage delta/i)
    const publicProjection = projectContestPublic(recalled.document)
    expect(JSON.stringify(publicProjection)).not.toContain('battleVoltageLifecycleLedger')
    expect(JSON.stringify(publicProjection)).not.toContain(recalled.lifecycle.lifecycleId)
    const diagnostic = projectContestGm(recalled.document) as any
    expect(diagnostic).not.toHaveProperty('battleVoltageLifecycleLedger')
  })

  it('derives a damage-over-time KO from one accepted lifecycle boundary and redirects Voltage to the opposing active Pokémon', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const contest = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const binding = contest.battle!.encounter!
    const mapRepository = createSqliteMapRepository<TabletopMap>(context.harness.database)
    const map = mapRepository.getBySlug(binding.link.linkedMapSlug)!
    const victimPlacement = map.placements.find(row => row.sheetKind === 'pokemon')!
    const victimTeam = binding.teams.find(team => team.sideId === victimPlacement.sideId)!
    const recipientTeam = binding.teams.find(team => team.sideId !== victimPlacement.sideId)!
    const recipientPlacement = map.placements.find(row => row.sheetKind === 'pokemon' && row.sideId === recipientTeam.sideId)!
    const victimStored = context.harness.sheetRepository.get('pokemon', victimPlacement.sheetSlug!)!
    const lowHp = structuredClone(victimStored.document) as any
    lowHp.combat.currentHp = 1
    expect(context.harness.sheetRepository.applyLivePlayUpdate({ kind: 'pokemon', slug: victimStored.slug, expectedRevision: victimStored.revision, nextSheet: lowHp })).toBe('applied')
    const orderIds = initiativeOrderIdsForPlacements(map.placements, (kind, slug) => {
      const stored = context.harness.sheetRepository.get(kind, slug)
      return stored ? { sheet: stored.document, revision: stored.revision } : null
    })
    const lastActiveId = orderIds.at(-1)!
    const weatherMap: TabletopMap = {
      ...map,
      revision: Number(map.revision) + 1,
      initiative: { ...map.initiative!, activeId: lastActiveId, round: 1 },
      fieldEffects: { weather: [{ kind: 'hail', rounds: 1, source: 'Hail' }], terrains: [], rooms: [] },
    }
    expect(mapRepository.applyLivePlayUpdate({ slug: map.slug, expectedRevision: Number(map.revision), nextMap: weatherMap })).toBe('applied')
    const sourceOperationId = 'op_battle_dot_ko_001'
    const accepted = await context.harness.nextInitiative({ actor: { role: 'gm', clientId: 'battle-dot-gm' }, command: {
      ...context.harness.nextInitiativeCommand({
        opId: sourceOperationId,
        baseRevision: weatherMap.revision!,
        orderIds,
        activeId: lastActiveId,
        round: 1,
      }),
      mapSlug: weatherMap.slug,
    } })
    const acceptedResult = assertAccepted(accepted.result)
    const acceptedMap = mapRepository.getBySlug(map.slug)!
    expect(acceptedMap.initiative).toMatchObject({ round: 2 })
    expect(((context.harness.sheetRepository.get('pokemon', victimPlacement.sheetSlug!)!.document as any).combat.currentHp)).toBeLessThanOrEqual(0)
    const lifecycleEvents = (acceptedResult.patches.find(patch => patch.type === 'map.initiative')?.payload as any).lifecycle.events as any[]
    expect(lifecycleEvents).toContainEqual(expect.objectContaining({ kind: 'lifecycle-ko' }))
    const lifecycleKo = parseEncounterHistory(acceptedMap.encounterState!.history).lifecycleKnockouts.find(row => row.targetPlacementId === victimPlacement.id && row.cause === 'damage-over-time')!
    expect(lifecycleKo).toMatchObject({ targetPlacementId: victimPlacement.id, cause: 'damage-over-time', round: 1 })
    expect(lifecycleEvents).toContainEqual(expect.objectContaining({ eventId: lifecycleKo.eventId, kind: 'lifecycle-ko' }))
    const applied = applyBattleContestVoltageLifecycleUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId, sourceResultId: lifecycleKo.eventId, clientId: 'battle-dot-gm',
    }, context.deps)
    expect(applied.result.exactRetry).toBe(false)
    const after = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const recipient = recipientTeam.pokemon.find(member => member.sheetSlug === recipientPlacement.sheetSlug)!
    expect(after.contestants.find(row => row.contestantId === recipientTeam.contestantId)!.performerVoltages[recipient.performerId]).toBe(2)
    expect(after.battleVoltageLifecycleLedger).toEqual([expect.objectContaining({ rule: 'damage-over-time-knockout', sourceResultId: lifecycleKo.eventId })])
    expect(after.contestants.find(row => row.contestantId === victimTeam.contestantId)!.performerVoltages).toEqual(expect.objectContaining({ [victimTeam.pokemon[0]!.performerId]: 0 }))
  })

  it('derives an attack-KO handoff from one accepted Move/history row and rejects public lifecycle ingress', async () => {
    const context = setup()
    const { contestId, response } = prepareLinked(context)
    const contest = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const binding = contest.battle!.encounter!
    const mapRepository = createSqliteMapRepository<TabletopMap>(context.harness.database)
    const map = mapRepository.getBySlug(binding.link.linkedMapSlug)!
    const actorId = map.initiative!.activeId!
    const actorPlacement = map.placements.find(row => row.id === actorId)!
    const targetPlacement = map.placements.find(row => row.sheetKind === 'pokemon' && row.sideId !== actorPlacement.sideId)!
    const targetStored = context.harness.sheetRepository.get('pokemon', targetPlacement.sheetSlug!)!
    const lowHp = structuredClone(targetStored.document) as any
    lowHp.combat.currentHp = 1
    expect(context.harness.sheetRepository.applyLivePlayUpdate({ kind: 'pokemon', slug: targetStored.slug, expectedRevision: targetStored.revision, nextSheet: lowHp })).toBe('applied')
    const adjacentMap = {
      ...map,
      revision: Number(map.revision) + 1,
      placements: map.placements.map(row => row.id === targetPlacement.id ? { ...row, position: { x: actorPlacement.position.x + 1, y: actorPlacement.position.y, z: actorPlacement.position.z } } : row),
    }
    expect(mapRepository.applyLivePlayUpdate({ slug: map.slug, expectedRevision: Number(map.revision), nextMap: adjacentMap })).toBe('applied')
    const current = mapRepository.getBySlug(map.slug)!
    const intent = { schemaVersion: 1 as const, placementId: actorId, moveName: 'Tackle', selection: { kind: 'single-target' as const, targetPlacementId: targetPlacement.id } }
    const scopes = buildResolveMoveScopes({ map: current, intent, candidateScopePlacementIds: [targetPlacement.id] })
    if (!scopes.ok) throw new Error(scopes.message)
    const sourceOperationId = 'op_battle_attack_ko_001'
    const accepted = await context.harness.resolveMove({ actor: { role: 'gm', clientId: 'battle-ko-gm' }, command: {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION, opId: sourceOperationId, mapSlug: current.slug, baseRevision: current.revision!,
      type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE, scopes: scopes.scopes, payload: intent,
    } })
    assertAccepted(accepted.result)
    const acceptedMap = mapRepository.getBySlug(current.slug)!
    expect((context.harness.sheetRepository.get('pokemon', targetPlacement.sheetSlug!)!.document as any).combat.currentHp).toBeLessThanOrEqual(0)
    const knockout = parseEncounterHistory(acceptedMap.encounterState!.history).knockouts.find(row => row.sourceOperationId === sourceOperationId)
      ?? parseEncounterHistory(acceptedMap.encounterState!.history).knockouts.at(-1)!
    expect(knockout).toMatchObject({ canonicalId: 'Tackle', actorPlacementId: actorId, targetPlacementId: targetPlacement.id, round: 1 })
    expect(() => endBattleContestUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId, sourceResultId: knockout.eventId, clientId: 'battle-ko-gm',
    }, context.deps)).toThrow(/all Pokémon knocked out|all Pokémon/i)
    const applied = applyBattleContestVoltageLifecycleUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId, sourceResultId: knockout.eventId, clientId: 'battle-ko-gm',
    }, context.deps)
    expect(applied.result).toMatchObject({ commandKind: 'apply-battle-voltage-lifecycle', exactRetry: false, revision: response.result.revision + 1 })
    const after = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const actorTeam = binding.teams.find(team => team.sideId === actorPlacement.sideId)!
    const actor = actorTeam.pokemon.find(member => member.sheetSlug === actorPlacement.sheetSlug)!
    expect(after.contestants.find(row => row.contestantId === actorTeam.contestantId)!.performerVoltages[actor.performerId]).toBe(2)
    expect(after.battleVoltageLifecycleLedger).toEqual([expect.objectContaining({ rule: 'attack-knockout', sourceResultId: knockout.eventId, causalCanonicalId: 'Tackle' })])
    expect(applyBattleContestVoltageLifecycleUseCase({ contestId, expectedRevision: response.result.revision, sourceOperationId, sourceResultId: knockout.eventId, clientId: 'battle-ko-gm' }, context.deps).result.exactRetry).toBe(true)
    expect(() => executeContestCommandUseCase({
      schemaVersion: 1, commandKind: 'apply-battle-voltage-lifecycle', contestId, operationId: contestOp('forged-lifecycle'),
      expectedRevision: after.revision, clientId: 'forged', sourceOperationId, sourceResultId: knockout.eventId,
    }, { role: 'gm' }, context.deps)).toThrow(/server coordinator/i)
  })

  it('ends at the immutable round budget, tallies Appeal points, emits one terminal receipt, and exact-replays', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const move = await performAgility(context, contestId, 'op_battle_budget_appeal')
    const scored = scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId: move.sourceOperationId,
      sourceResolutionId: move.sourceResolutionId, spentDice: emptySpend(), clientId: 'battle-budget-gm',
    }, context.deps)
    const mapRepository = createSqliteMapRepository<TabletopMap>(context.harness.database)
    const contest = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const mapSlug = contest.battle!.encounter!.link.linkedMapSlug
    let finalBoundaryOperationId = ''
    for (let index = 0; index < 100; index += 1) {
      const current = mapRepository.getBySlug(mapSlug)!
      if (Number(current.initiative?.round) > contest.battle!.roundBudget) break
      const orderIds = initiativeOrderIdsForPlacements(current.placements, (kind, slug) => {
        const stored = context.harness.sheetRepository.get(kind, slug)
        return stored ? { sheet: stored.document, revision: stored.revision } : null
      })
      const sourceOperationId = `op_battle_budget_${String(index).padStart(3, '0')}`
      const accepted = await context.harness.nextInitiative({ actor: { role: 'gm', clientId: 'battle-budget-gm' }, command: {
        ...context.harness.nextInitiativeCommand({
          opId: sourceOperationId, baseRevision: current.revision!, orderIds,
          activeId: current.initiative!.activeId, round: current.initiative!.round,
        }),
        mapSlug,
      } })
      assertAccepted(accepted.result)
      if (current.initiative!.round === contest.battle!.roundBudget && accepted.map.initiative!.round === contest.battle!.roundBudget + 1) finalBoundaryOperationId = sourceOperationId
    }
    expect(finalBoundaryOperationId).not.toBe('')
    const boundaryMap = mapRepository.getBySlug(mapSlug)!
    const boundary = parseEncounterHistory(boundaryMap.encounterState!.history).roundBoundaries.find(row => row.completedRound === contest.battle!.roundBudget)!
    expect(boundary).toMatchObject({ completedRound: 6, nextRound: 7 })
    const input = {
      contestId, expectedRevision: scored.result.revision, sourceOperationId: finalBoundaryOperationId,
      sourceResultId: boundary.eventId, clientId: 'battle-budget-gm',
    }
    const ended = endBattleContestUseCase(input, context.deps)
    expect(ended.result).toMatchObject({ commandKind: 'end-battle-contest', exactRetry: false, stage: 'settling', revision: scored.result.revision + 1 })
    const after = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const binding = after.battle!.encounter!
    const winner = after.contestants.find(row => row.finalPlacement === 1)!
    expect(winner.contestantId).toBe(move.actorContestantId)
    expect(after.round).toBe(6)
    expect(after.contestants.every(row => row.finalScore === row.appeal)).toBe(true)
    expect(after.battleHandoffReceipts.filter(row => row.outcome === 'contest-ended')).toEqual([expect.objectContaining({
      sourceResultId: boundary.eventId, operationId: ended.result.operationId, contestRevisionAfter: after.revision,
    })])
    expect(after.history).toContainEqual(expect.objectContaining({ type: 'battle-ended-round-budget', operationId: ended.result.operationId }))
    expect(JSON.stringify(loadContestUseCase(contestId, { role: 'player' }, context.deps))).not.toContain(finalBoundaryOperationId)
    expect(loadBattleContestLiveplayUseCase(binding.link.encounterId, { role: 'gm' }, { database: context.harness.database }).battleContest)
      .toMatchObject({ stage: 'settling', actionsBlocked: true, pendingAppeal: null })
    const blockedAfterEnd = await createSqliteAuthoritativeLivePlayCommandExecutor({ database: context.harness.database }).execute({
      command: {
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        opId: 'op_battle_budget_blocked_settling',
        mapSlug,
        baseRevision: boundaryMap.revision!,
        type: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
        scopes: [{ kind: 'map' as const, lane: 'initiative' as const }, { kind: 'map' as const, lane: 'metadata' as const }],
        payload: { orderIds: [...(boundaryMap.initiative?.orderIds ?? [])], activeId: boundaryMap.initiative?.activeId ?? null, round: boundaryMap.initiative?.round ?? 1 },
      },
      readMap: () => boundaryMap,
      getMapRevision: map => map.revision!,
      apply: () => { throw new Error('settling command must not reach Encounter planning') },
      persist: () => { throw new Error('settling command must not persist') },
    })
    expect(blockedAfterEnd).toMatchObject({ ok: false, reason: 'conflict', message: 'The linked Battle Contest has ended. Complete joined settlement before issuing another live-play command.' })
    const acceptedDocument = structuredClone(after)
    expect(endBattleContestUseCase(input, context.deps).result).toMatchObject({ exactRetry: true, revision: after.revision })
    expect(createSqliteContestRepository(context.harness.database).get(contestId)!.document).toEqual(acceptedDocument)
    const forged = structuredClone(after) as any
    forged.contestants[0].finalScore += 1
    expect(() => parseContestDocument(forged)).toThrow(/must equal Battle Appeal points/i)
    expect(() => executeContestCommandUseCase({
      schemaVersion: 1, commandKind: 'end-battle-contest', contestId, operationId: contestOp('forged-end'),
      expectedRevision: after.revision, clientId: 'forged', sourceOperationId: finalBoundaryOperationId, sourceResultId: boundary.eventId,
    }, { role: 'gm' }, context.deps)).toThrow(/server coordinator/i)

    const settlementDeps = { ...context.deps, now: () => 1_800_000_000_000 }
    expect(() => prepareFinishEncounter({ role: 'gm', encounterId: binding.link.encounterId, now: 1_800_000_000_000 }, { database: context.harness.database }))
      .toThrow(/combined Battle Contest coordinator/i)
    const prepareSettlementCommand = base(contestId, 'prepare-settlement', 'battle-settlement-preview', after.revision)
    const preparedSettlement = executeContestCommandUseCase(prepareSettlementCommand, { role: 'gm' }, settlementDeps)
    const preparedDocument = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    expect(preparedSettlement.result).toMatchObject({ stage: 'settling', exactRetry: false, revision: after.revision + 1 })
    expect(preparedDocument.settlement).toMatchObject({
      status: 'preview', money: 500, items: [{ itemId: 'Potion', quantity: 2, targetTrainerSlug: null }],
      battleCoordination: {
        status: 'prepared', contestId, battleContestLinkId: binding.link.linkId,
        encounterId: binding.link.encounterId, mapSlug: binding.link.linkedMapSlug,
        preparedByContestOperationId: prepareSettlementCommand.operationId,
      },
    })
    expect(preparedDocument.settlement!.entries.map(entry => entry.experienceByPokemon.length)).toEqual([3, 3])
    expect(preparedDocument.settlement!.entries.flatMap(entry => entry.experienceByPokemon).map(row => row.experience)).toEqual([20, 20, 20, 20, 20, 20])
    const encounterSettlementRepository = createSqliteEncounterSettlementRepository(context.harness.database)
    const preparedEncounterSettlement = encounterSettlementRepository.getByEncounterId(binding.link.encounterId)!
    expect(preparedEncounterSettlement).toMatchObject({ status: 'ready', completion: { state: 'open' } })
    const safePreview = projectContestPublic(preparedDocument)
    expect(safePreview.settlement).toMatchObject({ status: 'preview', attentionItemCount: 6 })
    const safePreviewJson = JSON.stringify(safePreview.settlement)
    for (const privateValue of ['battleCoordination', 'battle-pokemon-', 'battle-trainer-', 'settlement-commit:v1:', prepareSettlementCommand.operationId, 'attentionItemIds']) expect(safePreviewJson).not.toContain(privateValue)

    const sheetBefore = new Map(binding.teams.flatMap(team => [
      { kind: 'trainer' as const, slug: team.trainer.sheetSlug },
      ...team.pokemon.map(member => ({ kind: 'pokemon' as const, slug: member.sheetSlug })),
    ]).map(ref => {
      const stored = context.harness.sheetRepository.get(ref.kind, ref.slug)!
      return [`${ref.kind}:${ref.slug}`, structuredClone(stored)] as const
    }))
    const commitSettlementCommand = base(contestId, 'commit-settlement', 'battle-settlement-commit', preparedSettlement.result.revision)
    const committed = executeContestCommandUseCase(commitSettlementCommand, { role: 'gm' }, settlementDeps)
    expect(committed.result).toMatchObject({ stage: 'completed', exactRetry: false, revision: preparedSettlement.result.revision + 1 })
    const completedDocument = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const coordination = completedDocument.settlement!.battleCoordination!
    expect(completedDocument.settlement).toMatchObject({ status: 'committed', committedOperationId: commitSettlementCommand.operationId })
    expect(coordination).toMatchObject({
      status: 'accepted', acceptedByContestOperationId: commitSettlementCommand.operationId,
      encounterSettlementId: preparedEncounterSettlement.settlementId,
      encounterSettlementRevision: preparedEncounterSettlement.revision + 1,
      contestSheetWrites: expect.arrayContaining(binding.teams.flatMap(team => [
        expect.objectContaining({ kind: 'trainer', slug: team.trainer.sheetSlug }),
        ...team.pokemon.map(member => expect.objectContaining({ kind: 'pokemon', slug: member.sheetSlug })),
      ])),
    })
    expect(coordination.combinedDefinitionSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(createSqliteEncounterDocumentRepository(context.harness.database).get(binding.link.encounterId)).toMatchObject({ lifecycle: 'completed', revision: coordination.encounterDocumentRevision })
    expect(encounterSettlementRepository.get(preparedEncounterSettlement.settlementId)).toMatchObject({ status: 'completed', completion: { state: 'accepted', operationId: coordination.encounterSettlementOperationId } })
    expect(encounterSettlementRepository.getOperation(coordination.encounterSettlementOperationId)).toMatchObject({
      operationId: coordination.encounterSettlementOperationId,
      planDefinitionSha256: coordination.encounterPlanDefinitionSha256,
      result: { encounterId: binding.link.encounterId, mapSlug: binding.link.linkedMapSlug },
    })
    for (const entry of completedDocument.settlement!.entries) {
      const contestant = completedDocument.contestants.find(row => row.contestantId === entry.contestantId)!
      const trainerAfter = context.harness.sheetRepository.get('trainer', entry.trainerSheetSlug)!
      expect((trainerAfter.document as unknown as TrainerSheet).contestResults).toContainEqual(expect.objectContaining({
        contestId, placement: entry.placement, score: entry.finalScore, pokemonSheetSlugs: contestant.performers.filter(performer => performer.performerKind === 'pokemon').map(performer => performer.pokemonSheetSlug),
      }))
      for (const award of entry.experienceByPokemon) {
        const beforeSheet = sheetBefore.get(`pokemon:${award.pokemonSheetSlug}`)!
        const afterSheet = context.harness.sheetRepository.get('pokemon', award.pokemonSheetSlug)!
        const beforePokemon = beforeSheet.document as unknown as CharacterSheet
        expect(Number((afterSheet.document as unknown as CharacterSheet).totalExp)).toBe(Number(beforePokemon.totalExp ?? pokemonExperienceNeededForLevel(beforePokemon.level) ?? 0) + award.experience)
        if (entry.ribbon) expect((afterSheet.document as unknown as CharacterSheet).contestRibbons).toContainEqual(expect.objectContaining({ contestId, pokemonSheetSlug: award.pokemonSheetSlug }))
      }
    }
    const winningEntry = completedDocument.settlement!.entries.find(entry => entry.placement === 1)!
    const winnerBefore = sheetBefore.get(`trainer:${winningEntry.trainerSheetSlug}`)!
    const winnerAfter = context.harness.sheetRepository.get('trainer', winningEntry.trainerSheetSlug)!
    expect(Number((winnerAfter.document as unknown as TrainerSheet).money)).toBe(Number((winnerBefore.document as unknown as TrainerSheet).money ?? 0) + 500)
    expect(JSON.stringify((winnerAfter.document as unknown as TrainerSheet).inventory)).toContain('Potion')
    const finalSheetSnapshots = coordination.contestSheetWrites.map(write => context.harness.sheetRepository.get(write.kind, write.slug))
    const realtimeRows = (context.harness.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count
    const exactRetry = executeContestCommandUseCase(commitSettlementCommand, { role: 'gm' }, settlementDeps)
    expect(exactRetry.result).toMatchObject({ exactRetry: true, revision: completedDocument.revision, stage: 'completed' })
    expect(coordination.contestSheetWrites.map(write => context.harness.sheetRepository.get(write.kind, write.slug))).toEqual(finalSheetSnapshots)
    expect((context.harness.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count).toBe(realtimeRows)
  })

  it('ends from one source-bound final KO only when every Pokémon on that Trainer team is knocked out', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const contest = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const binding = contest.battle!.encounter!
    const mapRepository = createSqliteMapRepository<TabletopMap>(context.harness.database)
    const map = mapRepository.getBySlug(binding.link.linkedMapSlug)!
    const actorPlacement = map.placements.find(row => row.id === map.initiative!.activeId)!
    const targetPlacement = map.placements.find(row => row.sheetKind === 'pokemon' && row.sideId !== actorPlacement.sideId)!
    const targetTeam = binding.teams.find(team => team.sideId === targetPlacement.sideId)!
    for (const member of targetTeam.pokemon) {
      const stored = context.harness.sheetRepository.get('pokemon', member.sheetSlug)!
      const next = structuredClone(stored.document) as any
      next.combat.currentHp = member.sheetSlug === targetPlacement.sheetSlug ? 1 : 0
      expect(context.harness.sheetRepository.applyLivePlayUpdate({ kind: 'pokemon', slug: stored.slug, expectedRevision: stored.revision, nextSheet: next })).toBe('applied')
    }
    const adjacentMap = {
      ...map,
      revision: Number(map.revision) + 1,
      placements: map.placements.map(row => row.id === targetPlacement.id ? { ...row, position: { x: actorPlacement.position.x + 1, y: actorPlacement.position.y, z: actorPlacement.position.z } } : row),
    }
    expect(mapRepository.applyLivePlayUpdate({ slug: map.slug, expectedRevision: Number(map.revision), nextMap: adjacentMap })).toBe('applied')
    const current = mapRepository.getBySlug(map.slug)!
    const intent = { schemaVersion: 1 as const, placementId: actorPlacement.id, moveName: 'Tackle', selection: { kind: 'single-target' as const, targetPlacementId: targetPlacement.id } }
    const scopes = buildResolveMoveScopes({ map: current, intent, candidateScopePlacementIds: [targetPlacement.id] })
    if (!scopes.ok) throw new Error(scopes.message)
    const sourceOperationId = 'op_battle_final_team_ko'
    const accepted = await context.harness.resolveMove({ actor: { role: 'gm', clientId: 'battle-end-ko-gm' }, command: {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION, opId: sourceOperationId, mapSlug: current.slug, baseRevision: current.revision!,
      type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE, scopes: scopes.scopes, payload: intent,
    } })
    assertAccepted(accepted.result)
    const acceptedMap = mapRepository.getBySlug(current.slug)!
    const history = parseEncounterHistory(acceptedMap.encounterState!.history)
    const moveUse = history.moveUses.find(row => row.completion?.sourceOperationId === sourceOperationId)!
    const knockout = history.knockouts.find(row => row.sourceOperationId === sourceOperationId)!
    const sourceOperation = context.harness.opRepository.getStoredOpRecord(current.slug, sourceOperationId)!
    const encounter = createSqliteEncounterDocumentRepository(context.harness.database).get(binding.link.encounterId)!
    const acceptedDelivery = deriveBattleContestAcceptedMoveDelivery({
      document: contest, encounterDocument: encounter, map: acceptedMap, sourceOperation,
      sourceOperationId, sourceResolutionId: moveUse.resolutionId,
      contestOperationId: `contest-op:v1:battle-move-${createHash('sha256').update(`${contestId}\n${sourceOperationId}\n${moveUse.resolutionId}`).digest('hex').slice(0, 40)}`,
    })
    const scored = scoreBattleContestAcceptedMoveUseCase({
      contestId, expectedRevision: response.result.revision, sourceOperationId, sourceResolutionId: moveUse.resolutionId,
      spentDice: emptySpend(), clientId: 'battle-end-ko-gm',
    }, context.deps)
    const scoredDocument = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const accounting = assertBattleContestSingleSpendConvergence({ before: contest, after: scoredDocument, delivery: acceptedDelivery, sourceOperation })
    expect(accounting).toMatchObject({
      encounterFrequency: { kind: 'at-will', spendDelta: 0 }, encounterAction: { actionType: 'standard', spendDelta: 1 },
      contestDiceSpent: 0, acceptedAppeals: 1,
    })
    expect(accounting.encounterRandom.drawCount).toBeGreaterThan(0)
    expect(accounting.contestRandom.drawCount).toBeGreaterThan(0)
    const voltage = applyBattleContestVoltageLifecycleUseCase({
      contestId, expectedRevision: scored.result.revision, sourceOperationId, sourceResultId: knockout.eventId, clientId: 'battle-end-ko-gm',
    }, context.deps)
    const ended = endBattleContestUseCase({
      contestId, expectedRevision: voltage.result.revision, sourceOperationId, sourceResultId: knockout.eventId, clientId: 'battle-end-ko-gm',
    }, context.deps)
    expect(ended.result).toMatchObject({ exactRetry: false, stage: 'settling' })
    const after = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    expect(after.history).toContainEqual(expect.objectContaining({ type: 'battle-ended-all-pokemon-ko' }))
    expect(after.battleHandoffReceipts.map(row => row.outcome)).toEqual(['scored-appeal', 'lifecycle-applied', 'contest-ended'])
    expect(after.contestants.find(row => row.finalPlacement === 1)!.contestantId).toBe(binding.teams.find(team => team.sideId === actorPlacement.sideId)!.contestantId)

    const rollbackDeps = { ...context.deps, now: () => 1_800_000_000_100 }
    const prepared = executeContestCommandUseCase(base(contestId, 'prepare-settlement', 'ko-settlement-preview', after.revision), { role: 'gm' }, rollbackDeps)
    const contestRepository = createSqliteContestRepository(context.harness.database)
    const encounterRepository = createSqliteEncounterDocumentRepository(context.harness.database)
    const encounterSettlementRepository = createSqliteEncounterSettlementRepository(context.harness.database)
    const preparedContest = structuredClone(contestRepository.get(contestId)!.document)
    const preparedCoordination = preparedContest.settlement!.battleCoordination!
    const encounterBeforeRollback = structuredClone(encounterRepository.get(binding.link.encounterId)!)
    const mapBeforeRollback = structuredClone(mapRepository.getBySlug(binding.link.linkedMapSlug)!)
    const sheetsBeforeRollback = structuredClone(context.harness.sheetRepository.list())
    const encounterSettlementBeforeRollback = structuredClone(encounterSettlementRepository.get(preparedCoordination.encounterSettlementId)!)
    const historyCountBefore = (context.harness.database.connection.prepare('SELECT COUNT(*) AS count FROM encounter_settlement_history_facts').get() as { count: number }).count
    const realtimeCountBefore = (context.harness.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count
    const commit = base(contestId, 'commit-settlement', 'ko-settlement-rollback', prepared.result.revision)
    expect(() => executeContestCommandUseCase(commit, { role: 'gm' }, {
      ...rollbackDeps,
      onBattleSettlementWriteBoundary: (boundary) => {
        if (boundary === 'after-contest-reward-writes') throw new Error('injected combined settlement interruption')
      },
    })).toThrow(/injected combined settlement interruption/i)
    expect(contestRepository.get(contestId)!.document).toEqual(preparedContest)
    expect(encounterRepository.get(binding.link.encounterId)).toEqual(encounterBeforeRollback)
    expect(mapRepository.getBySlug(binding.link.linkedMapSlug)).toEqual(mapBeforeRollback)
    expect(context.harness.sheetRepository.list()).toEqual(sheetsBeforeRollback)
    expect(encounterSettlementRepository.get(preparedCoordination.encounterSettlementId)).toEqual(encounterSettlementBeforeRollback)
    expect(encounterSettlementRepository.getOperation(preparedCoordination.encounterSettlementOperationId)).toBeNull()
    expect(contestRepository.findOperation(commit.operationId)).toBeNull()
    expect((context.harness.database.connection.prepare('SELECT COUNT(*) AS count FROM encounter_settlement_history_facts').get() as { count: number }).count).toBe(historyCountBefore)
    expect((context.harness.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count).toBe(realtimeCountBefore)
    const recovered = executeContestCommandUseCase(commit, { role: 'gm' }, rollbackDeps)
    expect(recovered.result).toMatchObject({ exactRetry: false, stage: 'completed', revision: prepared.result.revision + 1 })
    expect(executeContestCommandUseCase(commit, { role: 'gm' }, rollbackDeps).result).toMatchObject({ exactRetry: true, revision: recovered.result.revision })

    const incomplete = setup(); const linked = prepareLinked(incomplete)
    expect(() => endBattleContestUseCase({
      contestId: linked.contestId, expectedRevision: linked.response.result.revision,
      sourceOperationId: 'op_missing_final_ko', sourceResultId: 'missing-final-ko', clientId: 'battle-end-ko-gm',
    }, incomplete.deps)).toThrow(/unavailable|not ended/i)
  })

  it('atomically pauses and resumes both linked documents across a reconstructed server runtime', () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const contests = createSqliteContestRepository(context.harness.database)
    const encounters = createSqliteEncounterDocumentRepository(context.harness.database)
    const beforeContest = contests.get(contestId)!.document
    const encounterId = beforeContest.battle!.encounter!.link.encounterId
    const beforeEncounter = encounters.get(encounterId)!
    const beforeMap = createSqliteMapRepository<TabletopMap>(context.harness.database).getBySlug(beforeContest.battle!.encounter!.link.linkedMapSlug)!

    const pauseCommand = { ...base(contestId, 'set-paused', 'recovery-pause', response.result.revision), paused: true }
    const paused = executeContestCommandUseCase(pauseCommand, { role: 'gm' }, context.deps)
    expect(paused.result).toMatchObject({ exactRetry: false, revision: response.result.revision + 1, stage: 'performance' })
    const pausedContest = contests.get(contestId)!.document, pausedEncounter = encounters.get(encounterId)!
    expect(pausedContest.paused).toBe(true)
    expect(pausedEncounter).toMatchObject({ lifecycle: 'paused', revision: beforeEncounter.revision + 1 })
    expect(pausedContest.battleRecoveryReceipts).toEqual(pausedEncounter.battleRecoveryReceipts)
    expect(pausedContest.battleRecoveryReceipts).toEqual([expect.objectContaining({
      kind: 'pause', contestRevisionBefore: response.result.revision, contestRevisionAfter: response.result.revision + 1,
      encounterDocumentRevisionBefore: beforeEncounter.revision, encounterDocumentRevisionAfter: beforeEncounter.revision + 1,
      encounterMapRevision: beforeMap.revision,
    })])
    expect(pausedContest.history.filter(row => row.type === 'battle-recovery-coordinated')).toHaveLength(1)
    expect(createSqliteMapRepository<TabletopMap>(context.harness.database).getBySlug(beforeMap.slug)).toEqual(beforeMap)
    expect(() => applyEncounterDirectorCommandUseCase({
      schemaVersion: 1, commandId: 'director-battle-bypass', encounterId, baseRevision: pausedEncounter.revision, type: 'set-story',
      payload: { name: pausedEncounter.name, lifecycle: 'active', publicStakes: pausedEncounter.stakes.public, gmStakes: pausedEncounter.stakes.gm, notes: pausedEncounter.notes },
    }, { database: context.harness.database, now: () => 2_001, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} })).toThrow(/cross-engine recovery coordinator/i)
    expect(encounters.get(encounterId)).toEqual(pausedEncounter)

    const restartDeps = {
      database: context.harness.database,
      random: { nextInteger: () => { throw new Error('resume must not draw randomness') } },
      now: () => 2_001,
      readProfile: context.deps.readProfile,
      publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {},
    }
    const resumed = executeContestCommandUseCase({ ...base(contestId, 'set-paused', 'recovery-resume', paused.result.revision), paused: false }, { role: 'gm' }, restartDeps)
    expect(resumed.result).toMatchObject({ exactRetry: false, revision: paused.result.revision + 1 })
    const resumedContest = contests.get(contestId)!.document, resumedEncounter = encounters.get(encounterId)!
    expect(resumedContest.paused).toBe(false)
    expect(resumedEncounter.lifecycle).toBe('active')
    expect(resumedContest.battleRecoveryReceipts).toEqual(resumedEncounter.battleRecoveryReceipts)
    expect(resumedContest.battleRecoveryReceipts.map(row => row.kind)).toEqual(['pause', 'resume'])

    const retry = executeContestCommandUseCase({ ...base(contestId, 'set-paused', 'recovery-resume', paused.result.revision), paused: false }, { role: 'gm' }, restartDeps)
    expect(retry.result).toMatchObject({ exactRetry: true, revision: resumed.result.revision })
    expect(contests.get(contestId)!.document).toEqual(resumedContest)
    expect(encounters.get(encounterId)).toEqual(resumedEncounter)
    const publicJson = JSON.stringify(loadContestUseCase(contestId, { role: 'player' }, restartDeps))
    for (const forbidden of ['battle-recovery:v1:', 'intentSha256', 'encounterDocumentRevisionBefore', pauseCommand.operationId]) expect(publicJson).not.toContain(forbidden)
    const diagnostic = loadContestUseCase(contestId, { role: 'gm', diagnostic: true }, restartDeps) as any
    expect(diagnostic.battleRecoveryReceipts).toEqual(resumedContest.battleRecoveryReceipts)
  })

  it('blocks new linked-map commands while paused but serves an already accepted exact retry before the interruption gate', async () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const source = await performAgility(context, contestId, 'op_battle_before_pause_001')
    executeContestCommandUseCase({ ...base(contestId, 'set-paused', 'map-command-pause', response.result.revision), paused: true }, { role: 'gm' }, context.deps)
    const executor = createSqliteAuthoritativeLivePlayCommandExecutor({
      database: context.harness.database,
      publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {},
    })
    const unreachable = (): never => { throw new Error('paused command reached map planning') }
    const exactRetry = await executor.execute({ command: source.command, actor: { role: 'gm' }, readMap: unreachable, apply: unreachable, persist: unreachable })
    expect(exactRetry).toMatchObject({ ok: true, opId: source.command.opId, mapSlug: source.command.mapSlug })
    const blocked = await executor.execute({
      command: { ...source.command, opId: 'op_battle_while_paused_002', baseRevision: source.acceptedMap.revision! },
      actor: { role: 'gm' }, readMap: unreachable, apply: unreachable, persist: unreachable,
    })
    expect(blocked).toMatchObject({ ok: false, reason: 'conflict', message: expect.stringMatching(/linked Battle Contest.*paused/i) })
    expect(context.harness.opRepository.getStoredOpRecord(source.acceptedMap.slug, 'op_battle_while_paused_002')).toBeNull()
  })

  it('applies exact-performer and score corrections only at an atomically paused cross-engine boundary', () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const contests = createSqliteContestRepository(context.harness.database), encounters = createSqliteEncounterDocumentRepository(context.harness.database)
    const active = contests.get(contestId)!.document
    const contestant = active.contestants[0]!, performer = contestant.performers.find(row => row.performerKind === 'pokemon')!
    const activeEncounter = encounters.get(active.battle!.encounter!.link.encounterId)!
    const activeCorrection = {
      ...base(contestId, 'apply-correction', 'active-correction-rejected', response.result.revision), correctionKind: 'appeal-delta',
      contestantId: contestant.contestantId, performerId: null, statId: null, numericDelta: 2, replacementProfileId: null, reason: 'Reviewed score correction.',
    }
    expect(() => executeContestCommandUseCase(activeCorrection, { role: 'gm' }, context.deps)).toThrowError(expect.objectContaining({ code: 'battle-contest.recovery-requires-pause' }))
    expect(contests.get(contestId)!.document).toEqual(active)
    expect(encounters.get(activeEncounter.encounterId)).toEqual(activeEncounter)

    const paused = executeContestCommandUseCase({ ...base(contestId, 'set-paused', 'correction-pause', response.result.revision), paused: true }, { role: 'gm' }, context.deps)
    const appealCorrection = executeContestCommandUseCase({
      ...base(contestId, 'apply-correction', 'appeal-correction', paused.result.revision), correctionKind: 'appeal-delta',
      contestantId: contestant.contestantId, performerId: null, statId: null, numericDelta: 2, replacementProfileId: null, reason: 'Reviewed score correction.',
    }, { role: 'gm' }, context.deps)
    const voltageCorrection = executeContestCommandUseCase({
      ...base(contestId, 'apply-correction', 'voltage-correction', appealCorrection.result.revision), correctionKind: 'voltage-delta',
      contestantId: contestant.contestantId, performerId: performer.performerId, statId: null, numericDelta: 2, replacementProfileId: null, reason: 'Reviewed Pokémon Voltage correction.',
    }, { role: 'gm' }, context.deps)
    const corrected = contests.get(contestId)!.document, correctedEncounter = encounters.get(activeEncounter.encounterId)!
    const correctedContestant = corrected.contestants.find(row => row.contestantId === contestant.contestantId)!
    expect(correctedContestant.appeal).toBe(contestant.appeal + 2)
    expect(correctedContestant.performerVoltages[performer.performerId]).toBe(2)
    expect(corrected.corrections).toEqual([
      expect.objectContaining({ kind: 'appeal-delta', performerId: null, priorValue: contestant.appeal, nextValue: contestant.appeal + 2 }),
      expect.objectContaining({ kind: 'voltage-delta', performerId: performer.performerId, priorValue: 0, nextValue: 2 }),
    ])
    expect(corrected.battleRecoveryReceipts.map(row => row.kind)).toEqual(['pause', 'correction', 'correction'])
    expect(corrected.battleRecoveryReceipts).toEqual(correctedEncounter.battleRecoveryReceipts)
    expect(correctedEncounter.revision).toBe(activeEncounter.revision + 3)
    expect(corrected.paused).toBe(true)
    expect(correctedEncounter.lifecycle).toBe('paused')
    expect(voltageCorrection.result.revision).toBe(response.result.revision + 3)
  })

  it('rolls back an interrupted cross-document write and then cancels exactly once at a safe Encounter boundary', () => {
    const context = setup(); const { contestId, response } = prepareLinked(context)
    const contests = createSqliteContestRepository(context.harness.database), encounters = createSqliteEncounterDocumentRepository(context.harness.database)
    const beforeContest = structuredClone(contests.get(contestId)!.document)
    const encounterId = beforeContest.battle!.encounter!.link.encounterId
    const beforeEncounter = structuredClone(encounters.get(encounterId)!)
    const beforeMap = structuredClone(createSqliteMapRepository<TabletopMap>(context.harness.database).getBySlug(beforeContest.battle!.encounter!.link.linkedMapSlug)!)
    const command = { ...base(contestId, 'cancel-contest', 'recovery-cancel', response.result.revision), reason: 'GM ended the Battle Contest.' }
    const failingContests = { ...contests, replace: () => { throw new Error('injected Contest write failure') } }
    expect(() => executeContestCommandUseCase(command, { role: 'gm' }, { ...context.deps, contests: failingContests })).toThrow(/injected Contest write failure/i)
    expect(contests.get(contestId)!.document).toEqual(beforeContest)
    expect(encounters.get(encounterId)).toEqual(beforeEncounter)
    expect(createSqliteMapRepository<TabletopMap>(context.harness.database).getBySlug(beforeMap.slug)).toEqual(beforeMap)
    expect(contests.findOperation(command.operationId)).toBeNull()

    const cancelled = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    expect(cancelled.result).toMatchObject({ exactRetry: false, stage: 'cancelled', revision: response.result.revision + 1 })
    const afterContest = contests.get(contestId)!.document, afterEncounter = encounters.get(encounterId)!
    expect(afterContest).toMatchObject({ stage: 'cancelled', paused: false, cancellationReason: command.reason })
    expect(afterEncounter).toMatchObject({ lifecycle: 'paused', revision: beforeEncounter.revision + 1 })
    expect(afterContest.battleRecoveryReceipts).toEqual(afterEncounter.battleRecoveryReceipts)
    expect(afterContest.battleRecoveryReceipts).toEqual([expect.objectContaining({ kind: 'cancel', correctionKind: null })])
    const retry = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    expect(retry.result).toMatchObject({ exactRetry: true, stage: 'cancelled', revision: cancelled.result.revision })
    expect(contests.get(contestId)!.document).toEqual(afterContest)
    expect(encounters.get(encounterId)).toEqual(afterEncounter)
    expect(() => executeContestCommandUseCase({ ...command, reason: 'Changed cancellation material.' }, { role: 'gm' }, context.deps)).toThrow(/Operation ID was reused with changed input/i)
  })
})


describe('Battle Contest joined liveplay coordination', () => {
  it('projects one role-safe blocking Appeal decision, rejects the next Encounter action, and converges exact retry', async () => {
    const context = setup()
    const { contestId } = prepareLinked(context)
    const source = await performAgility(context, contestId, 'op_battle_liveplay_agility_001')
    const contest = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounterId = contest.battle!.encounter!.link.encounterId
    const liveplayDependencies = { database: context.harness.database, contestUseCases: context.deps }
    const actorProfileId = source.actorContestantId.endsWith('north') ? 'profile_battle_north' : 'profile_battle_south'
    const opponentProfileId = source.actorContestantId.endsWith('north') ? 'profile_battle_south' : 'profile_battle_north'

    const owner = loadBattleContestLiveplayUseCase(encounterId, {
      role: 'player', playerProfile: context.profiles.get(actorProfileId),
    }, liveplayDependencies).battleContest!
    expect(owner).toMatchObject({
      audience: 'owner', contestId, stage: 'performance', actionsBlocked: true, synchronizing: false,
      pendingAppeal: {
        kind: 'score-accepted-move', contestantId: source.actorContestantId, pokemonDisplayName: expect.any(String),
        moveName: 'Agility', maximumSpend: 3, canResolve: true,
      },
    })
    expect(owner.visibleTeamPools).toHaveLength(1)
    expect(owner.visibleTeamPools[0]!.contestantId).toBe(source.actorContestantId)
    expect(owner.scores).toHaveLength(2)
    expect(owner.scores.flatMap(score => score.performers)).toHaveLength(6)

    const opponent = loadBattleContestLiveplayUseCase(encounterId, {
      role: 'player', playerProfile: context.profiles.get(opponentProfileId),
    }, liveplayDependencies).battleContest!
    expect(opponent).toMatchObject({ audience: 'owner', pendingAppeal: { canResolve: false } })
    expect(opponent.visibleTeamPools).toHaveLength(1)
    expect(opponent.visibleTeamPools[0]!.contestantId).not.toBe(source.actorContestantId)

    const publicProjection = loadBattleContestLiveplayUseCase(encounterId, { role: 'player' }, liveplayDependencies).battleContest!
    expect(publicProjection).toMatchObject({ audience: 'public', pendingAppeal: { canResolve: false }, actionsBlocked: true })
    expect(publicProjection.visibleTeamPools).toEqual([])
    const publicJson = JSON.stringify(publicProjection)
    for (const forbidden of [source.sourceOperationId, source.sourceResolutionId, 'pokemonSheetSlug', 'trainerSheetSlug', 'providerId', 'operationId', 'sourceResult', 'handoffSha256']) {
      expect(publicJson).not.toContain(forbidden)
    }

    const blockedMap = createSqliteMapRepository<TabletopMap>(context.harness.database).getBySlug(source.acceptedMap.slug)!
    const blockedCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_battle_liveplay_blocked_next_001',
      mapSlug: blockedMap.slug,
      baseRevision: blockedMap.revision!,
      type: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      scopes: [{ kind: 'map' as const, lane: 'initiative' as const }, { kind: 'map' as const, lane: 'metadata' as const }],
      payload: {
        orderIds: [...(blockedMap.initiative?.orderIds ?? [])],
        activeId: blockedMap.initiative?.activeId ?? null,
        round: blockedMap.initiative?.round ?? 1,
      },
    }
    const blocked = await createSqliteAuthoritativeLivePlayCommandExecutor({ database: context.harness.database }).execute({
      command: blockedCommand,
      readMap: () => blockedMap,
      getMapRevision: map => map.revision!,
      apply: () => { throw new Error('blocked command must not reach Encounter planning') },
      persist: () => { throw new Error('blocked command must not persist') },
    })
    expect(blocked).toMatchObject({ ok: false, reason: 'conflict', message: 'Contest Appeal must settle before the next Encounter action.' })

    const availableStat = CONTEST_STAT_IDS.find(statId => owner.visibleTeamPools[0]!.remaining[statId] > 0)!
    const spend = { ...emptySpend(), [availableStat]: 1 }
    const accepted = executeBattleContestLiveplayCommandUseCase({
      schemaVersion: 1, command: 'score-appeal', encounterId,
      expectedContestRevision: owner.revision, spentDice: spend,
    }, { role: 'player', playerProfile: context.profiles.get(actorProfileId) }, liveplayDependencies).battleContest!
    expect(accepted).toMatchObject({ exactRetry: false, actionsBlocked: false, pendingAppeal: null })
    expect(accepted.revision).toBe(owner.revision + 1)
    expect(accepted.acceptedAppeals).toHaveLength(1)
    expect(accepted.acceptedAppeals[0]).toMatchObject({ contestantId: source.actorContestantId, moveLabel: 'Agility', spentDice: spend })

    const durableAfter = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const retry = executeBattleContestLiveplayCommandUseCase({
      schemaVersion: 1, command: 'score-appeal', encounterId,
      expectedContestRevision: owner.revision, spentDice: spend,
    }, { role: 'player', playerProfile: context.profiles.get(actorProfileId) }, {
      ...liveplayDependencies,
      contestUseCases: { ...context.deps, random: { nextInteger: () => { throw new Error('exact retry must not draw') } } },
    }).battleContest!
    expect(retry).toMatchObject({ exactRetry: true, revision: accepted.revision, actionsBlocked: false })
    expect(createSqliteContestRepository(context.harness.database).get(contestId)!.document).toEqual(durableAfter)
    expect(() => executeBattleContestLiveplayCommandUseCase({
      schemaVersion: 1, command: 'score-appeal', encounterId,
      expectedContestRevision: owner.revision, spentDice: emptySpend(),
    }, { role: 'player', playerProfile: context.profiles.get(actorProfileId) }, liveplayDependencies)).toThrow(/no longer has this Contest Dice decision/i)
  })

  it('rebuilds the joined cockpit inside the existing Contest projection budget', () => {
    const context = setup()
    const { contestId } = prepareLinked(context)
    const contest = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounterId = contest.battle!.encounter!.link.encounterId
    const dependencies = { database: context.harness.database, contestUseCases: context.deps }
    const started = performance.now()
    for (let index = 0; index < 100; index += 1) {
      const projection = loadBattleContestLiveplayUseCase(encounterId, { role: 'gm' }, dependencies).battleContest
      expect(projection?.scores).toHaveLength(2)
    }
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('lets every role invoke server-owned synchronization but never lets a non-controller allocate another team’s dice', async () => {
    const context = setup()
    const { contestId } = prepareLinked(context)
    const source = await performAgility(context, contestId, 'op_battle_liveplay_agility_002')
    const contest = createSqliteContestRepository(context.harness.database).get(contestId)!.document
    const encounterId = contest.battle!.encounter!.link.encounterId
    const dependencies = { database: context.harness.database, contestUseCases: context.deps }
    const opponentProfileId = source.actorContestantId.endsWith('north') ? 'profile_battle_south' : 'profile_battle_north'
    const before = structuredClone(contest)

    const synchronized = executeBattleContestLiveplayCommandUseCase({
      schemaVersion: 1, command: 'synchronize', encounterId,
    }, { role: 'player' }, dependencies).battleContest!
    expect(synchronized).toMatchObject({ audience: 'public', pendingAppeal: { canResolve: false }, actionsBlocked: true })
    expect(createSqliteContestRepository(context.harness.database).get(contestId)!.document).toEqual(before)

    expect(() => executeBattleContestLiveplayCommandUseCase({
      schemaVersion: 1, command: 'score-appeal', encounterId,
      expectedContestRevision: synchronized.revision, spentDice: emptySpend(),
    }, { role: 'player', playerProfile: context.profiles.get(opponentProfileId) }, dependencies)).toThrow(/belongs to another controller/i)
    expect(createSqliteContestRepository(context.harness.database).get(contestId)!.document).toEqual(before)
  })
})
