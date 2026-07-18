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

export const EMBER_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'ember.v2-burn-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'ember.v2-critical-hit',
    evidenceClasses: ['crit'] as const,
  },
  {
    scenarioId: 'ember.v2-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'ember.v2-threshold-fail',
    evidenceClasses: ['threshold-fail'] as const,
  },
  {
    scenarioId: 'ember.v2-threshold-pass',
    evidenceClasses: ['hit', 'retry', 'threshold-pass'] as const,
  },
] as const)

export type EmberV2SemanticScenarioId =
  (typeof EMBER_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

interface EmberScenarioDefinition {
  readonly operationId: string
  readonly accuracyRandom: number
  readonly damageRandom?: number
  readonly hit: boolean
  readonly burned: boolean
  readonly conditionOutcome: 'applied' | 'no-op' | 'prevented'
  readonly expectedCurrentHp: number
  readonly targetTypes: readonly string[]
}

const DEFINITIONS: Readonly<Record<EmberV2SemanticScenarioId, EmberScenarioDefinition>> = {
  'ember.v2-burn-immunity': {
    operationId: 'op_emberimmunity1',
    accuracyRandom: 0.85,
    damageRandom: 0,
    hit: true,
    burned: false,
    conditionOutcome: 'prevented',
    expectedCurrentHp: 77,
    targetTypes: ['Fire'],
  },
  'ember.v2-critical-hit': {
    operationId: 'op_embercritical1',
    accuracyRandom: 0.999,
    damageRandom: 0,
    hit: true,
    burned: true,
    conditionOutcome: 'applied',
    expectedCurrentHp: 76,
    targetTypes: ['Normal'],
  },
  'ember.v2-miss': {
    operationId: 'op_embermiss0001',
    accuracyRandom: 0,
    hit: false,
    burned: false,
    conditionOutcome: 'no-op',
    expectedCurrentHp: 100,
    targetTypes: ['Normal'],
  },
  'ember.v2-threshold-fail': {
    operationId: 'op_emberthresholdfail1',
    accuracyRandom: 0.8,
    damageRandom: 0,
    hit: true,
    burned: false,
    conditionOutcome: 'no-op',
    expectedCurrentHp: 77,
    targetTypes: ['Normal'],
  },
  'ember.v2-threshold-pass': {
    operationId: 'op_emberthresholdpass1',
    accuracyRandom: 0.85,
    damageRandom: 0,
    hit: true,
    burned: true,
    conditionOutcome: 'applied',
    expectedCurrentHp: 77,
    targetTypes: ['Normal'],
  },
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
  readonly types: readonly string[]
  readonly currentHp: number
  readonly moves?: readonly { readonly name: string }[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  types: [...options.types],
  level: 20,
  revision: 3,
  movelist: [...(options.moves ?? [])],
  combat: { currentHp: options.currentHp, conditions: [] },
})

export interface EmberV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const emberV2Fixture = (
  scenarioId: EmberV2SemanticScenarioId,
): EmberV2ScenarioFixture => {
  const definition = DEFINITIONS[scenarioId]
  return {
    map: {
      schemaVersion: 2,
      slug: 'ember-v2-arena',
      name: 'Ember v2 Arena',
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
      activeScene: { name: 'Ember Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', pokemonSheet({
        slug: 'actor',
        species: 'Pikachu',
        types: ['Electric'],
        currentHp: 50,
        moves: [{ name: 'Ember' }],
      })],
      ['target', pokemonSheet({
        slug: 'target',
        species: 'Snorlax',
        types: definition.targetTypes,
        currentHp: 100,
      })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Ember',
      selection: {
        kind: 'single-target',
        targetPlacementId: 'target-token',
      },
    },
    randomValues: [
      definition.accuracyRandom,
      ...(definition.damageRandom === undefined ? [] : [definition.damageRandom]),
    ],
  }
}

const expectedMap = (operationId: string) => ({
  revision: 8,
  updatedAt: 5_000,
  encounterState: {
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: [
          expectedActedSinceEntryFlag(operationId),
          {
            id: 'move.ember',
            sourceOperationId: operationId,
          },
        ],
      },
    },
  },
})

/** Build one reviewed Ember branch fixture for all immediate authority layers. */
export const emberV2SemanticScenario = (
  scenarioId: EmberV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = emberV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const hitTargetIds = definition.hit ? ['target-token'] : []
  const missedTargetIds = definition.hit ? [] : ['target-token']
  const conditions = definition.burned ? ['Burned'] : []
  const targetRevision = definition.hit ? 4 : 3
  const traceProgram = {
    canonicalId: 'Ember',
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
          hitTargetIds,
          missedTargetIds,
          rollLedger: [{
            rollId: 'ember.accuracy-roll.1',
            naturalResult: Math.floor(definition.accuracyRandom * 20) + 1,
          }, ...(definition.hit ? [{
            rollId: 'ember.damage.roll.1',
            naturalResult: 1,
            finalValue: 7,
          }] : [])],
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
              hitTargetIds,
              hpUpdates: definition.hit
                ? [{ id: 'target-token', currentHp: definition.expectedCurrentHp }]
                : [],
              conditionUpdates: definition.burned
                ? [{ id: 'target-token', conditions }]
                : [],
            },
          },
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
            canonicalMoveName: 'Ember',
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates: definition.hit
                ? [{ id: 'target-token', currentHp: definition.expectedCurrentHp }]
                : [],
              conditionUpdates: definition.burned
                ? [{ id: 'target-token', conditions }]
                : [],
            },
          },
        },
      },
      committedDocuments: {
        map: expectedMap(definition.operationId),
        sheets: {
          pokemon: {
            actor: { revision: 3, combat: { currentHp: 50, conditions: [] } },
            target: {
              revision: targetRevision,
              combat: {
                currentHp: definition.expectedCurrentHp,
                conditions,
              },
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
            operationId: 'ember.burn',
            operationKind: 'condition',
          }],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'ember.burn',
            operationKind: 'condition',
            outcome: definition.conditionOutcome,
          }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'ember.burn',
            operationKind: 'condition',
            outcome: definition.conditionOutcome,
          }],
        },
      },
    },
  }
}

export const allEmberV2SemanticScenarios = (): readonly MoveAutomationSemanticScenario[] =>
  EMBER_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => emberV2SemanticScenario(scenarioId))
