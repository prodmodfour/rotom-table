import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import movesJson from '../data/reference/moves.json'
import { stableJsonStringify } from '../shared/automation/stableJson'
import {
  battleContestHandoffCanonicalJson,
  parseBattleContestHandoffDelivery,
  type BattleContestHandoffFactV1,
} from '../shared/contests/battleBlend'
import {
  battleContestRosterCanonicalJson,
  parseBattleContestEncounterBinding,
  type BattleContestEncounterBindingV1,
  type BattleContestRosterHashMaterialV1,
} from '../shared/contests/battleEncounter'
import { createSeededContestRandomSource } from '../shared/contests/dice'
import {
  createContestDocument,
  emptyContestDicePools,
  type ContestDocumentV1,
  type ContestMoveOptionV1,
  type ContestPokemonPerformerSnapshotV1,
} from '../shared/contests/document'
import type { ContestStatId } from '../shared/contests/ids'
import {
  createContestantState,
  executeContestEngineCommand,
} from '../server/domain/contests/engine'
import { executeBattleContestAcceptedMoveAppeal } from '../server/domain/contests/battleAppeal'
import { executeBattleContestEnd } from '../server/domain/contests/battleEnd'
import { executeBattleContestVoltageLifecycle } from '../server/domain/contests/battleVoltageLifecycle'

const root = resolve(import.meta.dirname, '..')
const outputPath = resolve(root, 'data/contests/battle-contest-scenarios.v1.json')
const digestText = (value: string): string => createHash('sha256').update(value).digest('hex')
const digest = (value: unknown): string => digestText(stableJsonStringify(value))
const fileSha = (path: string): string => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')
const sides = ['north', 'south'] as const
type Side = typeof sides[number]
const opposite = (side: Side): Side => side === 'north' ? 'south' : 'north'
const zeroSpend = (): Record<ContestStatId, number> => ({ beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 })

interface AppealStep {
  readonly kind: 'appeal'
  readonly side: Side
  readonly pokemonIndex: number
  readonly move: 'Agility' | 'Tackle'
  readonly round: number
  readonly spendStat: ContestStatId | null
}
interface SwitchStep {
  readonly kind: 'switch'
  readonly side: Side
  readonly recalledIndex: number
  readonly sentOutIndex: number
  readonly round: number
  readonly exception: null | 'Baton Pass' | 'U-Turn'
}
interface SendOutStep {
  readonly kind: 'send-out'
  readonly side: Side
  readonly pokemonIndex: number
  readonly round: number
}
interface KnockoutStep {
  readonly kind: 'knockout'
  readonly cause: 'attack' | 'damage-over-time'
  readonly sourceSide: Side
  readonly sourcePokemonIndex: number
  readonly targetSide: Side
  readonly targetPokemonIndex: number
  readonly round: number
  readonly terminal: boolean
}
interface EndStep {
  readonly kind: 'end'
  readonly condition: 'round-budget-exhausted' | 'one-trainer-all-pokemon-knocked-out'
  readonly round: number
  readonly knockedOutSide: Side | null
}
type FixtureStep = AppealStep | SwitchStep | SendOutStep | KnockoutStep | EndStep

interface FixtureScenario {
  readonly id: string
  readonly seed: number
  readonly rosterSize: 3 | 6
  readonly steps: readonly FixtureStep[]
}

