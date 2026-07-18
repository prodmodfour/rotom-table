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

export const DOUBLE_KICK_V2_SEMANTIC_SCENARIOS = Object.freeze([
  {
    scenarioId: 'double-kick.v2-critical-double-hit',
    evidenceClasses: ['crit', 'hit', 'retry'] as const,
  },
  {
    scenarioId: 'double-kick.v2-double-miss',
    evidenceClasses: ['miss'] as const,
  },
  {
    scenarioId: 'double-kick.v2-early-ko',
    evidenceClasses: [] as const,
  },
  {
    scenarioId: 'double-kick.v2-immunity',
    evidenceClasses: ['immunity'] as const,
  },
  {
    scenarioId: 'double-kick.v2-mixed-hit-miss',
    evidenceClasses: [] as const,
  },
] as const)

export const FURY_ATTACK_V2_SEMANTIC_SCENARIOS = Object.freeze([
  { scenarioId: 'fury-attack.v2-early-ko', evidenceClasses: ['alternate-branch'] as const },
  {
    scenarioId: 'fury-attack.v2-five-hit-critical',
    evidenceClasses: ['alternate-branch', 'crit', 'retry'] as const,
  },
  { scenarioId: 'fury-attack.v2-four-hit', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'fury-attack.v2-immunity', evidenceClasses: ['immunity'] as const },
  { scenarioId: 'fury-attack.v2-miss', evidenceClasses: ['miss'] as const },
  { scenarioId: 'fury-attack.v2-one-hit', evidenceClasses: ['hit'] as const },
  { scenarioId: 'fury-attack.v2-three-hit', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'fury-attack.v2-two-hit', evidenceClasses: ['alternate-branch'] as const },
] as const)

export const FURY_SWIPES_V2_SEMANTIC_SCENARIOS = Object.freeze([
  { scenarioId: 'fury-swipes.v2-early-ko', evidenceClasses: ['alternate-branch'] as const },
  {
    scenarioId: 'fury-swipes.v2-five-hit-critical',
    evidenceClasses: ['alternate-branch', 'crit', 'retry'] as const,
  },
  { scenarioId: 'fury-swipes.v2-four-hit', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'fury-swipes.v2-immunity', evidenceClasses: ['immunity'] as const },
  { scenarioId: 'fury-swipes.v2-miss', evidenceClasses: ['miss'] as const },
  { scenarioId: 'fury-swipes.v2-one-hit', evidenceClasses: ['hit'] as const },
  { scenarioId: 'fury-swipes.v2-three-hit', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'fury-swipes.v2-two-hit', evidenceClasses: ['alternate-branch'] as const },
] as const)

export const PIN_MISSILE_V2_SEMANTIC_SCENARIOS = Object.freeze([
  { scenarioId: 'pin-missile.v2-early-ko', evidenceClasses: ['alternate-branch'] as const },
  {
    scenarioId: 'pin-missile.v2-five-hit-critical',
    evidenceClasses: ['alternate-branch', 'crit', 'retry'] as const,
  },
  { scenarioId: 'pin-missile.v2-four-hit', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'pin-missile.v2-miss', evidenceClasses: ['miss'] as const },
  { scenarioId: 'pin-missile.v2-one-hit', evidenceClasses: ['hit'] as const },
  { scenarioId: 'pin-missile.v2-three-hit', evidenceClasses: ['alternate-branch'] as const },
  { scenarioId: 'pin-missile.v2-two-hit', evidenceClasses: ['alternate-branch'] as const },
] as const)

export const STRIKE_CANARY_V2_SEMANTIC_SCENARIOS = Object.freeze([
  ...DOUBLE_KICK_V2_SEMANTIC_SCENARIOS,
  ...FURY_ATTACK_V2_SEMANTIC_SCENARIOS,
  ...FURY_SWIPES_V2_SEMANTIC_SCENARIOS,
  ...PIN_MISSILE_V2_SEMANTIC_SCENARIOS,
] as const)

export type StrikeCanaryV2SemanticScenarioId =
  (typeof STRIKE_CANARY_V2_SEMANTIC_SCENARIOS)[number]['scenarioId']

export type StrikeCanaryMoveName =
  | 'Double Kick'
  | 'Fury Attack'
  | 'Fury Swipes'
  | 'Pin Missile'

