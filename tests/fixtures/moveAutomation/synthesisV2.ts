import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MapWeatherKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '~~/server/domain/moveAutomation/registry'
import {
  expectedActedSinceEntryFlag,
  type MoveAutomationSemanticScenario,
} from './scenario'

export const SYNTHESIS_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'synthesis.v2-full-hp',
    evidenceClasses: ['self'] as const,
  },
  {
    scenarioId: 'synthesis.v2-hail',
    evidenceClasses: ['alternate-branch', 'self'] as const,
  },
  {
    scenarioId: 'synthesis.v2-normal',
    evidenceClasses: ['alternate-branch', 'self'] as const,
  },
  {
    scenarioId: 'synthesis.v2-rain',
    evidenceClasses: ['alternate-branch', 'self'] as const,
  },
  {
    scenarioId: 'synthesis.v2-sandstorm',
    evidenceClasses: ['alternate-branch', 'self'] as const,
  },
  {
    scenarioId: 'synthesis.v2-sunny',
    evidenceClasses: ['alternate-branch', 'retry', 'self'] as const,
  },
] as const)

export type SynthesisV2SemanticScenarioId =
  (typeof SYNTHESIS_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

interface SynthesisScenarioDefinition {
  readonly operationId: string
  readonly weather: MapWeatherKind | null
  readonly initialHp: number
  readonly expectedHp: number
  readonly expectedHealing: number
  readonly healOperationId: 'synthesis.heal-normal' | 'synthesis.heal-sunny' | 'synthesis.heal-adverse'
  readonly healOutcome: 'applied' | 'no-op'
}

const DEFINITIONS: Readonly<Record<
  SynthesisV2SemanticScenarioId,
  SynthesisScenarioDefinition
>> = {
  'synthesis.v2-full-hp': {
    operationId: 'op_synthesisfullhp1',
    weather: null,
    initialHp: 99,
    expectedHp: 99,
    expectedHealing: 49,
    healOperationId: 'synthesis.heal-normal',
    healOutcome: 'no-op',
  },
  'synthesis.v2-hail': {
    operationId: 'op_synthesishail001',
    weather: 'hail',
    initialHp: 1,
    expectedHp: 25,
    expectedHealing: 24,
    healOperationId: 'synthesis.heal-adverse',
    healOutcome: 'applied',
  },
  'synthesis.v2-normal': {
    operationId: 'op_synthesisnormal1',
    weather: null,
    initialHp: 1,
    expectedHp: 50,
    expectedHealing: 49,
    healOperationId: 'synthesis.heal-normal',
    healOutcome: 'applied',
  },
  'synthesis.v2-rain': {
    operationId: 'op_synthesisrain001',
    weather: 'rainy',
    initialHp: 1,
    expectedHp: 25,
    expectedHealing: 24,
    healOperationId: 'synthesis.heal-adverse',
    healOutcome: 'applied',
  },
  'synthesis.v2-sandstorm': {
    operationId: 'op_synthesissand001',
    weather: 'sandstorm',
    initialHp: 1,
    expectedHp: 25,
    expectedHealing: 24,
    healOperationId: 'synthesis.heal-adverse',
    healOutcome: 'applied',
  },
  'synthesis.v2-sunny': {
    operationId: 'op_synthesissunny01',
    weather: 'sunny',
    initialHp: 1,
    expectedHp: 67,
    expectedHealing: 66,
    healOperationId: 'synthesis.heal-sunny',
    healOutcome: 'applied',
  },
}

const placement = (): SheetPlacement => ({
  id: 'actor-token',
  sheetKind: 'pokemon',
  sheetSlug: 'actor',
  position: { x: 1, y: 0, z: 1 },
})

/** Bulbasaur HP 5 + 18 added at level 20 gives an exact full Max HP of 99. */
const pokemonSheet = (currentHp: number): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Sprout',
  species: 'Bulbasaur',
  level: 20,
  revision: 3,
  movelist: [{ name: 'Synthesis' }],
  stats: { hp: { added: 18 } },
  combat: { currentHp, conditions: [] },
})