const scenarios: readonly FixtureScenario[] = Object.freeze([
  {
    id: 'minimum-three-round-budget', seed: 79_031, rosterSize: 3,
    steps: [
      { kind: 'appeal', side: 'north', pokemonIndex: 0, move: 'Agility', round: 1, spendStat: 'cool' },
      { kind: 'appeal', side: 'south', pokemonIndex: 0, move: 'Tackle', round: 1, spendStat: 'cute' },
      { kind: 'switch', side: 'north', recalledIndex: 0, sentOutIndex: 1, round: 2, exception: null },
      { kind: 'appeal', side: 'north', pokemonIndex: 1, move: 'Tackle', round: 2, spendStat: null },
      { kind: 'knockout', cause: 'attack', sourceSide: 'north', sourcePokemonIndex: 1, targetSide: 'south', targetPokemonIndex: 0, round: 2, terminal: false },
      { kind: 'send-out', side: 'south', pokemonIndex: 1, round: 3 },
      { kind: 'appeal', side: 'south', pokemonIndex: 1, move: 'Agility', round: 3, spendStat: null },
      { kind: 'knockout', cause: 'damage-over-time', sourceSide: 'south', sourcePokemonIndex: 1, targetSide: 'north', targetPokemonIndex: 1, round: 4, terminal: false },
      { kind: 'send-out', side: 'north', pokemonIndex: 2, round: 5 },
      { kind: 'appeal', side: 'north', pokemonIndex: 2, move: 'Tackle', round: 5, spendStat: null },
      { kind: 'end', condition: 'round-budget-exhausted', round: 6, knockedOutSide: null },
    ],
  },
  {
    id: 'minimum-three-all-pokemon-ko', seed: 79_032, rosterSize: 3,
    steps: [
      { kind: 'appeal', side: 'north', pokemonIndex: 0, move: 'Tackle', round: 1, spendStat: 'cool' },
      { kind: 'appeal', side: 'south', pokemonIndex: 0, move: 'Agility', round: 1, spendStat: 'cute' },
      { kind: 'knockout', cause: 'attack', sourceSide: 'south', sourcePokemonIndex: 0, targetSide: 'north', targetPokemonIndex: 0, round: 1, terminal: false },
      { kind: 'send-out', side: 'north', pokemonIndex: 1, round: 2 },
      { kind: 'appeal', side: 'north', pokemonIndex: 1, move: 'Agility', round: 2, spendStat: null },
      { kind: 'switch', side: 'south', recalledIndex: 0, sentOutIndex: 1, round: 2, exception: 'Baton Pass' },
      { kind: 'knockout', cause: 'attack', sourceSide: 'south', sourcePokemonIndex: 1, targetSide: 'north', targetPokemonIndex: 1, round: 2, terminal: false },
      { kind: 'send-out', side: 'north', pokemonIndex: 2, round: 3 },
      { kind: 'appeal', side: 'north', pokemonIndex: 2, move: 'Tackle', round: 3, spendStat: null },
      { kind: 'knockout', cause: 'attack', sourceSide: 'south', sourcePokemonIndex: 1, targetSide: 'north', targetPokemonIndex: 2, round: 4, terminal: true },
      { kind: 'end', condition: 'one-trainer-all-pokemon-knocked-out', round: 4, knockedOutSide: 'north' },
    ],
  },
  {
    id: 'maximum-six-round-budget', seed: 79_061, rosterSize: 6,
    steps: [
      { kind: 'appeal', side: 'north', pokemonIndex: 0, move: 'Agility', round: 1, spendStat: 'cool' },
      { kind: 'appeal', side: 'south', pokemonIndex: 0, move: 'Tackle', round: 1, spendStat: 'cute' },
      { kind: 'switch', side: 'north', recalledIndex: 0, sentOutIndex: 1, round: 2, exception: null },
      { kind: 'switch', side: 'south', recalledIndex: 0, sentOutIndex: 1, round: 2, exception: 'U-Turn' },
      { kind: 'appeal', side: 'north', pokemonIndex: 1, move: 'Tackle', round: 3, spendStat: null },
      { kind: 'appeal', side: 'south', pokemonIndex: 1, move: 'Agility', round: 3, spendStat: null },
      { kind: 'knockout', cause: 'attack', sourceSide: 'north', sourcePokemonIndex: 1, targetSide: 'south', targetPokemonIndex: 1, round: 4, terminal: false },
      { kind: 'send-out', side: 'south', pokemonIndex: 2, round: 5 },
      { kind: 'knockout', cause: 'damage-over-time', sourceSide: 'south', sourcePokemonIndex: 2, targetSide: 'north', targetPokemonIndex: 1, round: 5, terminal: false },
      { kind: 'send-out', side: 'north', pokemonIndex: 2, round: 6 },
      { kind: 'appeal', side: 'north', pokemonIndex: 2, move: 'Agility', round: 7, spendStat: null },
      { kind: 'appeal', side: 'south', pokemonIndex: 2, move: 'Tackle', round: 8, spendStat: null },
      { kind: 'end', condition: 'round-budget-exhausted', round: 12, knockedOutSide: null },
    ],
  },
  {
    id: 'maximum-six-all-pokemon-ko', seed: 79_062, rosterSize: 6,
    steps: [
      { kind: 'appeal', side: 'north', pokemonIndex: 0, move: 'Agility', round: 1, spendStat: 'cool' },
      { kind: 'appeal', side: 'south', pokemonIndex: 0, move: 'Tackle', round: 1, spendStat: 'cute' },
      { kind: 'knockout', cause: 'attack', sourceSide: 'north', sourcePokemonIndex: 0, targetSide: 'south', targetPokemonIndex: 0, round: 1, terminal: false },
      { kind: 'send-out', side: 'south', pokemonIndex: 1, round: 2 },
      { kind: 'switch', side: 'north', recalledIndex: 0, sentOutIndex: 1, round: 2, exception: null },
      { kind: 'appeal', side: 'north', pokemonIndex: 1, move: 'Tackle', round: 2, spendStat: null },
      { kind: 'knockout', cause: 'attack', sourceSide: 'north', sourcePokemonIndex: 1, targetSide: 'south', targetPokemonIndex: 1, round: 2, terminal: false },
      { kind: 'send-out', side: 'south', pokemonIndex: 2, round: 3 },
      { kind: 'appeal', side: 'south', pokemonIndex: 2, move: 'Agility', round: 3, spendStat: null },
      { kind: 'knockout', cause: 'damage-over-time', sourceSide: 'north', sourcePokemonIndex: 1, targetSide: 'south', targetPokemonIndex: 2, round: 3, terminal: false },
      { kind: 'send-out', side: 'south', pokemonIndex: 3, round: 4 },
      { kind: 'switch', side: 'north', recalledIndex: 1, sentOutIndex: 2, round: 4, exception: 'Baton Pass' },
      { kind: 'appeal', side: 'north', pokemonIndex: 2, move: 'Agility', round: 4, spendStat: null },
      { kind: 'knockout', cause: 'attack', sourceSide: 'north', sourcePokemonIndex: 2, targetSide: 'south', targetPokemonIndex: 3, round: 4, terminal: false },
      { kind: 'send-out', side: 'south', pokemonIndex: 4, round: 5 },
      { kind: 'appeal', side: 'south', pokemonIndex: 4, move: 'Tackle', round: 5, spendStat: null },
      { kind: 'knockout', cause: 'attack', sourceSide: 'north', sourcePokemonIndex: 2, targetSide: 'south', targetPokemonIndex: 4, round: 5, terminal: false },
      { kind: 'send-out', side: 'south', pokemonIndex: 5, round: 6 },
      { kind: 'appeal', side: 'south', pokemonIndex: 5, move: 'Agility', round: 6, spendStat: null },
      { kind: 'knockout', cause: 'attack', sourceSide: 'north', sourcePokemonIndex: 2, targetSide: 'south', targetPokemonIndex: 5, round: 8, terminal: true },
      { kind: 'end', condition: 'one-trainer-all-pokemon-knocked-out', round: 8, knockedOutSide: 'south' },
    ],
  },
])

