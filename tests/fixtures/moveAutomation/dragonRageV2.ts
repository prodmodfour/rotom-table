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

export const DRAGON_RAGE_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'dragon-rage.v2-hit',
    evidenceClasses: ['hit', 'retry'] as const,
  },
  {
    scenarioId: 'dragon-rage.v2-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'dragon-rage.v2-miss',
    evidenceClasses: ['miss'] as const,
  },
] as const)

export type DragonRageV2SemanticScenarioId =
  (typeof DRAGON_RAGE_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

interface DragonRageScenarioDefinition {
  readonly operationId: string
  readonly accuracyRandom: number
  readonly hit: boolean
  readonly expectedCurrentHp: number
  readonly targetTypes: readonly string[]
  readonly directHpOutcome: 'applied' | 'no-op' | 'prevented'
}

const DEFINITIONS: Readonly<Record<
  DragonRageV2SemanticScenarioId,
  DragonRageScenarioDefinition
>> = {
  'dragon-rage.v2-hit': {
    operationId: 'op_dragonragehit001',
    accuracyRandom: 0.999,
    hit: true,
    expectedCurrentHp: 65,
    targetTypes: ['Dragon'],
    directHpOutcome: 'applied',
  },
  'dragon-rage.v2-immunity': {
    operationId: 'op_dragonrageimmune1',
    accuracyRandom: 0.5,
    hit: true,
    expectedCurrentHp: 80,
    targetTypes: ['Fairy'],
    directHpOutcome: 'prevented',
  },
  'dragon-rage.v2-miss': {
    operationId: 'op_dragonragemiss001',
    accuracyRandom: 0,
    hit: false,
    expectedCurrentHp: 80,
    targetTypes: ['Normal'],
    directHpOutcome: 'no-op',
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
  readonly stats?: CharacterSheet['stats']
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  types: [...options.types],
  level: options.slug === 'actor' ? 20 : 30,
  revision: 3,
  movelist: [...(options.moves ?? [])],
  ...(options.stats ? { stats: options.stats } : {}),
  combat: { currentHp: options.currentHp, conditions: [] },
})

export interface DragonRageV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const dragonRageV2Fixture = (
  scenarioId: DragonRageV2SemanticScenarioId,
): DragonRageV2ScenarioFixture => {
  const definition = DEFINITIONS[scenarioId]
  return {
    map: {
      schemaVersion: 2,
      slug: 'dragon-rage-v2-arena',
      name: 'Dragon Rage v2 Arena',
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
      initiative: { activeId: 'actor-token', round: 2 },
      activeScene: { name: 'Dragon Rage Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', pokemonSheet({
        slug: 'actor',
        species: 'Dratini',
        types: ['Dragon'],
        currentHp: 50,
        moves: [{ name: 'Dragon Rage' }],
      })],
      ['target', pokemonSheet({
        slug: 'target',
        species: 'Snorlax',
        types: definition.targetTypes,
        currentHp: 80,
        ...(scenarioId === 'dragon-rage.v2-hit'
          ? { stats: { sdef: { added: 100, stage: 6 } } }
          : {}),
      })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Dragon Rage',
      selection: {
        kind: 'single-target',
        targetPlacementId: 'target-token',
      },
    },
    randomValues: [definition.accuracyRandom],
  }
}

const expectedMap = (operationId: string) => ({
  revision: 8,
  updatedAt: 5_000,
  encounterState: {
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: [{
          id: 'move.dragon-rage',
          sourceOperationId: operationId,
        }],
      },
    },
  },
})

/** Build one fixed-loss branch fixture for all immediate authority layers. */
export const dragonRageV2SemanticScenario = (
  scenarioId: DragonRageV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = dragonRageV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const hitTargetIds = definition.hit ? ['target-token'] : []
  const missedTargetIds = definition.hit ? [] : ['target-token']
  const changed = definition.directHpOutcome === 'applied'
  const naturalResult = Math.floor(definition.accuracyRandom * 20) + 1
  const traceProgram = {
    canonicalId: 'Dragon Rage',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }
  const directHpEvent = {
    kind: 'operation',
    phase: 'damage',
    operationId: 'dragon-rage.fixed-hp-loss',
    operationKind: 'direct-hp',
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
          operations: [
            {
              operation: { id: 'dragon-rage.accuracy' },
              recipientIds: ['target-token'],
            },
            {
              operation: { id: 'dragon-rage.fixed-hp-loss' },
              recipientIds: hitTargetIds,
            },
            {
              operation: { id: 'dragon-rage.usage' },
              recipientIds: ['actor-token'],
            },
            {
              operation: { id: 'dragon-rage.log-completed' },
              recipientIds: [],
            },
          ],
          rollLedger: [{
            rollId: 'dragon-rage.accuracy-roll.1',
            naturalResult,
            finalValue: naturalResult,
          }],
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
              hpUpdates: changed
                ? [{ id: 'target-token', currentHp: definition.expectedCurrentHp }]
                : [],
            },
            rollLedger: [{
              rollId: 'dragon-rage.accuracy-roll.1',
              naturalResult,
            }],
          },
          sheetWrites: changed
            ? [{
                kind: 'pokemon',
                slug: 'target',
                expectedRevision: 3,
                revision: 4,
                changedFields: ['hp'],
                nextSheet: {
                  revision: 4,
                  combat: { currentHp: definition.expectedCurrentHp, conditions: [] },
                },
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
          map: expectedMap(definition.operationId),
          move: {
            canonicalMoveName: 'Dragon Rage',
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates: changed
                ? [{ id: 'target-token', currentHp: definition.expectedCurrentHp }]
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
              revision: changed ? 4 : 3,
              combat: {
                currentHp: definition.expectedCurrentHp,
                conditions: [],
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
          events: [directHpEvent],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{ ...directHpEvent, outcome: definition.directHpOutcome }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{ ...directHpEvent, outcome: definition.directHpOutcome }],
        },
      },
    },
  }
}

export const allDragonRageV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => DRAGON_RAGE_V2_SEMANTIC_SCENARIOS
  .map(({ scenarioId }) => dragonRageV2SemanticScenario(scenarioId))

export const dragonRageV2ScenarioDefinition = (
  scenarioId: DragonRageV2SemanticScenarioId,
): DragonRageScenarioDefinition => DEFINITIONS[scenarioId]