export interface SynthesisV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const synthesisV2Fixture = (
  scenarioId: SynthesisV2SemanticScenarioId,
): SynthesisV2ScenarioFixture => {
  const definition = DEFINITIONS[scenarioId]
  return {
    map: {
      schemaVersion: 2,
      slug: 'synthesis-v2-arena',
      name: 'Synthesis v2 Arena',
      revision: 7,
      dimensions: { x: 4, y: 3, z: 4 },
      groundLevelY: 0,
      playerVisible: true,
      voxels: [],
      hazards: [],
      fieldEffects: {
        weather: definition.weather ? [{ kind: definition.weather }] : [],
        terrains: [],
        rooms: [],
      },
      placements: [placement()],
      lights: [],
      initiative: { activeId: 'actor-token', round: 3 },
      activeScene: { name: 'Synthesis Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([['actor', pokemonSheet(definition.initialHp)]]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Synthesis',
      selection: { kind: 'self' },
    },
    randomValues: [],
  }
}

const expectedMap = (operationId: string) => ({
  revision: 8,
  updatedAt: 5_000,
  moveUsage: {
    byPlacementId: {
      'actor-token': {
        synthesis: {
          moveName: 'Synthesis',
          frequency: 'daily',
          uses: 1,
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
            id: 'move.synthesis',
            sourceOperationId: operationId,
          },
        ],
      },
    },
  },
})

/** Build one reviewed weather branch for every immediate authority layer. */
export const synthesisV2SemanticScenario = (
  scenarioId: SynthesisV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = synthesisV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const changed = definition.healOutcome === 'applied'
  const expectedHpUpdates = changed
    ? [{ id: 'actor-token', currentHp: definition.expectedHp }]
    : []
  const expectedSheet = {
    revision: 4,
    updatedAt: 5_000,
    stats: { hp: { added: 18 } },
    combat: { currentHp: definition.expectedHp, conditions: [] },
    moveUsage: {
      daily: {
        synthesis: {
          moveName: 'Synthesis',
          uses: 1,
          updatedAt: 5_000,
        },
      },
    },
  }
  const traceProgram = {
    canonicalId: 'Synthesis',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }
  const healEvent = {
    kind: 'operation',
    phase: 'hit',
    operationId: definition.healOperationId,
    operationKind: 'heal',
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
      candidatePlacementIds: [],
      selectedPlacementIds: [],
    },
    command: {
      candidateScopePlacementIds: [],
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
          targetIds: ['actor-token'],
          hitTargetIds: [],
          missedTargetIds: [],
          operations: [
            { operation: { id: 'synthesis.select-sunny' }, recipientIds: [] },
            { operation: { id: 'synthesis.select-adverse' }, recipientIds: [] },
            { operation: { id: 'synthesis.select-normal' }, recipientIds: [] },
            { operation: { id: definition.healOperationId }, recipientIds: ['actor-token'] },
            { operation: { id: 'synthesis.usage' }, recipientIds: ['actor-token'] },
            { operation: { id: 'synthesis.log-completed' }, recipientIds: [] },
          ],
          rollLedger: [],
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: expectedMap(definition.operationId),
          resolution: {
            selectedTargetIds: [],
            transaction: {
              attackedTargetIds: [],
              hitTargetIds: [],
              hpUpdates: expectedHpUpdates,
            },
            rollLedger: [],
          },
          sheetWrites: [{
            kind: 'pokemon',
            slug: 'actor',
            expectedRevision: 3,
            revision: 4,
            changedFields: changed ? ['moveUsage', 'hp'] : ['moveUsage'],
            nextSheet: expectedSheet,
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
          sheetUpdates: [{ kind: 'pokemon', slug: 'actor', sheet: expectedSheet }],
          move: {
            canonicalMoveName: 'Synthesis',
            selectedTargetIds: [],
            transaction: {
              attackedTargetIds: [],
              hitTargetIds: [],
              hpUpdates: expectedHpUpdates,
            },
          },
        },
      },
      committedDocuments: {
        map: expectedMap(definition.operationId),
        sheets: {
          pokemon: { actor: expectedSheet },
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
          events: [
            { kind: 'target', targetId: 'actor-token', outcome: 'included' },
            { ...healEvent, outcome: 'applied' },
          ],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{ ...healEvent, outcome: definition.healOutcome }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{ ...healEvent, outcome: definition.healOutcome }],
        },
      },
    },
  }
}

export const allSynthesisV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => SYNTHESIS_V2_SEMANTIC_SCENARIOS
  .map(({ scenarioId }) => synthesisV2SemanticScenario(scenarioId))

export const synthesisV2ScenarioDefinition = (
  scenarioId: SynthesisV2SemanticScenarioId,
): SynthesisScenarioDefinition => DEFINITIONS[scenarioId]
