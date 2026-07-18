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

export const SAND_TOMB_V2_SEMANTIC_SCENARIOS = Object.freeze([
  { scenarioId: 'sand-tomb.v2-hit', evidenceClasses: ['hit'] as const },
  { scenarioId: 'sand-tomb.v2-miss', evidenceClasses: ['miss'] as const },
  { scenarioId: 'sand-tomb.v2-critical-hit', evidenceClasses: ['crit'] as const },
  { scenarioId: 'sand-tomb.v2-immunity', evidenceClasses: ['immunity'] as const },
  { scenarioId: 'sand-tomb.v2-escape-success', evidenceClasses: ['lifecycle-trigger', 'threshold-pass'] as const },
  { scenarioId: 'sand-tomb.v2-attempts-expire', evidenceClasses: ['lifecycle-cleanup', 'threshold-fail'] as const },
  { scenarioId: 'sand-tomb.v2-switch-cleanup', evidenceClasses: ['lifecycle-cleanup'] as const },
  { scenarioId: 'sand-tomb.v2-knockout-cleanup', evidenceClasses: ['lifecycle-cleanup'] as const },
  { scenarioId: 'sand-tomb.v2-scene-cleanup', evidenceClasses: ['lifecycle-cleanup'] as const },
  { scenarioId: 'sand-tomb.v2-replacement-retry', evidenceClasses: ['retry'] as const },
] as const)

export type SandTombV2SemanticScenarioId =
  (typeof SAND_TOMB_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

interface SandTombScenarioDefinition {
  readonly operationId: string
  readonly accuracyRandom: number
  readonly hit: boolean
  readonly critical: boolean
  readonly vortex: boolean
  readonly targetTypes: readonly string[]
}

const ordinary = (suffix: string): SandTombScenarioDefinition => ({
  operationId: `op_sandtomb_${suffix}`,
  accuracyRandom: 0.45,
  hit: true,
  critical: false,
  vortex: true,
  targetTypes: ['Normal'],
})

const DEFINITIONS: Readonly<Record<SandTombV2SemanticScenarioId, SandTombScenarioDefinition>> = {
  'sand-tomb.v2-hit': ordinary('hit'),
  'sand-tomb.v2-miss': {
    ...ordinary('miss'),
    accuracyRandom: 0,
    hit: false,
    vortex: false,
  },
  'sand-tomb.v2-critical-hit': {
    ...ordinary('critical'),
    accuracyRandom: 0.999,
    critical: true,
  },
  'sand-tomb.v2-immunity': {
    ...ordinary('immunity'),
    vortex: false,
    targetTypes: ['Ghost'],
  },
  'sand-tomb.v2-escape-success': ordinary('escape_success'),
  'sand-tomb.v2-attempts-expire': ordinary('attempts_expire'),
  'sand-tomb.v2-switch-cleanup': ordinary('switch_cleanup'),
  'sand-tomb.v2-knockout-cleanup': ordinary('knockout_cleanup'),
  'sand-tomb.v2-scene-cleanup': ordinary('scene_cleanup'),
  'sand-tomb.v2-replacement-retry': ordinary('replacement_retry'),
}

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
  initiative: id === 'actor-token' ? 20 : 10,
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly species: string
  readonly types: readonly string[]
  readonly moves?: CharacterSheet['movelist']
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  level: 20,
  revision: 3,
  types: [...options.types],
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

const fixture = (definition: SandTombScenarioDefinition): {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
} => ({
  map: {
    schemaVersion: 2,
    slug: 'sand-tomb-v2-arena',
    name: 'Sand Tomb v2 Arena',
    revision: 7,
    dimensions: { x: 8, y: 3, z: 5 },
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
    activeScene: { name: 'Sand Tomb Scene', startedAt: 100 },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  },
  pokemonSheets: new Map([
    ['actor', pokemonSheet({
      slug: 'actor',
      species: 'Hippowdon',
      types: ['Ground'],
      moves: [{ name: 'Sand Tomb' }],
    })],
    ['target', pokemonSheet({
      slug: 'target',
      species: 'Eevee',
      types: definition.targetTypes,
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Sand Tomb',
    selection: { kind: 'single-target', targetPlacementId: 'target-token' },
  },
  randomValues: definition.hit
    ? [definition.accuracyRandom, 0, 0]
    : [definition.accuracyRandom],
})

const expectedVortexEffect = {
  kind: 'vortex',
  source: {
    operationId: 'sand-tomb.vortex',
    moveId: 'move.sand-tomb',
    placementId: 'actor-token',
  },
  affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
  charges: 4,
  payload: {
    sourceType: 'ground',
    tickPercent: 10,
    escapeDcs: [20, 14, 8, 2],
  },
}

/** Immediate authority evidence; lifecycle branches are asserted by the server suite. */
export const sandTombV2SemanticScenario = (
  scenarioId: SandTombV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const definition = DEFINITIONS[scenarioId]
  const input = fixture(definition)
  const hitTargetIds = definition.hit ? ['target-token'] : []
  const missedTargetIds = definition.hit ? [] : ['target-token']
  const expectedEffects = definition.vortex ? [expectedVortexEffect] : []
  const traceProgram = {
    canonicalId: 'Sand Tomb',
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }
  return {
    scenarioId,
    operationId: definition.operationId,
    runtimeRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY,
    initialState: {
      map: input.map,
      encounterState: createEmptyEncounterState(),
      pokemonSheets: input.pokemonSheets,
      trainerSheets: input.trainerSheets,
    },
    intent: input.intent,
    choices: [],
    interpreter: {
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
    },
    command: { candidateScopePlacementIds: ['target-token'] },
    seed: {
      randomValues: input.randomValues,
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
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: { encounterState: { effects: expectedEffects } },
          resolution: {
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
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
          map: { encounterState: { effects: expectedEffects } },
          move: {
            canonicalMoveName: 'Sand Tomb',
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
            },
          },
        },
      },
      trace: {
        interpreter: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'sand-tomb.vortex',
            operationKind: 'temporary-effect',
          }],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'sand-tomb.vortex',
            operationKind: 'temporary-effect',
            outcome: definition.vortex ? 'applied' : 'no-op',
          }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{
            kind: 'operation',
            operationId: 'sand-tomb.vortex',
            operationKind: 'temporary-effect',
            outcome: definition.vortex ? 'applied' : 'no-op',
          }],
        },
      },
    },
  }
}

export const allSandTombV2SemanticScenarios = (): readonly MoveAutomationSemanticScenario[] => (
  SAND_TOMB_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => sandTombV2SemanticScenario(scenarioId))
)
