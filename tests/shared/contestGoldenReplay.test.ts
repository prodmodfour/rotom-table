import { describe, expect, it } from 'vitest'
import golden from '../../data/contests/golden-cute-demo.v1.json'
import movesJson from '../../data/reference/moves.json'
import { createContestDocument, emptyContestDicePools, parseContestDocument, contestCurrentContestant, contestCurrentPerformer, type ContestDocumentV1, type ContestMoveOptionV1, type ContestPerformerSnapshotV1 } from '../../shared/contests/document'
import { createSequenceContestRandomSource } from '../../shared/contests/dice'
import { createContestantState, executeContestEngineCommand } from '../../server/domain/contests/engine'
import type { ContestEffectId, ContestStatId } from '../../shared/contests/ids'

const op = (n: number) => `contest-op:v1:golden-${String(n).padStart(3, '0')}`
const move = (name: string): ContestMoveOptionV1 => {
  const row = (movesJson as Record<string, any>)[name]
  if (!row?.contest || row.contest.status !== 'defined') throw new Error(`Missing fixture Move ${name}`)
  return Object.freeze({ optionId: `move:${name.toLowerCase().replaceAll(' ', '-')}`, canonicalMoveId: name, label: name, typeId: row.contest.typeId as ContestStatId, effectId: row.contest.effectId as ContestEffectId, tags: Object.freeze([]), source: 'sheet', available: true, unavailableCode: null, unavailableReason: null })
}
const pokemon = (id: string, moveNames: readonly string[], pools: Record<string, number>, providers: readonly string[] = []): ContestPerformerSnapshotV1 => {
  const dicePools = structuredClone(emptyContestDicePools())
  for (const [statId, total] of Object.entries(pools)) dicePools[statId as ContestStatId] = { total, remaining: total, contributors: [{ id: `golden:${id}:${statId}`, kind: 'poffin', statId: statId as ContestStatId, dice: total, active: true, label: 'Golden fixture', sourceId: 'golden-cute-demo', explanation: 'Reviewed documentary replay pool.' }] }
  return Object.freeze({ performerId: `performer:${id}`, pokemonSheetSlug: id, pokemonSheetRevision: 1, displayName: id[0]!.toUpperCase() + id.slice(1), species: id[0]!.toUpperCase() + id.slice(1), level: 10, portraitUrl: null, moves: Object.freeze(moveNames.map(move)), dicePools, providerIds: Object.freeze([...providers]) })
}
const initialDocument = (): ContestDocumentV1 => {
  const base = createContestDocument({ contestId: 'contest:v1:golden-cute', name: 'Golden Cute Contest', hallName: 'Demo Hall', description: '', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 2, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '', now: 1 })
  const definitions = [
    { id: 'lickitung', letter: 'A', appeal: 2, moves: ['Attract','Aqua Tail','Defense Curl'], pools: { cute: 6 } },
    { id: 'zubat', letter: 'B', appeal: 2, moves: ['U-Turn','Confuse Ray','Frustration'], pools: { cute: 3, smart: 3 } },
    { id: 'mawile', letter: 'C', appeal: 2, moves: ['Sweet Scent','Fake Tears','Giga Impact'], pools: { cute: 2, beauty: 2 }, providers: ['feature:Coordinator'] },
  ] as const
  const contestants = definitions.map((definition, index) => {
    const row = structuredClone(createContestantState({ contestantId: `contestant:${definition.id}`, trainerSheetSlug: `trainer-${definition.id}`, trainerSheetRevision: 1, displayName: `${definition.id} trainer`, controller: { kind: 'gm' }, performers: [pokemon(definition.id, definition.moves, definition.pools, 'providers' in definition ? definition.providers : [])], rotationOrder: [] }))
    row.letter = definition.letter
    row.introductionSkillDice.charm = 4
    row.appeal = definition.appeal
    row.introduction = { status: 'accepted', skillId: 'charm', generatedStatId: 'cute', skillRankDice: 4, bonusDice: 0, results: [4, 4, 1, 1], generatedDice: 2, matchingAppealBonus: 2, letterTotal: 4, operationId: op(index + 1) }
    const cutePool = row.performers[0]!.dicePools.cute
    cutePool.contributors[0]!.dice -= 2
    cutePool.contributors.push({ id: `introduction:${op(index + 1)}`, kind: 'introduction', statId: 'cute', dice: 2, active: true, label: 'Introduction', sourceId: op(index + 1), explanation: 'Reviewed documentary Introduction dice.' })
    return row
  })
  const diceJournal = contestants.flatMap((row, index) => [
    { journalId: `${base.contestId}:dice:intro-${index + 1}`, operationId: op(index + 1), purpose: 'introduction' as const, contestantId: row.contestantId, round: null, dieSides: 6, results: [4, 4, 1, 1], replacesJournalId: null, createdAt: 1 },
    { journalId: `${base.contestId}:dice:intro-bonus-${index + 1}`, operationId: op(index + 1), purpose: 'introduction-bonus' as const, contestantId: row.contestantId, round: null, dieSides: 6, results: [], replacesJournalId: null, createdAt: 1 },
  ])
  diceJournal.push(
    { journalId: `${base.contestId}:dice:letter-tie-1`, operationId: op(3), purpose: 'letter-tie' as const, contestantId: null, round: null, dieSides: 2, results: [2, 1, 1], replacesJournalId: null, createdAt: 1 },
    { journalId: `${base.contestId}:dice:letter-tie-2`, operationId: op(3), purpose: 'letter-tie' as const, contestantId: null, round: null, dieSides: 2, results: [2, 1], replacesJournalId: null, createdAt: 1 },
  )
  return parseContestDocument({ ...base, revision: 10, stage: 'performance', round: 1, contestants, diceJournal, policy: { ...base.policy, lockedAt: 1 } })
}
const spend = (value: Partial<Record<ContestStatId, number>>) => ({ beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0, ...value })