export interface StrikeCanaryScenarioDefinition {
  readonly operationId: string
  readonly moveName: StrikeCanaryMoveName
  readonly multiHitOperationId: string
  readonly targetTypes: readonly string[]
  readonly targetHp: number
  readonly randomValues: readonly number[]
  readonly expectedRollIds: readonly string[]
  readonly plannedHitCount: number | null
  readonly attemptedHitCount: number
  readonly successfulHitCount: number
  readonly missedHitCount: number
  readonly stopReason: 'completed' | 'accuracy-missed' | 'stop-on-miss' | 'knockout'
  readonly operationOutcome: 'applied' | 'prevented' | 'no-op'
  readonly criticalHitIndexes: readonly number[]
  readonly targetWritten: boolean
}

export interface StrikeCanaryMoveDefinition {
  readonly slug: string
  readonly actorType: string
  readonly actorSpecies: string
  readonly expectedDamageBase: number
  readonly expectedDamageFormula: Readonly<{
    kind: 'dice'
    count: number
    sides: number
    modifier: number
  }>
  readonly hitCountRollId: string | null
}

const MOVE_DEFINITIONS: Readonly<Record<
  StrikeCanaryMoveName,
  StrikeCanaryMoveDefinition
>> = Object.freeze({
  'Double Kick': {
    slug: 'double-kick',
    actorType: 'Fighting',
    actorSpecies: 'Hitmonlee',
    expectedDamageBase: 5,
    expectedDamageFormula: { kind: 'dice', count: 1, sides: 8, modifier: 8 },
    hitCountRollId: null,
  },
  'Fury Attack': {
    slug: 'fury-attack',
    actorType: 'Normal',
    actorSpecies: 'Tauros',
    expectedDamageBase: 4,
    expectedDamageFormula: { kind: 'dice', count: 1, sides: 8, modifier: 6 },
    hitCountRollId: 'fury-attack.hit-count-roll',
  },
  'Fury Swipes': {
    slug: 'fury-swipes',
    actorType: 'Normal',
    actorSpecies: 'Persian',
    expectedDamageBase: 5,
    expectedDamageFormula: { kind: 'dice', count: 1, sides: 8, modifier: 8 },
    hitCountRollId: 'fury-swipes.hit-count-roll',
  },
  'Pin Missile': {
    slug: 'pin-missile',
    actorType: 'Bug',
    actorSpecies: 'Beedrill',
    expectedDamageBase: 5,
    expectedDamageFormula: { kind: 'dice', count: 1, sides: 8, modifier: 8 },
    hitCountRollId: 'pin-missile.hit-count-roll',
  },
})

export const strikeCanaryV2MoveDefinition = (
  moveName: StrikeCanaryMoveName,
): StrikeCanaryMoveDefinition => MOVE_DEFINITIONS[moveName]

type FiveStrikeMoveName = Exclude<StrikeCanaryMoveName, 'Double Kick'>

interface FiveStrikeScenarioConfig {
  readonly moveName: FiveStrikeMoveName
  readonly immunityTypes: readonly string[] | null
}

const FIVE_STRIKE_COUNT_DRAWS: Readonly<Record<number, number>> = Object.freeze({
  1: 0,
  2: 0.2,
  3: 0.5,
  4: 0.75,
  5: 0.999,
})

const fiveStrikeRollIds = (
  slug: string,
  attemptedHits: number,
): readonly string[] => [
  `${slug}.accuracy-roll.t1`,
  `${slug}.hit-count-roll`,
  ...Array.from({ length: attemptedHits }, (_, index) => [
    `${slug}.critical-roll.t1.h${index + 1}`,
    `${slug}.multi-hit.t1.h${index + 1}.roll`,
  ]).flat(),
]

const fiveStrikeRandomValues = (
  plannedHits: number,
  attemptedHits: number,
  criticalHitIndexes: readonly number[] = [],
): readonly number[] => [
  0.5,
  FIVE_STRIKE_COUNT_DRAWS[plannedHits] ?? 0,
  ...Array.from({ length: attemptedHits }, (_, index) => [
    criticalHitIndexes.includes(index + 1) ? 0.999 : 0,
    0,
  ]).flat(),
]

