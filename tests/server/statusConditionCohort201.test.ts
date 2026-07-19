import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  DARK_VOID_BURST_BRANCH_ID,
  DARK_VOID_SINGLE_TARGET_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
  isSeamlessAreaConfirmationScript,
  isSeamlessSingleTargetMoveScript,
} from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { DARK_VOID_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/darkVoid'
import { THUNDER_WAVE_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/thunderWave'
import { TOXIC_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/toxic'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
} from '~~/server/useCases/applyResolveMoveCommand'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { MA_201_SCENARIOS } from '../fixtures/moveAutomation/statusConditions201'

const NOW = 5_000
const BURST_5_TEMPLATE_ID = moveAutomationAreaTemplateId({
  kind: 'burst',
  size: 5,
})

interface TargetProfile {
  readonly id: string
  readonly slug?: string
  readonly x: number
  readonly sideId?: string
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
}

interface CohortFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly randomValues: readonly number[]
}

const placement = (
  id: string,
  slug: string,
  x: number,
  sideId: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: slug,
  sideId,
  position: { x, y: 0, z: 1 },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly species: string
  readonly types?: readonly string[]
  readonly moves?: readonly string[]
  readonly abilities?: readonly string[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  types: [...(options.types ?? ['Normal'])],
  level: 20,
  revision: 3,
  capabilities: { overland: 6 },
  movelist: (options.moves ?? []).map(name => ({ name })),
  abilities: (options.abilities ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 50 },
    atk: { added: 5, stage: 0 },
    def: { added: 5, stage: 0 },
    satk: { added: 5, stage: 0 },
    sdef: { added: 5, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 100, conditions: [] },
})

const fixture = (options: {
  readonly moveName: 'Dark Void' | 'Thunder Wave' | 'Toxic'
  readonly actorTypes?: readonly string[]
  readonly actorAbilities?: readonly string[]
  readonly targets?: readonly TargetProfile[]
  readonly targetBranchId?: string
  readonly selectionKind?: 'single-target' | 'area'
  readonly excludedTargetPlacementIds?: readonly string[]
  readonly randomValues?: readonly number[]
}): CohortFixture => {
  const targets = options.targets ?? [{ id: 'target-token', x: 6 }]
  const encounterState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `ma201-${options.moveName.toLowerCase().replaceAll(' ', '-')}`,
    name: 'MA-201 Arena',
    revision: 7,
    dimensions: { x: 20, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement('actor-token', 'actor', 5, 'heroes'),
      ...targets.map(target => placement(
        target.id,
        target.slug ?? target.id.replace(/-token$/, ''),
        target.x,
        target.sideId ?? 'foes',
      )),
    ],
    lights: [],
    initiative: { activeId: 'actor-token', round: 1 },
    activeScene: { name: 'MA-201 Scene', startedAt: 100 },
    encounterState: {
      ...encounterState,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
    },
    createdAt: 1,
    updatedAt: 100,
  }
  const sheets = new Map<string, CharacterSheet>([[
    'actor',
    pokemonSheet({
      slug: 'actor',
      species: 'Pikachu',
      types: options.actorTypes ?? ['Psychic'],
      moves: [options.moveName],
      abilities: options.actorAbilities,
    }),
  ]])
  for (const target of targets) {
    const slug = target.slug ?? target.id.replace(/-token$/, '')
    sheets.set(slug, pokemonSheet({
      slug,
      species: 'Snorlax',
      types: target.types,
      abilities: target.abilities,
    }))
  }
  const selection = options.selectionKind === 'area'
    ? {
        kind: 'area' as const,
        areaTemplateId: BURST_5_TEMPLATE_ID,
        ...(options.excludedTargetPlacementIds?.length
          ? { excludedTargetPlacementIds: [...options.excludedTargetPlacementIds] }
          : {}),
      }
    : {
        kind: 'single-target' as const,
        targetPlacementId: targets[0]!.id,
      }
  return {
    map,
    pokemonSheets: sheets,
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: options.moveName,
      ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
      selection,
    },
    randomValues: options.randomValues ?? [0.5],
  }
}

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

const plan = (input: CohortFixture, operationId: string): AuthoritativeMoveStatePlan => (
  planAuthoritativeMoveState({
    ...input,
    random: randomSequence(input.randomValues),
    now: () => NOW,
    operationId,
  })
)

