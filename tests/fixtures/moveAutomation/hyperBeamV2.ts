import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '~~/server/domain/moveAutomation/registry'
import {
  expectedActedSinceEntryFlag,
  type MoveAutomationSemanticScenario,
} from './scenario'

export const HYPER_BEAM_V2_SCENARIOS = Object.freeze([
  { scenarioId: 'hyper-beam.v2-hit', evidenceClasses: ['hit'] as const },
  {
    scenarioId: 'hyper-beam.v2-smite-miss',
    evidenceClasses: ['alternate-branch', 'miss'] as const,
  },
  { scenarioId: 'hyper-beam.v2-critical-hit', evidenceClasses: ['crit'] as const },
  { scenarioId: 'hyper-beam.v2-normal-immunity', evidenceClasses: ['immunity'] as const },
  { scenarioId: 'hyper-beam.v2-duplicate-replay', evidenceClasses: ['retry'] as const },
  {
    scenarioId: 'hyper-beam.v2-stale-target',
    evidenceClasses: ['multi-resource-conflict'] as const,
  },
] as const)

export type HyperBeamV2SemanticScenarioId =
  | 'hyper-beam.v2-hit'
  | 'hyper-beam.v2-smite-miss'
  | 'hyper-beam.v2-critical-hit'
  | 'hyper-beam.v2-normal-immunity'

interface HyperBeamScenarioDefinition {
  readonly operationId: string
  readonly accuracyRandom: number
  readonly hit: boolean
  readonly targetTypes: readonly string[]
  readonly expectedCurrentHp: number
  readonly damageOutcome: 'applied' | 'prevented'
}

const DEFINITIONS: Readonly<Record<
  HyperBeamV2SemanticScenarioId,
  HyperBeamScenarioDefinition
>> = {
  'hyper-beam.v2-hit': {
    operationId: 'op_hyperbeamhit001',
    accuracyRandom: 0.5,
    hit: true,
    targetTypes: ['Normal'],
    expectedCurrentHp: 456,
    damageOutcome: 'applied',
  },
  'hyper-beam.v2-smite-miss': {
    operationId: 'op_hyperbeammiss01',
    accuracyRandom: 0,
    hit: false,
    targetTypes: ['Normal'],
    expectedCurrentHp: 478,
    damageOutcome: 'applied',
  },
  'hyper-beam.v2-critical-hit': {
    operationId: 'op_hyperbeamcrit01',
    accuracyRandom: 0.999,
    hit: true,
    targetTypes: ['Normal'],
    expectedCurrentHp: 452,
    damageOutcome: 'applied',
  },
  'hyper-beam.v2-normal-immunity': {
    operationId: 'op_hyperbeamimmune',
    accuracyRandom: 0.5,
    hit: true,
    targetTypes: ['Ghost'],
    expectedCurrentHp: 500,
    damageOutcome: 'prevented',
  },
}

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
  readonly types: readonly string[]
  readonly moves?: readonly { readonly name: string }[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  types: [...options.types],
  level: 20,
  revision: 3,
  capabilities: { overland: 6 },
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 500 },
    atk: { added: 10, stage: 0 },
    def: { added: 5, stage: 0 },
    satk: { added: options.slug === 'actor' ? 20 : 5, stage: 0 },
    sdef: { added: 5, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 500, conditions: [] },
})

export interface HyperBeamV2Fixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const hyperBeamV2Fixture = (
  scenarioId: HyperBeamV2SemanticScenarioId,
): HyperBeamV2Fixture => {
  const definition = DEFINITIONS[scenarioId]
  const encounterState = createEmptyEncounterState()
  return {
    map: {
      schemaVersion: 2,
      slug: 'hyper-beam-v2-arena',
      name: 'Hyper Beam v2 Arena',
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
      activeScene: { name: 'Hyper Beam Scene', startedAt: 100 },
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
        species: 'Alakazam',
        types: ['Psychic'],
        moves: [{ name: 'Hyper Beam' }],
      })],
      ['target', pokemonSheet({
        slug: 'target',
        species: 'Audino',
        types: definition.targetTypes,
      })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Hyper Beam',
      selection: {
        kind: 'single-target',
        targetPlacementId: 'target-token',
      },
    },
    randomValues: [definition.accuracyRandom, 0, 0, 0, 0],
  }
}