const canonicalMove = (name: 'Agility' | 'Tackle'): ContestMoveOptionV1 => {
  const row = (movesJson as Record<string, any>)[name]
  if (!row?.contest || row.contest.status !== 'defined') throw new Error(`Fixture Move ${name} lacks canonical Contest identity.`)
  return Object.freeze({
    optionId: `move:${name.toLowerCase()}`,
    canonicalMoveId: name,
    label: name,
    typeId: row.contest.typeId,
    effectId: row.contest.effectId,
    tags: Object.freeze(row.contest.tags ?? []),
    source: 'sheet' as const,
    available: true,
    unavailableCode: null,
    unavailableReason: null,
  })
}
const moveOptions = Object.freeze([canonicalMove('Agility'), canonicalMove('Tackle')])
const contestantId = (scenario: FixtureScenario, side: Side): string => `contestant:${scenario.id}-${side}`
const trainerSlug = (scenario: FixtureScenario, side: Side): string => `trainer-${scenario.id}-${side}`
const pokemonSlug = (scenario: FixtureScenario, side: Side, index: number): string => `pokemon-${scenario.id}-${side}-${index + 1}`
const performerId = (scenario: FixtureScenario, side: Side, index: number): string => `performer:${scenario.id}-${side}-${index + 1}`
const placementId = (scenario: FixtureScenario, side: Side, kind: 'trainer' | 'pokemon', index = 0): string => `placement:${scenario.id}-${side}-${kind}-${index + 1}`
const reserveId = (scenario: FixtureScenario, side: Side, index: number): string => `reserve:${scenario.id}-${side}-${index + 1}`

