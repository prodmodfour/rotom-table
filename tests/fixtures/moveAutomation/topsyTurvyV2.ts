import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '~~/server/domain/moveAutomation/registry'
import type { MoveAutomationSemanticScenario } from './scenario'

export const TOPSY_TURVY_V2_SCENARIOS = Object.freeze([
  {
    scenarioId: 'topsy-turvy.v2-mixed-inversion',
    evidenceClasses: ['hit', 'threshold-pass'] as const,
  },
  {
    scenarioId: 'topsy-turvy.v2-zero-stage-no-op',
    evidenceClasses: ['threshold-fail'] as const,
  },
  {
    scenarioId: 'topsy-turvy.v2-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'topsy-turvy.v2-duplicate-replay',
    evidenceClasses: ['retry'] as const,
  },
  {
    scenarioId: 'topsy-turvy.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'] as const,
  },
] as const)

export type TopsyTurvyV2SemanticScenarioId =
  | 'topsy-turvy.v2-mixed-inversion'
  | 'topsy-turvy.v2-zero-stage-no-op'
  | 'topsy-turvy.v2-miss'

interface TopsyTurvyScenarioDefinition {
  readonly operationId: string
  readonly randomValue: number
  readonly initialStages: CombatStageMap
  readonly expectedStages: CombatStageMap
  readonly hit: boolean
  readonly stageOutcome: 'applied' | 'no-op'
}

const MIXED_STAGES: CombatStageMap = Object.freeze({
  atk: 3,
  def: -2,
  satk: 0,
  sdef: 6,
  spd: -6,
  acc: 1,
})

const INVERTED_MIXED_STAGES: CombatStageMap = Object.freeze({
  atk: -3,
  def: 2,
  satk: 0,
  sdef: -6,
  spd: 6,
  acc: -1,
})

const ZERO_STAGES: CombatStageMap = Object.freeze({
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
})

const DEFINITIONS: Readonly<Record<
  TopsyTurvyV2SemanticScenarioId,
  TopsyTurvyScenarioDefinition
>> = Object.freeze({
  'topsy-turvy.v2-mixed-inversion': {
    operationId: 'op_topsyturvymixed1',
    randomValue: 0.5,
    initialStages: MIXED_STAGES,
    expectedStages: INVERTED_MIXED_STAGES,
    hit: true,
    stageOutcome: 'applied',
  },
  'topsy-turvy.v2-zero-stage-no-op': {
    operationId: 'op_topsyturvyzero01',
    randomValue: 0.5,
    initialStages: ZERO_STAGES,
    expectedStages: ZERO_STAGES,
    hit: true,
    stageOutcome: 'no-op',
  },
  'topsy-turvy.v2-miss': {
    operationId: 'op_topsyturvymiss01',
    randomValue: 0,
    initialStages: MIXED_STAGES,
    expectedStages: MIXED_STAGES,
    hit: false,
    stageOutcome: 'no-op',
  },
})

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  sideId: id === 'actor-token' ? 'heroes' : 'foes',
  position: { x, y: 0, z: 1 },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly species: string
  readonly stages: CombatStageMap
  readonly moves?: readonly string[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  types: ['Normal'],
  level: 20,
  revision: 3,
  capabilities: { overland: 6 },
  movelist: (options.moves ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 50 },
    atk: { added: 5, stage: options.stages.atk },
    def: { added: 5, stage: options.stages.def },
    satk: { added: 5, stage: options.stages.satk },
    sdef: { added: 5, stage: options.stages.sdef },
    spd: { added: 5, stage: options.stages.spd },
  },
  combatStages: { acc: options.stages.acc },
  combat: { currentHp: 100, conditions: [] },
})

export interface TopsyTurvyV2Fixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const topsyTurvyV2Fixture = (
  scenarioId: TopsyTurvyV2SemanticScenarioId,
): TopsyTurvyV2Fixture => {
  const definition = DEFINITIONS[scenarioId]
  const encounterState = createEmptyEncounterState()
  return {
    map: {
      schemaVersion: 2,
      slug: 'topsy-turvy-v2-arena',
      name: 'Topsy-Turvy v2 Arena',
      revision: 7,
      dimensions: { x: 12, y: 3, z: 4 },
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
      initiative: { activeId: 'actor-token', round: 1 },
      activeScene: { name: 'Topsy-Turvy Scene', startedAt: 100 },
      encounterState: {
        ...encounterState,
        sides: {
          heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
          foes: { id: 'foes', label: 'Foes', status: 'active' },
        },
      },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', pokemonSheet({
        slug: 'actor',
        species: 'Malamar',
        stages: ZERO_STAGES,
        moves: ['Topsy-Turvy'],
      })],
      ['target', pokemonSheet({
        slug: 'target',
        species: 'Machamp',
        stages: definition.initialStages,
      })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Topsy-Turvy',
      selection: {
        kind: 'single-target',
        targetPlacementId: 'target-token',
      },
    },
    randomValues: [definition.randomValue],
  }
}

