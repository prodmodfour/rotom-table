import { describe, expect, it } from 'vitest'
import { contestCatalog } from '../../shared/contests/catalog'
import { createContestDocument, contestCurrentContestant, contestCurrentPerformer, parseContestDocument, type ContestDocumentV1, type ContestPerformerSnapshotV1 } from '../../shared/contests/document'
import { createSeededContestRandomSource, createSequenceContestRandomSource } from '../../shared/contests/dice'
import { CONTEST_EFFECT_IDS, CONTEST_LETTERS, CONTEST_STAT_IDS, emptyContestStatRecord, type ContestEffectId, type ContestVariantId } from '../../shared/contests/ids'
import { createContestantState, executeContestEngineCommand } from '../../server/domain/contests/engine'
import { ContestRuleError } from '../../shared/contests/validation'

const op = (index: number) => `contest-op:v1:engine${String(index).padStart(8, '0')}`
const performer = (owner: number, index = 0, effects: readonly ContestEffectId[] = ['excitement', 'steady-performance']): ContestPerformerSnapshotV1 => Object.freeze({
  performerId: `performer:p${owner}-${index}`,
  pokemonSheetSlug: `pokemon-${owner}-${index}`,
  pokemonSheetRevision: 1,
  displayName: `Partner ${owner}-${index}`,
  species: 'Pikachu',
  level: 10,
  portraitUrl: null,
  moves: Object.freeze(effects.map((effectId, moveIndex) => Object.freeze({ optionId: `move:p${owner}-${index}-${moveIndex}`, canonicalMoveId: `Fixture ${effectId}`, label: `Fixture ${effectId}`, typeId: 'cute' as const, effectId, tags: Object.freeze([]), source: 'sheet' as const, available: true, unavailableCode: null, unavailableReason: null }))),
  dicePools: Object.freeze(emptyContestStatRecord(statId => Object.freeze({ total: 20, remaining: 20, contributors: Object.freeze([{ id: `fixture:${statId}`, kind: 'combat-stat' as const, statId, dice: 20, active: true, label: 'Fixture', sourceId: 'fixture', explanation: 'Bounded engine fixture.' }]) }))),
  providerIds: Object.freeze([]),
})

const contestDocument = (count: 3|4|5, variantId: ContestVariantId = 'standard', effects?: readonly ContestEffectId[]): ContestDocumentV1 => {
  const base = createContestDocument({ contestId: `contest:v1:engine-${variantId}-${count}`, name: 'Engine fixture', hallName: 'Fixture Hall', variantId, contestTypeId: variantId === 'supercontest' ? null : 'cute', significanceMultiplier: 1, awardRibbon: true, now: 100 })
  const contestants = Array.from({ length: count }, (_, index) => {
    const performers = variantId === 'rotation'
      ? Array.from({ length: count }, (_, performerIndex) => performer(index, performerIndex, effects))
      : [performer(index, 0, effects)]
    const created = structuredClone(createContestantState({ contestantId: `contestant:c${index}`, trainerSheetSlug: `trainer-${index}`, trainerSheetRevision: 1, displayName: `Trainer ${index}`, controller: { kind: 'gm' }, performers, rotationOrder: variantId === 'rotation' ? performers.map((_, performerIndex) => performerIndex) : [] }))
    created.letter = CONTEST_LETTERS[index]!
    const matching = variantId === 'standard'
    created.introduction = { status: 'accepted', skillId: 'charm', generatedStatId: 'cute', skillRankDice: 2, bonusDice: 0, results: [4, 5], generatedDice: 2, matchingAppealBonus: matching ? 2 : 0, letterTotal: matching ? 4 : 2, operationId: op(index) }
    created.appeal = matching ? 2 : 0
    const contribution = { id: `introduction:${op(index)}`, kind: 'introduction' as const, statId: 'cute' as const, dice: 2, active: true, label: 'Introduction', sourceId: op(index), explanation: 'Reviewed engine fixture.' }
    const pools = variantId === 'rotation' ? [created.teamDicePools.cute] : created.performers.map(row => row.dicePools.cute)
    for (const pool of pools) { pool.total += 2; pool.remaining += 2; pool.contributors.push(contribution) }
    return created
  })
  const diceJournal = contestants.flatMap((row, index) => [
    { journalId: `${base.contestId}:dice:intro-${index + 1}`, operationId: op(index), purpose: 'introduction' as const, contestantId: row.contestantId, round: null, dieSides: 6, results: [4, 5], replacesJournalId: null, createdAt: 100 },
    { journalId: `${base.contestId}:dice:intro-bonus-${index + 1}`, operationId: op(index), purpose: 'introduction-bonus' as const, contestantId: row.contestantId, round: null, dieSides: 6, results: [], replacesJournalId: null, createdAt: 100 },
  ])
  for (let unresolved = count; unresolved > 1; unresolved -= 1) diceJournal.push({ journalId: `${base.contestId}:dice:letter-tie-${count - unresolved + 1}`, operationId: op(count - 1), purpose: 'letter-tie' as const, contestantId: null, round: null, dieSides: 2, results: [2, ...Array.from({ length: unresolved - 1 }, () => 1)], replacesJournalId: null, createdAt: 100 })
  if (variantId === 'supercontest') diceJournal.push({ journalId: `${base.contestId}:dice:supercontest-1`, operationId: op(40), purpose: 'supercontest-type' as const, contestantId: null, round: 1, dieSides: 6, results: [5], replacesJournalId: null, createdAt: 100 })
  return parseContestDocument({ ...structuredClone(base), revision: 1, stage: 'performance', round: 1, turnIndex: 0, currentRoundContestTypeId: 'cute', supercontestTypeByRound: variantId === 'supercontest' ? ['cute'] : [], policy: { ...base.policy, lockedAt: 100 }, contestants, diceJournal })
}

const seedNumericCorrection = (document: any, contestantId: string, kind: 'appeal-delta'|'fumble-delta'|'voltage-delta', nextValue: number, operationIndex: number): void => {
  const operationId = op(operationIndex), field = kind === 'appeal-delta' ? 'appeal' : kind === 'fumble-delta' ? 'fumble' : 'voltage'
  const contestant = document.contestants.find((row: any) => row.contestantId === contestantId), priorValue = Number(contestant[field] ?? 0)
  contestant[field] = nextValue
  document.corrections.push({ correctionId: `${document.contestId}:correction:${document.corrections.length + 1}`, operationId, contestantId, kind, reason: 'Explicit fixture correction', numericDelta: nextValue - priorValue, statId: null, priorValue, nextValue, createdAt: 100 })
  const sequence = document.history.length + 1
  document.history.push({ sequence, eventId: `${document.contestId}:history:${sequence}`, type: 'contest-corrected', visibility: 'public', contestantId, headline: 'GM correction recorded', detail: 'Explicit fixture correction', operationId, createdAt: 100 })
}

