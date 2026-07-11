import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '~~/server/domain/moveAutomation/registry'
import type { MoveAutomationSemanticScenario } from './scenario'

export const DOUBLE_KICK_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'double-kick.v2-critical-double-hit',
    evidenceClasses: ['crit', 'hit', 'retry'] as const,
  },
  {
    scenarioId: 'double-kick.v2-double-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'double-kick.v2-early-ko',
    evidenceClasses: [] as const,
  },
  {
    scenarioId: 'double-kick.v2-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'double-kick.v2-mixed-hit-miss',
    evidenceClasses: [] as const,
  },
] as const)

export const FURY_ATTACK_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'fury-attack.v2-early-ko',
    evidenceClasses: [] as const,
  },
  {
    scenarioId: 'fury-attack.v2-five-hit-critical',
    evidenceClasses: ['crit', 'hit', 'retry'] as const,
  },
  {
    scenarioId: 'fury-attack.v2-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'fury-attack.v2-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'fury-attack.v2-one-hit',
    evidenceClasses: [] as const,
  },
] as const)

export const STRIKE_CANARY_V2_SEMANTIC_SCENARIOS = Object.freeze([
  ...DOUBLE_KICK_V2_SEMANTIC_SCENARIOS,
  ...FURY_ATTACK_V2_SEMANTIC_SCENARIOS,
] as const)

