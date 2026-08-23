import { describe, expect, it } from 'vitest'
import { trainerParticipantContestVariant } from '../../shared/contests/catalog'
import {
  createContestDocument,
  emptyContestDicePools,
  parseContestDocument,
  spendTrainerParticipantSharedDice,
  type ContestDocumentV1,
  type ContestPokemonPerformerSnapshotV1,
  type ContestTrainerPerformerSnapshotV1,
} from '../../shared/contests/document'
import { emptyContestStatRecord, CONTEST_STAT_IDS } from '../../shared/contests/ids'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { createContestantState, executeContestEngineCommand } from '../../server/domain/contests/engine'

const zeroSpend = () => ({ beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 })
const contribution = (id: string, kind: 'combat-stat' | 'feature-poffin-equivalent' | 'introduction', dice: number, label: string) => Object.freeze({
  id, kind, statId: 'cute' as const, dice, active: true, label, sourceId: id,
  explanation: `${label} contributes ${dice} prepared Cute dice.`,
})
const pools = (dice: number, featureDice = 0, kind: 'preparation'|'team' = 'preparation') => Object.freeze(emptyContestStatRecord(statId => {
  if (statId !== 'cute') return Object.freeze({ total: 0, remaining: 0, contributors: Object.freeze([]) })
  const contributors = kind === 'team'
    ? [contribution('introduction:cute', 'introduction', dice, 'Shared Introduction')]
    : [contribution('combat-stat:cute', 'combat-stat', dice, 'Cute combat stat'), ...(featureDice ? [contribution('feature:style-expert:cute', 'feature-poffin-equivalent', featureDice, 'Style Expert')] : [])]
  return Object.freeze({ total: dice + featureDice, remaining: dice + featureDice, contributors: Object.freeze(contributors) })
}))
const pokemon = (id: string, dice: number, featureDice = 0): ContestPokemonPerformerSnapshotV1 => Object.freeze({
  performerKind: 'pokemon', performerId: `performer:${id}`, pokemonSheetSlug: id, pokemonSheetRevision: 1,
  displayName: id, species: 'Pikachu', level: 10, portraitUrl: null, moves: Object.freeze([]),
  dicePools: pools(dice, featureDice), providerIds: Object.freeze(featureDice ? ['feature:Style Expert:cute'] : []),
})
const trainer: ContestTrainerPerformerSnapshotV1 = Object.freeze({
  performerKind: 'trainer', performerId: 'performer:trainer-avery', trainerSheetSlug: 'trainer-avery', trainerSheetRevision: 2,
  displayName: 'Avery', level: 8, portraitUrl: null, moves: Object.freeze([]), dicePools: emptyContestDicePools(),
  providerIds: Object.freeze(['feature:Coordinator']),
})
const participantDocument = (): ContestDocumentV1 => createContestDocument({
  contestId: 'contest:v1:trainer-shared-dice', name: 'Shared Dice Fixture', hallName: 'Fixture Hall', variantId: 'rotation',
  participantVariantId: 'trainer-participant', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, now: 10,
})
const enrollRaw = () => {
  const document = participantDocument(), prepared = [pokemon('pokemon-a', 2, 2), pokemon('pokemon-b', 1), pokemon('pokemon-c', 1)]
  const enrollment = createContestantState({
    contestantId: 'contestant:shared-dice', trainerSheetSlug: trainer.trainerSheetSlug, trainerSheetRevision: trainer.trainerSheetRevision,
    displayName: trainer.displayName, controller: { kind: 'gm' }, performers: [...prepared, trainer], rotationOrder: [0, 1, 2],
  })
  const accepted = executeContestEngineCommand(document, {
    schemaVersion: 1, operationId: 'contest-op:v1:shared-dice-enroll', contestId: document.contestId,
    commandKind: 'enroll-contestant', expectedRevision: 0, clientId: null, contestantId: enrollment.contestantId,
    trainerSheetSlug: enrollment.trainerSheetSlug, pokemonSheetSlugs: prepared.map(row => row.pokemonSheetSlug),
    controller: enrollment.controller, rotationOrder: enrollment.rotationOrder,
  }, { now: 11, random: createSeededContestRandomSource(1), enrollment })
  return { accepted, prepared }
}
const spend = (input: {
  pokemonPools: ReturnType<typeof pools>, teamPools?: ReturnType<typeof pools>, journal?: any[], actor?: string,
  pokemon?: string, operation?: string, cute: number,
}) => spendTrainerParticipantSharedDice({
  pokemonPools: input.pokemonPools,
  teamPools: input.teamPools ?? emptyContestDicePools(),
  journal: input.journal ?? [],
  enrolledPerformerIds: ['performer:pokemon-a', trainer.performerId],
  trainerPerformerId: trainer.performerId,
  pokemonPerformerId: input.pokemon ?? 'performer:pokemon-a',
  performerId: input.actor ?? trainer.performerId,
  operationId: input.operation ?? 'contest-op:v1:shared-spend-01',
  spentDice: { ...zeroSpend(), cute: input.cute },
  createdAt: 20,
})