const conditionOperationEvent = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
) => result.resolution.auditTrace.events.find(event => (
  event.kind === 'operation' && event.operationId === operationId
))

interface CommandHarness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly events: unknown[]
}

const openDatabases: RotomDatabase[] = []
afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const openHarness = (input: CohortFixture): CommandHarness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => NOW })
  const modes = createSqliteMapInteractionModeRepository(database)
  const events: unknown[] = []
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks(events, { clock: () => NOW }),
  })
  maps.save({
    slug: input.map.slug,
    document: deepCloneJson(input.map),
    revision: input.map.revision ?? 0,
    updatedAt: input.map.updatedAt ?? 100,
  })
  for (const [slug, sheet] of input.pokemonSheets) {
    sheets.save({
      kind: 'pokemon',
      slug,
      document: deepCloneJson(sheet) as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: input.map.updatedAt ?? 100,
    })
  }
  return { database, maps, sheets, ops, commandExecutor, events }
}

const commandFor = (input: CohortFixture, opId: string): ResolveMoveLivePlayCommand => {
  const scopes = buildResolveMoveScopes({
    map: input.map,
    intent: input.intent,
    candidateScopePlacementIds: input.map.placements.map(({ id }) => id),
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: input.map.slug,
    baseRevision: input.map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: deepCloneJson(input.intent),
  }
}

const executeCommand = (
  harness: CommandHarness,
  command: ResolveMoveLivePlayCommand,
  options: {
    readonly random?: LivePlayResolveMoveCommandDependencies['random']
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
  } = {},
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'ma201-test-client',
  playerProfile: null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  commandExecutor: harness.commandExecutor,
  random: options.random,
  planner: options.planner,
  now: () => NOW,
  idFactory: (() => {
    let sequence = 0
    return () => `ma201-test-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const scenarioEvidence = (moveName: string) => {
  const prefix = `ma201-${moveName.toLowerCase().replaceAll(' ', '-')}`
  return Object.values(MA_201_SCENARIOS)
    .filter(({ scenarioId }) => scenarioId.startsWith(prefix))
    .map(({ scenarioId, evidenceClasses }) => ({
      scenarioId,
      evidenceClasses: [...evidenceClasses],
    }))
}

describe('MA-201 native status-condition cohort', () => {
  it('registers exactly three complete native-v2 rows with reviewed presentation metadata', () => {
    const names = ['Dark Void', 'Thunder Wave', 'Toxic'] as const
    const expected = {
      'Dark Void': {
        hash: '1b47ef0d4cfde5995042a9b5725f36999b15db017cac11c4adae8c8d1887f770',
        module: 'server/domain/moveAutomation/specs/darkVoid.ts',
        spec: DARK_VOID_MOVE_SPEC,
      },
      'Thunder Wave': {
        hash: 'ebbb0416acf7508958c375cd1fa89f318b51a253f6e15264682171fa95a05b74',
        module: 'server/domain/moveAutomation/specs/thunderWave.ts',
        spec: THUNDER_WAVE_MOVE_SPEC,
      },
      Toxic: {
        hash: '613acbdf95d6423b628c2e931f071dd8ba5d1222640b5f3982f1c41aba582988',
        module: 'server/domain/moveAutomation/specs/toxic.ts',
        spec: TOXIC_MOVE_SPEC,
      },
    } as const

    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toHaveLength(29)
    expect(menuStatusJson.moves).toHaveLength(776)
    expect(menuStatusJson.moves.filter(({ baseStatus }) => baseStatus === 'complete')).toHaveLength(262)
    expect(menuStatusJson.moves.filter(({ baseStatus }) => baseStatus === 'assisted')).toHaveLength(0)
    expect(menuStatusJson.moves.filter(({ baseStatus }) => baseStatus === 'blocked')).toHaveLength(514)
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)
    for (const name of names) {
      const row = manifestJson.moves.find(({ canonicalId }) => canonicalId === name)!
      expect(row).toMatchObject({
        baseStatus: 'complete',
        interactionStatus: 'unassessed',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        rolloutCohortId: 'ma-201',
        runtime: {
          kind: 'movespec-v2',
          version: 2,
          definitionHash: expected[name].hash,
          sourceModule: expected[name].module,
        },
      })
      expect(registeredMoveAutomationRuntimeFor(name)).toMatchObject({
        kind: 'movespec-v2',
        definition: {
          definitionHash: expected[name].hash,
          spec: { canonicalId: name, version: 2 },
        },
      })
      const expectedScenarios = scenarioEvidence(name)
      expect(row.scenarioIds).toEqual(expectedScenarios.map(({ scenarioId }) => scenarioId))
      expect(row.conformanceEvidence.scenarios).toEqual(expectedScenarios)
      expect(nativeMoveAutomationPresentationScriptForMove(name)).not.toBeNull()
    }

    const darkVoid = nativeMoveAutomationPresentationScriptForMove('Dark Void')!
    expect(darkVoid.targetBranches?.map(branch => branch.id)).toEqual([
      DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      DARK_VOID_BURST_BRANCH_ID,
    ])
    expect(isSeamlessSingleTargetMoveScript(darkVoid)).toBe(true)
    const burst = darkVoid.targetBranches![1]!
    expect(isSeamlessAreaConfirmationScript({
      ...darkVoid,
      ...burst,
      targetBranches: undefined,
    })).toBe(true)
  })

  it('executes each single-target MoveSpec directly through the bounded interpreter', () => {
    for (const testCase of [{
      moveName: 'Thunder Wave' as const,
      operationIds: ['thunder-wave.accuracy', 'thunder-wave.paralysis', 'thunder-wave.usage'],
    }, {
      moveName: 'Toxic' as const,
      operationIds: ['toxic.accuracy', 'toxic.badly-poisoned', 'toxic.usage'],
    }, {
      moveName: 'Dark Void' as const,
      targetBranchId: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      operationIds: ['dark-void.accuracy', 'dark-void.sleep', 'dark-void.usage'],
    }]) {
      const input = fixture({
        moveName: testCase.moveName,
        targetBranchId: testCase.targetBranchId,
        randomValues: [0.5],
      })
      const context = buildAuthoritativeMoveRulesContext({
        ...input,
        selectedPlacementIds: ['target-token'],
        random: randomSequence(input.randomValues),
        time: NOW,
        resolutionId: `resolution.${testCase.moveName.replaceAll(' ', '-').toLowerCase()}`,
      })
      const runtime = registeredMoveAutomationRuntimeFor(testCase.moveName)
      if (runtime?.kind !== 'movespec-v2') throw new Error(`Missing ${testCase.moveName} MoveSpec.`)
      const execution = executeMoveSpec({
        definition: runtime.definition,
        context,
        targetBranchId: testCase.targetBranchId,
        authoritativeTargetIds: ['target-token'],
      })
      expect(execution).toMatchObject({
        kind: 'complete',
        targetIds: ['target-token'],
        hitTargetIds: ['target-token'],
        missedTargetIds: [],
      })
      expect(execution.operations.map(({ operation }) => operation.id)).toEqual(
        expect.arrayContaining(testCase.operationIds),
      )
      expect(execution.trace.program).toMatchObject({
        canonicalId: testCase.moveName,
        runtimeKind: 'movespec-v2',
      })
    }
  })

  it.each([
    {
      scenario: MA_201_SCENARIOS.thunderWaveHit,
      moveName: 'Thunder Wave' as const,
      operationId: 'thunder-wave.paralysis',
      expectedCondition: 'Paralysis',
    },
    {
      scenario: MA_201_SCENARIOS.toxicHit,
      moveName: 'Toxic' as const,
      operationId: 'toxic.badly-poisoned',
      expectedCondition: 'Badly Poisoned',
    },
    {
      scenario: MA_201_SCENARIOS.darkVoidSingleHit,
      moveName: 'Dark Void' as const,
      targetBranchId: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      operationId: 'dark-void.sleep',
      expectedCondition: 'Sleep',
    },
  ])('$scenario.scenarioId resolves a hit through interpreter and planner', (testCase) => {
    const input = fixture({
      moveName: testCase.moveName,
      targetBranchId: testCase.targetBranchId,
      randomValues: [0.5],
    })
    const result = plan(input, `op_${testCase.moveName.replaceAll(' ', '_')}_hit`)
    expect(result.resolution.transaction).toMatchObject({
      attackedTargetIds: ['target-token'],
      hitTargetIds: ['target-token'],
      conditionUpdates: [{ id: 'target-token', conditions: [testCase.expectedCondition] }],
    })
    expect(conditionOperationEvent(result, testCase.operationId)).toMatchObject({
      outcome: 'applied',
      recipientIds: ['target-token'],
    })
    expect(result.resolution.auditTrace.program).toMatchObject({
      canonicalId: testCase.moveName,
      runtimeKind: 'movespec-v2',
      runtimeVersion: 2,
    })
    expect(result.nextMap.encounterState?.turnResources['actor-token']?.actions.standard.spent)
      .toBe(1)
  })

  it.each([
    {
      scenario: MA_201_SCENARIOS.thunderWaveMiss,
      moveName: 'Thunder Wave' as const,
      operationId: 'thunder-wave.paralysis',
    },
    {
      scenario: MA_201_SCENARIOS.toxicMiss,
      moveName: 'Toxic' as const,
      operationId: 'toxic.badly-poisoned',
    },
    {
      scenario: MA_201_SCENARIOS.darkVoidSingleMiss,
      moveName: 'Dark Void' as const,
      targetBranchId: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      operationId: 'dark-void.sleep',
    },
  ])('$scenario.scenarioId spends declaration resources but applies no hit-only condition', (testCase) => {
    const result = plan(fixture({
      moveName: testCase.moveName,
      targetBranchId: testCase.targetBranchId,
      randomValues: [0],
    }), `op_${testCase.moveName.replaceAll(' ', '_')}_miss`)
    expect(result.resolution.transaction).toMatchObject({
      attackedTargetIds: ['target-token'],
      hitTargetIds: [],
      conditionUpdates: [],
    })
    expect(result.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation',
        operationId: testCase.operationId,
        recipientIds: [],
      }),
    ]))
    expect(result.usage.uses).toBe(1)
  })

  it(MA_201_SCENARIOS.thunderWaveImmunity.scenarioId, () => {
    const cases = [
      { types: ['Ground'], abilities: [] as string[], blocker: 'Ground type' },
      { types: ['Electric'], abilities: [] as string[], blocker: 'Electric type' },
      { types: ['Normal'], abilities: ['Volt Absorb'], blocker: 'Volt Absorb' },
      { types: ['Normal'], abilities: ['Motor Drive'], blocker: 'Motor Drive' },
    ]
    for (const [index, target] of cases.entries()) {
      const result = plan(fixture({
        moveName: 'Thunder Wave',
        targets: [{ id: 'target-token', x: 6, ...target }],
        randomValues: [0.5],
      }), `op_thunder_wave_immunity_${index}`)
      expect(result.resolution.transaction).toMatchObject({
        hitTargetIds: ['target-token'],
        conditionUpdates: [],
      })
      expect(conditionOperationEvent(result, 'thunder-wave.paralysis')).toMatchObject({
        outcome: 'prevented',
        result: {
          recipients: [expect.objectContaining({
            outcome: 'prevented',
            blockers: [{ subject: 'Paralysis', source: target.blocker }],
          })],
        },
      })
    }
  })

  it(MA_201_SCENARIOS.toxicPoisonUser.scenarioId, () => {
    for (const actorTypes of [['Poison'], ['Psychic', 'Poison']] as const) {
      const result = plan(fixture({
        moveName: 'Toxic',
        actorTypes,
        randomValues: [0],
      }), `op_toxic_poison_user_${actorTypes.length}`)
      expect(result.resolution.rollLedger[0]).toMatchObject({ naturalResult: 1 })
      expect(result.resolution.transaction).toMatchObject({
        hitTargetIds: ['target-token'],
        conditionUpdates: [{ id: 'target-token', conditions: ['Badly Poisoned'] }],
      })
      expect(result.resolution.auditTrace.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'predicate',
          predicateId: 'toxic.accuracy.accuracy-rule.target-token',
          outcome: true,
          reasonCode: 'toxic.poison-user-automatic-hit',
        }),
        expect.objectContaining({
          kind: 'operation',
          operationId: 'toxic.accuracy',
          result: {
            rolls: [expect.objectContaining({
              accuracyRule: {
                kind: 'automatic-hit',
                sourceId: 'toxic.poison-user',
                reasonCode: 'toxic.poison-user-automatic-hit',
              },
            })],
          },
        }),
      ]))
    }
  })

  it(MA_201_SCENARIOS.toxicImmunity.scenarioId, () => {
    const directCases = [
      { types: ['Poison'], abilities: [] as string[], blocker: 'Poison type' },
      { types: ['Steel'], abilities: [] as string[], blocker: 'Steel type' },
      { types: ['Normal'], abilities: ['Immunity'], blocker: 'Immunity' },
    ]
    for (const [index, target] of directCases.entries()) {
      const result = plan(fixture({
        moveName: 'Toxic',
        targets: [{ id: 'target-token', x: 6, ...target }],
        randomValues: [0.5],
      }), `op_toxic_immunity_${index}`)
      expect(result.resolution.transaction.conditionUpdates).toEqual([])
      expect(conditionOperationEvent(result, 'toxic.badly-poisoned')).toMatchObject({
        outcome: 'prevented',
        result: { recipients: [expect.objectContaining({
          blockers: [{ subject: 'Badly Poisoned', source: target.blocker }],
        })] },
      })
    }

    const auraResult = plan(fixture({
      moveName: 'Toxic',
      targets: [{ id: 'target-token', x: 6 }, {
        id: 'pastel-token',
        slug: 'pastel',
        x: 7,
        sideId: 'foes',
        abilities: ['Pastel Veil'],
      }],
      randomValues: [0.5],
    }), 'op_toxic_pastel_veil')
    expect(auraResult.resolution.transaction.conditionUpdates).toEqual([])
    expect(auraResult.resolution.sheetReads).toContainEqual({
      kind: 'pokemon',
      slug: 'pastel',
      revision: 3,
    })
    expect(conditionOperationEvent(auraResult, 'toxic.badly-poisoned')).toMatchObject({
      outcome: 'prevented',
      result: { recipients: [expect.objectContaining({
        blockers: [{ subject: 'Badly Poisoned', source: 'Pastel Veil (Snorlax)' }],
      })] },
    })
  })

  it(MA_201_SCENARIOS.darkVoidImmunity.scenarioId, () => {
    const result = plan(fixture({
      moveName: 'Dark Void',
      targetBranchId: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      targets: [{ id: 'target-token', x: 6 }, {
        id: 'veil-token',
        slug: 'veil',
        x: 7,
        sideId: 'foes',
        abilities: ['Sweet Veil'],
      }],
      randomValues: [0.5],
    }), 'op_dark_void_sweet_veil')
    expect(result.resolution.transaction.conditionUpdates).toEqual([])
    expect(result.resolution.sheetReads).toContainEqual({
      kind: 'pokemon',
      slug: 'veil',
      revision: 3,
    })
    expect(conditionOperationEvent(result, 'dark-void.sleep')).toMatchObject({
      outcome: 'prevented',
      result: { recipients: [expect.objectContaining({
        blockers: [{ subject: 'Sleep', source: 'Sweet Veil (Snorlax)' }],
      })] },
    })
  })

  it(MA_201_SCENARIOS.darkVoidBurstMixed.scenarioId, async () => {
    const input = fixture({
      moveName: 'Dark Void',
      targetBranchId: DARK_VOID_BURST_BRANCH_ID,
      selectionKind: 'area',
      targets: [
        { id: 'hit-token', x: 6 },
        { id: 'miss-token', x: 7 },
        { id: 'immune-token', x: 8, sideId: 'heroes', abilities: ['Sweet Veil'] },
        { id: 'excluded-token', x: 9, sideId: 'heroes' },
      ],
      excludedTargetPlacementIds: ['excluded-token'],
      randomValues: [0.5, 0, 0.75],
    })
    const result = plan(input, 'op_dark_void_burst_mixed')
    expect(result.resolution).toMatchObject({
      targetBranchId: DARK_VOID_BURST_BRANCH_ID,
      selectedTargetIds: ['hit-token', 'miss-token', 'immune-token'],
      transaction: {
        attackedTargetIds: ['hit-token', 'miss-token', 'immune-token'],
        hitTargetIds: ['hit-token', 'immune-token'],
        conditionUpdates: [{ id: 'hit-token', conditions: ['Sleep'] }],
      },
      area: {
        areaTemplateId: BURST_5_TEMPLATE_ID,
        candidateTargetIds: ['hit-token', 'miss-token', 'immune-token', 'excluded-token'],
        excludedTargetIds: ['excluded-token'],
      },
    })
    expect(result.resolution.rollLedger.filter(({ rollId }) => (
      rollId.startsWith('dark-void.accuracy-roll')
    ))).toHaveLength(3)
    expect(result.nextMap.moveUsage?.byPlacementId['actor-token']).toMatchObject({
      'dark-void': { uses: 1 },
      'dark-void-burst-5': { frequency: 'scene', uses: 1 },
    })
    expect(result.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'predicate',
        predicateId: 'dark-void.burst-branch-selected',
        outcome: true,
      }),
      expect.objectContaining({
        kind: 'target',
        targetId: 'excluded-token',
        outcome: 'excluded',
        reasonCode: 'requested-friendly-exclusion',
      }),
    ]))

    const harness = openHarness(input)
    const accepted = await executeCommand(
      harness,
      commandFor(input, 'op_dark_void_burst_command'),
      { random: randomSequence(input.randomValues) },
    )
    expect(accepted).toMatchObject({
      result: { ok: true, previousRevision: 7, revision: 8 },
      move: {
        canonicalMoveName: 'Dark Void',
        targetBranchId: DARK_VOID_BURST_BRANCH_ID,
        selectedTargetIds: ['hit-token', 'miss-token', 'immune-token'],
      },
    })
    expect(harness.maps.getBySlug(input.map.slug)?.moveUsage?.byPlacementId['actor-token'])
      .toMatchObject({ 'dark-void-burst-5': { frequency: 'scene', uses: 1 } })
  })

  it('enforces Dark Void branch shape, Melee 1, and the independent Burst Scene resource', () => {
    const areaWithoutBranch = fixture({ moveName: 'Dark Void', selectionKind: 'area' })
    expect(() => plan(areaWithoutBranch, 'op_dark_void_missing_branch')).toThrowError(
      expect.objectContaining({ code: 'selection-kind-mismatch' }),
    )
    const singleWithBurst = fixture({
      moveName: 'Dark Void',
      targetBranchId: DARK_VOID_BURST_BRANCH_ID,
    })
    expect(() => plan(singleWithBurst, 'op_dark_void_wrong_branch')).toThrowError(
      expect.objectContaining({ code: 'selection-kind-mismatch' }),
    )
    const outOfRange = fixture({
      moveName: 'Dark Void',
      targetBranchId: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      targets: [{ id: 'target-token', x: 8 }],
    })
    expect(() => plan({ ...outOfRange, randomValues: [] }, 'op_dark_void_out_of_range'))
      .toThrowError(expect.objectContaining({ code: 'target-out-of-range' }))

    const burstInput = fixture({
      moveName: 'Dark Void',
      targetBranchId: DARK_VOID_BURST_BRANCH_ID,
      selectionKind: 'area',
      randomValues: [0.5],
    })
    const first = plan(burstInput, 'op_dark_void_first_burst')
    const laterMap = deepCloneJson(first.nextMap)
    laterMap.initiative = { activeId: 'actor-token', round: 3 }
    laterMap.encounterState = {
      ...laterMap.encounterState!,
      turnResources: {},
    }
    expect(() => plan({ ...burstInput, map: laterMap }, 'op_dark_void_second_burst'))
      .toThrowError(expect.objectContaining({
        code: 'move-usage-unavailable',
        message: expect.stringContaining('Dark Void (Burst 5)'),
      }))

    const regularIntent: ResolveMoveIntent = {
      ...burstInput.intent,
      targetBranchId: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    }
    const regular = plan({ ...burstInput, map: laterMap, intent: regularIntent }, 'op_dark_void_regular_after_burst')
    expect(regular.resolution.targetBranchId).toBe(DARK_VOID_SINGLE_TARGET_BRANCH_ID)
    expect(regular.resolution.transaction.hitTargetIds).toEqual(['target-token'])
  })

  it.each([
    {
      scenario: MA_201_SCENARIOS.thunderWaveRetry,
      moveName: 'Thunder Wave' as const,
      expectedCondition: 'Paralysis',
    },
    {
      scenario: MA_201_SCENARIOS.toxicRetry,
      moveName: 'Toxic' as const,
      expectedCondition: 'Badly Poisoned',
    },
    {
      scenario: MA_201_SCENARIOS.darkVoidRetry,
      moveName: 'Dark Void' as const,
      targetBranchId: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
      expectedCondition: 'Sleep',
    },
  ])('$scenario.scenarioId returns the accepted command result on duplicate delivery without replanning', async (testCase) => {
    const input = fixture({
      moveName: testCase.moveName,
      targetBranchId: testCase.targetBranchId,
      randomValues: [0.5],
    })
    const harness = openHarness(input)
    const command = commandFor(input, `op_${testCase.moveName.replaceAll(' ', '_')}_retry`)
    const first = await executeCommand(harness, command, {
      random: randomSequence(input.randomValues),
    })
    expect(first).toMatchObject({
      result: { ok: true, previousRevision: 7, revision: 8 },
      move: {
        canonicalMoveName: testCase.moveName,
        selectedTargetIds: ['target-token'],
        transaction: {
          hitTargetIds: ['target-token'],
          conditionUpdates: [{
            id: 'target-token',
            conditions: [testCase.expectedCondition],
          }],
        },
      },
    })
    const committedMap = deepCloneJson(harness.maps.getBySlug(input.map.slug))
    const committedSheets = deepCloneJson(harness.sheets.list())
    const committedEvents = deepCloneJson(harness.events)

    const duplicate = await executeCommand(harness, command, {
      random: () => { throw new Error('duplicate MA-201 move must not reroll') },
      planner: () => { throw new Error('duplicate MA-201 move must not replan') },
    })
    expect(duplicate).toEqual(first)
    expect(harness.maps.getBySlug(input.map.slug)).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
    expect(harness.events).toEqual(committedEvents)
    expect(harness.events.filter(event => (
      typeof event === 'object'
      && event !== null
      && (event as { readonly type?: string }).type === 'live-play-command-accepted'
    ))).toHaveLength(1)
  })

  it.each([
    { scenario: MA_201_SCENARIOS.thunderWaveStale, moveName: 'Thunder Wave' as const },
    { scenario: MA_201_SCENARIOS.toxicStale, moveName: 'Toxic' as const },
    {
      scenario: MA_201_SCENARIOS.darkVoidStale,
      moveName: 'Dark Void' as const,
      targetBranchId: DARK_VOID_SINGLE_TARGET_BRANCH_ID,
    },
  ])('$scenario.scenarioId atomically rejects a raced consulted target sheet', async (testCase) => {
    const input = fixture({
      moveName: testCase.moveName,
      targetBranchId: testCase.targetBranchId,
      randomValues: [0.5],
    })
    const harness = openHarness(input)
    const command = commandFor(input, `op_${testCase.moveName.replaceAll(' ', '_')}_stale`)
    const mapBefore = deepCloneJson(harness.maps.getBySlug(input.map.slug))
    const actorBefore = deepCloneJson(harness.sheets.getByRef('pokemon', 'actor'))
    let racedTarget: Record<string, unknown> | null = null
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (planningInput) => {
      const result = planAuthoritativeMoveState({
        ...planningInput,
        random: randomSequence(input.randomValues),
      })
      expect(result.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target' }))
      const current = harness.sheets.getByRef('pokemon', 'target')
      if (!current) throw new Error('Missing MA-201 raced target sheet.')
      racedTarget = {
        ...deepCloneJson(current.sheet),
        revision: current.revision + 1,
        updatedAt: NOW + 1,
      }
      harness.sheets.save({
        kind: 'pokemon',
        slug: 'target',
        document: racedTarget,
        revision: current.revision + 1,
        updatedAt: NOW + 1,
      })
      return result
    }

    const response = await executeCommand(harness, command, { planner })
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('consulted while resolving the move changed'),
    })
    expect(harness.maps.getBySlug(input.map.slug)).toEqual(mapBefore)
    expect(harness.sheets.getByRef('pokemon', 'actor')).toEqual(actorBefore)
    expect(harness.sheets.getByRef('pokemon', 'target')?.sheet).toEqual(racedTarget)
    expect(harness.ops.getOpResult(input.map.slug, command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })
})
