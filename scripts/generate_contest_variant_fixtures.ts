import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import movesJson from '../data/reference/moves.json'
import { createContestDocument, emptyContestDicePools, contestCurrentContestant, contestCurrentPerformer, type ContestMoveOptionV1, type ContestPokemonPerformerSnapshotV1, type ContestTrainerPerformerSnapshotV1 } from '../shared/contests/document'
import { createSeededContestRandomSource } from '../shared/contests/dice'
import { createContestantState, executeContestEngineCommand } from '../server/domain/contests/engine'
import type { ContestParticipantMethodId, ContestStatId, ContestVariantId } from '../shared/contests/ids'
import { projectContestGm } from '../shared/contests/projections'
import { stableJsonStringify } from '../shared/automation/stableJson'

const root = resolve(import.meta.dirname, '..')
const outputPath = resolve(root, 'data/contests/variant-matrix.v1.json')
const participantOutputPath = resolve(root, 'data/contests/trainer-participant-variant-matrix.v1.json')
const sha = (path: string): string => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')
const digest = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const op = (scenario: string, n: number): string => `contest-op:v1:${scenario}-${String(n).padStart(3, '0')}`
const moveRows = Object.entries(movesJson as Record<string, any>)
const movesFor = (typeId: ContestStatId): readonly ContestMoveOptionV1[] => moveRows
  .filter(([, row]) => row.contest?.status === 'defined' && row.contest.typeId === typeId)
  .slice(0, 2)
  .map(([id, row]) => Object.freeze({ optionId: `move:${id.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`, canonicalMoveId: id, label: row.name, typeId: row.contest.typeId, effectId: row.contest.effectId, tags: Object.freeze(row.contest.tags ?? []), source: 'sheet' as const, available: true, unavailableCode: null, unavailableReason: null }))