const fixtureBinding = (scenario: FixtureScenario, document: ContestDocumentV1): BattleContestEncounterBindingV1 => {
  const contestId = document.contestId
  const material: BattleContestRosterHashMaterialV1 = {
    schemaVersion: 1,
    contestId,
    teams: sides.map(side => {
      const contestant = document.contestants.find(row => row.contestantId === contestantId(scenario, side))!
      return {
        contestantId: contestant.contestantId,
        trainerSheetSlug: contestant.trainerSheetSlug,
        trainerSheetRevision: contestant.trainerSheetRevision,
        pokemon: contestant.performers.map(performer => ({
          performerId: performer.performerId,
          pokemonSheetSlug: performer.performerKind === 'pokemon' ? performer.pokemonSheetSlug : '',
          pokemonSheetRevision: performer.performerKind === 'pokemon' ? performer.pokemonSheetRevision : 0,
        })),
      }
    }),
  }
  const link = {
    schemaVersion: 1 as const,
    linkId: `battle-contest-link:v1:fixture-${scenario.id}` as const,
    contestId,
    encounterId: `encounter:${scenario.id}`,
    linkedMapSlug: `map-${scenario.id}`,
    contestRosterSha256: digestText(battleContestRosterCanonicalJson(material)),
    createdAt: 10_000,
  }
  const teams = sides.map(side => ({
    contestantId: contestantId(scenario, side),
    sideId: side,
    trainer: {
      sheetSlug: trainerSlug(scenario, side), contestSheetRevision: 1, openingSheetRevision: 1,
      placementId: placementId(scenario, side, 'trainer'),
    },
    pokemon: Array.from({ length: scenario.rosterSize }, (_, index) => ({
      performerId: performerId(scenario, side, index),
      sheetSlug: pokemonSlug(scenario, side, index),
      contestSheetRevision: 1,
      openingSheetRevision: 1,
      reserveId: reserveId(scenario, side, index),
      openingPlacementId: index === 0 ? placementId(scenario, side, 'pokemon', index) : null,
    })),
  }))
  const openingInitiativeOrderIds = [
    placementId(scenario, 'north', 'pokemon'),
    placementId(scenario, 'north', 'trainer'),
    placementId(scenario, 'south', 'pokemon'),
    placementId(scenario, 'south', 'trainer'),
  ]
  return parseBattleContestEncounterBinding({
    schemaVersion: 1,
    link,
    sceneId: `scene:${scenario.id}`,
    openingRound: 1,
    openingInitiativeOrderIds,
    openingActivePlacementId: openingInitiativeOrderIds[0],
    teams,
  })
}