const fiveStrikeHitDefinition = (
  config: FiveStrikeScenarioConfig,
  options: {
    readonly operationId: string
    readonly plannedHits: number
    readonly attemptedHits?: number
    readonly targetTypes?: readonly string[]
    readonly targetHp?: number
    readonly stopReason?: StrikeCanaryScenarioDefinition['stopReason']
    readonly operationOutcome?: StrikeCanaryScenarioDefinition['operationOutcome']
    readonly criticalHitIndexes?: readonly number[]
    readonly targetWritten?: boolean
  },
): StrikeCanaryScenarioDefinition => {
  const { slug } = MOVE_DEFINITIONS[config.moveName]
  const attemptedHits = options.attemptedHits ?? options.plannedHits
  const criticalHitIndexes = options.criticalHitIndexes ?? []
  return {
    operationId: options.operationId,
    moveName: config.moveName,
    multiHitOperationId: `${slug}.multi-hit`,
    targetTypes: options.targetTypes ?? ['Normal'],
    targetHp: options.targetHp ?? 500,
    randomValues: fiveStrikeRandomValues(
      options.plannedHits,
      attemptedHits,
      criticalHitIndexes,
    ),
    expectedRollIds: fiveStrikeRollIds(slug, attemptedHits),
    plannedHitCount: options.plannedHits,
    attemptedHitCount: attemptedHits,
    successfulHitCount: attemptedHits,
    missedHitCount: 0,
    stopReason: options.stopReason ?? 'completed',
    operationOutcome: options.operationOutcome ?? 'applied',
    criticalHitIndexes,
    targetWritten: options.targetWritten ?? true,
  }
}

const fiveStrikeScenarioDefinitions = (
  config: FiveStrikeScenarioConfig,
): Readonly<Record<string, StrikeCanaryScenarioDefinition>> => {
  const { slug } = MOVE_DEFINITIONS[config.moveName]
  const compact = slug.replaceAll('-', '')
  const hit = (
    suffix: string,
    plannedHits: number,
    options: Omit<Parameters<typeof fiveStrikeHitDefinition>[1], 'operationId' | 'plannedHits'> = {},
  ) => fiveStrikeHitDefinition(config, {
    operationId: `op_${compact}${suffix}1`,
    plannedHits,
    ...options,
  })
  const definitions: Record<string, StrikeCanaryScenarioDefinition> = {
    [`${slug}.v2-early-ko`]: hit('earlyko', 5, {
      attemptedHits: 1,
      targetHp: 1,
      stopReason: 'knockout',
    }),
    [`${slug}.v2-five-hit-critical`]: hit('fivehit', 5, {
      criticalHitIndexes: [3],
    }),
    [`${slug}.v2-four-hit`]: hit('fourhit', 4),
    [`${slug}.v2-miss`]: {
      operationId: `op_${compact}miss001`,
      moveName: config.moveName,
      multiHitOperationId: `${slug}.multi-hit`,
      targetTypes: ['Normal'],
      targetHp: 500,
      randomValues: [0],
      expectedRollIds: [`${slug}.accuracy-roll.t1`],
      plannedHitCount: null,
      attemptedHitCount: 0,
      successfulHitCount: 0,
      missedHitCount: 0,
      stopReason: 'accuracy-missed',
      operationOutcome: 'no-op',
      criticalHitIndexes: [],
      targetWritten: false,
    },
    [`${slug}.v2-one-hit`]: hit('onehit', 1),
    [`${slug}.v2-three-hit`]: hit('threehit', 3),
    [`${slug}.v2-two-hit`]: hit('twohit', 2),
  }
  if (config.immunityTypes) {
    definitions[`${slug}.v2-immunity`] = hit('immune', 1, {
      targetTypes: config.immunityTypes,
      operationOutcome: 'prevented',
      targetWritten: false,
    })
  }
  return Object.freeze(definitions)
}

