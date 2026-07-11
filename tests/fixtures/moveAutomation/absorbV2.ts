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

export const ABSORB_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'absorb.v2-critical-hit',
    evidenceClasses: ['crit'] as const,
  },
  {
    scenarioId: 'absorb.v2-full-hp-user',
    evidenceClasses: ['hit', 'self'] as const,
  },
  {
    scenarioId: 'absorb.v2-hit-mitigated',
    evidenceClasses: ['hit', 'retry'] as const,
  },
  {
    scenarioId: 'absorb.v2-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'absorb.v2-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'absorb.v2-target-ko',
    evidenceClasses: ['hit'] as const,
  },
  {
    scenarioId: 'absorb.v2-temporary-hp',
    evidenceClasses: ['hit'] as const,
  },
] as const)

export type AbsorbV2SemanticScenarioId =
  (typeof ABSORB_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

interface AbsorbScenarioDefinition {
  readonly operationId: string
  readonly actorHp: number
  readonly expectedActorHp: number
  readonly targetHp: number
  readonly expectedTargetHp: number
  readonly targetAbilities: readonly { readonly name: string }[]
  readonly targetTemporaryHp: number
  readonly expectedTargetTemporaryHp: number
  readonly targetInjuries: number
  readonly randomValues: readonly number[]
  readonly hit: boolean
  readonly effectiveDamage: number
  readonly damageOutcome: 'applied' | 'prevented' | 'no-op'
  readonly drainOutcome: 'applied' | 'no-op'
  readonly drainReasonCode: string
}

const DEFINITIONS: Readonly<Record<
  AbsorbV2SemanticScenarioId,
  AbsorbScenarioDefinition
>> = {
  'absorb.v2-critical-hit': {
    operationId: 'op_absorbcritical01',
    actorHp: 10,
    expectedActorHp: 17,
    targetHp: 50,
    expectedTargetHp: 36,
    targetAbilities: [],
    targetTemporaryHp: 0,
    expectedTargetTemporaryHp: 0,
    targetInjuries: 0,
    randomValues: [0.999, 0],
    hit: true,
    effectiveDamage: 14,
    damageOutcome: 'applied',
    drainOutcome: 'applied',
    drainReasonCode: 'absorb.drain-half-damage',
  },
  'absorb.v2-full-hp-user': {
    operationId: 'op_absorbfullhp001',
    actorHp: 99,
    expectedActorHp: 99,
    targetHp: 50,
    expectedTargetHp: 37,
    targetAbilities: [],
    targetTemporaryHp: 0,
    expectedTargetTemporaryHp: 0,
    targetInjuries: 0,
    randomValues: [0.5, 0],
    hit: true,
    effectiveDamage: 13,
    damageOutcome: 'applied',
    drainOutcome: 'no-op',
    drainReasonCode: 'hp-at-cap',
  },
  'absorb.v2-hit-mitigated': {
    operationId: 'op_absorbmitigated1',
    actorHp: 10,
    expectedActorHp: 17,
    targetHp: 50,
    expectedTargetHp: 37,
    targetAbilities: [],
    targetTemporaryHp: 0,
    expectedTargetTemporaryHp: 0,
    targetInjuries: 0,
    randomValues: [0.5, 0],
    hit: true,
    effectiveDamage: 13,
    damageOutcome: 'applied',
    drainOutcome: 'applied',
    drainReasonCode: 'absorb.drain-half-damage',
  },
  'absorb.v2-immunity': {
    operationId: 'op_absorbimmunity01',
    actorHp: 10,
    expectedActorHp: 10,
    targetHp: 50,
    expectedTargetHp: 50,
    targetAbilities: [{ name: 'Sap Sipper' }],
    targetTemporaryHp: 0,
    expectedTargetTemporaryHp: 0,
    targetInjuries: 0,
    randomValues: [0.5, 0],
    hit: true,
    effectiveDamage: 0,
    damageOutcome: 'prevented',
    drainOutcome: 'no-op',
    drainReasonCode: 'linked-damage-zero',
  },
  'absorb.v2-miss': {
    operationId: 'op_absorbmiss00001',
    actorHp: 10,
    expectedActorHp: 10,
    targetHp: 50,
    expectedTargetHp: 50,
    targetAbilities: [],
    targetTemporaryHp: 0,
    expectedTargetTemporaryHp: 0,
    targetInjuries: 0,
    randomValues: [0],
    hit: false,
    effectiveDamage: 0,
    damageOutcome: 'no-op',
    drainOutcome: 'no-op',
    drainReasonCode: 'linked-damage-zero',
  },
  'absorb.v2-target-ko': {
    operationId: 'op_absorbtargetko01',
    actorHp: 10,
    expectedActorHp: 17,
    targetHp: 5,
    expectedTargetHp: -8,
    targetAbilities: [],
    targetTemporaryHp: 0,
    expectedTargetTemporaryHp: 0,
    targetInjuries: 1,
    randomValues: [0.5, 0],
    hit: true,
    effectiveDamage: 13,
    damageOutcome: 'applied',
    drainOutcome: 'applied',
    drainReasonCode: 'absorb.drain-half-damage',
  },
  'absorb.v2-temporary-hp': {
    operationId: 'op_absorbtemphp001',
    actorHp: 10,
    expectedActorHp: 17,
    targetHp: 50,
    expectedTargetHp: 45,
    targetAbilities: [],
    targetTemporaryHp: 8,
    expectedTargetTemporaryHp: 0,
    targetInjuries: 0,
    randomValues: [0.5, 0],
    hit: true,
    effectiveDamage: 13,
    damageOutcome: 'applied',
    drainOutcome: 'applied',
    drainReasonCode: 'absorb.drain-half-damage',
  },
}

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
})