export const hyperBeamV2ScenarioDefinition = (
  scenarioId: HyperBeamV2SemanticScenarioId,
): HyperBeamScenarioDefinition => DEFINITIONS[scenarioId]

const expectedResourceState = (operationId: string) => ({
  actions: { standard: { spent: 1 } },
  oncePerTurnFlags: [{
    id: 'cost.exhaust.command',
    sourceOperationId: operationId,
    resetOn: ['round-start'],
  }, {
    id: 'cost.exhaust.next-turn',
    sourceOperationId: operationId,
    resetOn: ['turn-start'],
  }, expectedActedSinceEntryFlag(operationId)],
})

/** Build one reviewed Hyper Beam branch for interpreter, planner, and durable command authority. */
export const hyperBeamV2SemanticScenario = (
  scenarioId: HyperBeamV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = hyperBeamV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const hitTargetIds = definition.hit ? ['target-token'] : []
  const changedTarget = definition.damageOutcome === 'applied'
  const naturalResult = Math.floor(definition.accuracyRandom * 20) + 1
  const traceProgram = {
    canonicalId: 'Hyper Beam',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }
  const expectedMap = {
    revision: 8,
    updatedAt: 5_000,
    encounterState: {
      turnResources: {
        'actor-token': expectedResourceState(definition.operationId),
      },
    },
  }
  const hpUpdates = changedTarget
    ? [{ id: 'target-token', currentHp: definition.expectedCurrentHp }]
    : []

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
          missedTargetIds: definition.hit ? [] : ['target-token'],
          operations: [{
            operation: { id: 'hyper-beam.accuracy' },
            recipientIds: ['target-token'],
          }, {
            operation: { id: 'hyper-beam.damage' },
            recipientIds: ['target-token'],
          }, {
            operation: { id: 'hyper-beam.usage' },
            recipientIds: ['actor-token'],
          }, {
            operation: { id: 'hyper-beam.log-completed' },
            recipientIds: [],
          }],
          rollLedger: [{
            rollId: 'hyper-beam.accuracy-roll.1',
            naturalResult,
          }, {
            rollId: 'hyper-beam.damage.roll.1',
            naturalResults: [1, 1, 1, 1],
            finalValue: 24,
          }],
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
              hitTargetIds,
              hpUpdates,
            },
          },
          sheetWrites: [
            ...(changedTarget ? [{
              kind: 'pokemon',
              slug: 'target',
              expectedRevision: 3,
              revision: 4,
              changedFields: ['hp'],
            }] : []),
            {
              kind: 'pokemon',
              slug: 'actor',
              expectedRevision: 3,
              revision: 4,
              changedFields: ['moveUsage'],
            },
          ],
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
          map: expectedMap,
          move: {
            canonicalMoveName: 'Hyper Beam',
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates,
            },
          },
        },
      },
      committedDocuments: {
        map: expectedMap,
        sheets: {
          pokemon: {
            actor: {
              revision: 4,
              combat: { currentHp: 500, conditions: [] },
              moveUsage: {
                daily: {
                  'hyper-beam': {
                    moveName: 'Hyper Beam',
                    uses: 1,
                    updatedAt: 5_000,
                  },
                },
              },
            },
            target: {
              revision: changedTarget ? 4 : 3,
              combat: { currentHp: definition.expectedCurrentHp, conditions: [] },
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
            operationId: 'hyper-beam.damage',
            operationKind: 'damage',
            recipientIds: ['target-token'],
          }],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'hyper-beam.damage',
            operationKind: 'damage',
            recipientIds: ['target-token'],
            outcome: definition.damageOutcome,
          }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'hyper-beam.damage',
            operationKind: 'damage',
            recipientIds: ['target-token'],
            outcome: definition.damageOutcome,
          }],
        },
      },
    },
  }
}

export const allHyperBeamV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => ([
  'hyper-beam.v2-hit',
  'hyper-beam.v2-smite-miss',
  'hyper-beam.v2-critical-hit',
  'hyper-beam.v2-normal-immunity',
] as const).map(hyperBeamV2SemanticScenario)