interface Scenario { readonly id: string, readonly variantId: ContestVariantId, readonly contestTypeId: ContestStatId, readonly contestantCount: 3|4|5, readonly seed: number }
const statIds: readonly ContestStatId[] = ['beauty','cool','cute','smart','tough']
const skillIds = ['intuition','command','charm','guile','intimidate'] as const
const scenarios: readonly Scenario[] = Object.freeze([
  ...statIds.flatMap((typeId, typeIndex) => ([3,4,5] as const).map((contestantCount, countIndex) => ({ id: `standard-${typeId}-${contestantCount}`, variantId: 'standard' as const, contestTypeId: typeId, contestantCount, seed: 1_000 + typeIndex * 10 + countIndex }))),
  { id: 'supercontest-five', variantId: 'supercontest', contestTypeId: 'cute', contestantCount: 5, seed: 2_001 },
  { id: 'festival-five', variantId: 'festival', contestTypeId: 'beauty', contestantCount: 5, seed: 2_002 },
  { id: 'rotation-three', variantId: 'rotation', contestTypeId: 'smart', contestantCount: 3, seed: 2_003 },
])
const performer = (scenario: Scenario, contestant: number, index: number): ContestPokemonPerformerSnapshotV1 => {
  const typeId = statIds[(statIds.indexOf(scenario.contestTypeId) + contestant + index) % statIds.length]!
  return Object.freeze({ performerKind: 'pokemon', performerId: `performer:${scenario.id}-${contestant}-${index}`, pokemonSheetSlug: `pokemon-${scenario.id}-${contestant}-${index}`, pokemonSheetRevision: 1, displayName: `Partner ${contestant + 1}.${index + 1}`, species: 'Pikachu', level: 10 + contestant, portraitUrl: null, moves: Object.freeze(movesFor(typeId)), dicePools: emptyContestDicePools(), providerIds: Object.freeze([]) })
}
const run = (scenario: Scenario) => {
  const random = createSeededContestRandomSource(scenario.seed)
  let document = createContestDocument({ contestId: `contest:v1:${scenario.id}`, name: scenario.id, hallName: 'Fixture Hall', description: 'Deterministic variant matrix.', variantId: scenario.variantId, contestTypeId: scenario.variantId === 'supercontest' ? null : scenario.contestTypeId, significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '', now: 1 })
  let operation = 1
  for (let contestant = 0; contestant < scenario.contestantCount; contestant += 1) {
    const performerCount = scenario.variantId === 'rotation' ? scenario.contestantCount : 1
    const skillId = skillIds[contestant % skillIds.length]!
    const introductionSkillDice = { charm: 2, command: 2, guile: 2, intimidate: 2, intuition: 2, [skillId]: 2 + contestant }
    const enrollment = createContestantState({ contestantId: `contestant:${scenario.id}-${contestant}`, trainerSheetSlug: `trainer-${scenario.id}-${contestant}`, trainerSheetRevision: 1, displayName: `Trainer ${contestant + 1}`, controller: { kind: 'gm' }, performers: Object.freeze(Array.from({ length: performerCount }, (_, index) => performer(scenario, contestant, index))), rotationOrder: scenario.variantId === 'rotation' ? Object.freeze(Array.from({ length: performerCount }, (_, index) => index)) : Object.freeze([]), introductionSkillDice })
    document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'enroll-contestant', expectedRevision: document.revision, clientId: null, contestantId: enrollment.contestantId, trainerSheetSlug: enrollment.trainerSheetSlug, pokemonSheetSlugs: enrollment.performers.map(row => row.pokemonSheetSlug), controller: enrollment.controller, rotationOrder: enrollment.rotationOrder }, { now: operation, random, enrollment })
  }
  document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'start-introduction', expectedRevision: document.revision, clientId: null }, { now: operation, random })
  for (let contestant = 0; contestant < scenario.contestantCount; contestant += 1) {
    const row = document.contestants[contestant]!
    const generatedStatId = statIds[contestant % statIds.length]!
    document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'declare-introduction', expectedRevision: document.revision, clientId: null, contestantId: row.contestantId, skillId: skillIds[contestant % skillIds.length]!, generatedStatId }, { now: operation, random, introduction: { skillDice: 2 + contestant, bonusRolls: [], uglySixesCountAsOnes: false, graceFlexible: true } })
  }
  document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'start-performance', expectedRevision: document.revision, clientId: null }, { now: operation, random })
  const letters = document.contestants.map(row => ({ contestantId: row.contestantId, letter: row.letter, introductionTotal: row.introduction.letterTotal }))
  let appealGuard = 0
  while (document.stage === 'performance' && appealGuard++ < 100) {
    const actor = contestCurrentContestant(document)!
    const active = contestCurrentPerformer(document, actor)
    const previousMove = [...document.appealLedger].reverse().find(row => row.contestantId === actor.contestantId && row.performerId === active.performerId)?.moveOptionId ?? null
    const option = active.moves.find(row => row.available && row.optionId !== previousMove) ?? active.moves.find(row => row.available)!
    document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'declare-appeal', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, performerId: active.performerId, moveOptionId: option.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { now: operation, random })
  }
  if (document.stage !== 'settling') throw new Error(`${scenario.id} did not reach settlement.`)
  document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'prepare-settlement', expectedRevision: document.revision, clientId: null }, { now: operation, random })
  return Object.freeze({
    letters,
    acceptedAppeals: document.appealLedger.length,
    festivalHeat: document.festivalHeat,
    supercontestTypeByRound: document.supercontestTypeByRound,
    placements: [...document.contestants].sort((a,b) => a.finalPlacement! - b.finalPlacement!).map(row => ({ contestantId: row.contestantId, placement: row.finalPlacement, appeal: row.appeal, fumble: row.fumble, finalScore: row.finalScore })),
    settlement: document.settlement!.entries.map(row => ({ contestantId: row.contestantId, placement: row.placement, totalExperience: row.experienceByPokemon.reduce((sum, award) => sum + award.experience, 0), ribbon: row.ribbon })),
    evidenceSha256: digest({ diceJournal: document.diceJournal, appealLedger: document.appealLedger, history: document.history }),
  })
}
interface ParticipantScenario {
  readonly id: string
  readonly variantId: ContestVariantId
  readonly participantMethodId: ContestParticipantMethodId
  readonly contestantCount: 3|4|5
  readonly seed: number
}
const participantScenarios: readonly ParticipantScenario[] = Object.freeze((['standard','supercontest','festival','rotation'] as const).flatMap((variantId, variantIndex) =>
  (['simultaneous','alternating'] as const).flatMap((participantMethodId, methodIndex) => ([3,4,5] as const).map((contestantCount, countIndex) => ({
    id: `trainer-participant-${variantId}-${participantMethodId}-${contestantCount}`,
    variantId,
    participantMethodId,
    contestantCount,
    seed: 3_000 + variantIndex * 100 + methodIndex * 10 + countIndex,
  }))),
))
const trainerPerformer = (scenario: ParticipantScenario, contestant: number): ContestTrainerPerformerSnapshotV1 => Object.freeze({
  performerKind: 'trainer', performerId: `performer:trainer-${scenario.id}-${contestant}`, trainerSheetSlug: `trainer-${scenario.id}-${contestant}`, trainerSheetRevision: 1,
  displayName: `Trainer ${contestant + 1}`, level: 10 + contestant, portraitUrl: null,
  moves: Object.freeze(movesFor(statIds[(contestant + 2) % statIds.length]!)), dicePools: emptyContestDicePools(), providerIds: Object.freeze([]),
})
const participantPokemon = (scenario: ParticipantScenario, contestant: number, index: number): ContestPokemonPerformerSnapshotV1 => {
  const typeId = statIds[(contestant + index) % statIds.length]!
  return Object.freeze({ performerKind: 'pokemon', performerId: `performer:${scenario.id}-${contestant}-${index}`, pokemonSheetSlug: `pokemon-${scenario.id}-${contestant}-${index}`, pokemonSheetRevision: 1, displayName: `Partner ${contestant + 1}.${index + 1}`, species: 'Pikachu', level: 10 + contestant, portraitUrl: null, moves: Object.freeze(movesFor(typeId)), dicePools: emptyContestDicePools(), providerIds: Object.freeze([]) })
}
const runParticipant = (scenario: ParticipantScenario) => {
  const random = createSeededContestRandomSource(scenario.seed)
  let document = createContestDocument({ contestId: `contest:v1:${scenario.id}`, name: scenario.id, hallName: 'Fixture Hall', description: 'Deterministic Trainer Participant matrix.', variantId: scenario.variantId, participantVariantId: 'trainer-participant', participantMethodId: scenario.participantMethodId, contestTypeId: scenario.variantId === 'supercontest' ? null : 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '', now: 1 })
  let operation = 1
  for (let contestant = 0; contestant < scenario.contestantCount; contestant += 1) {
    const pokemonCount = scenario.variantId === 'rotation' ? scenario.contestantCount : 1
    const pokemon = Array.from({ length: pokemonCount }, (_, index) => participantPokemon(scenario, contestant, index))
    const trainer = trainerPerformer(scenario, contestant)
    const skillId = skillIds[contestant % skillIds.length]!
    const introductionSkillDice = { charm: 2, command: 2, guile: 2, intimidate: 2, intuition: 2, [skillId]: 2 + contestant }
    const enrollment = createContestantState({ contestantId: `contestant:${scenario.id}-${contestant}`, trainerSheetSlug: trainer.trainerSheetSlug, trainerSheetRevision: 1, displayName: trainer.displayName, controller: { kind: 'gm' }, performers: Object.freeze([...pokemon, trainer]), rotationOrder: scenario.variantId === 'rotation' ? Object.freeze(Array.from({ length: pokemonCount }, (_, index) => index)) : Object.freeze([]), introductionSkillDice })
    document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'enroll-contestant', expectedRevision: document.revision, clientId: null, contestantId: enrollment.contestantId, trainerSheetSlug: enrollment.trainerSheetSlug, pokemonSheetSlugs: pokemon.map(row => row.pokemonSheetSlug), controller: enrollment.controller, rotationOrder: enrollment.rotationOrder }, { now: operation, random, enrollment })
  }
  document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'start-introduction', expectedRevision: document.revision, clientId: null }, { now: operation, random })
  for (let contestant = 0; contestant < scenario.contestantCount; contestant += 1) {
    const row = document.contestants[contestant]!, generatedStatId = statIds[contestant % statIds.length]!
    document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'declare-introduction', expectedRevision: document.revision, clientId: null, contestantId: row.contestantId, skillId: skillIds[contestant % skillIds.length]!, generatedStatId, bonusStatIds: {} }, { now: operation, random, introduction: { skillDice: 2 + contestant, bonusRolls: [], uglySixesCountAsOnes: false, graceFlexible: true } })
  }
  document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'start-performance', expectedRevision: document.revision, clientId: null }, { now: operation, random })
  const letters = document.contestants.map(row => ({ contestantId: row.contestantId, letter: row.letter, introductionTotal: row.introduction.letterTotal }))
  const performerSequences: Record<string, string[]> = Object.fromEntries(document.contestants.map(row => [row.contestantId, []]))
  let appealGuard = 0
  while (document.stage === 'performance' && appealGuard++ < 400) {
    const actor = contestCurrentContestant(document)!, legalIds = projectContestGm(document).currentLegalPerformerIds
    const selectedId = legalIds[(appealGuard + scenario.seed) % legalIds.length]!
    const active = actor.performers.find(row => row.performerId === selectedId)!
    const previousMove = [...document.appealLedger].reverse().find(row => row.contestantId === actor.contestantId && row.performerId === active.performerId)?.moveOptionId ?? null
    const option = active.moves.find(row => row.available && row.optionId !== previousMove) ?? active.moves.find(row => row.available)!
    document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'declare-appeal', expectedRevision: document.revision, clientId: null, contestantId: actor.contestantId, performerId: active.performerId, moveOptionId: option.optionId, partnerEffectTargetPerformerId: null, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } }, { now: operation, random })
    performerSequences[actor.contestantId]!.push(active.performerKind)
  }
  if (document.stage !== 'settling') throw new Error(`${scenario.id} did not reach settlement.`)
  document = executeContestEngineCommand(document, { schemaVersion: 1, contestId: document.contestId, operationId: op(scenario.id, operation++), commandKind: 'prepare-settlement', expectedRevision: document.revision, clientId: null }, { now: operation, random })
  return Object.freeze({
    letters,
    acceptedAppeals: document.appealLedger.length,
    festivalHeat: document.festivalHeat,
    supercontestTypeByRound: document.supercontestTypeByRound,
    performerSequences,
    placements: [...document.contestants].sort((a,b) => a.finalPlacement! - b.finalPlacement!).map(row => ({ contestantId: row.contestantId, placement: row.finalPlacement, appeal: row.appeal, fumble: row.fumble, finalScore: row.finalScore })),
    settlement: document.settlement!.entries.map(row => ({ contestantId: row.contestantId, placement: row.placement, pokemonAwards: row.experienceByPokemon.length, totalExperience: row.experienceByPokemon.reduce((sum, award) => sum + award.experience, 0), ribbon: row.ribbon })),
    evidenceSha256: digest({ diceJournal: document.diceJournal, appealLedger: document.appealLedger, sharedDiceSpendJournal: document.contestants.map(row => row.sharedDiceSpendJournal), history: document.history, settlement: document.settlement }),
  })
}
const sources = [
  { path: 'data/reference/contests.json', sha256: sha('data/reference/contests.json') },
  { path: 'data/reference/moves.json', sha256: sha('data/reference/moves.json') },
]
const generated = { schemaVersion: 1, fixtureSetId: 'pokemon-contest-variant-matrix-v1', sources, scenarios: scenarios.map(scenario => ({ ...scenario, expected: run(scenario) })) }
const participantGenerated = { schemaVersion: 1, fixtureSetId: 'trainer-participant-contest-variant-matrix-v1', participantVariantId: 'trainer-participant', sources, scenarios: participantScenarios.map(scenario => ({ ...scenario, expected: runParticipant(scenario) })) }
const serialized = `${JSON.stringify(generated, null, 2)}\n`
const participantSerialized = `${JSON.stringify(participantGenerated, null, 2)}\n`
if (process.argv.includes('--write')) {
  writeFileSync(outputPath, serialized)
  writeFileSync(participantOutputPath, participantSerialized)
  console.log(`Wrote ${outputPath} and ${participantOutputPath}`)
} else {
  const current = readFileSync(outputPath, 'utf8')
  const participantCurrent = readFileSync(participantOutputPath, 'utf8')
  if (current !== serialized || participantCurrent !== participantSerialized) throw new Error('Contest variant fixtures drifted; run generator with --write after reviewed changes.')
  console.log(`Contest variant fixtures match (${scenarios.length} ordinary + ${participantScenarios.length} Trainer Participant scenarios).`)
}
