import { expect } from 'vitest'
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

export const YAWN_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'yawn.v2-delayed-sleep',
    evidenceClasses: ['lifecycle-trigger'] as const,
  },
  {
    scenarioId: 'yawn.v2-sleep-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'yawn.v2-switch-cleanup',
    evidenceClasses: ['lifecycle-cleanup'] as const,
  },
  {
    scenarioId: 'yawn.v2-knockout-cleanup',
    evidenceClasses: ['lifecycle-cleanup'] as const,
  },
  {
    scenarioId: 'yawn.v2-scene-cleanup',
    evidenceClasses: ['lifecycle-cleanup'] as const,
  },
  {
    scenarioId: 'yawn.v2-refresh-retry',
    evidenceClasses: ['retry'] as const,
  },
] as const)

export type YawnV2SemanticScenarioId =
  (typeof YAWN_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

const operationIds: Readonly<Record<YawnV2SemanticScenarioId, string>> = {
  'yawn.v2-delayed-sleep': 'op_yawn_delayed_sleep',
  'yawn.v2-sleep-immunity': 'op_yawn_sleep_immunity',
  'yawn.v2-switch-cleanup': 'op_yawn_switch_cleanup',
  'yawn.v2-knockout-cleanup': 'op_yawn_knockout_cleanup',
  'yawn.v2-scene-cleanup': 'op_yawn_scene_cleanup',
  'yawn.v2-refresh-retry': 'op_yawn_refresh_retry',
}

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly species: string
  readonly moves?: CharacterSheet['movelist']
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  level: 20,
  revision: 3,
  movelist: [...(options.moves ?? [])],
  types: ['Normal'],
  stats: {
    atk: { stage: 0 },
    def: { stage: 0 },
    satk: { stage: 0 },
    sdef: { stage: 0 },
    spd: { stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 50, conditions: [] },
})

export interface YawnV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const yawnV2Fixture = (): YawnV2ScenarioFixture => ({
  map: {
    schemaVersion: 2,
    slug: 'yawn-v2-arena',
    name: 'Yawn v2 Arena',
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
    initiative: { activeId: 'actor-token', round: 1 },
    activeScene: { name: 'Yawn Scene', startedAt: 100 },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  },
  pokemonSheets: new Map([
    ['actor', pokemonSheet({
      slug: 'actor',
      species: 'Slowpoke',
      moves: [{ name: 'Yawn' }],
    })],
    ['target', pokemonSheet({ slug: 'target', species: 'Snorlax' })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Yawn',
    selection: {
      kind: 'single-target',
      targetPlacementId: 'target-token',
    },
  },
  randomValues: [],
})

const expectedDrowsyEffect = {
  id: expect.stringMatching(/^condition\.[a-f0-9]{32}$/),
  kind: 'condition',
  source: {
    operationId: 'yawn.drowsy',
    moveId: 'move.yawn',
    placementId: 'actor-token',
  },
  affected: {
    placementIds: ['target-token'],
    sideIds: [],
    cells: [],
  },
  duration: {
    kind: 'turns',
    subject: 'target',
    boundary: 'end',
    remaining: 1,
  },
  stackPolicy: { kind: 'refresh', maxStacks: null },
  payload: { conditionId: 'yawn', action: 'apply', saveTiming: null },
  transferPolicy: 'retain',
}

/** Build one reviewed Yawn evidence fixture for every immediate authority layer. */
export const yawnV2SemanticScenario = (
  scenarioId: YawnV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = yawnV2Fixture()
  const operationId = operationIds[scenarioId]
  const expectedMap = {
    revision: 8,
    updatedAt: 5_000,
    encounterState: {
      effects: [expectedDrowsyEffect],
    },
  }
  const traceProgram = {
    canonicalId: 'Yawn',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }
  const conditionTrace = {
    kind: 'operation',
    operationId: 'yawn.drowsy',
    operationKind: 'condition',
  }

  return {
    scenarioId,
    operationId,
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
      randomValues: [],
      now: 5_000,
      idPrefix: scenarioId,
    },
    expected: {
      interpreter: {
        result: {
          kind: 'complete',
          targetIds: ['target-token'],
          hitTargetIds: ['target-token'],
          missedTargetIds: [],
          operations: [
            {
              operation: { id: 'yawn.drowsy' },
              recipientIds: ['target-token'],
            },
            {
              operation: { id: 'yawn.usage' },
              recipientIds: ['actor-token'],
            },
            {
              operation: { id: 'yawn.log-completed' },
              recipientIds: [],
            },
          ],
          rollLedger: [],
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: expectedMap,
          resolution: {
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds: ['target-token'],
              conditionUpdates: [],
            },
            rollLedger: [],
          },
          sheetWrites: [],
        },
      },
      command: {
        result: {
          result: {
            ok: true,
            opId: operationId,
            previousRevision: 7,
            revision: 8,
          },
          map: expectedMap,
          move: {
            canonicalMoveName: 'Yawn',
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds: ['target-token'],
              conditionUpdates: [],
            },
          },
        },
      },
      committedDocuments: {
        map: expectedMap,
        sheets: {
          pokemon: {
            actor: { revision: 3, combat: { currentHp: 50, conditions: [] } },
            target: { revision: 3, combat: { currentHp: 50, conditions: [] } },
          },
          trainer: {},
        },
        operationResult: {
          ok: true,
          opId: operationId,
          previousRevision: 7,
          revision: 8,
        },
      },
      trace: {
        interpreter: {
          trace: { program: traceProgram },
          events: [conditionTrace],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{ ...conditionTrace, outcome: 'applied' }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{ ...conditionTrace, outcome: 'applied' }],
        },
      },
    },
  }
}

export const allYawnV2SemanticScenarios = (): readonly MoveAutomationSemanticScenario[] =>
  YAWN_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => yawnV2SemanticScenario(scenarioId))