const appealCommand = (document: ContestDocumentV1, operationIndex: number, effectIndex = 0) => {
  const actor = contestCurrentContestant(document)!
  const active = contestCurrentPerformer(document, actor)
  const move = active.moves[effectIndex]!
  return { schemaVersion: 1 as const, operationId: op(operationIndex), contestId: document.contestId, commandKind: 'declare-appeal' as const, expectedRevision: document.revision, clientId: 'engine-test', contestantId: actor.contestantId, performerId: active.performerId, moveOptionId: move.optionId, spentDice: emptyContestStatRecord(() => 0) }
}

const resolveToSettlement = (initial: ContestDocumentV1): { document: ContestDocumentV1, appeals: number } => {
  let document = initial
  const random = createSeededContestRandomSource(700 + initial.contestants.length)
  let appeals = 0
  while (document.stage === 'performance') {
    const actor = contestCurrentContestant(document)!
    const active = contestCurrentPerformer(document, actor)
    const previousMove = [...document.appealLedger].reverse().find(row => row.contestantId === actor.contestantId && row.performerId === active.performerId)?.moveOptionId ?? null
    const selected = active.moves.findIndex(row => row.optionId !== previousMove)
    document = executeContestEngineCommand(document, appealCommand(document, 100 + appeals, Math.max(0, selected)), { now: 1_000 + appeals, random })
    appeals += 1
    if (appeals > 100) throw new Error('Fixture did not terminate')
  }
  return { document, appeals }
}