const actorSheet = (currentHp: number): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Sprout',
  species: 'Bulbasaur',
  types: ['Grass'],
  level: 20,
  revision: 3,
  movelist: [{ name: 'Absorb' }],
  stats: { hp: { added: 18 }, satk: { added: 10 } },
  combat: { currentHp, conditions: [] },
})

const targetSheet = (definition: AbsorbScenarioDefinition): CharacterSheet => ({
  slug: 'target',
  nickname: 'Wall',
  species: 'Snorlax',
  types: ['Normal'],
  abilities: [...definition.targetAbilities],
  level: 20,
  revision: 3,
  movelist: [],
  stats: { hp: { added: 20 } },
  combat: { currentHp: definition.targetHp, conditions: [] },
})

export interface AbsorbV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const absorbV2Fixture = (
  scenarioId: AbsorbV2SemanticScenarioId,
): AbsorbV2ScenarioFixture => {
  const definition = DEFINITIONS[scenarioId]
  const scene = { name: 'Absorb Scene', startedAt: 100 }
  return {
    map: {
      schemaVersion: 2,
      slug: 'absorb-v2-arena',
      name: 'Absorb v2 Arena',
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
      activeScene: scene,
      ...(definition.targetTemporaryHp > 0 ? {
        temporaryHitPoints: {
          scene,
          byPlacementId: { 'target-token': definition.targetTemporaryHp },
        },
      } : {}),
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', actorSheet(definition.actorHp)],
      ['target', targetSheet(definition)],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Absorb',
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
  encounterState: {
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: [{
          id: 'move.absorb',
          sourceOperationId: operationId,
        }],
      },
    },
  },
})

/** Build one reviewed drain branch for every immediate authority layer. */
export const absorbV2SemanticScenario = (
  scenarioId: AbsorbV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = absorbV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const hitTargetIds = definition.hit ? ['target-token'] : []
  const targetChanged = definition.expectedTargetHp !== definition.targetHp
    || definition.expectedTargetTemporaryHp !== definition.targetTemporaryHp
  const actorChanged = definition.expectedActorHp !== definition.actorHp
  const hpUpdates = [
    ...(targetChanged ? [{
      id: 'target-token',
      currentHp: definition.expectedTargetHp,
      ...(definition.targetTemporaryHp !== definition.expectedTargetTemporaryHp
        ? { temporaryHp: definition.expectedTargetTemporaryHp }
        : {}),
      ...(definition.targetInjuries > 0 ? { injuries: definition.targetInjuries } : {}),
    }] : []),
    ...(actorChanged ? [{ id: 'actor-token', currentHp: definition.expectedActorHp }] : []),
  ]
  const expectedSheets = {
    actor: {
      revision: actorChanged ? 4 : 3,
      combat: { currentHp: definition.expectedActorHp, conditions: [] },
    },
    target: {
      revision: targetChanged ? 4 : 3,
      combat: {
        currentHp: definition.expectedTargetHp,
        conditions: [],
        ...(definition.targetInjuries > 0 ? { injuries: definition.targetInjuries } : {}),
      },
    },
  }
  const sheetWrites = [
    ...(targetChanged ? [{
      kind: 'pokemon',
      slug: 'target',
      expectedRevision: 3,
      revision: 4,
      changedFields: ['hp'],
      nextSheet: expectedSheets.target,
    }] : []),
    ...(actorChanged ? [{
      kind: 'pokemon',
      slug: 'actor',
      expectedRevision: 3,
      revision: 4,
      changedFields: ['hp'],
      nextSheet: expectedSheets.actor,
    }] : []),
  ]
  const traceProgram = {
    canonicalId: 'Absorb',
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
          missedTargetIds: definition.hit ? [] : ['target-token'],
          operations: [
            { operation: { id: 'absorb.accuracy' }, recipientIds: ['target-token'] },
            { operation: { id: 'absorb.damage' }, recipientIds: hitTargetIds },
            { operation: { id: 'absorb.drain' }, recipientIds: ['actor-token'] },
            { operation: { id: 'absorb.usage' }, recipientIds: ['actor-token'] },
            { operation: { id: 'absorb.log-completed' }, recipientIds: [] },
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
              hitTargetIds,
              hpUpdates,
            },
          },
          sheetWrites,
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
            canonicalMoveName: 'Absorb',
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
        map: expectedMap(definition.operationId),
        sheets: {
          pokemon: expectedSheets,
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
            { kind: 'operation', operationId: 'absorb.damage', operationKind: 'damage' },
            { kind: 'operation', operationId: 'absorb.drain', operationKind: 'heal' },
          ],
        },
        plan: {
          trace: { program: traceProgram },
          events: [
            {
              kind: 'operation',
              operationId: 'absorb.damage',
              operationKind: 'damage',
              outcome: definition.damageOutcome,
            },
            {
              kind: 'operation',
              operationId: 'absorb.drain',
              operationKind: 'heal',
              outcome: definition.drainOutcome,
            },
          ],
        },
        command: {
          trace: { program: traceProgram },
          events: [
            {
              kind: 'operation',
              operationId: 'absorb.damage',
              operationKind: 'damage',
              outcome: definition.damageOutcome,
            },
            {
              kind: 'operation',
              operationId: 'absorb.drain',
              operationKind: 'heal',
              outcome: definition.drainOutcome,
            },
          ],
        },
      },
    },
  }
}

export const allAbsorbV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => ABSORB_V2_SEMANTIC_SCENARIOS
  .map(({ scenarioId }) => absorbV2SemanticScenario(scenarioId))

export const absorbV2ScenarioDefinition = (
  scenarioId: AbsorbV2SemanticScenarioId,
): AbsorbScenarioDefinition => DEFINITIONS[scenarioId]