export type StrikeCanaryV2SemanticScenarioId =
  (typeof STRIKE_CANARY_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

export type StrikeCanaryMoveName = 'Double Kick' | 'Fury Attack'

export interface StrikeCanaryScenarioDefinition {
  readonly operationId: string
  readonly moveName: StrikeCanaryMoveName
  readonly multiHitOperationId: string
  readonly targetTypes: readonly string[]
  readonly targetHp: number
  readonly randomValues: readonly number[]
  readonly expectedRollIds: readonly string[]
  readonly plannedHitCount: number | null
  readonly attemptedHitCount: number
  readonly successfulHitCount: number
  readonly missedHitCount: number
  readonly stopReason: 'completed' | 'accuracy-missed' | 'stop-on-miss' | 'knockout'
  readonly operationOutcome: 'applied' | 'prevented' | 'no-op'
  readonly criticalHitIndexes: readonly number[]
  readonly targetWritten: boolean
}

const DEFINITIONS: Readonly<Record<
  StrikeCanaryV2SemanticScenarioId,
  StrikeCanaryScenarioDefinition
>> = {
  'double-kick.v2-critical-double-hit': {
    operationId: 'op_doublekickcritical1',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [0.5, 0, 0.999, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
      'double-kick.accuracy-roll.t1.h2',
      'double-kick.multi-hit.t1.h2.roll',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 2,
    successfulHitCount: 2,
    missedHitCount: 0,
    stopReason: 'completed',
    operationOutcome: 'applied',
    criticalHitIndexes: [2],
    targetWritten: true,
  },
  'double-kick.v2-double-miss': {
    operationId: 'op_doublekickmiss001',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [0, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.accuracy-roll.t1.h2',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 2,
    successfulHitCount: 0,
    missedHitCount: 2,
    stopReason: 'completed',
    operationOutcome: 'no-op',
    criticalHitIndexes: [],
    targetWritten: false,
  },
  'double-kick.v2-early-ko': {
    operationId: 'op_doublekickearlyko1',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 1,
    randomValues: [0.5, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 1,
    successfulHitCount: 1,
    missedHitCount: 0,
    stopReason: 'knockout',
    operationOutcome: 'applied',
    criticalHitIndexes: [],
    targetWritten: true,
  },
  'double-kick.v2-immunity': {
    operationId: 'op_doublekickimmune1',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Ghost'],
    targetHp: 500,
    randomValues: [0.5, 0, 0.5, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
      'double-kick.accuracy-roll.t1.h2',
      'double-kick.multi-hit.t1.h2.roll',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 2,
    successfulHitCount: 2,
    missedHitCount: 0,
    stopReason: 'completed',
    operationOutcome: 'prevented',
    criticalHitIndexes: [],
    targetWritten: false,
  },
  'double-kick.v2-mixed-hit-miss': {
    operationId: 'op_doublekickmixed01',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [0.5, 0, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
      'double-kick.accuracy-roll.t1.h2',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 2,
    successfulHitCount: 1,
    missedHitCount: 1,
    stopReason: 'completed',
    operationOutcome: 'applied',
    criticalHitIndexes: [],
    targetWritten: true,
  },
  'fury-attack.v2-early-ko': {
    operationId: 'op_furyattackearlyko1',
    moveName: 'Fury Attack',
    multiHitOperationId: 'fury-attack.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 1,
    randomValues: [0.5, 0.999, 0, 0],
    expectedRollIds: [
      'fury-attack.accuracy-roll.t1',
      'fury-attack.hit-count-roll',
      'fury-attack.critical-roll.t1.h1',
      'fury-attack.multi-hit.t1.h1.roll',
    ],
    plannedHitCount: 5,
    attemptedHitCount: 1,
    successfulHitCount: 1,
    missedHitCount: 0,
    stopReason: 'knockout',
    operationOutcome: 'applied',
    criticalHitIndexes: [],
    targetWritten: true,
  },
  'fury-attack.v2-five-hit-critical': {
    operationId: 'op_furyattackfivehit1',
    moveName: 'Fury Attack',
    multiHitOperationId: 'fury-attack.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [
      0.5,
      0.999,
      0, 0,
      0, 0,
      0.999, 0,
      0, 0,
      0, 0,
    ],
    expectedRollIds: [
      'fury-attack.accuracy-roll.t1',
      'fury-attack.hit-count-roll',
      'fury-attack.critical-roll.t1.h1',
      'fury-attack.multi-hit.t1.h1.roll',
      'fury-attack.critical-roll.t1.h2',
      'fury-attack.multi-hit.t1.h2.roll',
      'fury-attack.critical-roll.t1.h3',
      'fury-attack.multi-hit.t1.h3.roll',
      'fury-attack.critical-roll.t1.h4',
      'fury-attack.multi-hit.t1.h4.roll',
      'fury-attack.critical-roll.t1.h5',
      'fury-attack.multi-hit.t1.h5.roll',
    ],
    plannedHitCount: 5,
    attemptedHitCount: 5,
    successfulHitCount: 5,
    missedHitCount: 0,
    stopReason: 'completed',
    operationOutcome: 'applied',
    criticalHitIndexes: [3],
    targetWritten: true,
  },
  'fury-attack.v2-immunity': {
    operationId: 'op_furyattackimmune1',
    moveName: 'Fury Attack',
    multiHitOperationId: 'fury-attack.multi-hit',
    targetTypes: ['Ghost'],
    targetHp: 500,
    randomValues: [0.5, 0, 0, 0],
    expectedRollIds: [
      'fury-attack.accuracy-roll.t1',
      'fury-attack.hit-count-roll',
      'fury-attack.critical-roll.t1.h1',
      'fury-attack.multi-hit.t1.h1.roll',
    ],
    plannedHitCount: 1,
    attemptedHitCount: 1,
    successfulHitCount: 1,
    missedHitCount: 0,
    stopReason: 'completed',
    operationOutcome: 'prevented',
    criticalHitIndexes: [],
    targetWritten: false,
  },
  'fury-attack.v2-miss': {
    operationId: 'op_furyattackmiss001',
    moveName: 'Fury Attack',
    multiHitOperationId: 'fury-attack.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [0],
    expectedRollIds: ['fury-attack.accuracy-roll.t1'],
    plannedHitCount: null,
    attemptedHitCount: 0,
    successfulHitCount: 0,
    missedHitCount: 0,
    stopReason: 'accuracy-missed',
    operationOutcome: 'no-op',
    criticalHitIndexes: [],
    targetWritten: false,
  },
  'fury-attack.v2-one-hit': {
    operationId: 'op_furyattackonehit1',
    moveName: 'Fury Attack',
    multiHitOperationId: 'fury-attack.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [0.5, 0, 0, 0],
    expectedRollIds: [
      'fury-attack.accuracy-roll.t1',
      'fury-attack.hit-count-roll',
      'fury-attack.critical-roll.t1.h1',
      'fury-attack.multi-hit.t1.h1.roll',
    ],
    plannedHitCount: 1,
    attemptedHitCount: 1,
    successfulHitCount: 1,
    missedHitCount: 0,
    stopReason: 'completed',
    operationOutcome: 'applied',
    criticalHitIndexes: [],
    targetWritten: true,
  },
}

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
})

const actorSheet = (moveName: StrikeCanaryMoveName): CharacterSheet => ({
  slug: 'actor',
  nickname: moveName === 'Double Kick' ? 'Kicker' : 'Striker',
  species: moveName === 'Double Kick' ? 'Hitmonlee' : 'Tauros',
  types: [moveName === 'Double Kick' ? 'Fighting' : 'Normal'],
  level: 20,
  revision: 3,
  movelist: [{ name: moveName }],
  stats: {
    hp: { added: 100 },
    atk: { added: 10, stage: 0 },
  },
  combat: { currentHp: 100, conditions: [] },
})

const targetSheet = (definition: StrikeCanaryScenarioDefinition): CharacterSheet => ({
  slug: 'target',
  nickname: 'Target',
  species: 'Snorlax',
  types: [...definition.targetTypes],
  level: 20,
  revision: 3,
  movelist: [],
  stats: {
    hp: { added: 500 },
    def: { added: 10, stage: 0 },
  },
  combat: { currentHp: definition.targetHp, conditions: [] },
})

export interface StrikeCanaryV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const strikeCanaryV2Fixture = (
  scenarioId: StrikeCanaryV2SemanticScenarioId,
): StrikeCanaryV2ScenarioFixture => {
  const definition = DEFINITIONS[scenarioId]
  return {
    map: {
      schemaVersion: 2,
      slug: `${definition.moveName === 'Double Kick' ? 'double-kick' : 'fury-attack'}-v2-arena`,
      name: `${definition.moveName} v2 Arena`,
      revision: 7,
      dimensions: { x: 6, y: 3, z: 4 },
      groundLevelY: 0,
      playerVisible: true,
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      placements: [
        placement('actor-token', 'actor', 1),
        placement('target-token', 'target', 2),
      ],
      lights: [],
      initiative: { activeId: 'actor-token', round: 3 },
      activeScene: { name: 'Strike Canary Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', actorSheet(definition.moveName)],
      ['target', targetSheet(definition)],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: definition.moveName,
      selection: {
        kind: 'single-target',
        targetPlacementId: 'target-token',
      },
    },
    randomValues: definition.randomValues,
  }
}

const expectedMap = (
  definition: StrikeCanaryScenarioDefinition,
): Readonly<Record<string, unknown>> => ({
  revision: 8,
  updatedAt: 5_000,
  encounterState: {
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: [{
          id: `move.${definition.moveName === 'Double Kick' ? 'double-kick' : 'fury-attack'}`,
          sourceOperationId: definition.operationId,
        }],
      },
    },
  },
})

/** Build one fixed- or rolled-strike branch for all immediate authority layers. */
export const strikeCanaryV2SemanticScenario = (
  scenarioId: StrikeCanaryV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = strikeCanaryV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const hitTargetIds = definition.successfulHitCount > 0 ? ['target-token'] : []
  const missedTargetIds = definition.successfulHitCount > 0 ? [] : ['target-token']
  const traceProgram = {
    canonicalId: definition.moveName,
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }
  const multiHitEvent = {
    kind: 'operation',
    phase: 'damage',
    operationId: definition.multiHitOperationId,
    operationKind: 'multi-hit',
  }

  return {
    scenarioId,
    operationId: definition.operationId,
    runtimeRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY,
    initialState: {
      map: fixture.map,
      encounterState: createEmptyEncounterState(),
      pokemonSheets: fixture.pokemonSheets,
      trainerSheets: fixture.trainerSheets,
    },
    intent: fixture.intent,
    choices: [],
    interpreter: {
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
    },
    command: {
      candidateScopePlacementIds: ['target-token'],
    },
    seed: {
      randomValues: fixture.randomValues,
      now: 5_000,
      idPrefix: scenarioId,
    },
    expected: {
      interpreter: {
        result: {
          kind: 'complete',
          targetIds: ['target-token'],
          hitTargetIds,
          missedTargetIds,
          damagedTargetIds: definition.targetWritten ? ['target-token'] : [],
          faintedTargetIds: definition.stopReason === 'knockout' ? ['target-token'] : [],
          operations: [
            {
              operation: { id: definition.multiHitOperationId },
              recipientIds: ['target-token'],
            },
            {
              operation: {
                id: definition.moveName === 'Double Kick'
                  ? 'double-kick.usage'
                  : 'fury-attack.usage',
              },
              recipientIds: ['actor-token'],
            },
            {
              operation: {
                id: definition.moveName === 'Double Kick'
                  ? 'double-kick.log-completed'
                  : 'fury-attack.log-completed',
              },
              recipientIds: [],
            },
          ],
          rollLedger: definition.expectedRollIds.map(rollId => ({ rollId })),
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: expectedMap(definition),
          resolution: {
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates: definition.targetWritten ? [{ id: 'target-token' }] : [],
            },
            rollLedger: definition.expectedRollIds.map(rollId => ({ rollId })),
          },
          sheetWrites: definition.targetWritten
            ? [{
                kind: 'pokemon',
                slug: 'target',
                expectedRevision: 3,
                revision: 4,
                changedFields: ['hp'],
              }]
            : [],
        },
      },
      command: {
        result: {
          result: {
            ok: true,
            opId: definition.operationId,
            previousRevision: 7,
            revision: 8,
          },
          map: expectedMap(definition),
          move: {
            canonicalMoveName: definition.moveName,
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates: definition.targetWritten ? [{ id: 'target-token' }] : [],
            },
            rollLedger: definition.expectedRollIds.map(rollId => ({ rollId })),
          },
        },
      },
      committedDocuments: {
        map: expectedMap(definition),
        sheets: {
          pokemon: {
            actor: { revision: 3 },
            target: { revision: definition.targetWritten ? 4 : 3 },
          },
          trainer: {},
        },
        operationResult: {
          ok: true,
          opId: definition.operationId,
          previousRevision: 7,
          revision: 8,
        },
      },
      trace: {
        interpreter: {
          trace: { program: traceProgram },
          events: [{ ...multiHitEvent, outcome: definition.operationOutcome }],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{ ...multiHitEvent, outcome: definition.operationOutcome }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{ ...multiHitEvent, outcome: definition.operationOutcome }],
        },
      },
    },
  }
}

export const allStrikeCanaryV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => STRIKE_CANARY_V2_SEMANTIC_SCENARIOS
  .map(({ scenarioId }) => strikeCanaryV2SemanticScenario(scenarioId))

export const strikeCanaryV2ScenarioDefinition = (
  scenarioId: StrikeCanaryV2SemanticScenarioId,
): StrikeCanaryScenarioDefinition => DEFINITIONS[scenarioId]
