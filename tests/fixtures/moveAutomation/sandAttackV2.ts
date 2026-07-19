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

export const SAND_ATTACK_V2_IMMEDIATE_SCENARIOS = Object.freeze([
  {
    scenarioId: 'sand-attack.v2-blindness-hit',
    evidenceClasses: ['hit', 'lifecycle-trigger'] as const,
  },
  {
    scenarioId: 'sand-attack.v2-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'sand-attack.v2-blindness-immunity',
    evidenceClasses: ['immunity'] as const,
  },
] as const)

export type SandAttackV2ImmediateScenarioId =
  (typeof SAND_ATTACK_V2_IMMEDIATE_SCENARIOS)[number]['scenarioId']

interface SandAttackScenarioDefinition {
  readonly operationId: string
  readonly accuracyRandom: number
  readonly hit: boolean
  readonly effectApplied: boolean
  readonly targetTypes: readonly string[]
  readonly targetAbilities: readonly string[]
}

const DEFINITIONS: Readonly<Record<
  SandAttackV2ImmediateScenarioId,
  SandAttackScenarioDefinition
>> = {
  'sand-attack.v2-blindness-hit': {
    operationId: 'op_sandattack_blindness_hit',
    accuracyRandom: 0.45,
    hit: true,
    effectApplied: true,
    targetTypes: ['Normal'],
    targetAbilities: [],
  },
  'sand-attack.v2-miss': {
    operationId: 'op_sandattack_miss',
    accuracyRandom: 0,
    hit: false,
    effectApplied: false,
    targetTypes: ['Normal'],
    targetAbilities: [],
  },
  'sand-attack.v2-blindness-immunity': {
    operationId: 'op_sandattack_blindness_immunity',
    accuracyRandom: 0.45,
    hit: true,
    effectApplied: false,
    targetTypes: ['Normal'],
    targetAbilities: ['Keen Eye'],
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
  readonly abilities?: readonly string[]
  readonly moves?: CharacterSheet['movelist']
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  level: 20,
  revision: 3,
  types: [...options.types],
  abilities: (options.abilities ?? []).map(name => ({ name })),
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 100 },
    atk: { added: 10, stage: 0 },
    def: { added: 10, stage: 0 },
    satk: { added: 10, stage: 0 },
    sdef: { added: 10, stage: 0 },
    spd: { added: 10, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 100, injuries: 0, conditions: [] },
})

const fixture = (definition: SandAttackScenarioDefinition): {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
} => ({
  map: {
    schemaVersion: 2,
    slug: `sand-attack-${definition.operationId.replaceAll('_', '-')}`,
    name: 'Sand Attack v2 Arena',
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
    activeScene: { name: 'Sand Attack Scene', startedAt: 100 },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  },
  pokemonSheets: new Map([
    ['actor', pokemonSheet({
      slug: 'actor',
      species: 'Sandshrew',
      types: ['Ground'],
      moves: [{ name: 'Sand Attack' }],
    })],
    ['target', pokemonSheet({
      slug: 'target',
      species: 'Pidgey',
      types: definition.targetTypes,
      abilities: definition.targetAbilities,
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Sand Attack',
    selection: {
      kind: 'single-target',
      targetPlacementId: 'target-token',
    },
  },
})

const effectExpectation = {
  kind: 'condition',
  source: {
    operationId: 'sand-attack.blindness',
    moveId: 'move.sand-attack',
    placementId: 'actor-token',
  },
  affected: { placementIds: ['target-token'] },
  duration: {
    kind: 'turns',
    subject: 'target',
    boundary: 'end',
    remaining: 1,
  },
  transferPolicy: 'expire',
  payload: {
    conditionId: 'blindness',
    action: 'apply',
    saveTiming: null,
  },
} as const

const expectedMap = (
  operationId: string,
  effectApplied: boolean,
) => ({
  revision: 8,
  updatedAt: 5_000,
  encounterState: {
    effects: effectApplied ? [effectExpectation] : [],
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: [
          expectedActedSinceEntryFlag(operationId),
          { id: 'move.sand-attack', sourceOperationId: operationId },
        ],
      },
    },
  },
})

/** Build one reviewed Sand Attack branch at all immediate authority layers. */
export const sandAttackV2SemanticScenario = (
  scenarioId: SandAttackV2ImmediateScenarioId,
): MoveAutomationSemanticScenario => {
  const definition = DEFINITIONS[scenarioId]
  const state = fixture(definition)
  const hitTargetIds = definition.hit ? ['target-token'] : []
  const missedTargetIds = definition.hit ? [] : ['target-token']
  const map = expectedMap(definition.operationId, definition.effectApplied)
  const traceProgram = {
    canonicalId: 'Sand Attack',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }

  return {
    scenarioId,
    operationId: definition.operationId,
    runtimeRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY,
    initialState: {
      map: state.map,
      encounterState: createEmptyEncounterState(),
      pokemonSheets: state.pokemonSheets,
      trainerSheets: state.trainerSheets,
    },
    intent: state.intent,
    choices: [],
    interpreter: {
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
    },
    command: { candidateScopePlacementIds: ['target-token'] },
    seed: {
      randomValues: [definition.accuracyRandom],
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
            rollId: 'sand-attack.accuracy-roll.1',
            naturalResult: Math.floor(definition.accuracyRandom * 20) + 1,
          }],
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: map,
          resolution: {
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates: [],
              conditionUpdates: [],
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
          map,
          move: {
            canonicalMoveName: 'Sand Attack',
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates: [],
              conditionUpdates: [],
            },
          },
        },
      },
      committedDocuments: {
        map,
        sheets: {
          pokemon: {
            actor: { revision: 3, combat: { currentHp: 100, conditions: [] } },
            target: { revision: 3, combat: { currentHp: 100, conditions: [] } },
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
            operationId: 'sand-attack.blindness',
            operationKind: 'condition',
          }],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'sand-attack.blindness',
            operationKind: 'condition',
          }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'sand-attack.blindness',
            operationKind: 'condition',
          }],
        },
      },
    },
  }
}

export const allSandAttackV2ImmediateScenarios = (): readonly MoveAutomationSemanticScenario[] =>
  SAND_ATTACK_V2_IMMEDIATE_SCENARIOS.map(({ scenarioId }) => (
    sandAttackV2SemanticScenario(scenarioId)
  ))