const createFixtureDocument = (scenario: FixtureScenario): ContestDocumentV1 => {
  const contestId = `contest:v1:${scenario.id}`
  const fixedRandom = { nextInteger: (_minimum: number, maximum: number) => maximum }
  let now = 1_000
  let operation = 0
  const op = (label: string) => `contest-op:v1:${scenario.id}-${String(++operation).padStart(3, '0')}-${label}`
  let document = createContestDocument({
    contestId,
    name: scenario.id,
    hallName: 'Deterministic Battle Fixture Arena',
    description: 'Source-bound deterministic Battle Contest fixture.',
    variantId: 'battle',
    contestTypeId: 'cool',
    significanceMultiplier: 1,
    awardRibbon: true,
    prize: { declared: true, money: 0, items: [], notes: '' },
    gmNotes: '',
    now: now++,
  })
  for (const side of sides) {
    const performers: ContestPokemonPerformerSnapshotV1[] = Array.from({ length: scenario.rosterSize }, (_, index) => Object.freeze({
      performerKind: 'pokemon' as const,
      performerId: performerId(scenario, side, index),
      pokemonSheetSlug: pokemonSlug(scenario, side, index),
      pokemonSheetRevision: 1,
      displayName: `${side === 'north' ? 'North' : 'South'} ${index + 1}`,
      species: 'Pikachu',
      level: 20,
      portraitUrl: null,
      moves: moveOptions,
      dicePools: emptyContestDicePools(),
      providerIds: Object.freeze([]),
    }))
    const enrollment = createContestantState({
      contestantId: contestantId(scenario, side),
      trainerSheetSlug: trainerSlug(scenario, side),
      trainerSheetRevision: 1,
      displayName: side === 'north' ? 'Mara' : 'Dax',
      controller: { kind: 'gm' },
      performers,
      rotationOrder: Object.freeze([]),
      introductionSkillDice: { charm: 6, command: 6, guile: 6, intimidate: 6, intuition: 6 },
    })
    document = executeContestEngineCommand(document, {
      schemaVersion: 1, contestId, operationId: op(`enroll-${side}`), commandKind: 'enroll-contestant', expectedRevision: document.revision,
      clientId: null, contestantId: enrollment.contestantId, trainerSheetSlug: enrollment.trainerSheetSlug,
      pokemonSheetSlugs: performers.map(row => row.pokemonSheetSlug), controller: enrollment.controller, rotationOrder: [],
    }, { now: now++, random: fixedRandom, enrollment })
  }
  document = executeContestEngineCommand(document, {
    schemaVersion: 1, contestId, operationId: op('start-introduction'), commandKind: 'start-introduction', expectedRevision: document.revision, clientId: null,
  }, { now: now++, random: fixedRandom })
  for (const side of sides) {
    document = executeContestEngineCommand(document, {
      schemaVersion: 1, contestId, operationId: op(`introduction-${side}`), commandKind: 'declare-introduction', expectedRevision: document.revision,
      clientId: null, contestantId: contestantId(scenario, side), skillId: side === 'north' ? 'command' : 'charm',
      generatedStatId: side === 'north' ? 'cool' : 'cute', bonusStatIds: {},
    }, {
      now: now++, random: fixedRandom,
      introduction: { skillDice: 6, bonusRolls: [], uglySixesCountAsOnes: false, graceFlexible: true },
    })
  }
  const binding = fixtureBinding(scenario, document)
  document = executeContestEngineCommand(document, {
    schemaVersion: 1, contestId, operationId: op('link'), commandKind: 'create-battle-encounter', expectedRevision: document.revision, clientId: null,
  }, { now: now++, random: fixedRandom, battleEncounter: binding })
  return document
}

const handoffDelivery = (
  document: ContestDocumentV1,
  scenario: FixtureScenario,
  sequence: number,
  factInput: Omit<BattleContestHandoffFactV1, 'schemaVersion' | 'handoffId' | 'linkId' | 'sourceResultId' | 'sourceResultSha256' | 'occurredAt'>,
) => {
  const binding = document.battle!.encounter!
  const sourceResultId = `fixture-result:${scenario.id}-${sequence}`
  const fact = {
    schemaVersion: 1,
    handoffId: `battle-contest-handoff:v1:${digestText(`${scenario.id}:${sequence}`).slice(0, 40)}`,
    linkId: binding.link.linkId,
    sourceResultId,
    sourceResultSha256: digest({ scenarioId: scenario.id, sequence, factInput }),
    occurredAt: 20_000 + sequence,
    ...factInput,
  } as BattleContestHandoffFactV1
  return parseBattleContestHandoffDelivery({
    schemaVersion: 1,
    operationId: `contest-op:v1:${scenario.id}-handoff-${String(sequence).padStart(3, '0')}`,
    readSet: {
      schemaVersion: 1,
      linkId: binding.link.linkId,
      contestId: document.contestId,
      contestRevision: document.revision,
      encounterId: binding.link.encounterId,
      encounterDocumentRevision: sequence,
      linkedMapSlug: binding.link.linkedMapSlug,
      encounterRevision: 100 + sequence,
      encounterSceneId: binding.sceneId,
    },
    fact,
    handoffSha256: digestText(battleContestHandoffCanonicalJson(fact)),
  })
}