describe('Trainer Participant shared Contest dice policy', () => {
  it('binds the canonical one-pool, whole-Contest, active-performer policy and paired Feature targets', () => {
    expect(trainerParticipantContestVariant.sharedContestDicePool).toEqual({ scope: 'trainer-pokemon-entry', depletionScope: 'contest', spendAuthority: 'active-performer', singleSpendRequired: true })
    expect(trainerParticipantContestVariant.featurePolicy).toEqual({ coordinatorMayTarget: ['trainer', 'pokemon'], similarTrainerFeaturesMayTarget: ['trainer', 'pokemon'] })
  })

  it('retains one Pokémon preparation authority and gives the Trainer no copied pool', () => {
    const { accepted, prepared } = enrollRaw(), contestant = accepted.contestants[0]!
    expect(contestant.performers.filter(row => row.performerKind === 'pokemon').map(row => row.dicePools.cute.total)).toEqual([4, 1, 1])
    expect(contestant.performers.find(row => row.performerKind === 'trainer')?.dicePools).toEqual(emptyContestDicePools())
    expect(contestant.teamDicePools).toEqual(emptyContestDicePools())
    expect(contestant.sharedDiceSpendJournal).toEqual([])

    const legacy = structuredClone(accepted) as any
    delete legacy.sharedContestDicePoolScope
    delete legacy.contestants[0].sharedDiceSpendJournal
    const migrated = parseContestDocument(legacy)
    expect(migrated.sharedContestDicePoolScope).toBe('trainer-pokemon-entry')
    expect(migrated.contestants[0]?.performers).toEqual([...prepared, trainer])
    expect(migrated.contestants[0]?.teamDicePools).toEqual(emptyContestDicePools())
  })

  it('lets the paired Trainer and Pokémon deplete the same Feature-bearing pool exactly once', () => {
    const initial = pools(2, 2)
    const trainerSpend = spend({ pokemonPools: initial, cute: 2 })
    expect(trainerSpend).toMatchObject({ exactRetry: false, pokemonPools: { cute: { remaining: 2 } }, teamPools: { cute: { remaining: 0 } } })
    expect(trainerSpend.receipt).toMatchObject({
      performerId: trainer.performerId, pokemonPerformerId: 'performer:pokemon-a', sourcePolicy: 'trainer-pokemon-entry',
      spentDice: { cute: 2 }, pokemonSpentDice: { cute: 2 }, teamSpentDice: { cute: 0 },
      pokemonRemainingBefore: { cute: 4 }, pokemonRemainingAfter: { cute: 2 },
    })
    expect(initial.cute.contributors).toContainEqual(expect.objectContaining({ label: 'Style Expert', dice: 2, active: true }))

    const retry = spend({ pokemonPools: trainerSpend.pokemonPools as ReturnType<typeof pools>, teamPools: trainerSpend.teamPools as ReturnType<typeof pools>, journal: [...trainerSpend.journal], cute: 2 })
    expect(retry.exactRetry).toBe(true)
    expect(retry.journal).toHaveLength(1)
    expect(retry.receipt).toBe(trainerSpend.receipt)

    expect(() => spend({ pokemonPools: retry.pokemonPools as ReturnType<typeof pools>, teamPools: retry.teamPools as ReturnType<typeof pools>, journal: [...retry.journal], actor: 'performer:pokemon-a', cute: 2 })).toThrow(/reused with changed input/)
    const pokemonSpend = spend({ pokemonPools: retry.pokemonPools as ReturnType<typeof pools>, teamPools: retry.teamPools as ReturnType<typeof pools>, journal: [...retry.journal], actor: 'performer:pokemon-a', operation: 'contest-op:v1:shared-spend-02', cute: 2 })
    expect(pokemonSpend.pokemonPools.cute.remaining).toBe(0)
    expect(pokemonSpend.journal.map(row => row.performerId)).toEqual([trainer.performerId, 'performer:pokemon-a'])
    expect(() => spend({ pokemonPools: pokemonSpend.pokemonPools as ReturnType<typeof pools>, teamPools: pokemonSpend.teamPools as ReturnType<typeof pools>, journal: [...pokemonSpend.journal], operation: 'contest-op:v1:shared-spend-03', cute: 1 })).toThrow(/Only 0 shared cute dice remain/)
  })

  it('preserves Rotation shared-first allocation while binding the Trainer to the active Pokémon pool', () => {
    const result = spend({ pokemonPools: pools(4), teamPools: pools(2, 0, 'team'), cute: 3 })
    expect(result.receipt).toMatchObject({ teamSpentDice: { cute: 2 }, pokemonSpentDice: { cute: 1 }, teamRemainingAfter: { cute: 0 }, pokemonRemainingAfter: { cute: 3 } })
    expect(result.teamPools.cute.remaining).toBe(0)
    expect(result.pokemonPools.cute.remaining).toBe(3)
  })

  it('rejects changed identities, overspend, forged receipts, and orphan spend evidence', () => {
    expect(() => spend({ pokemonPools: pools(2), pokemon: 'performer:not-enrolled', cute: 1 })).toThrow(/paired Trainer or Pokémon/)
    const { accepted } = enrollRaw(), transition = spend({ pokemonPools: accepted.contestants[0]!.performers[0]!.dicePools as ReturnType<typeof pools>, cute: 1 })
    const orphan = structuredClone(accepted) as any
    orphan.contestants[0].performers[0].dicePools = transition.pokemonPools
    orphan.contestants[0].sharedDiceSpendJournal = transition.journal
    expect(() => parseContestDocument(orphan)).toThrow(/accepted appeal/)

    const forged = structuredClone(orphan) as any
    forged.contestants[0].sharedDiceSpendJournal[0].pokemonRemainingAfter.cute += 1
    expect(() => parseContestDocument(forged)).toThrow(/shared-first spend/)

    const scopeDrift = structuredClone(accepted) as any
    scopeDrift.sharedContestDicePoolScope = null
    expect(() => parseContestDocument(scopeDrift)).toThrow(/does not match the participant format/)

    const parallelTrainer = structuredClone(accepted) as any
    parallelTrainer.contestants[0].performers.find((row: any) => row.performerKind === 'trainer').dicePools.cute = pools(1).cute
    expect(() => parseContestDocument(parallelTrainer)).toThrow(/cannot retain a parallel Contest dice pool/)
    for (const statId of CONTEST_STAT_IDS) expect(accepted.contestants[0]!.performers.find(row => row.performerKind === 'trainer')!.dicePools[statId].remaining).toBe(0)
  })
})
