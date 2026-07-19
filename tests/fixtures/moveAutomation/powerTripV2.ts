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
import {
  expectedActedSinceEntryFlag,
  type MoveAutomationSemanticScenario,
} from './scenario'

export const POWER_TRIP_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'power-trip.v2-capped-stages',
    evidenceClasses: ['alternate-branch'] as const,
  },
  {
    scenarioId: 'power-trip.v2-mixed-stages',
    evidenceClasses: ['alternate-branch'] as const,
  },
  {
    scenarioId: 'power-trip.v2-zero-stages',
    evidenceClasses: ['hit'] as const,
  },
] as const)

export type PowerTripV2SemanticScenarioId =
  (typeof POWER_TRIP_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

interface PowerTripScenarioDefinition {
  readonly operationId: string
  readonly actorTypes: readonly string[]
  readonly stages: CombatStageMap
  readonly positiveStageTotal: number
  readonly expressionValue: number
  readonly boundedDamageBase: number
  readonly stabBonus: number
  readonly finalDamageBase: number
  readonly damageFormula: {
    readonly count: number
    readonly sides: number
    readonly modifier: number
  }
  readonly randomValues: readonly number[]
  readonly expectedDamage: number
  readonly expectedTargetHp: number
}

const stages = (values: Partial<CombatStageMap> = {}): CombatStageMap => ({
  atk: values.atk ?? 0,
  def: values.def ?? 0,
  satk: values.satk ?? 0,
  sdef: values.sdef ?? 0,
  spd: values.spd ?? 0,
  acc: values.acc ?? 0,
})

const DEFINITIONS: Readonly<Record<
  PowerTripV2SemanticScenarioId,
  PowerTripScenarioDefinition
>> = {
  'power-trip.v2-capped-stages': {
    operationId: 'op_powertripcapped1',
    actorTypes: ['Dark'],
    stages: stages({ def: 6, satk: 4 }),
    positiveStageTotal: 10,
    expressionValue: 22,
    boundedDamageBase: 20,
    stabBonus: 2,
    finalDamageBase: 22,
    damageFormula: { count: 6, sides: 12, modifier: 45 },
    randomValues: [0.5, 0, 0, 0, 0, 0, 0],
    expectedDamage: 61,
    expectedTargetHp: 939,
  },
  'power-trip.v2-mixed-stages': {
    operationId: 'op_powertripmixed01',
    actorTypes: ['Dark'],
    stages: stages({ def: 2, satk: -3, sdef: 1, spd: -2 }),
    positiveStageTotal: 3,
    expressionValue: 8,
    boundedDamageBase: 8,
    stabBonus: 2,
    finalDamageBase: 10,
    damageFormula: { count: 3, sides: 8, modifier: 10 },
    randomValues: [0.5, 0, 0, 0],
    expectedDamage: 23,
    expectedTargetHp: 977,
  },
  'power-trip.v2-zero-stages': {
    operationId: 'op_powertripzero001',
    actorTypes: ['Normal'],
    stages: stages(),
    positiveStageTotal: 0,
    expressionValue: 2,
    boundedDamageBase: 2,
    stabBonus: 0,
    finalDamageBase: 2,
    damageFormula: { count: 1, sides: 6, modifier: 3 },
    randomValues: [0.5, 0],
    expectedDamage: 14,
    expectedTargetHp: 986,
  },
}

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
})

const actorSheet = (definition: PowerTripScenarioDefinition): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Schemer',
  species: 'Zorua',
  types: [...definition.actorTypes],
  level: 20,
  revision: 3,
  movelist: [{ name: 'Power Trip' }],
  stats: {
    hp: { added: 20 },
    atk: { added: 10, stage: definition.stages.atk },
    def: { stage: definition.stages.def },
    satk: { stage: definition.stages.satk },
    sdef: { stage: definition.stages.sdef },
    spd: { stage: definition.stages.spd },
  },
  combatStages: { acc: definition.stages.acc },
  combat: { currentHp: 100, conditions: [] },
})

const targetSheet = (): CharacterSheet => ({
  slug: 'target',
  nickname: 'Wall',
  species: 'Snorlax',
  types: ['Normal'],
  level: 20,
  revision: 3,
  movelist: [],
  stats: { hp: { added: 500 } },
  combat: { currentHp: 1_000, conditions: [] },
})