const runScenario = (scenario: FixtureScenario) => {
  let document = createFixtureDocument(scenario)
  const random = createSeededContestRandomSource(scenario.seed)
  const active: Record<Side, number | null> = { north: 0, south: 0 }
  const knockedOut: Record<Side, Set<number>> = { north: new Set(), south: new Set() }
  const appeals: Record<string, unknown>[] = []
  const lifecycle: Record<string, unknown>[] = []
  let sequence = 0
  let sendOuts = 0
  let terminalCondition: EndStep['condition'] | null = null

  for (const step of scenario.steps) {
    sequence += 1
    if (step.kind === 'send-out') {
      if (knockedOut[step.side].has(step.pokemonIndex)) throw new Error(`${scenario.id} sends out a knocked-out Pokémon.`)
      active[step.side] = step.pokemonIndex
      sendOuts += 1
      continue
    }
    if (step.kind === 'appeal') {
      if (active[step.side] !== step.pokemonIndex) throw new Error(`${scenario.id} Appeal actor is not active.`)
      const opponent = opposite(step.side)
      const adjacentIndex = active[opponent]
      if (adjacentIndex === null) throw new Error(`${scenario.id} Appeal has no opposing active Pokémon.`)
      const sourceOperationId = `live-op:${scenario.id}-move-${sequence}`
      const actorPlacementId = placementId(scenario, step.side, 'pokemon', step.pokemonIndex)
      const delivery = handoffDelivery(document, scenario, sequence, {
        kind: 'accepted-move',
        payload: {
          completionEventId: `event:${scenario.id}-move-${sequence}`,
          sourceOperationId,
          resolutionId: `resolution:${scenario.id}-move-${sequence}`,
          sceneId: document.battle!.encounter!.sceneId,
          round: step.round,
          completionOrder: sequence,
          actorPlacementId,
          canonicalMoveId: step.move,
          specVersion: 1,
          actionType: 'standard',
          sourceActionKind: 'pokemon-move',
          origin: { kind: 'direct' },
          moveListSource: { kind: 'placement', placementId: actorPlacementId },
          attackedTargetIds: step.move === 'Tackle' ? [placementId(scenario, opponent, 'pokemon', adjacentIndex)] : [],
          hitTargetIds: step.move === 'Tackle' ? [placementId(scenario, opponent, 'pokemon', adjacentIndex)] : [],
          outcome: step.move === 'Tackle' ? 'hit' : 'no-target',
          succeeded: true,
          branches: [],
          replacementAttention: null,
        },
      })
      const spentDice = zeroSpend()
      if (step.spendStat) spentDice[step.spendStat] = 1
      const result = executeBattleContestAcceptedMoveAppeal({
        document,
        delivery,
        actorPokemonSheetSlug: pokemonSlug(scenario, step.side, step.pokemonIndex),
        adjacentPokemonSheetSlugs: [pokemonSlug(scenario, opponent, adjacentIndex)],
        spentDice,
        now: 30_000 + sequence,
        random,
      })
      document = result.document
      if (!result.appeal) throw new Error(`${scenario.id} expected one scored Appeal.`)
      appeals.push({
        side: step.side,
        pokemonIndex: step.pokemonIndex,
        move: step.move,
        round: step.round,
        spentDice,
        assembledDice: result.appeal.assembledDice,
        acceptedResults: result.appeal.acceptedResults,
        appealDelta: result.appeal.appealDelta,
        fumbleDelta: result.appeal.fumbleDelta,
        voltageBefore: result.appeal.voltageBefore,
        voltageAfter: result.appeal.voltageAfter,
      })
      continue
    }
    if (step.kind === 'switch') {
      if (active[step.side] !== step.recalledIndex) throw new Error(`${scenario.id} switch recall actor is not active.`)
      const sourceOperationId = `switch.${scenario.id}-${sequence}`
      const delivery = handoffDelivery(document, scenario, sequence, {
        kind: 'switch',
        payload: {
          eventId: `event:${scenario.id}-switch-${sequence}`,
          sourceOperationId,
          sceneId: document.battle!.encounter!.sceneId,
          round: step.round,
          switchKind: 'switch',
          recalledPlacementId: placementId(scenario, step.side, 'pokemon', step.recalledIndex),
          sentOutPlacementId: placementId(scenario, step.side, 'pokemon', step.sentOutIndex),
          causalResolutionId: step.exception ? `resolution:${scenario.id}-switch-${sequence}` : null,
          causalCanonicalId: step.exception,
          causalProviderId: null,
        },
      })
      const result = executeBattleContestVoltageLifecycle({
        document,
        delivery,
        targetPokemonSheetSlug: null,
        sourcePokemonSheetSlug: null,
        recalledPokemonSheetSlug: pokemonSlug(scenario, step.side, step.recalledIndex),
        sentOutPokemonSheetSlug: pokemonSlug(scenario, step.side, step.sentOutIndex),
        opposingActivePokemonSheetSlugs: [],
        now: 30_000 + sequence,
      })
      document = result.document
      active[step.side] = step.sentOutIndex
      lifecycle.push({ kind: 'switch', side: step.side, round: step.round, rule: result.lifecycle.rule, recallExceptionId: result.lifecycle.recallExceptionId, transitions: result.lifecycle.transitions })
      continue
    }
    if (step.kind === 'knockout') {
      if (step.sourceSide === step.targetSide || active[step.sourceSide] !== step.sourcePokemonIndex || active[step.targetSide] !== step.targetPokemonIndex) {
        throw new Error(`${scenario.id} knockout does not bind opposing active Pokémon.`)
      }
      knockedOut[step.targetSide].add(step.targetPokemonIndex)
      active[step.targetSide] = null
      if (step.terminal) continue
      const delivery = handoffDelivery(document, scenario, sequence, {
        kind: 'knockout',
        payload: {
          eventId: `event:${scenario.id}-knockout-${sequence}`,
          sourceOperationId: `live-op:${scenario.id}-knockout-${sequence}`,
          sceneId: document.battle!.encounter!.sceneId,
          round: step.round,
          targetPlacementId: placementId(scenario, step.targetSide, 'pokemon', step.targetPokemonIndex),
          sourcePlacementId: step.cause === 'attack' ? placementId(scenario, step.sourceSide, 'pokemon', step.sourcePokemonIndex) : null,
          causalResolutionId: step.cause === 'attack' ? `resolution:${scenario.id}-knockout-${sequence}` : null,
          causalCanonicalId: step.cause === 'attack' ? 'Tackle' : null,
          cause: step.cause,
        },
      })
      const result = executeBattleContestVoltageLifecycle({
        document,
        delivery,
        targetPokemonSheetSlug: pokemonSlug(scenario, step.targetSide, step.targetPokemonIndex),
        sourcePokemonSheetSlug: step.cause === 'attack' ? pokemonSlug(scenario, step.sourceSide, step.sourcePokemonIndex) : null,
        recalledPokemonSheetSlug: null,
        sentOutPokemonSheetSlug: null,
        opposingActivePokemonSheetSlugs: step.cause === 'damage-over-time'
          ? [pokemonSlug(scenario, step.sourceSide, step.sourcePokemonIndex)]
          : [],
        now: 30_000 + sequence,
      })
      document = result.document
      lifecycle.push({ kind: 'knockout', cause: step.cause, sourceSide: step.sourceSide, targetSide: step.targetSide, round: step.round, rule: result.lifecycle.rule, transitions: result.lifecycle.transitions })
      continue
    }
    terminalCondition = step.condition
    if (step.condition === 'round-budget-exhausted') {
      if (step.round !== scenario.rosterSize * 2) throw new Error(`${scenario.id} budget ending does not match immutable roster scale.`)
      const delivery = handoffDelivery(document, scenario, sequence, {
        kind: 'round-boundary',
        payload: {
          eventId: `event:${scenario.id}-round-end`,
          sourceOperationId: `initiative.${scenario.id}-round-end`,
          sceneId: document.battle!.encounter!.sceneId,
          completedRound: step.round,
          nextRound: step.round + 1,
        },
      })
      document = executeBattleContestEnd({ document, delivery, now: 30_000 + sequence, random }).document
    } else {
      const knockedOutSide = step.knockedOutSide
      if (!knockedOutSide || knockedOut[knockedOutSide].size !== scenario.rosterSize) throw new Error(`${scenario.id} all-KO ending lacks the complete immutable roster.`)
      const delivery = handoffDelivery(document, scenario, sequence, {
        kind: 'encounter-ended',
        payload: {
          eventId: `event:${scenario.id}-ended`,
          sourceOperationId: `live-op:${scenario.id}-final-knockout`,
          sceneId: document.battle!.encounter!.sceneId,
          round: step.round,
          reason: 'completed',
          allKnockedOutSideIds: [knockedOutSide],
        },
      })
      document = executeBattleContestEnd({ document, delivery, now: 30_000 + sequence, random }).document
    }
  }

  if (!terminalCondition || document.stage !== 'settling') throw new Error(`${scenario.id} did not reach one terminal Battle state.`)
  const teams = Object.fromEntries(sides.map(side => {
    const contestant = document.contestants.find(row => row.contestantId === contestantId(scenario, side))!
    return [side, {
      contestantId: contestant.contestantId,
      appeal: contestant.appeal,
      fumble: contestant.fumble,
      finalScore: contestant.finalScore,
      placement: contestant.finalPlacement,
      pokemonVoltage: contestant.performers.map((performer, index) => ({ pokemonIndex: index, value: contestant.performerVoltages[performer.performerId] })),
      teamDiceRemaining: Object.fromEntries((['beauty', 'cool', 'cute', 'smart', 'tough'] as const).map(statId => [statId, contestant.teamDicePools[statId].remaining])),
    }]
  }))
  const receiptsByOutcome = Object.fromEntries(['scored-appeal', 'canonical-exclusion', 'lifecycle-applied', 'contest-ended'].map(outcome => [outcome, document.battleHandoffReceipts.filter(receipt => receipt.outcome === outcome).length]))
  return Object.freeze({
    id: scenario.id,
    seed: scenario.seed,
    rosterSize: scenario.rosterSize,
    roundBudget: scenario.rosterSize * 2,
    script: scenario.steps,
    expected: {
      terminalCondition,
      terminalRound: document.round,
      scorePolicy: 'appeal-points',
      winnerContestantId: document.contestants.find(row => row.finalPlacement === 1)!.contestantId,
      teams,
      appeals,
      lifecycle,
      knockedOutPokemonIndices: Object.fromEntries(sides.map(side => [side, [...knockedOut[side]].sort((left, right) => left - right)])),
      sendOuts,
      receiptsByOutcome,
      documentRevision: document.revision,
      evidenceSha256: digest({
        appealLedger: document.appealLedger,
        battleVoltageLifecycleLedger: document.battleVoltageLifecycleLedger,
        battleHandoffReceipts: document.battleHandoffReceipts,
        terminalHistory: document.history.filter(row => row.type.startsWith('battle-')),
      }),
    },
  })
}