export const topsyTurvyV2ScenarioDefinition = (
  scenarioId: TopsyTurvyV2SemanticScenarioId,
): TopsyTurvyScenarioDefinition => DEFINITIONS[scenarioId]

/** Build one reviewed inversion branch for interpreter, planner, and durable command authority. */
export const topsyTurvyV2SemanticScenario = (
  scenarioId: TopsyTurvyV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = topsyTurvyV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const hitTargetIds = definition.hit ? ['target-token'] : []
  const missedTargetIds = definition.hit ? [] : ['target-token']
  const stageChanged = definition.stageOutcome === 'applied'
  const stageUpdates = stageChanged
    ? [{ id: 'target-token', stages: definition.expectedStages }]
    : []
  const naturalResult = Math.floor(definition.randomValue * 20) + 1
  const traceProgram = {
    canonicalId: 'Topsy-Turvy',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }

  return {
    scenarioId,
    operationId: definition.operationId,
    runtimeRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY,
    initialState: {
      map: fixture.map,
      encounterState: fixture.map.encounterState ?? createEmptyEncounterState(),
      pokemonSheets: fixture.pokemonSheets,
      trainerSheets: fixture.trainerSheets,
    },
    intent: fixture.intent,
    choices: [],
    interpreter: {
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
    },
    command: { candidateScopePlacementIds: ['target-token'] },
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
          operations: [{
            operation: { id: 'topsy-turvy.accuracy' },
            recipientIds: ['target-token'],
          }, {
            operation: { id: 'topsy-turvy.invert-stages' },
            recipientIds: hitTargetIds,
          }, {
            operation: { id: 'topsy-turvy.usage' },
            recipientIds: ['actor-token'],
          }, {
            operation: { id: 'topsy-turvy.log-completed' },
            recipientIds: [],
          }],
          rollLedger: [{
            rollId: 'topsy-turvy.accuracy-roll.1',
            naturalResult,
          }],
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: { revision: 8, updatedAt: 5_000 },
          resolution: {
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              combatStageUpdates: stageUpdates,
            },
          },
          sheetWrites: stageChanged
            ? [{
                kind: 'pokemon',
                slug: 'target',
                expectedRevision: 3,
                revision: 4,
                changedFields: ['combatStages'],
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
          map: { revision: 8, updatedAt: 5_000 },
          move: {
            canonicalMoveName: 'Topsy-Turvy',
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              combatStageUpdates: stageUpdates,
            },
          },
        },
      },
      committedDocuments: {
        map: { revision: 8, updatedAt: 5_000 },
        sheets: {
          pokemon: {
            target: {
              revision: stageChanged ? 4 : 3,
              stats: {
                atk: { stage: definition.expectedStages.atk },
                def: { stage: definition.expectedStages.def },
                satk: { stage: definition.expectedStages.satk },
                sdef: { stage: definition.expectedStages.sdef },
                spd: { stage: definition.expectedStages.spd },
              },
              combatStages: { acc: definition.expectedStages.acc },
            },
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
          events: [{
            kind: 'operation',
            operationId: 'topsy-turvy.invert-stages',
            operationKind: 'combat-stage',
            recipientIds: hitTargetIds,
          }],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'topsy-turvy.invert-stages',
            operationKind: 'combat-stage',
            recipientIds: hitTargetIds,
            outcome: definition.stageOutcome,
          }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'topsy-turvy.invert-stages',
            operationKind: 'combat-stage',
            recipientIds: hitTargetIds,
            outcome: definition.stageOutcome,
          }],
        },
      },
    },
  }
}

export const allTopsyTurvyV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => ([
  'topsy-turvy.v2-mixed-inversion',
  'topsy-turvy.v2-zero-stage-no-op',
  'topsy-turvy.v2-miss',
] as const).map(topsyTurvyV2SemanticScenario)
