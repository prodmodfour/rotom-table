import { describe, expect, it } from 'vitest'
import { createContestDocument, emptyContestDicePools, parseContestDocument, type ContestPokemonPerformerSnapshotV1, type ContestTrainerPerformerSnapshotV1 } from '../../shared/contests/document'
import { CONTEST_STAT_IDS } from '../../shared/contests/ids'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { projectContestGm, projectContestOwner, projectContestPublic } from '../../shared/contests/projections'
import { createContestantState, executeContestEngineCommand, type ContestEngineContextV1 } from '../../server/domain/contests/engine'

const pokemon = (suffix: string): ContestPokemonPerformerSnapshotV1 => Object.freeze({
  performerKind: 'pokemon', performerId: `performer:pokemon-${suffix}`, pokemonSheetSlug: `pokemon-${suffix}`, pokemonSheetRevision: 1,
  displayName: `Partner ${suffix.toUpperCase()}`, species: 'Pikachu', level: 10, portraitUrl: null, moves: Object.freeze([]),
  dicePools: emptyContestDicePools(), providerIds: Object.freeze([]),
})
const trainer = (suffix: string): ContestTrainerPerformerSnapshotV1 => Object.freeze({
  performerKind: 'trainer', performerId: `performer:trainer-${suffix}`, trainerSheetSlug: `trainer-${suffix}`, trainerSheetRevision: 2,
  displayName: `Trainer ${suffix.toUpperCase()}`, level: 8, portraitUrl: null, moves: Object.freeze([]),
  dicePools: emptyContestDicePools(), providerIds: Object.freeze([]),
})
const command = (contestId: string, commandKind: string, operation: string, expectedRevision: number, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, contestId, commandKind, operationId: `contest-op:v1:${operation.padEnd(8, 'x')}`, expectedRevision, clientId: 'trainer-introduction-test', ...extra,
})
const setupContest = () => {
  let document = createContestDocument({
    contestId: 'contest:v1:trainer-introductions', name: 'Trainer Introductions', hallName: 'Introduction Hall', variantId: 'standard',
    participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, now: 1,
  })
  for (const [index, suffix] of ['a', 'b', 'c'].entries()) {
    const enrollment = createContestantState({
      contestantId: `contestant:entry-${suffix}`, trainerSheetSlug: `trainer-${suffix}`, trainerSheetRevision: 2, displayName: `Trainer ${suffix.toUpperCase()}`,
      controller: { kind: 'profile', profileId: `profile_intro${suffix}0001` as never }, performers: [pokemon(suffix), trainer(suffix)], rotationOrder: [],
      introductionSkillDice: { charm: 2 + index, command: 2, guile: 2, intimidate: 2, intuition: 2 },
    })
    document = executeContestEngineCommand(document, command(document.contestId, 'enroll-contestant', `enroll-${suffix}`, document.revision, {
      contestantId: enrollment.contestantId, trainerSheetSlug: enrollment.trainerSheetSlug, pokemonSheetSlugs: [`pokemon-${suffix}`], controller: enrollment.controller, rotationOrder: [],
    }) as any, { now: 2 + index, random: createSeededContestRandomSource(index + 1), enrollment })
  }
  document = executeContestEngineCommand(document, command(document.contestId, 'start-introduction', 'start-intro', document.revision) as any, { now: 10, random: createSeededContestRandomSource(10) })
  return document
}
const acceptAll = (source = setupContest()) => {
  let document = source
  for (const [index, suffix] of ['a', 'b', 'c'].entries()) {
    const context: ContestEngineContextV1 = {
      now: 20 + index,
      random: createSeededContestRandomSource(100 + index),
      introduction: { skillDice: 2 + index, bonusRolls: [], uglySixesCountAsOnes: false, graceFlexible: false },
    }
    document = executeContestEngineCommand(document, command(document.contestId, 'declare-introduction', `intro-${suffix}`, document.revision, {
      contestantId: `contestant:entry-${suffix}`, skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {},
    }) as any, context)
  }
  return document
}