describe('canonical Contest performance engine', () => {
  it('rejects unknown contract fields and corrupt journal or appeal evidence', () => {
    const document = contestDocument(3)
    expect(() => parseContestDocument({ ...document, fabricatedScore: 99 })).toThrow(/not recognized/)
    const accepted = executeContestEngineCommand(document, appealCommand(document, 898), { now: 1, random: createSeededContestRandomSource(1) })
    const badDie = structuredClone(accepted) as any
    badDie.diceJournal[0].results[0] = 7
    expect(() => parseContestDocument(badDie)).toThrow(/must be an integer/)
    const missingJournal = structuredClone(accepted) as any
    missingJournal.appealLedger[0].journalIds = ['journal:missing']
    expect(() => parseContestDocument(missingJournal)).toThrow(/missing evidence/)
    const rewrittenResult = structuredClone(accepted) as any
    rewrittenResult.appealLedger[0].acceptedResults[0] = rewrittenResult.appealLedger[0].acceptedResults[0] === 6 ? 5 : 6
    expect(() => parseContestDocument(rewrittenResult)).toThrow(/immutable journal evidence/)
    const rewrittenScore = structuredClone(accepted) as any
    rewrittenScore.appealLedger[0].appealDelta += 1
    expect(() => parseContestDocument(rewrittenScore)).toThrow(/score deltas do not match/)
    const impossibleTurn = structuredClone(document) as any
    impossibleTurn.round = 0
    expect(() => parseContestDocument(impossibleTurn)).toThrow(/outside the active chart/)
    const fabricatedConsequence = structuredClone(accepted) as any
    fabricatedConsequence.appealLedger[0].consequences.push({ contestantId: fabricatedConsequence.appealLedger[0].contestantId, appealDelta: 999, fumbleDelta: 0, voltageDelta: 0, reason: 'forged' })
    expect(() => parseContestDocument(fabricatedConsequence)).toThrow(/canonical Contest effect/)
    const rewrittenVoltage = structuredClone(accepted) as any
    rewrittenVoltage.appealLedger[0].voltageAfter = rewrittenVoltage.appealLedger[0].voltageAfter === 5 ? 4 : 5
    expect(() => parseContestDocument(rewrittenVoltage)).toThrow(/canonical effect consequences/)
  })

  it('reads early additive schema-v1 snapshots without weakening current strict validation', () => {
    const document = contestDocument(3)
    const accepted = executeContestEngineCommand(document, appealCommand(document, 897), { now: 1, random: createSeededContestRandomSource(7) })
    const legacy = JSON.parse(JSON.stringify(accepted)) as any
    delete legacy.pendingInterventionAppealId
    for (const contestant of legacy.contestants) {
      delete contestant.introductionSkillDice
      delete contestant.teamDicePools
      delete contestant.pendingEffects.nextAppealAlignmentTypeId
    }
    delete legacy.appealLedger[0].moveTypeId
    const parsed = parseContestDocument(legacy)
    expect(parsed.pendingInterventionAppealId).toBeNull()
    expect(parsed.contestants[0]!.introductionSkillDice).toEqual({ charm: 2, command: 2, guile: 2, intimidate: 2, intuition: 2 })
    expect(parsed.contestants[0]!.teamDicePools.cute.remaining).toBe(0)
    expect(parsed.contestants[0]!.pendingEffects.nextAppealAlignmentTypeId).toBeNull()
    expect(parsed.appealLedger[0]!.moveTypeId).toBe(parsed.contestants.find(row => row.contestantId === parsed.appealLedger[0]!.contestantId)!.performers[0]!.moves.find(row => row.optionId === parsed.appealLedger[0]!.moveOptionId)!.typeId)
  })

  it('applies actor Voltage consequences exactly once', () => {
    const document = contestDocument(3, 'standard', ['excitement', 'steady-performance'])
    const actorId = contestCurrentContestant(document)!.contestantId
    const accepted = executeContestEngineCommand(document, appealCommand(document, 899), { now: 1, random: createSeededContestRandomSource(1) })
    expect(accepted.contestants.find(row => row.contestantId === actorId)!.voltage).toBe(2)
    expect(accepted.appealLedger[0]!.voltageAfter).toBe(2)
  })

  it('allows reviewed setup edits but forbids policy mutation after the lock', () => {
    const setup = createContestDocument({ contestId: 'contest:v1:policy-lock', name: 'Before', hallName: 'Hall', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: false, money: 0, items: [], notes: '' }, now: 1 })
    const command = { schemaVersion: 1 as const, operationId: op(739), contestId: setup.contestId, commandKind: 'update-settings' as const, expectedRevision: setup.revision, clientId: null, patch: { name: 'Reviewed', significanceMultiplier: 2, awardRibbon: false, prize: { declared: true, money: 100, items: [], notes: '' } } }
    const updated = executeContestEngineCommand(setup, command, { now: 2, random: createSeededContestRandomSource(1) })
    expect(updated).toMatchObject({ display: { name: 'Reviewed' }, policy: { significanceMultiplier: 2, awardRibbon: false, prize: { declared: true, money: 100 } } })
    const locked = contestDocument(3)
    expect(() => executeContestEngineCommand(locked, { ...command, operationId: op(740), contestId: locked.contestId, expectedRevision: locked.revision }, { now: 3, random: createSeededContestRandomSource(2) })).toThrowError(expect.objectContaining({ issue: expect.objectContaining({ code: 'contest.stage-mismatch' }) }))
  })

  it('blocks gameplay and settlement decisions while paused until an explicit resume', () => {
    let document = contestDocument(3)
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(746), contestId: document.contestId, commandKind: 'set-paused', expectedRevision: document.revision, clientId: null, paused: true }, { now: 2, random: createSeededContestRandomSource(1) })
    expect(() => executeContestEngineCommand(document, appealCommand(document, 747), { now: 3, random: createSeededContestRandomSource(2) })).toThrowError(expect.objectContaining({ issue: expect.objectContaining({ code: 'contest.paused' }) }))
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(748), contestId: document.contestId, commandKind: 'set-paused', expectedRevision: document.revision, clientId: null, paused: false }, { now: 4, random: createSeededContestRandomSource(3) })
    expect(() => executeContestEngineCommand(document, appealCommand(document, 749), { now: 5, random: createSeededContestRandomSource(4) })).not.toThrow()
  })

  it('stacks Desperation ones and sixes with Center of Attention scoring', () => {
    const ones = contestDocument(3, 'standard', ['desperation'])
    const fumbled = executeContestEngineCommand(ones, appealCommand(ones, 70), { now: 1, random: createSequenceContestRandomSource(Array.from({ length: 20 }, () => 1)) })
    expect(fumbled.appealLedger[0]!.centerOfAttention).toBe(true)
    expect(fumbled.appealLedger[0]!.fumbleDelta).toBe(fumbled.appealLedger[0]!.assembledDice * 2)
    const sixes = contestDocument(3, 'standard', ['desperation'])
    const scored = executeContestEngineCommand(sixes, appealCommand(sixes, 71), { now: 2, random: createSequenceContestRandomSource(Array.from({ length: 20 }, () => 6)) })
    expect(scored.appealLedger[0]!.appealDelta).toBe(scored.appealLedger[0]!.assembledDice * 4)
  })

  it('applies Incentives only to a matching Contest type', () => {
    const matching = contestDocument(3, 'standard', ['incentives'])
    const matchingActor = contestCurrentContestant(matching)!
    const matchingResult = executeContestEngineCommand(matching, appealCommand(matching, 72), { now: 1, random: createSequenceContestRandomSource([3, 3, 3, 3]) })
    expect(matchingResult.contestants.find(row => row.contestantId === matchingActor.contestantId)!.voltage).toBe(1)
    const mismatchRaw = structuredClone(contestDocument(3, 'standard', ['incentives'])) as any
    mismatchRaw.contestTypeId = 'beauty'; mismatchRaw.currentRoundContestTypeId = 'beauty'
    for (const [index, row] of mismatchRaw.contestants.entries()) { row.introduction.matchingAppealBonus = 0; row.introduction.letterTotal = row.introduction.generatedDice; row.appeal = 0; if (row.contestantId !== mismatchRaw.contestants.find((candidate: any) => candidate.letter === 'A').contestantId) seedNumericCorrection(mismatchRaw, row.contestantId, 'voltage-delta', 2, 730 + index) }
    const mismatch = parseContestDocument(mismatchRaw), mismatchActor = contestCurrentContestant(mismatch)!
    const result = executeContestEngineCommand(mismatch, appealCommand(mismatch, 73), { now: 2, random: createSequenceContestRandomSource([3, 3, 3]) })
    expect(result.contestants.find(row => row.contestantId === mismatchActor.contestantId)!.voltage).toBe(0)
    expect(result.contestants.filter(row => row.contestantId !== mismatchActor.contestantId).every(row => row.voltage === 2)).toBe(true)
  })

  it('Saving Grace removes Fumble without spending Voltage and protects only its user from competitor effects', () => {
    const raw = structuredClone(contestDocument(3, 'standard', ['saving-grace'])) as any
    const actorId = contestCurrentContestant(parseContestDocument(raw))!.contestantId
    seedNumericCorrection(raw, actorId, 'fumble-delta', 3, 735); seedNumericCorrection(raw, actorId, 'voltage-delta', 2, 737)
    const document = parseContestDocument(raw)
    const accepted = executeContestEngineCommand(document, appealCommand(document, 74), { now: 3, random: createSequenceContestRandomSource([3, 3, 3, 3]) })
    const after = accepted.contestants.find(row => row.contestantId === actorId)!
    expect(after.fumble).toBe(1)
    expect(after.voltage).toBe(3)
    expect(after.pendingEffects.fumbleProtectionRound).toBe(document.round)
    expect(accepted.contestants.filter(row => row.contestantId !== actorId).every(row => row.pendingEffects.fumbleProtectionRound === null)).toBe(true)
    expect(accepted.appealLedger[0]!.consequences).toContainEqual(expect.objectContaining({ contestantId: actorId, fumbleDelta: -2, reason: 'Saving Grace' }))
  })

  it('blocks indirect Sabotage and Tease Fumble, including Tease reroll deltas, during Saving Grace protection', () => {
    const sabotageRaw = structuredClone(contestDocument(3, 'standard', ['sabotage'])) as any
    const sabotageActorId = contestCurrentContestant(parseContestDocument(sabotageRaw))!.contestantId
    const protectedSabotageTarget = sabotageRaw.contestants.find((row: any) => row.contestantId !== sabotageActorId)
    seedNumericCorrection(sabotageRaw, protectedSabotageTarget.contestantId, 'fumble-delta', 4, 736)
    protectedSabotageTarget.pendingEffects.fumbleProtectionRound = sabotageRaw.round
    const sabotage = parseContestDocument(sabotageRaw)
    const sabotaged = executeContestEngineCommand(sabotage, appealCommand(sabotage, 742), { now: 4, random: createSequenceContestRandomSource(Array.from({ length: 20 }, () => 6)) })
    expect(sabotaged.contestants.find(row => row.contestantId === protectedSabotageTarget.contestantId)!.fumble).toBe(4)
    expect(sabotaged.appealLedger[0]!.consequences).toContainEqual(expect.objectContaining({ contestantId: protectedSabotageTarget.contestantId, fumbleDelta: 0, reason: 'Sabotage' }))

    const teaseRaw = structuredClone(contestDocument(3, 'standard', ['tease'])) as any
    const teaseActorId = contestCurrentContestant(parseContestDocument(teaseRaw))!.contestantId
    const teaseActor = teaseRaw.contestants.find((row: any) => row.contestantId === teaseActorId)
    teaseActor.performers[0].providerIds = ['feature:Coordinator']
    for (const target of teaseRaw.contestants.filter((row: any) => row.contestantId !== teaseActorId)) target.pendingEffects.fumbleProtectionRound = teaseRaw.round
    let teased = parseContestDocument(teaseRaw)
    teased = executeContestEngineCommand(teased, appealCommand(teased, 743), { now: 5, random: createSequenceContestRandomSource(Array.from({ length: 20 }, () => 6)) })
    const appealId = teased.pendingInterventionAppealId!
    expect(appealId).toBeTruthy()
    expect(teased.contestants.filter(row => row.contestantId !== teaseActorId).every(row => row.fumble === 0)).toBe(true)
    teased = executeContestEngineCommand(teased, { schemaVersion: 1, operationId: op(744), contestId: teased.contestId, commandKind: 'use-intervention', expectedRevision: teased.revision, clientId: null, contestantId: teaseActorId, interventionId: 'Coordinator', targetContestantId: null, appealId, choices: {} }, { now: 6, random: createSequenceContestRandomSource(Array.from({ length: 20 }, () => 6)) })
    expect(teased.contestants.filter(row => row.contestantId !== teaseActorId).every(row => row.fumble === 0)).toBe(true)
    expect(teased.appealLedger[0]!.consequences.filter(row => row.reason === 'Tease').every(row => row.fumbleDelta === 0)).toBe(true)
  })

  it('retains terminal Contest spend and intervention provenance while expiring temporary dice', () => {
    const raw = structuredClone(contestDocument(3)) as any
    const actorId = contestCurrentContestant(parseContestDocument(raw))!.contestantId
    const performer = raw.contestants.find((row: any) => row.contestantId === actorId).performers[0]
    performer.providerIds = ['ability:Beautiful']
    let document = parseContestDocument(raw)
    const baseline = contestCurrentPerformer(document, contestCurrentContestant(document)!).dicePools.beauty.total
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(75), contestId: document.contestId, commandKind: 'use-intervention', expectedRevision: document.revision, clientId: null, contestantId: actorId, interventionId: 'Beautiful', targetContestantId: null, appealId: null, choices: {} }, { now: 4, random: createSeededContestRandomSource(1) })
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(76), contestId: document.contestId, commandKind: 'cancel-contest', expectedRevision: document.revision, clientId: null, reason: 'Fixture cancellation' }, { now: 5, random: createSeededContestRandomSource(1) })
    const terminal = document.contestants.find(row => row.contestantId === actorId)!
    expect(terminal.usedInterventionIds).toContain('Beautiful')
    expect(terminal.performers[0]!.dicePools.beauty.total).toBe(baseline)
    expect(terminal.performers[0]!.dicePools.beauty.contributors).toContainEqual(expect.objectContaining({ kind: 'ability', active: false }))
  })

  it('resolves every canonical effect identity without an unowned fallback', () => {
    for (const [index, effectId] of CONTEST_EFFECT_IDS.entries()) {
      const document = contestDocument(3, 'standard', [effectId, 'steady-performance'])
      const terminal = executeContestEngineCommand(document, appealCommand(document, index + 50), { now: 500 + index, random: createSequenceContestRandomSource(Array.from({ length: 50 }, () => index % 2 ? 1 : 6)) })
      expect(terminal.appealLedger).toHaveLength(1)
      expect(terminal.appealLedger[0]!.effectId).toBe(effectId)
      expect(terminal.appealLedger[0]!.contributors[0]!.id).toBe(`effect:${effectId}`)
    }
    expect(CONTEST_EFFECT_IDS).toHaveLength(contestCatalog.contestEffects.length)
  })

  it('journals final placement ties and rejects placements detached from that evidence', () => {
    const result = resolveToSettlement(contestDocument(3, 'standard', ['sabotage', 'sabotage'])).document
    const tieJournals = result.diceJournal.filter(row => row.purpose === 'placement-tie')
    expect(tieJournals.length).toBeGreaterThan(0)
    expect(new Set(result.contestants.map(row => row.finalPlacement)).size).toBe(3)
    const rewritten = structuredClone(result) as any
    ;[rewritten.contestants[0].finalPlacement, rewritten.contestants[1].finalPlacement] = [rewritten.contestants[1].finalPlacement, rewritten.contestants[0].finalPlacement]
    expect(() => parseContestDocument(rewritten)).toThrow(/tie evidence/)
    const missing = structuredClone(result) as any
    missing.diceJournal = missing.diceJournal.filter((row: any) => row.purpose !== 'placement-tie')
    expect(() => parseContestDocument(missing)).toThrow(/tie evidence/)
  })

  it.each([3, 4, 5] as const)('runs the canonical %i-contestant chart for one round per contestant', (count) => {
    const result = resolveToSettlement(contestDocument(count))
    expect(result.appeals).toBe(count * count)
    expect(result.document.stage).toBe('settling')
    expect(result.document.contestants.map(row => row.finalPlacement).sort()).toEqual(Array.from({ length: count }, (_, index) => index + 1))
    expect(result.document.appealLedger.every(row => row.adjacentContestantIds.length >= 1 && row.adjacentContestantIds.length <= 2)).toBe(true)
  })

  it('runs Festival elimination heats with fixed eliminated placements and appeal carryover', () => {
    const result = resolveToSettlement(contestDocument(5, 'festival'))
    expect(result.appeals).toBe(25 + 16 + 9)
    expect(result.document.history.filter(row => row.type === 'festival-elimination')).toHaveLength(2)
    expect(result.document.contestants.map(row => row.finalPlacement).sort()).toEqual([1, 2, 3, 4, 5])
    expect(result.document.contestants.filter(row => row.withdrawn).map(row => row.finalPlacement).sort()).toEqual([4, 5])
  })

  it('resets Festival heat-scoped Voltage, repetition, and pending effects while carrying Appeal', () => {
    let document = contestDocument(5, 'festival', ['excitement', 'get-ready'])
    const random = createSeededContestRandomSource(123)
    let index = 0
    while (document.festivalHeat === 1) {
      const actor = contestCurrentContestant(document)!, active = contestCurrentPerformer(document, actor)
      const previous = [...document.appealLedger].reverse().find(row => row.contestantId === actor.contestantId && row.performerId === active.performerId)?.moveOptionId
      const effectIndex = active.moves[0]!.optionId === previous ? 1 : 0
      document = executeContestEngineCommand(document, appealCommand(document, 1_500 + index, effectIndex), { now: 2_000 + index, random })
      if (++index > 30) throw new Error('Festival heat did not advance')
    }
    expect(document.contestants.filter(row => !row.withdrawn).every(row => row.fumble === 0 && row.voltage === 0 && row.lastMoveOptionId === null && row.pendingEffects.nextRoundBaseMoveDiceMultiplier === 1)).toBe(true)
    expect(document.contestants.some(row => row.appeal > 0)).toBe(true)
  })

  it('rolls and journals a Supercontest type exactly once per round', () => {
    const result = resolveToSettlement(contestDocument(4, 'supercontest'))
    expect(result.document.supercontestTypeByRound).toHaveLength(4)
    expect(result.document.diceJournal.filter(row => row.purpose === 'supercontest-type')).toHaveLength(4)
    expect(result.document.supercontestTypeByRound.every(type => CONTEST_STAT_IDS.includes(type))).toBe(true)
  })

  it('uses one distinct Rotation performer for every canonical round', () => {
    const result = resolveToSettlement(contestDocument(4, 'rotation'))
    const actor = result.document.contestants[0]!
    const used = result.document.appealLedger.filter(row => row.contestantId === actor.contestantId).map(row => row.performerId)
    expect(new Set(used).size).toBe(4)
  })

  it('scopes Pokémon Ability use to each Rotation performer instead of the whole team', () => {
    const raw = structuredClone(contestDocument(3, 'rotation')) as any
    const initial = contestCurrentContestant(parseContestDocument(raw))!
    for (const candidate of raw.contestants.find((row: any) => row.contestantId === initial.contestantId).performers) candidate.providerIds = ['ability:Beautiful']
    let document = parseContestDocument(raw)
    const actorId = contestCurrentContestant(document)!.contestantId
    const firstPerformerId = contestCurrentPerformer(document, contestCurrentContestant(document)!).performerId
    const useBeautiful = (operation: number) => ({ schemaVersion: 1 as const, operationId: op(operation), contestId: document.contestId, commandKind: 'use-intervention' as const, expectedRevision: document.revision, clientId: null, contestantId: actorId, interventionId: 'Beautiful', targetContestantId: null, appealId: null, choices: {} })
    document = executeContestEngineCommand(document, useBeautiful(620), { now: 1, random: createSeededContestRandomSource(1) })
    expect(document.contestants.find(row => row.contestantId === actorId)!.usedInterventionIds).toContain(`Beautiful@${firstPerformerId}`)
    expect(() => executeContestEngineCommand(document, useBeautiful(621), { now: 2, random: createSeededContestRandomSource(2) })).toThrowError(ContestRuleError)
    document = executeContestEngineCommand(document, appealCommand(document, 622), { now: 3, random: createSeededContestRandomSource(3) })
    let operation = 623
    while (document.round === 1 || contestCurrentContestant(document)!.contestantId !== actorId) document = executeContestEngineCommand(document, appealCommand(document, operation++), { now: operation, random: createSeededContestRandomSource(operation) })
    const secondPerformerId = contestCurrentPerformer(document, contestCurrentContestant(document)!).performerId
    expect(secondPerformerId).not.toBe(firstPerformerId)
    document = executeContestEngineCommand(document, useBeautiful(operation), { now: operation, random: createSeededContestRandomSource(operation) })
    expect(document.contestants.find(row => row.contestantId === actorId)!.usedInterventionIds).toEqual(expect.arrayContaining([`Beautiful@${firstPerformerId}`, `Beautiful@${secondPerformerId}`]))
  })

  it('scopes Rotation continuity per performer and spends shared Introduction dice before prepared pools', () => {
    let document = contestDocument(3, 'rotation', ['reliable', 'excitement'])
    const targetId = contestCurrentContestant(document)!.contestantId
    const firstPerformerId = contestCurrentPerformer(document, contestCurrentContestant(document)!).performerId
    document = executeContestEngineCommand(document, { ...appealCommand(document, 640), spentDice: { beauty: 0, cool: 0, cute: 1, smart: 0, tough: 0 } }, { now: 1, random: createSeededContestRandomSource(1) })
    let operation = 641
    while (document.round === 1) document = executeContestEngineCommand(document, appealCommand(document, operation++), { now: operation, random: createSeededContestRandomSource(operation) })
    const target = document.contestants.find(row => row.contestantId === targetId)!
    expect(target.teamDicePools.cute.remaining).toBe(1)
    expect(target.performers.find(row => row.performerId === firstPerformerId)!.dicePools.cute.remaining).toBe(20)
    expect(target.performers[1]!.dicePools.cute.remaining).toBe(20)
    while (contestCurrentContestant(document)!.contestantId !== targetId) document = executeContestEngineCommand(document, appealCommand(document, operation++), { now: operation, random: createSeededContestRandomSource(operation) })
    const active = contestCurrentPerformer(document, contestCurrentContestant(document)!)
    expect(active.performerId).not.toBe(firstPerformerId)
    document = executeContestEngineCommand(document, { ...appealCommand(document, operation++), spentDice: { beauty: 0, cool: 0, cute: 2, smart: 0, tough: 0 } }, { now: operation, random: createSeededContestRandomSource(operation) })
    const afterSpend = document.contestants.find(row => row.contestantId === targetId)!
    expect(afterSpend.teamDicePools.cute.remaining).toBe(0)
    expect(afterSpend.performers.find(row => row.performerId === active.performerId)!.dicePools.cute.remaining).toBe(19)
    const accepted = document.appealLedger.at(-1)!
    expect(accepted.effectId).toBe('reliable')
    expect(accepted.consequences.some(row => row.reason === 'Reliable repeat')).toBe(false)
  })

  it('supports an authoritative choose-each-round Rotation order without exposing a fallback performer', () => {
    const raw = structuredClone(contestDocument(3, 'rotation')) as any
    raw.policy.rotationOrderPolicy = 'choose-each-round'
    for (const contestant of raw.contestants) contestant.rotationOrder = []
    let document = parseContestDocument(raw)
    const actor = contestCurrentContestant(document)!, selected = actor.performers[1]!
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(680), contestId: document.contestId, commandKind: 'select-rotation-performer', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, performerId: selected.performerId }, { now: 1, random: createSeededContestRandomSource(1) })
    expect(contestCurrentPerformer(document, document.contestants.find(row => row.contestantId === actor.contestantId)!)).toMatchObject({ performerId: selected.performerId })
    expect(() => executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(681), contestId: document.contestId, commandKind: 'select-rotation-performer', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, performerId: actor.performers[0]!.performerId }, { now: 2, random: createSeededContestRandomSource(1) })).toThrowError(ContestRuleError)
  })

  it('enforces the Rotation team-wide spend cap without pooling unrelated Pokémon preparation', () => {
    const seeded = structuredClone(contestDocument(3, 'rotation')) as any
    seeded.contestants[0].teamDicePools.cute = { total: 2, remaining: 2, contributors: [{ id: 'introduction:fixture', kind: 'introduction', statId: 'cute', dice: 2, active: true, label: 'Introduction', sourceId: 'fixture', explanation: 'Shared fixture dice.' }] }
    let document = parseContestDocument(seeded)
    const targetId = document.contestants[0]!.contestantId
    let operation = 700
    while (document.contestants.find(row => row.contestantId === targetId)!.teamContestDiceSpent < 6) {
      const actor = contestCurrentContestant(document)!, active = contestCurrentPerformer(document, actor)
      const spend = actor.contestantId === targetId ? 3 : 0
      document = executeContestEngineCommand(document, { ...appealCommand(document, operation++), performerId: active.performerId, spentDice: { beauty: 0, cool: 0, cute: spend, smart: 0, tough: 0 } }, { now: operation, random: createSeededContestRandomSource(operation) })
    }
    const target = document.contestants.find(row => row.contestantId === targetId)!
    expect(target.teamContestDiceSpent).toBe(6)
    expect(target.teamDicePools.cute.remaining).toBe(0)
    expect(target.performers[0]!.dicePools.cute.remaining).toBe(19)
    expect(target.performers[1]!.dicePools.cute.remaining).toBe(17)
    while (contestCurrentContestant(document)!.contestantId !== targetId) document = executeContestEngineCommand(document, appealCommand(document, operation++), { now: operation, random: createSeededContestRandomSource(operation) })
    const blocked = appealCommand(document, operation++)
    expect(() => executeContestEngineCommand(document, { ...blocked, spentDice: { beauty: 0, cool: 0, cute: 1, smart: 0, tough: 0 } }, { now: operation, random: createSeededContestRandomSource(operation) })).toThrowError(ContestRuleError)
  })

  it('rejects a settlement correction that would invent an unjournaled placement tie', () => {
    const document = resolveToSettlement(contestDocument(3)).document
    const ordered = [...document.contestants].sort((left, right) => Number(right.finalScore) - Number(left.finalScore))
    const higher = ordered.find((row, index) => ordered.some((candidate, candidateIndex) => candidateIndex > index && candidate.finalScore !== row.finalScore))!
    const lower = [...ordered].reverse().find(row => row.finalScore !== higher.finalScore)!
    const delta = Number(higher.finalScore) - Number(lower.finalScore)
    expect(delta).toBeGreaterThan(0)
    expect(() => executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(775), contestId: document.contestId, commandKind: 'apply-correction', expectedRevision: document.revision, clientId: null, correctionKind: 'appeal-delta', contestantId: lower.contestantId, statId: null, numericDelta: delta, replacementProfileId: null, reason: 'Tie creation fixture' }, { now: 7_900, random: createSeededContestRandomSource(1) })).toThrowError(expect.objectContaining({ issue: expect.objectContaining({ code: 'contest.correction-out-of-bounds' }) }))
  })

  it('turns an undeclared private package into an explicit guided settlement decision', () => {
    let document = resolveToSettlement(contestDocument(3)).document
    expect(document.policy.prize.declared).toBe(false)
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(780), contestId: document.contestId, commandKind: 'declare-prize', expectedRevision: document.revision, clientId: null }, { now: 8_000, random: createSeededContestRandomSource(1) })
    expect(document.policy.prize.declared).toBe(true)
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(781), contestId: document.contestId, commandKind: 'prepare-settlement', expectedRevision: document.revision, clientId: null }, { now: 8_001, random: createSeededContestRandomSource(1) })
    expect(document.settlement?.status).toBe('preview')
  })

  it('derives Rotation experience from Pokémon on lower-placed teams before an equal split', () => {
    const resolved = resolveToSettlement(contestDocument(3, 'rotation')).document
    const ready = parseContestDocument({ ...structuredClone(resolved), policy: { ...resolved.policy, prize: { declared: true, money: 0, items: [], notes: '' } } })
    const preview = executeContestEngineCommand(ready, { schemaVersion: 1, operationId: op(790), contestId: ready.contestId, commandKind: 'prepare-settlement', expectedRevision: ready.revision, clientId: null }, { now: 9_000, random: createSeededContestRandomSource(1) })
    const packages = [...preview.settlement!.entries].sort((left, right) => left.placement - right.placement).map(row => row.experienceByPokemon.map(entry => entry.experience))
    expect(packages).toEqual([[40, 40, 40], [20, 20, 20], [10, 10, 10]])
  })

  it('removes generated Introduction dice before an explicit restart', () => {
    const base = createContestDocument({ contestId: 'contest:v1:intro-restart', name: 'Restart', hallName: 'Hall', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: false, now: 1 })
    const rows = Array.from({ length: 3 }, (_, index) => createContestantState({ contestantId: `contestant:r${index}`, trainerSheetSlug: `trainer-r${index}`, trainerSheetRevision: 1, displayName: `R${index}`, controller: { kind: 'gm' }, performers: [performer(index)], rotationOrder: [] }))
    let document = parseContestDocument({ ...structuredClone(base), revision: 1, stage: 'introduction', policy: { ...base.policy, lockedAt: 1 }, contestants: rows })
    const baseline = document.contestants[0]!.performers[0]!.dicePools.cute.total
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(900), contestId: document.contestId, commandKind: 'declare-introduction', expectedRevision: document.revision, clientId: null, contestantId: document.contestants[0]!.contestantId, skillId: 'charm', generatedStatId: 'cute' }, { now: 2, random: createSequenceContestRandomSource([4, 5]), introduction: { skillDice: 2, bonusRolls: [], uglySixesCountAsOnes: false, graceFlexible: false } })
    expect(document.contestants[0]!.performers[0]!.dicePools.cute.total).toBe(baseline + 2)
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(901), contestId: document.contestId, commandKind: 'restart-introduction', expectedRevision: document.revision, clientId: null }, { now: 3, random: createSeededContestRandomSource(1) })
    expect(document.contestants[0]!.performers[0]!.dicePools.cute.total).toBe(baseline)
    expect(document.contestants[0]!.performers[0]!.dicePools.cute.contributors.some(row => row.kind === 'introduction')).toBe(false)
    expect(document.diceJournal).toHaveLength(2)
  })

  it('allocates independent Introduction bonus rolls without exposing private providers publicly', () => {
    const base = createContestDocument({ contestId: 'contest:v1:intro-allocation', name: 'Allocation', hallName: 'Hall', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: false, now: 1 })
    const rows = Array.from({ length: 3 }, (_, index) => createContestantState({ contestantId: `contestant:a${index}`, trainerSheetSlug: `trainer-a${index}`, trainerSheetRevision: 1, displayName: `A${index}`, controller: { kind: 'gm' }, performers: [performer(index)], rotationOrder: [] }))
    let document = parseContestDocument({ ...structuredClone(base), revision: 1, stage: 'introduction', policy: { ...base.policy, lockedAt: 1 }, contestants: rows })
    const actor = document.contestants[0]!
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(910), contestId: document.contestId, commandKind: 'declare-introduction', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, skillId: 'charm', generatedStatId: 'beauty', bonusStatIds: { contestAccessory: 'tough', jugglingShow: 'smart' } }, { now: 2, random: createSequenceContestRandomSource([4, 2, 3, 1, 5]), introduction: { skillDice: 2, bonusRolls: [{ sourceId: 'contest-accessory', label: 'Contest Accessory', dice: 2, statId: 'tough' }, { sourceId: 'juggling-show', label: 'Juggling Show', dice: 1, statId: 'smart' }], uglySixesCountAsOnes: false, graceFlexible: true } })
    const accepted = document.contestants[0]!
    expect(accepted.introduction.generatedDice).toBe(3)
    expect(accepted.introduction.matchingAppealBonus).toBe(2)
    expect(accepted.performers[0]!.dicePools.beauty.contributors.at(-1)?.dice).toBe(1)
    expect(accepted.performers[0]!.dicePools.tough.contributors.at(-1)?.dice).toBe(1)
    expect(accepted.performers[0]!.dicePools.smart.contributors.at(-1)?.dice).toBe(1)
    expect(document.history.find(row => row.type === 'introduction-accepted')?.detail).not.toContain('Contest Accessory')
    expect(document.history.find(row => row.type === 'introduction-evidence')?.visibility).toBe('owner')
    expect(document.history.find(row => row.type === 'introduction-evidence')?.detail).toContain('Contest Accessory')
    expect(parseContestDocument(document)).toEqual(document)
  })

  it('holds turn advancement for an offered reroll until use or explicit pass', () => {
    let document = contestDocument(3)
    const actor = contestCurrentContestant(document)!
    const copy = structuredClone(document)
    copy.contestants.find(row => row.contestantId === actor.contestantId)!.performers[0]!.providerIds = ['feature:Coordinator']
    document = parseContestDocument(copy)
    document = executeContestEngineCommand(document, appealCommand(document, 920), { now: 10, random: createSequenceContestRandomSource([1, 6, 5, 3]) })
    expect(document.pendingInterventionAppealId).toBe(document.appealLedger[0]!.appealId)
    expect(contestCurrentContestant(document)!.contestantId).toBe(actor.contestantId)
    const pendingId = document.pendingInterventionAppealId!
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(921), contestId: document.contestId, commandKind: 'use-intervention', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, interventionId: 'Coordinator', targetContestantId: null, appealId: pendingId, choices: {} }, { now: 11, random: createSequenceContestRandomSource([4, 3, 2, 5]) })
    expect(document.pendingInterventionAppealId).toBeNull()
    expect(document.appealLedger[0]!.journalIds).toHaveLength(2)
    expect(document.appealLedger[0]!.acceptedResults).toEqual([4, 3, 2, 5])
    expect(contestCurrentContestant(document)!.contestantId).not.toBe(actor.contestantId)

    let passed = contestDocument(3)
    const passActor = contestCurrentContestant(passed)!
    const passCopy = structuredClone(passed)
    passCopy.contestants.find(row => row.contestantId === passActor.contestantId)!.performers[0]!.providerIds = ['feature:Coordinator']
    passed = executeContestEngineCommand(parseContestDocument(passCopy), appealCommand(parseContestDocument(passCopy), 922), { now: 12, random: createSeededContestRandomSource(5) })
    passed = executeContestEngineCommand(passed, { schemaVersion: 1, operationId: op(923), contestId: passed.contestId, commandKind: 'pass-intervention', expectedRevision: passed.revision, clientId: null, contestantId: passActor.contestantId, appealId: passed.pendingInterventionAppealId! }, { now: 13, random: createSeededContestRandomSource(6) })
    expect(passed.pendingInterventionAppealId).toBeNull()
    expect(passed.history.at(-1)?.type).toBe('intervention-window-passed')
  })

  it('keeps the accepted-result window open for sequential eligible rerolls', () => {
    let document = contestDocument(3)
    const actor = contestCurrentContestant(document)!
    const copy = structuredClone(document)
    copy.contestants.find(row => row.contestantId === actor.contestantId)!.performers[0]!.providerIds = ['feature:Coordinator', 'feature:Style Flourish:cute', 'item:Contest Fashion:cute']
    document = executeContestEngineCommand(parseContestDocument(copy), appealCommand(parseContestDocument(copy), 930), { now: 20, random: createSequenceContestRandomSource([1, 6, 5, 3]) })
    const appealId = document.pendingInterventionAppealId!
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(931), contestId: document.contestId, commandKind: 'use-intervention', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, interventionId: 'Style Flourish', targetContestantId: null, appealId, choices: {} }, { now: 21, random: createSequenceContestRandomSource([1]) })
    expect(document.pendingInterventionAppealId).toBe(appealId)
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(932), contestId: document.contestId, commandKind: 'use-intervention', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, interventionId: 'Contest Fashion', targetContestantId: null, appealId, choices: {} }, { now: 22, random: createSequenceContestRandomSource([1]) })
    expect(document.pendingInterventionAppealId).toBe(appealId)
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(933), contestId: document.contestId, commandKind: 'use-intervention', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, interventionId: 'Coordinator', targetContestantId: null, appealId, choices: {} }, { now: 23, random: createSequenceContestRandomSource([4, 3, 2, 5]) })
    expect(document.pendingInterventionAppealId).toBeNull()
    expect(document.appealLedger[0]!.journalIds).toHaveLength(4)
    expect(document.appealLedger[0]!.acceptedResults).toEqual([4, 3, 2, 5])
    expect(document.contestants.find(row => row.contestantId === actor.contestantId)!.usedInterventionIds).toEqual(expect.arrayContaining(['Style Flourish', 'Contest Fashion', 'Coordinator']))
  })

  it.each([
    ['Fabulous Max', 'beauty', 1, 'Alignment improved to matching by an accepted intervention.'],
    ['Rule of Cool', 'cool', 0, 'Alignment improved from opposed to allied by an accepted intervention.'],
    ['Gleeful Steps', 'cute', 1, 'Alignment improved to matching by an accepted intervention.'],
    ['Calculated Assault', 'smart', 1, 'Alignment improved to matching by an accepted intervention.'],
    ['Macho Charge', 'tough', 0, 'Alignment improved from opposed to allied by an accepted intervention.'],
  ] as const)('%s improves its matching Move by one canonical alignment step', (interventionId, moveTypeId, expectedDice, explanation) => {
    const raw = structuredClone(contestDocument(3)) as any
    const actorId = contestCurrentContestant(parseContestDocument(raw))!.contestantId
    const actor = raw.contestants.find((row: any) => row.contestantId === actorId)
    actor.performers[0].moves[0].typeId = moveTypeId
    actor.performers[0].providerIds = [`feature:${interventionId}`]
    let document = parseContestDocument(raw)
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(940), contestId: document.contestId, commandKind: 'use-intervention', expectedRevision: document.revision, clientId: null, contestantId: actorId, interventionId, targetContestantId: null, appealId: null, choices: {} }, { now: 30, random: createSeededContestRandomSource(1) })
    document = executeContestEngineCommand(document, appealCommand(document, 941), { now: 31, random: createSeededContestRandomSource(2) })
    expect(document.appealLedger[0]!.moveTypeId).toBe(moveTypeId)
    expect(document.appealLedger[0]!.contributors.find(row => row.kind === 'type')).toMatchObject({ dice: expectedDice, explanation })
  })

  it('adds Voice Lessons only to an enrolled Sonic Move appeal', () => {
    const raw = structuredClone(contestDocument(3)) as any
    const actorId = contestCurrentContestant(parseContestDocument(raw))!.contestantId
    const actor = raw.contestants.find((row: any) => row.contestantId === actorId)
    actor.performers[0].moves[0].tags = ['sonic']
    actor.performers[0].providerIds = ['feature:Voice Lessons']
    const document = parseContestDocument(raw)
    const accepted = executeContestEngineCommand(document, appealCommand(document, 945), { now: 32, random: createSeededContestRandomSource(3) })
    expect(accepted.appealLedger[0]!.contributors).toContainEqual(expect.objectContaining({ id: 'feature:Voice Lessons', dice: 1 }))
  })

  it('validates Adaptable Performance from offered Move identities and blocks both next round', () => {
    let document = contestDocument(3, 'standard', ['excitement', 'safe-option', 'steady-performance'])
    const actor = contestCurrentContestant(document)!
    const copy = structuredClone(document)
    copy.contestants.find(row => row.contestantId === actor.contestantId)!.performers[0]!.providerIds = ['feature:Adaptable Performance']
    document = parseContestDocument(copy)
    const moves = contestCurrentPerformer(document, contestCurrentContestant(document)!).moves
    document = executeContestEngineCommand(document, { schemaVersion: 1, operationId: op(950), contestId: document.contestId, commandKind: 'use-intervention', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, interventionId: 'Adaptable Performance', targetContestantId: null, appealId: null, choices: { typeMoveOptionId: moves[0]!.optionId, effectMoveOptionId: moves[1]!.optionId } }, { now: 10, random: createSeededContestRandomSource(2) })
    document = executeContestEngineCommand(document, appealCommand(document, 951, 1), { now: 11, random: createSeededContestRandomSource(3) })
    while (document.round === 1) document = executeContestEngineCommand(document, appealCommand(document, 952 + document.turnIndex, 0), { now: 12 + document.turnIndex, random: createSeededContestRandomSource(4 + document.turnIndex) })
    while (contestCurrentContestant(document)!.contestantId !== actor.contestantId) document = executeContestEngineCommand(document, appealCommand(document, 960 + document.turnIndex, 1), { now: 20 + document.turnIndex, random: createSeededContestRandomSource(10 + document.turnIndex) })
    expect(() => executeContestEngineCommand(document, appealCommand(document, 970, 0), { now: 30, random: createSeededContestRandomSource(20) })).toThrowError(ContestRuleError)
    try { executeContestEngineCommand(document, appealCommand(document, 971, 0), { now: 31, random: createSeededContestRandomSource(21) }) } catch (error) { expect((error as ContestRuleError).issue.code).toBe('contest.move-blocked-by-intervention') }
  })
})