export interface PowerTripV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const powerTripV2Fixture = (
  scenarioId: PowerTripV2SemanticScenarioId,
): PowerTripV2ScenarioFixture => {
  const definition = DEFINITIONS[scenarioId]
  return {
    map: {
      schemaVersion: 2,
      slug: 'power-trip-v2-arena',
      name: 'Power Trip v2 Arena',
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
      initiative: { activeId: 'actor-token', round: 4 },
      activeScene: { name: 'Power Trip Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', actorSheet(definition)],
      ['target', targetSheet()],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Power Trip',
      selection: {
        kind: 'single-target',
        targetPlacementId: 'target-token',
      },
    },
    randomValues: definition.randomValues,
  }
}

const expectedMap = (operationId: string) => ({
  revision: 8,
  updatedAt: 5_000,
  moveUsage: {
    byPlacementId: {
      'actor-token': {
        'power-trip': {
          moveName: 'Power Trip',
          frequency: 'eot',
          uses: 1,
          lastUsedRound: 4,
          updatedAt: 5_000,
        },
      },
    },
  },
  encounterState: {
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: [
          expectedActedSinceEntryFlag(operationId),
          {
            id: 'move.power-trip',
            sourceOperationId: operationId,
          },
        ],
      },
    },
  },
})

/** Build one reviewed stage-total branch for every immediate authority layer. */
export const powerTripV2SemanticScenario = (
  scenarioId: PowerTripV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = powerTripV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const expectedTargetSheet = {
    revision: 4,
    combat: { currentHp: definition.expectedTargetHp, conditions: [] },
  }
  const traceProgram = {
    canonicalId: 'Power Trip',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
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
          hitTargetIds: ['target-token'],
          missedTargetIds: [],
          operations: [
            { operation: { id: 'power-trip.accuracy' }, recipientIds: ['target-token'] },
            { operation: { id: 'power-trip.damage' }, recipientIds: ['target-token'] },
            { operation: { id: 'power-trip.usage' }, recipientIds: ['actor-token'] },
            { operation: { id: 'power-trip.log-completed' }, recipientIds: [] },
          ],
          resolvedDamageBases: [{
            recipientId: 'target-token',
            expressionValue: definition.expressionValue,
            boundedValue: definition.boundedDamageBase,
            stabBonus: definition.stabBonus,
            finalDamageBase: definition.finalDamageBase,
          }],
          rollLedger: [
            { rollId: 'power-trip.accuracy-roll.1', naturalResult: 11 },
            {
              rollId: 'power-trip.damage.roll.1',
              formula: { kind: 'dice', ...definition.damageFormula },
            },
          ],
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: expectedMap(definition.operationId),
          resolution: {
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds: ['target-token'],
              hpUpdates: [{
                id: 'target-token',
                currentHp: definition.expectedTargetHp,
              }],
            },
          },
          sheetWrites: [{
            kind: 'pokemon',
            slug: 'target',
            expectedRevision: 3,
            revision: 4,
            changedFields: ['hp'],
            nextSheet: expectedTargetSheet,
          }],
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
          map: expectedMap(definition.operationId),
          move: {
            canonicalMoveName: 'Power Trip',
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds: ['target-token'],
              hpUpdates: [{
                id: 'target-token',
                currentHp: definition.expectedTargetHp,
              }],
            },
          },
        },
      },
      committedDocuments: {
        map: expectedMap(definition.operationId),
        sheets: {
          pokemon: {
            actor: { revision: 3 },
            target: expectedTargetSheet,
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
            operationId: 'power-trip.damage',
            operationKind: 'damage',
            outcome: 'applied',
          }],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'power-trip.damage',
            operationKind: 'damage',
            outcome: 'applied',
          }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'power-trip.damage',
            operationKind: 'damage',
            outcome: 'applied',
          }],
        },
      },
    },
  }
}

export const allPowerTripV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => POWER_TRIP_V2_SEMANTIC_SCENARIOS
  .map(({ scenarioId }) => powerTripV2SemanticScenario(scenarioId))

export const powerTripV2ScenarioDefinition = (
  scenarioId: PowerTripV2SemanticScenarioId,
): PowerTripScenarioDefinition => DEFINITIONS[scenarioId]