describe('Trainer Participant introductions', () => {
  it('uses each exact Trainer performer, existing Skill dice, server journals, shared pool, and ordinary letter assignment', () => {
    const started = setupContest()
    expect(started).toMatchObject({ stage: 'introduction', revision: 4, participantMethodId: 'simultaneous' })
    expect(started.policy.lockedAt).toBe(10)
    for (const [index, contestant] of started.contestants.entries()) {
      expect(contestant.introduction).toMatchObject({ status: 'pending', performerId: `performer:trainer-${['a', 'b', 'c'][index]}` })
      expect(contestant.introductionSkillDice.charm).toBe(2 + index)
    }

    const accepted = acceptAll(started)
    expect(accepted.stage).toBe('introduction')
    expect(accepted.contestants.map(row => row.letter).sort()).toEqual(['A', 'B', 'C'])
    expect(accepted.diceJournal.filter(row => row.purpose === 'introduction')).toHaveLength(3)
    expect(accepted.diceJournal.filter(row => row.purpose === 'introduction-bonus')).toHaveLength(3)
    expect(accepted.history.filter(row => row.type === 'introduction-accepted')).toHaveLength(3)
    expect(accepted.history.filter(row => row.type === 'introduction-evidence')).toHaveLength(3)
    for (const [index, contestant] of accepted.contestants.entries()) {
      const trainerPerformer = contestant.performers.find(row => row.performerKind === 'trainer')!, pokemonPerformer = contestant.performers.find(row => row.performerKind === 'pokemon')!
      expect(contestant.introduction).toMatchObject({ status: 'accepted', performerId: trainerPerformer.performerId, skillId: 'charm', skillRankDice: 2 + index })
      expect(contestant.introduction.results).toHaveLength(2 + index)
      expect(CONTEST_STAT_IDS.every(statId => trainerPerformer.dicePools[statId].total === 0 && trainerPerformer.dicePools[statId].contributors.length === 0)).toBe(true)
      expect(pokemonPerformer.dicePools.cute.contributors.filter(row => row.kind === 'introduction')).toHaveLength(contestant.introduction.generatedDice > 0 ? 1 : 0)
      expect(contestant.teamDicePools.cute.total).toBe(0)
    }
  })

  it('preserves Rotation base authority by putting generated dice only in the existing shared team pool', () => {
    let document = createContestDocument({
      contestId: 'contest:v1:trainer-rotation-introductions', name: 'Rotation Introductions', hallName: 'Rotation Hall', variantId: 'rotation',
      participantVariantId: 'trainer-participant', participantMethodId: 'alternating', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, rotationOrderPolicy: 'predeclared', now: 1,
    })
    for (const [entryIndex, suffix] of ['a', 'b', 'c'].entries()) {
      const pokemonPerformers = [1, 2, 3].map(number => pokemon(`${suffix}${number}`))
      const enrollment = createContestantState({
        contestantId: `contestant:rotation-${suffix}`, trainerSheetSlug: `trainer-${suffix}`, trainerSheetRevision: 2, displayName: `Trainer ${suffix.toUpperCase()}`,
        controller: { kind: 'gm' }, performers: [...pokemonPerformers, trainer(suffix)], rotationOrder: [0, 1, 2],
      })
      document = executeContestEngineCommand(document, command(document.contestId, 'enroll-contestant', `rotate-enroll-${suffix}`, document.revision, { contestantId: enrollment.contestantId, trainerSheetSlug: enrollment.trainerSheetSlug, pokemonSheetSlugs: pokemonPerformers.map(row => row.pokemonSheetSlug), controller: enrollment.controller, rotationOrder: [0, 1, 2] }) as any, { now: 2 + entryIndex, random: createSeededContestRandomSource(entryIndex + 1), enrollment })
    }
    document = executeContestEngineCommand(document, command(document.contestId, 'start-introduction', 'rotate-start', document.revision) as any, { now: 10, random: createSeededContestRandomSource(10) })
    document = executeContestEngineCommand(document, command(document.contestId, 'declare-introduction', 'rotate-intro-a', document.revision, { contestantId: 'contestant:rotation-a', skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {} }) as any, { now: 11, random: createSeededContestRandomSource(11), introduction: { skillDice: 2, bonusRolls: [], uglySixesCountAsOnes: false, graceFlexible: false } })
    const row = document.contestants[0]!
    expect(row.introduction).toMatchObject({ performerId: 'performer:trainer-a', status: 'accepted' })
    expect(row.teamDicePools.cute.contributors.filter(contribution => contribution.kind === 'introduction')).toHaveLength(row.introduction.generatedDice > 0 ? 1 : 0)
    expect(row.performers.every(performer => CONTEST_STAT_IDS.every(statId => performer.dicePools[statId].contributors.every(contribution => contribution.kind !== 'introduction')))).toBe(true)
  })

  it('preserves role-safe parity: public sees lifecycle and letters while only GM/owner get exact actor and roll authority', () => {
    const accepted = acceptAll()
    const publicProjection = projectContestPublic(accepted) as any
    expect(publicProjection.scoreboard.map((row: any) => row.letter).sort()).toEqual(['A', 'B', 'C'])
    expect(publicProjection.history.filter((row: any) => row.type === 'introduction-accepted')).toHaveLength(3)
    expect(JSON.stringify(publicProjection)).not.toContain('performer:trainer-')
    expect(JSON.stringify(publicProjection)).not.toContain('introduction-evidence')

    const gm = projectContestGm(accepted)
    expect(gm.contestants.every(row => row.introduction.performerId?.startsWith('performer:trainer-'))).toBe(true)
    const owner = projectContestOwner(accepted, 'profile_introa0001')!
    expect(owner.ownContestant.introduction).toMatchObject({ performerId: 'performer:trainer-a', status: 'accepted' })
    expect(owner.history.some(row => row.type === 'introduction-evidence')).toBe(true)
    expect(owner.history.some(row => row.contestantId === 'contestant:entry-b' && row.type === 'introduction-evidence')).toBe(false)
  })

  it('restarts without losing the exact Trainer actor, removes only generated shared dice, and retains immutable journals', () => {
    const accepted = acceptAll(), journalBefore = structuredClone(accepted.diceJournal)
    const restarted = executeContestEngineCommand(accepted, command(accepted.contestId, 'restart-introduction', 'restart-intro', accepted.revision) as any, { now: 30, random: createSeededContestRandomSource(30) })
    expect(restarted.stage).toBe('introduction')
    expect(restarted.diceJournal).toEqual(journalBefore)
    for (const [index, contestant] of restarted.contestants.entries()) {
      expect(contestant.introduction).toEqual({ status: 'pending', performerId: `performer:trainer-${['a', 'b', 'c'][index]}`, skillId: null, generatedStatId: null, skillRankDice: 0, bonusDice: 0, results: [], generatedDice: 0, matchingAppealBonus: 0, letterTotal: 0, operationId: null })
      expect(contestant.letter).toBeNull()
      expect(contestant.performers.find(row => row.performerKind === 'pokemon')!.dicePools.cute).toEqual({ total: 0, remaining: 0, contributors: [] })
      expect(CONTEST_STAT_IDS.every(statId => contestant.performers.find(row => row.performerKind === 'trainer')!.dicePools[statId].total === 0)).toBe(true)
    }
  })

  it('fails closed on forged actor identity and hands complete introductions to Simultaneous performance authority', () => {
    const setup = setupContest(), forged = structuredClone(setup) as any
    forged.contestants[0].introduction.performerId = forged.contestants[0].performers.find((row: any) => row.performerKind === 'pokemon').performerId
    expect(() => parseContestDocument(forged)).toThrow(/exact enrolled Trainer performer/)

    const accepted = acceptAll(setup)
    const performance = executeContestEngineCommand(accepted, command(accepted.contestId, 'start-performance', 'start-performance', accepted.revision) as any, { now: 40, random: createSeededContestRandomSource(40) })
    expect(performance).toMatchObject({ stage: 'performance', round: 1, turnIndex: 0 })
    expect(performance.contestants.every(contestant => contestant.voltage === 0 && Object.keys(contestant.performerVoltages).length === contestant.performers.length && Object.values(contestant.performerVoltages).every(voltage => voltage === 0))).toBe(true)
  })
})
