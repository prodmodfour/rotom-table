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

export const SWORDS_DANCE_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'swords-dance.v2-already-capped',
    evidenceClasses: ['self'] as const,
  },
  {
    scenarioId: 'swords-dance.v2-capped-increase',
    evidenceClasses: ['self'] as const,
  },
  {
    scenarioId: 'swords-dance.v2-full-increase',
    evidenceClasses: ['retry', 'self'] as const,
  },
] as const)

export type SwordsDanceV2SemanticScenarioId =
  (typeof SWORDS_DANCE_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

interface SwordsDanceScenarioDefinition {
  readonly operationId: string
  readonly initialAttack: number
  readonly expectedAttack: number
  readonly expectedAppliedDelta: number
  readonly operationOutcome: 'applied' | 'no-op'
  readonly capped: boolean
}

const DEFINITIONS: Readonly<Record<
  SwordsDanceV2SemanticScenarioId,
  SwordsDanceScenarioDefinition
>> = {
  'swords-dance.v2-already-capped': {
    operationId: 'op_swordsdancecapped1',
    initialAttack: 6,
    expectedAttack: 6,
    expectedAppliedDelta: 0,
    operationOutcome: 'no-op',
    capped: true,
  },
  'swords-dance.v2-capped-increase': {
    operationId: 'op_swordsdancecapinc1',
    initialAttack: 5,
    expectedAttack: 6,
    expectedAppliedDelta: 1,
    operationOutcome: 'applied',
    capped: true,
  },
  'swords-dance.v2-full-increase': {
    operationId: 'op_swordsdancefull1',
    initialAttack: 0,
    expectedAttack: 2,
    expectedAppliedDelta: 2,
    operationOutcome: 'applied',
    capped: false,
  },
}

const stages = (attack: number): CombatStageMap => ({
  atk: attack,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
})

const placement = (): SheetPlacement => ({
  id: 'actor-token',
  sheetKind: 'pokemon',
  sheetSlug: 'actor',
  position: { x: 1, y: 0, z: 1 },
})

const pokemonSheet = (attack: number): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Dancer',
  species: 'Scyther',
  level: 20,
  revision: 3,
  movelist: [{ name: 'Swords Dance' }],
  stats: {
    atk: { stage: attack },
    def: { stage: 0 },
    satk: { stage: 0 },
    sdef: { stage: 0 },
    spd: { stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 50 },
})

export interface SwordsDanceV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const swordsDanceV2Fixture = (
  scenarioId: SwordsDanceV2SemanticScenarioId,
): SwordsDanceV2ScenarioFixture => {
  const definition = DEFINITIONS[scenarioId]
  return {
    map: {
      schemaVersion: 2,
      slug: 'swords-dance-v2-arena',
      name: 'Swords Dance v2 Arena',
      revision: 7,
      dimensions: { x: 4, y: 3, z: 4 },
      groundLevelY: 0,
      playerVisible: true,
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      placements: [placement()],
      lights: [],
      initiative: { activeId: 'actor-token', round: 3 },
      activeScene: { name: 'Swords Dance Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([['actor', pokemonSheet(definition.initialAttack)]]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Swords Dance',
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
        'swords-dance': {
          moveName: 'Swords Dance',
          frequency: 'eot',
          uses: 1,
          lastUsedRound: 3,
          updatedAt: 5_000,
        },
      },
    },
  },
  encounterState: {
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: [{
          id: 'move.swords-dance',
          sourceOperationId: operationId,
        }],
      },
    },
  },
})

/** Build one cap branch fixture for the interpreter, planner, and command boundary. */
export const swordsDanceV2SemanticScenario = (
  scenarioId: SwordsDanceV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = swordsDanceV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const changed = definition.operationOutcome === 'applied'
  const expectedStages = stages(definition.expectedAttack)
  const expectedSheet = {
    revision: changed ? 4 : 3,
    stats: { atk: { stage: definition.expectedAttack } },
    combatStages: { acc: 0 },
  }
  const expectedStageUpdates = changed
    ? [{ id: 'actor-token', stages: expectedStages }]
    : []
  const traceProgram = {
    canonicalId: 'Swords Dance',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }
  const stageTraceEvent = {
    kind: 'operation',
    phase: 'hit',
    operationId: 'swords-dance.raise-attack',
    operationKind: 'combat-stage',
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
            {
              operation: { id: 'swords-dance.raise-attack' },
              recipientIds: ['actor-token'],
            },
            {
              operation: { id: 'swords-dance.usage' },
              recipientIds: ['actor-token'],
            },
            {
              operation: { id: 'swords-dance.log-completed' },
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
          nextMap: expectedMap(definition.operationId),
          resolution: {
            selectedTargetIds: [],
            transaction: {
              attackedTargetIds: [],
              hitTargetIds: [],
              combatStageUpdates: expectedStageUpdates,
            },
            rollLedger: [],
          },
          sheetWrites: changed
            ? [{
                kind: 'pokemon',
                slug: 'actor',
                expectedRevision: 3,
                revision: 4,
                changedFields: ['combatStages'],
                nextSheet: expectedSheet,
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
          ...(changed
            ? { sheetUpdates: [{ kind: 'pokemon', slug: 'actor', sheet: expectedSheet }] }
            : {}),
          move: {
            canonicalMoveName: 'Swords Dance',
            selectedTargetIds: [],
            transaction: {
              attackedTargetIds: [],
              hitTargetIds: [],
              combatStageUpdates: expectedStageUpdates,
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
            { ...stageTraceEvent, outcome: 'applied' },
          ],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{ ...stageTraceEvent, outcome: definition.operationOutcome }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{ ...stageTraceEvent, outcome: definition.operationOutcome }],
        },
      },
    },
  }
}

export const allSwordsDanceV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => SWORDS_DANCE_V2_SEMANTIC_SCENARIOS
  .map(({ scenarioId }) => swordsDanceV2SemanticScenario(scenarioId))

export const swordsDanceV2ScenarioDefinition = (
  scenarioId: SwordsDanceV2SemanticScenarioId,
): SwordsDanceScenarioDefinition => DEFINITIONS[scenarioId]