/**
 * The printed walkthrough omits one mechanically assembled die from three
 * Sweet Scent appeal. A neutral completion face makes that omission explicit
 * without altering canonical scoring. This is deterministic fixture
 * reconciliation only; dice assembly remains entirely catalog-driven.
 */
const canonicalRolls: Record<string, readonly number[]> = {
  '1:lickitung': [3,2,6,1],
  '1:zubat': [6,1,2,1,5,1],
  '1:mawile': [2,2,6,4,1,1],
  '2:zubat': [1,1,4,6,5,1,6,2],
  '2:mawile': [6,6,3,5],
  '2:lickitung': [1,5,3,3,4,6,6,5,3,5],
  '3:mawile': [2,5,1,2,4,5,3,2,2,1,4],
  '3:mawile-reroll': [3,4,5,4,1,5,6,4,1,6,2],
  '3:lickitung': [5,3,1,3,5,1,3,6,6],
  '3:zubat': [5,6,4,6,6,4,3,1,3],
}

describe('documented Cute Contest golden replay', () => {
  it('replays canonical assembly, scores, Voltage, effects, placements, and XP units exactly', () => {
    let document = initialDocument()
    let operation = 1
    const declarations = [
      { round: 1, id: 'lickitung', move: 'Attract', spent: {} },
      { round: 1, id: 'zubat', move: 'U-Turn', spent: {} },
      { round: 1, id: 'mawile', move: 'Sweet Scent', spent: { cute: 2 }, pass: true },
      { round: 2, id: 'zubat', move: 'Confuse Ray', spent: { smart: 3 } },
      { round: 2, id: 'mawile', move: 'Fake Tears', spent: {}, pass: true },
      { round: 2, id: 'lickitung', move: 'Aqua Tail', spent: { cute: 3 } },
      { round: 3, id: 'mawile', move: 'Giga Impact', spent: { beauty: 2 }, reroll: true },
      { round: 3, id: 'lickitung', move: 'Defense Curl', spent: { cute: 3 } },
      { round: 3, id: 'zubat', move: 'Frustration', spent: { cute: 3 } },
    ] as const
    for (const declaration of declarations) {
      const actor = contestCurrentContestant(document)!
      expect(actor.contestantId).toBe(`contestant:${declaration.id}`)
      const performer = contestCurrentPerformer(document, actor)
      const option = performer.moves.find(row => row.label === declaration.move)!
      const results = canonicalRolls[`${declaration.round}:${declaration.id}`]!
      document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(operation++), commandKind: 'declare-appeal', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: option.optionId, spentDice: spend(declaration.spent) }, { now: operation, random: createSequenceContestRandomSource(results) })
      expect(document.appealLedger.at(-1)!.acceptedResults).toEqual(results)
      if ('reroll' in declaration) {
        document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(operation++), commandKind: 'use-intervention', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, interventionId: 'Coordinator', targetContestantId: null, appealId: document.pendingInterventionAppealId, choices: {} }, { now: operation, random: createSequenceContestRandomSource(canonicalRolls['3:mawile-reroll']!) })
      } else if ('pass' in declaration) {
        document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(operation++), commandKind: 'pass-intervention', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, appealId: document.pendingInterventionAppealId! }, { now: operation, random: createSequenceContestRandomSource([]) })
      }
      const expectedRound = golden.rounds[declaration.round - 1]!.canonicalExpectedScoreboard as Record<string, { appeal: number, fumble: number, voltage: number }>
      // Compare only after the last declaration of a round.
      const next = contestCurrentContestant(document)
      if (!next || document.round !== declaration.round) for (const [id, expected] of Object.entries(expectedRound)) {
        const actual = document.contestants.find(row => row.contestantId === `contestant:${id}`)!
        expect({ appeal: actual.appeal, fumble: actual.fumble, voltage: actual.voltage }).toEqual({ appeal: expected.appeal, fumble: expected.fumble, voltage: expected.voltage })
      }
    }
    expect(document.stage).toBe('settling')
    expect(document.contestants.map(row => ({ id: row.contestantId.replace('contestant:',''), placement: row.finalPlacement, score: row.finalScore })).sort((a,b) => a.placement! - b.placement!)).toEqual(golden.canonicalExpectedPlacements.map(row => ({ id: row.contestantId, placement: row.placement, score: row.finalScore })))
    document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(operation++), commandKind: 'prepare-settlement', expectedRevision: document.revision, clientId: null }, { now: operation, random: createSequenceContestRandomSource([]) })
    expect(document.settlement!.entries.map(row => ({ id: row.contestantId.replace('contestant:',''), experience: row.experienceByPokemon.reduce((sum, award) => sum + award.experience, 0), ribbon: row.ribbon })).sort((a,b) => a.id.localeCompare(b.id))).toEqual(golden.expectedSettlementAtSignificance2.map(row => ({ id: row.contestantId, experience: row.experience, ribbon: row.ribbon })).sort((a,b) => a.id.localeCompare(b.id)))
  })
})
