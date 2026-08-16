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

export const TACKLE_V2_SEMANTIC_SCENARIOS = Object.freeze([
  { scenarioId: 'tackle.v2-critical-hit', evidenceClasses: ['crit'] as const },
  { scenarioId: 'tackle.v2-duplicate-retry', evidenceClasses: ['retry'] as const },
  { scenarioId: 'tackle.v2-hit-push', evidenceClasses: ['hit', 'threshold-pass'] as const },
  { scenarioId: 'tackle.v2-immunity', evidenceClasses: ['immunity'] as const },
  { scenarioId: 'tackle.v2-miss', evidenceClasses: ['miss'] as const },
  { scenarioId: 'tackle.v2-shortened-push', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'tackle.v2-stuck-rejected', evidenceClasses: ['alternate-branch', 'threshold-fail'] as const },
] as const)

export type TackleV2SemanticScenarioId =
  (typeof TACKLE_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

interface TackleDefinition {
  readonly accuracyRandom: number
  readonly hit: boolean
  readonly targetTypes: readonly string[]
  readonly blocker: boolean
  readonly pushed: boolean
  readonly destinationX: number
  readonly actorConditions: readonly string[]
  readonly rejected: boolean
}

const ordinary = (): TackleDefinition => ({
  accuracyRandom: 0.45,
  hit: true,
  targetTypes: ['Water'],
  blocker: false,
  pushed: true,
  destinationX: 4,
  actorConditions: [],
  rejected: false,
})

const DEFINITIONS: Readonly<Record<TackleV2SemanticScenarioId, TackleDefinition>> = {
  'tackle.v2-critical-hit': {
    ...ordinary(),
    accuracyRandom: 0.999,
  },
  'tackle.v2-duplicate-retry': ordinary(),
  'tackle.v2-hit-push': ordinary(),
  'tackle.v2-immunity': {
    ...ordinary(),
    targetTypes: ['Ghost'],
    pushed: false,
    destinationX: 2,
  },
  'tackle.v2-miss': {
    ...ordinary(),
    accuracyRandom: 0,
    hit: false,
    pushed: false,
    destinationX: 2,
  },
  'tackle.v2-shortened-push': {
    ...ordinary(),
    blocker: true,
    destinationX: 3,
  },
  'tackle.v2-stuck-rejected': {
    ...ordinary(),
    accuracyRandom: 0,
    hit: false,
    pushed: false,
    destinationX: 2,
    actorConditions: ['Stuck'],
    rejected: true,
  },
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
  readonly types: readonly string[]
  readonly moves?: CharacterSheet['movelist']
  readonly conditions?: readonly string[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.slug === 'actor' ? 'Machop' : 'Squirtle',
  level: 20,
  revision: 3,
  types: [...options.types],
  movelist: [...(options.moves ?? [])],
  capabilities: { overland: 6 },
  stats: {
    hp: { added: 20 },
    atk: { added: 5, stage: 0 },
    def: { added: 5, stage: 0 },
    satk: { added: 5, stage: 0 },
    sdef: { added: 5, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 100, injuries: 0, conditions: [...(options.conditions ?? [])] },
})

const fixture = (definition: TackleDefinition): {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
} => {
  const placements = [
    placement('actor-token', 'actor', 1),
    placement('target-token', 'target', 2),
    ...(definition.blocker ? [placement('blocker-token', 'blocker', 4)] : []),
  ]
  return {
    map: {
      schemaVersion: 2,
      slug: 'tackle-v2-arena',
      name: 'Tackle v2 Arena',
      revision: 7,
      dimensions: { x: 8, y: 3, z: 5 },
      groundLevelY: 0,
      playerVisible: true,
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      placements,
      lights: [],
      initiative: { activeId: 'actor-token', round: 1 },
      activeScene: { name: 'Tackle Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', pokemonSheet({
        slug: 'actor',
        types: ['Fighting'],
        moves: [{ name: 'Tackle' }],
        conditions: definition.actorConditions,
      })],
      ['target', pokemonSheet({ slug: 'target', types: definition.targetTypes })],
      ...(definition.blocker
        ? [['blocker', pokemonSheet({ slug: 'blocker', types: ['Normal'] })] as const]
        : []),
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    },
  }
}

const randomValues = (definition: TackleDefinition): readonly number[] => {
  if (definition.rejected) return []
  if (!definition.hit) return [definition.accuracyRandom]
  return [definition.accuracyRandom, 0]
}

export const tackleV2SemanticScenario = (
  scenarioId: TackleV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const definition = DEFINITIONS[scenarioId]
  const input = fixture(definition)
  const hitTargetIds = definition.hit ? ['target-token'] : []
  const targetPosition = { x: definition.destinationX, y: 0, z: 1 }
  return {
    scenarioId,
    operationId: `op_${scenarioId.replace(/[^a-z0-9]/g, '_')}`.slice(0, 64),
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
    command: {
      candidateScopePlacementIds: ['target-token'],
    },
    seed: {
      randomValues: randomValues(definition),
      now: 5_000,
      idPrefix: scenarioId,
    },
    expected: definition.rejected
      ? {
          interpreter: {
            rejection: {
              source: 'result',
              code: 'precondition-failed',
              reasonCode: 'tackle.dash-blocked-by-stuck',
            },
          },
          plan: {
            rejection: {
              source: 'error',
              name: 'AuthoritativeMoveResolutionError',
              code: 'move-condition-blocked',
              messageIncludes: 'blocked by Stuck',
            },
          },
          command: {
            rejection: {
              source: 'result',
              reason: 'conflict',
              messageIncludes: 'blocked by Stuck',
            },
          },
        }
      : {
          interpreter: {
            result: {
              kind: 'complete',
              targetIds: ['target-token'],
              hitTargetIds,
              missedTargetIds: definition.hit ? [] : ['target-token'],
            },
          },
          plan: {
            result: {
              previousRevision: 7,
              revision: 8,
              nextMap: {
                placements: [
                  { id: 'actor-token' },
                  { id: 'target-token', position: targetPosition },
                  ...(definition.blocker ? [{ id: 'blocker-token', position: { x: 4, y: 0, z: 1 } }] : []),
                ],
              },
              resolution: {
                transaction: {
                  attackedTargetIds: ['target-token'],
                  hitTargetIds,
                },
              },
            },
          },
          command: {
            result: {
              result: { ok: true, previousRevision: 7, revision: 8 },
              map: {
                placements: [
                  { id: 'actor-token' },
                  { id: 'target-token', position: targetPosition },
                  ...(definition.blocker ? [{ id: 'blocker-token' }] : []),
                ],
              },
              move: {
                canonicalMoveName: 'Tackle',
                transaction: {
                  attackedTargetIds: ['target-token'],
                  hitTargetIds,
                },
              },
            },
          },
          trace: {
            interpreter: {
              trace: {
                program: { canonicalId: 'Tackle', runtimeKind: 'movespec-v2', runtimeVersion: 2 },
              },
            },
            plan: {
              events: [{
                kind: 'operation',
                operationId: 'tackle.push',
                operationKind: 'movement-request',
                outcome: definition.pushed ? 'applied' : 'no-op',
              }],
            },
          },
        },
  }
}

export const allTackleV2SemanticScenarios = (): readonly MoveAutomationSemanticScenario[] => (
  TACKLE_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => tackleV2SemanticScenario(scenarioId))
)
