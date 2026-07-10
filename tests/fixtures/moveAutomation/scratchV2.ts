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

export const SCRATCH_V2_PASS_HIT_SCENARIO = Object.freeze({
  scenarioId: 'scratch.v2-pass-hit',
  evidenceClasses: ['hit', 'pass', 'retry'] as const,
})

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
})

const pokemonSheet = (
  slug: string,
  options: {
    readonly species: string
    readonly currentHp: number
    readonly moves?: readonly { readonly name: string }[]
  },
): CharacterSheet => ({
  slug,
  nickname: options.species,
  species: options.species,
  level: 20,
  revision: 3,
  movelist: [...(options.moves ?? [])],
  combat: { currentHp: options.currentHp },
})

export interface ScratchV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

/** One-target Pass fixture shared by v1/v2 shadow planning and native command tests. */
export const scratchV2PassHitFixture = (): ScratchV2ScenarioFixture => ({
  map: {
    schemaVersion: 2,
    slug: 'scratch-v2-arena',
    name: 'Scratch v2 Arena',
    revision: 7,
    dimensions: { x: 8, y: 3, z: 4 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement('actor-token', 'actor', 1),
      placement('target-token', 'target', 2),
      placement('occupied-end', 'blocker', 5),
    ],
    lights: [],
    initiative: { activeId: 'actor-token', round: 1 },
    activeScene: { name: 'Scratch Scene', startedAt: 100 },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  },
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', {
      species: 'Pikachu',
      currentHp: 50,
      moves: [{ name: 'Scratch' }],
    })],
    ['target', pokemonSheet('target', { species: 'Snorlax', currentHp: 100 })],
    ['blocker', pokemonSheet('blocker', { species: 'Geodude', currentHp: 50 })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Scratch',
    selection: {
      kind: 'area',
      areaTemplateId: 'pass:any:4',
      direction: 'east',
    },
  },
  randomValues: [0.5, 0],
})

const SCRATCH_SEMANTIC_TRACE_EVENTS = Object.freeze([
  {
    kind: 'target',
    phase: 'target',
    targetId: 'target-token',
    outcome: 'included',
  },
  {
    kind: 'operation',
    phase: 'damage',
    operationId: 'scratch.damage',
    operationKind: 'damage',
    outcome: 'applied',
  },
  {
    kind: 'operation',
    phase: 'movement',
    operationId: 'scratch.pass-movement',
    operationKind: 'movement-request',
    outcome: 'applied',
  },
] as const)

const expectedCommittedMap = () => ({
  revision: 8,
  updatedAt: 5_000,
  placements: [
    {
      id: 'actor-token',
      position: { x: 4, y: 0, z: 1 },
    },
    { id: 'target-token' },
    { id: 'occupied-end' },
  ],
  encounterState: {
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        movement: { spent: 3 },
        oncePerTurnFlags: [{
          id: 'move.scratch',
          sourceOperationId: 'op_semanticscratch1',
        }],
      },
    },
  },
})

/** Canonical MA-087 fixture: one definition drives every immediate authority layer. */
export const scratchV2PassHitSemanticScenario = (): MoveAutomationSemanticScenario => {
  const fixture = scratchV2PassHitFixture()
  const traceExpectation = {
    trace: {
      program: {
        canonicalId: 'Scratch',
        runtimeKind: 'movespec-v2',
        runtimeVersion: 2,
      },
    },
    events: SCRATCH_SEMANTIC_TRACE_EVENTS,
  }

  return {
    scenarioId: SCRATCH_V2_PASS_HIT_SCENARIO.scenarioId,
    operationId: 'op_semanticscratch1',
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
      authoritativeTargetIds: ['target-token'],
      authoritativeTargetEvaluations: [{
        targetPlacementId: 'target-token',
        outcome: 'included',
        reasonCode: 'target-included',
      }],
    },
    command: {
      candidateScopePlacementIds: ['target-token'],
    },
    seed: {
      randomValues: fixture.randomValues,
      now: 5_000,
      idPrefix: 'scratch-semantic',
    },
    expected: {
      interpreter: {
        result: {
          kind: 'complete',
          targetIds: ['target-token'],
          hitTargetIds: ['target-token'],
          missedTargetIds: [],
          operations: [
            { operation: { id: 'scratch.accuracy' }, recipientIds: ['target-token'] },
            { operation: { id: 'scratch.damage' }, recipientIds: ['target-token'] },
            { operation: { id: 'scratch.pass-movement' }, recipientIds: ['actor-token'] },
            { operation: { id: 'scratch.usage' }, recipientIds: ['actor-token'] },
            { operation: { id: 'scratch.log-completed' }, recipientIds: [] },
          ],
          rollLedger: [
            { rollId: 'scratch.accuracy-roll.1', naturalResult: 11, finalValue: 11 },
            { rollId: 'scratch.damage.roll.1', naturalResult: 1, finalValue: 7 },
          ],
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: expectedCommittedMap(),
          resolution: {
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds: ['target-token'],
            },
            rollLedger: [
              { rollId: 'scratch.accuracy-roll.1' },
              { rollId: 'scratch.damage.roll.1' },
            ],
          },
          sheetWrites: [{
            kind: 'pokemon',
            slug: 'target',
            expectedRevision: 3,
            revision: 4,
            nextSheet: {
              revision: 4,
              combat: { currentHp: 72 },
            },
          }],
          stateChanges: {
            changes: [
              { kind: 'sheet-state', sourceOperationId: 'scratch.damage' },
              { kind: 'placement-state', sourceOperationId: 'scratch.pass-movement' },
              { kind: 'map-metadata', sourceOperationId: 'scratch.log-completed' },
              { kind: 'encounter-state', sourceOperationId: 'op_semanticscratch1' },
            ],
          },
        },
      },
      command: {
        result: {
          result: {
            ok: true,
            opId: 'op_semanticscratch1',
            previousRevision: 7,
            revision: 8,
          },
          map: expectedCommittedMap(),
          sheetUpdates: [{
            kind: 'pokemon',
            slug: 'target',
            sheet: {
              revision: 4,
              combat: { currentHp: 72 },
            },
          }],
          move: {
            canonicalMoveName: 'Scratch',
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds: ['target-token'],
            },
          },
        },
      },
      committedDocuments: {
        map: expectedCommittedMap(),
        sheets: {
          pokemon: {
            actor: { revision: 3, combat: { currentHp: 50 } },
            target: { revision: 4, combat: { currentHp: 72 } },
            blocker: { revision: 3, combat: { currentHp: 50 } },
          },
          trainer: {},
        },
        operationResult: {
          ok: true,
          opId: 'op_semanticscratch1',
          previousRevision: 7,
          revision: 8,
        },
      },
      trace: {
        interpreter: traceExpectation,
        plan: traceExpectation,
        command: traceExpectation,
      },
    },
  }
}