const sources = [
  { path: 'data/reference/contests.json', sha256: fileSha('data/reference/contests.json') },
  { path: 'data/reference/moves.json', sha256: fileSha('data/reference/moves.json') },
  { path: 'data/deferred-closure/battle-contest-liveplay-certification.v1.json', sha256: fileSha('data/deferred-closure/battle-contest-liveplay-certification.v1.json') },
]
const generated = {
  schemaVersion: 1,
  fixtureSetId: 'battle-contest-deterministic-scenarios-v1',
  ticket: 'P11-079',
  sources,
  policy: {
    rosterSizes: [3, 6],
    roundBudgetFormula: 'twice-pokemon-per-trainer',
    endConditions: ['round-budget-exhausted', 'one-trainer-all-pokemon-knocked-out'],
    scorePolicy: 'appeal-points',
    voltageRules: ['appeal', 'attack-knockout', 'damage-over-time-knockout', 'recall', 'recall-exception'],
    switchingRules: ['ordinary-recall-minus-two', 'Baton Pass', 'U-Turn'],
  },
  scenarios: scenarios.map(runScenario),
}
const serialized = `${JSON.stringify(generated, null, 2)}\n`
if (process.argv.includes('--write')) {
  writeFileSync(outputPath, serialized)
  console.log(`Wrote ${outputPath}`)
} else {
  const current = readFileSync(outputPath, 'utf8')
  if (current !== serialized) throw new Error('Battle Contest deterministic fixtures drifted; run generator with --write after reviewed changes.')
  console.log(`Battle Contest deterministic fixtures match (${generated.scenarios.length} scenarios at 3/6 Pokémon scale).`)
}