const DEFINITIONS: Readonly<Record<string, StrikeCanaryScenarioDefinition>> = {
  'double-kick.v2-critical-double-hit': {
    operationId: 'op_doublekickcritical1',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [0.5, 0, 0.999, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
      'double-kick.accuracy-roll.t1.h2',
      'double-kick.multi-hit.t1.h2.roll',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 2,
    successfulHitCount: 2,
    missedHitCount: 0,
    stopReason: 'completed',
    operationOutcome: 'applied',
    criticalHitIndexes: [2],
    targetWritten: true,
  },
  'double-kick.v2-double-miss': {
    operationId: 'op_doublekickmiss001',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [0, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.accuracy-roll.t1.h2',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 2,
    successfulHitCount: 0,
    missedHitCount: 2,
    stopReason: 'completed',
    operationOutcome: 'no-op',
    criticalHitIndexes: [],
    targetWritten: false,
  },
  'double-kick.v2-early-ko': {
    operationId: 'op_doublekickearlyko1',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 1,
    randomValues: [0.5, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 1,
    successfulHitCount: 1,
    missedHitCount: 0,
    stopReason: 'knockout',
    operationOutcome: 'applied',
    criticalHitIndexes: [],
    targetWritten: true,
  },
  'double-kick.v2-immunity': {
    operationId: 'op_doublekickimmune1',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Ghost'],
    targetHp: 500,
    randomValues: [0.5, 0, 0.5, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
      'double-kick.accuracy-roll.t1.h2',
      'double-kick.multi-hit.t1.h2.roll',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 2,
    successfulHitCount: 2,
    missedHitCount: 0,
    stopReason: 'completed',
    operationOutcome: 'prevented',
    criticalHitIndexes: [],
    targetWritten: false,
  },
  'double-kick.v2-mixed-hit-miss': {
    operationId: 'op_doublekickmixed01',
    moveName: 'Double Kick',
    multiHitOperationId: 'double-kick.multi-hit',
    targetTypes: ['Normal'],
    targetHp: 500,
    randomValues: [0.5, 0, 0],
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
      'double-kick.accuracy-roll.t1.h2',
    ],
    plannedHitCount: 2,
    attemptedHitCount: 2,
    successfulHitCount: 1,
    missedHitCount: 1,
    stopReason: 'completed',
    operationOutcome: 'applied',
    criticalHitIndexes: [],
    targetWritten: true,
  },
  ...fiveStrikeScenarioDefinitions({
    moveName: 'Fury Attack',
    immunityTypes: ['Ghost'],
  }),
  ...fiveStrikeScenarioDefinitions({
    moveName: 'Fury Swipes',
    immunityTypes: ['Ghost'],
  }),
  ...fiveStrikeScenarioDefinitions({
    moveName: 'Pin Missile',
    immunityTypes: null,
  }),
}

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
})

const actorSheet = (moveName: StrikeCanaryMoveName): CharacterSheet => ({
  slug: 'actor',
  nickname: moveName === 'Double Kick' ? 'Kicker' : 'Striker',
  species: MOVE_DEFINITIONS[moveName].actorSpecies,
  types: [MOVE_DEFINITIONS[moveName].actorType],
  level: 20,
  revision: 3,
  movelist: [{ name: moveName }],
  stats: {
    hp: { added: 100 },
    atk: { added: 10, stage: 0 },
  },
  combat: { currentHp: 100, conditions: [] },
})

const targetSheet = (definition: StrikeCanaryScenarioDefinition): CharacterSheet => ({
  slug: 'target',
  nickname: 'Target',
  species: 'Snorlax',
  types: [...definition.targetTypes],
  level: 20,
  revision: 3,
  movelist: [],
  stats: {
    hp: { added: 500 },
    def: { added: 10, stage: 0 },
  },
  combat: { currentHp: definition.targetHp, conditions: [] },
})

export interface StrikeCanaryV2ScenarioFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

export const strikeCanaryV2Fixture = (
  scenarioId: StrikeCanaryV2SemanticScenarioId,
): StrikeCanaryV2ScenarioFixture => {
  const definition = DEFINITIONS[scenarioId]
  const move = MOVE_DEFINITIONS[definition.moveName]
  return {
    map: {
      schemaVersion: 2,
      slug: `${move.slug}-v2-arena`,
      name: `${definition.moveName} v2 Arena`,
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
      initiative: { activeId: 'actor-token', round: 3 },
      activeScene: { name: 'Strike Canary Scene', startedAt: 100 },
      metadata: { note: 'preserved' },
      createdAt: 1,
      updatedAt: 100,
    },
    pokemonSheets: new Map([
      ['actor', actorSheet(definition.moveName)],
      ['target', targetSheet(definition)],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: definition.moveName,
      selection: {
        kind: 'single-target',
        targetPlacementId: 'target-token',
      },
    },
    randomValues: definition.randomValues,
  }
}

const expectedMap = (
  definition: StrikeCanaryScenarioDefinition,
): Readonly<Record<string, unknown>> => ({
  revision: 8,
  updatedAt: 5_000,
  encounterState: {
    turnResources: {
      'actor-token': {
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: [{
          id: `move.${MOVE_DEFINITIONS[definition.moveName].slug}`,
          sourceOperationId: definition.operationId,
        }],
      },
    },
  },
})

/** Build one fixed- or rolled-strike branch for all immediate authority layers. */
export const strikeCanaryV2SemanticScenario = (
  scenarioId: StrikeCanaryV2SemanticScenarioId,
): MoveAutomationSemanticScenario => {
  const fixture = strikeCanaryV2Fixture(scenarioId)
  const definition = DEFINITIONS[scenarioId]
  const hitTargetIds = definition.successfulHitCount > 0 ? ['target-token'] : []
  const missedTargetIds = definition.successfulHitCount > 0 ? [] : ['target-token']
  const traceProgram = {
    canonicalId: definition.moveName,
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  }
  const multiHitEvent = {
    kind: 'operation',
    phase: 'damage',
    operationId: definition.multiHitOperationId,
    operationKind: 'multi-hit',
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
          damagedTargetIds: definition.targetWritten ? ['target-token'] : [],
          faintedTargetIds: definition.stopReason === 'knockout' ? ['target-token'] : [],
          operations: [
            {
              operation: { id: definition.multiHitOperationId },
              recipientIds: ['target-token'],
            },
            {
              operation: {
                id: `${MOVE_DEFINITIONS[definition.moveName].slug}.usage`,
              },
              recipientIds: ['actor-token'],
            },
            {
              operation: {
                id: `${MOVE_DEFINITIONS[definition.moveName].slug}.log-completed`,
              },
              recipientIds: [],
            },
          ],
          rollLedger: definition.expectedRollIds.map(rollId => ({ rollId })),
        },
      },
      plan: {
        result: {
          previousRevision: 7,
          revision: 8,
          nextMap: expectedMap(definition),
          resolution: {
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates: definition.targetWritten ? [{ id: 'target-token' }] : [],
            },
            rollLedger: definition.expectedRollIds.map(rollId => ({ rollId })),
          },
          sheetWrites: definition.targetWritten
            ? [{
                kind: 'pokemon',
                slug: 'target',
                expectedRevision: 3,
                revision: 4,
                changedFields: ['hp'],
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
          map: expectedMap(definition),
          move: {
            canonicalMoveName: definition.moveName,
            selectedTargetIds: ['target-token'],
            transaction: {
              attackedTargetIds: ['target-token'],
              hitTargetIds,
              hpUpdates: definition.targetWritten ? [{ id: 'target-token' }] : [],
            },
            rollLedger: definition.expectedRollIds.map(rollId => ({ rollId })),
          },
        },
      },
      committedDocuments: {
        map: expectedMap(definition),
        sheets: {
          pokemon: {
            actor: { revision: 3 },
            target: { revision: definition.targetWritten ? 4 : 3 },
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
          events: [{ ...multiHitEvent, outcome: definition.operationOutcome }],
        },
        plan: {
          trace: { program: traceProgram },
          events: [{ ...multiHitEvent, outcome: definition.operationOutcome }],
        },
        command: {
          trace: { program: traceProgram },
          events: [{ ...multiHitEvent, outcome: definition.operationOutcome }],
        },
      },
    },
  }
}

export const allStrikeCanaryV2SemanticScenarios = (
): readonly MoveAutomationSemanticScenario[] => STRIKE_CANARY_V2_SEMANTIC_SCENARIOS
  .map(({ scenarioId }) => strikeCanaryV2SemanticScenario(scenarioId))

export const strikeCanaryV2ScenarioDefinition = (
  scenarioId: StrikeCanaryV2SemanticScenarioId,
): StrikeCanaryScenarioDefinition => DEFINITIONS[scenarioId]
