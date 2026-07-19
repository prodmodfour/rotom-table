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
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { deepCloneJson } from '~/utils/serialization'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  STOMP_MOVE_SPEC,
  THUNDER_FANG_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/stompAndThunderFang204'
import { STOMP_SMALLER_TARGET_DAMAGE_BONUS } from '~~/server/domain/moveAutomation/handlers/stomp'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
} from '~~/server/useCases/applyResolveMoveCommand'
import {
  MA_204_MOVE_NAMES,
  MA_204_SCENARIOS_BY_MOVE,
  type StompAndThunderFang204MoveName,
  type StompAndThunderFang204ScenarioEvidence,
} from '../fixtures/moveAutomation/stompAndThunderFang204'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_ID = 'target-token'
const NOW = 6_000

interface TokenProfile {
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
  readonly size?: string
}

interface CohortFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds: readonly string[]
  readonly randomValues: readonly number[]
}

interface FixtureOptions {
  readonly moveName: StompAndThunderFang204MoveName
  readonly naturalResult?: number
  readonly randomValues?: readonly number[]
  readonly actor?: TokenProfile
  readonly target?: TokenProfile
}

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

const d20 = (naturalResult: number): number => (naturalResult - 0.5) / 20

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

const placement = (
  id: string,
  slug: string,
  position: { readonly x: number; readonly y: number; readonly z: number },
  sideId: 'heroes' | 'foes',
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: slug,
  sideId,
  position: { ...position },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly moveName?: string
  readonly profile?: TokenProfile
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: 'Mew',
  types: [...(options.profile?.types ?? ['Normal'])],
  level: 20,
  revision: 3,
  capabilities: {
    overland: 6,
    size: options.profile?.size ?? 'Medium',
  },
  movelist: options.moveName ? [{ name: options.moveName }] : [],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 200 },
    atk: { added: 20, stage: 0 },
    def: { added: 20, stage: 0 },
    satk: { added: 20, stage: 0 },
    sdef: { added: 20, stage: 0 },
    spd: { added: 20, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const fixture = (options: FixtureOptions): CohortFixture => {
  const encounter = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `ma204-${options.moveName.toLowerCase().replaceAll(' ', '-')}`,
    name: `MA-204 ${options.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 4, y: 0, z: 5 }, 'heroes'),
      placement(TARGET_ID, 'target', { x: 5, y: 0, z: 5 }, 'foes'),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'MA-204 scene', startedAt: 100 },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
    },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  return {
    map,
    pokemonSheets: new Map([
      ['actor', pokemonSheet({
        slug: 'actor',
        moveName: options.moveName,
        profile: options.actor,
      })],
      ['target', pokemonSheet({ slug: 'target', profile: options.target })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: options.moveName,
      selection: { kind: 'single-target', targetPlacementId: TARGET_ID },
    },
    candidateScopePlacementIds: [TARGET_ID],
    randomValues: options.randomValues
      ?? [d20(options.naturalResult ?? 10), 0, 0, 0, 0],
  }
}

const plan = (
  input: CohortFixture,
  operationId = 'op_ma204_plan',
): AuthoritativeMoveStatePlan => planAuthoritativeMoveState({
  ...input,
  random: randomSequence(input.randomValues),
  now: () => NOW,
  operationId,
  idFactory: (() => {
    let sequence = 0
    return () => `ma204-plan-id-${++sequence}`
  })(),
})

const operationEvent = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
) => result.resolution.auditTrace.events.findLast(event => (
  event.kind === 'operation' && event.operationId === operationId
))

const predicateEvent = (
  result: AuthoritativeMoveStatePlan,
  predicateId: string,
) => result.resolution.auditTrace.events.find(event => (
  event.kind === 'predicate' && event.predicateId === predicateId
))

const damageCalculation = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
): Readonly<Record<string, unknown>> | null => {
  const event = operationEvent(result, operationId)
  if (!event || event.kind !== 'operation' || typeof event.result !== 'object' || event.result === null) {
    return null
  }
  const recipients = 'recipients' in event.result && Array.isArray(event.result.recipients)
    ? event.result.recipients
    : []
  const first = recipients[0]
  if (typeof first !== 'object' || first === null || !('details' in first)) return null
  const details = first.details
  if (typeof details !== 'object' || details === null || !('calculation' in details)) return null
  return typeof details.calculation === 'object' && details.calculation !== null
    ? details.calculation as Readonly<Record<string, unknown>>
    : null
}

const damagePipeline = (
  result: AuthoritativeMoveStatePlan,
): {
  readonly preTypeDamage: number
  readonly hpLoss: number
  readonly stages: readonly {
    readonly modifiers: readonly {
      readonly id: string
      readonly source: { readonly kind: string; readonly id: string }
      readonly reasonCode: string
      readonly value: number | null
    }[]
  }[]
} => {
  const calculation = damageCalculation(
    result,
    result.resolution.canonicalMoveName === 'Stomp' ? 'stomp.damage' : 'thunder-fang.damage',
  )
  const pipeline = calculation?.damagePipeline
  if (typeof pipeline !== 'object' || pipeline === null) {
    throw new Error('Expected an authoritative damage pipeline.')
  }
  return pipeline as ReturnType<typeof damagePipeline>
}

const conditionsFor = (result: AuthoritativeMoveStatePlan): readonly string[] => (
  result.resolution.transaction.conditionUpdates
    .find(update => update.id === TARGET_ID)?.conditions ?? []
)

const normalizedEvidence = (
  scenarios: readonly StompAndThunderFang204ScenarioEvidence[],
) => scenarios.map(scenario => ({
  scenarioId: scenario.scenarioId,
  evidenceClasses: [...scenario.evidenceClasses].sort(),
})).sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const openHarness = (input: CohortFixture): CommandHarness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => NOW })
  const pending = createSqlitePendingMoveResolutionRepository(database)
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
    candidateScopePlacementIds: input.candidateScopePlacementIds,
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
  clientId: 'ma204-test-client',
  playerProfile: null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  pendingResolutionRepository: createSqlitePendingMoveResolutionRepository(harness.database),
  commandExecutor: harness.commandExecutor,
  random: options.random,
  planner: options.planner,
  now: () => NOW,
  idFactory: (() => {
    let sequence = 0
    return () => `ma204-command-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const safeOperationId = (value: string): string => `op_${value
  .replace(/[^A-Za-z0-9_-]+/g, '_')
  .slice(0, 90)}`

const recoveryFixture = (
  moveName: StompAndThunderFang204MoveName,
): CohortFixture => moveName === 'Stomp'
  ? fixture({
      moveName,
      naturalResult: 15,
      actor: { size: 'Large' },
      target: { size: 'Medium' },
    })
  : fixture({
      moveName,
      randomValues: [d20(18), 0, 0, 0],
    })

describe('MA-204 Stomp and Thunder Fang cohort', () => {
  it('selects exactly two complete reviewed native runtimes with linked evidence', () => {
    const expectedSpecs = new Map<string, MoveSpecLike>([
      ['Stomp', STOMP_MOVE_SPEC],
      ['Thunder Fang', THUNDER_FANG_MOVE_SPEC],
    ])
    for (const moveName of MA_204_MOVE_NAMES) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === moveName)!
      expect(row).toMatchObject({
        baseStatus: 'complete',
        interactionStatus: 'unassessed',
        runtime: {
          kind: 'movespec-v2',
          version: 2,
          sourceModule: 'server/domain/moveAutomation/specs/stompAndThunderFang204.ts',
          definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        capabilityTags: ['conditions.typed', 'expressions.bounded', 'targeting.authoritative'],
        suggestedCapabilityTags: [],
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: '2026-07-19',
        rolloutCohortId: 'ma-204',
      })
      expect(row.scenarioIds).toEqual(
        MA_204_SCENARIOS_BY_MOVE[moveName].map(({ scenarioId }) => scenarioId),
      )
      expect(normalizedEvidence(row.conformanceEvidence.scenarios))
        .toEqual(normalizedEvidence(MA_204_SCENARIOS_BY_MOVE[moveName]))
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        definition: { spec: { canonicalId: expectedSpecs.get(moveName)?.canonicalId } },
        definitionHash: row.runtime.definitionHash,
      })
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(entry => entry.canonicalId === moveName))
        .toHaveLength(1)
      expect(menuStatusJson.moves.find(candidate => candidate.canonicalId === moveName)).toMatchObject({
        baseStatus: 'complete',
        runtimeKind: 'movespec-v2',
        blockerCodes: [],
      })
      expect(nativeMoveAutomationPresentationScriptForMove(moveName)).toMatchObject({
        moveName,
        targetMode: 'one-target',
        targetCount: 1,
        automationNotes: [],
      })
    }
  })

  it.each([
    ['Large', 'Medium', true, 1],
    ['Huge', 'Small', true, 3],
    ['Medium', 'Medium', false, 0],
    ['Small', 'Large', false, -2],
    ['Unresolved', 'Small', false, null],
  ] as const)(
    'derives Stomp size bonus for authoritative %s versus %s categories',
    (actorSize, targetSize, expectedBonus, categoryDifference) => {
      const result = plan(fixture({
        moveName: 'Stomp',
        naturalResult: 14,
        actor: { size: actorSize },
        target: { size: targetSize },
      }))
      const modifier = damagePipeline(result).stages
        .flatMap(stage => stage.modifiers)
        .find(candidate => candidate.id === 'damage.stomp.smaller-target-bonus')
      expect(Boolean(modifier)).toBe(expectedBonus)
      if (expectedBonus) {
        expect(modifier).toMatchObject({
          source: { kind: 'move', id: 'move.stomp' },
          reasonCode: 'stomp.smaller-target-additional-damage',
          value: STOMP_SMALLER_TARGET_DAMAGE_BONUS,
        })
      }
      expect(predicateEvent(result, 'stomp.smaller-target-damage')).toMatchObject({
        outcome: expectedBonus,
        reasonCode: categoryDifference === null
          ? 'stomp.size-unavailable'
          : expectedBonus
            ? 'stomp.target-at-least-one-size-smaller'
            : 'stomp.target-not-smaller',
        input: { actorSize: actorSize === 'Unresolved' ? null : actorSize.toLowerCase(), categoryDifference },
      })
      expect(result.sheetReads.map(read => read.slug).sort()).toEqual(['actor', 'target'])
    },
  )

  it('adds exactly ten pre-type Stomp damage without changing the damage roll', () => {
    const smaller = plan(fixture({
      moveName: 'Stomp',
      naturalResult: 14,
      actor: { size: 'Large' },
      target: { size: 'Medium' },
    }))
    const equal = plan(fixture({
      moveName: 'Stomp',
      naturalResult: 14,
      actor: { size: 'Medium' },
      target: { size: 'Medium' },
    }))
    expect(damagePipeline(smaller).preTypeDamage - damagePipeline(equal).preTypeDamage)
      .toBe(STOMP_SMALLER_TARGET_DAMAGE_BONUS)
    expect(damagePipeline(smaller).hpLoss - damagePipeline(equal).hpLoss)
      .toBe(STOMP_SMALLER_TARGET_DAMAGE_BONUS)
    const smallerDamageRoll = smaller.resolution.rollLedger.find(entry => (
      entry.parentEffectId === 'stomp.damage'
    ))
    const equalDamageRoll = equal.resolution.rollLedger.find(entry => (
      entry.parentEffectId === 'stomp.damage'
    ))
    expect(smallerDamageRoll?.naturalResults).toEqual(equalDamageRoll?.naturalResults)
    expect(smallerDamageRoll?.finalValue).toBe(equalDamageRoll?.finalValue)
  })

  it('gates Stomp Flinch on the natural 15+ accuracy result and preserves damage through immunity', () => {
    const passed = plan(fixture({ moveName: 'Stomp', naturalResult: 15 }))
    const failed = plan(fixture({ moveName: 'Stomp', naturalResult: 14 }))
    const innerFocus = plan(fixture({
      moveName: 'Stomp',
      naturalResult: 15,
      target: { abilities: ['Inner Focus'] },
    }))
    expect(conditionsFor(passed)).toContain('Flinch')
    expect(conditionsFor(failed)).not.toContain('Flinch')
    expect(operationEvent(failed, 'stomp.flinch')).toMatchObject({
      outcome: 'no-op',
      result: { recipients: [{ reasonCode: 'condition-accuracy-roll-trigger-not-met' }] },
    })
    expect(innerFocus.resolution.transaction.hpUpdates.map(update => update.id)).toEqual([TARGET_ID])
    expect(conditionsFor(innerFocus)).not.toContain('Flinch')
    expect(operationEvent(innerFocus, 'stomp.flinch')).toMatchObject({
      outcome: 'prevented',
      result: { recipients: [{ blockers: [{ source: 'Inner Focus' }] }] },
    })
  })

  it('resolves Stomp miss, critical hit, and Normal immunity without a manual branch', () => {
    const miss = plan(fixture({ moveName: 'Stomp', naturalResult: 1 }))
    const critical = plan(fixture({ moveName: 'Stomp', naturalResult: 20 }))
    const immune = plan(fixture({
      moveName: 'Stomp',
      naturalResult: 20,
      target: { types: ['Ghost'] },
    }))
    expect(miss.resolution.transaction.attackedTargetIds).toEqual([TARGET_ID])
    expect(miss.resolution.transaction.hitTargetIds).toEqual([])
    expect(miss.resolution.transaction.hpUpdates).toEqual([])
    expect(damageCalculation(critical, 'stomp.damage')).toMatchObject({
      criticalHit: { critical: true },
    })
    expect(conditionsFor(critical)).toContain('Flinch')
    expect(immune.resolution.transaction.hitTargetIds).toEqual([TARGET_ID])
    expect(immune.resolution.transaction.hpUpdates).toEqual([])
    expect(conditionsFor(immune)).toEqual([])
  })

  it.each([
    ['Paralysis', 0],
    ['Flinch', 0.99],
  ] as const)(
    'lets Thunder Fang select only the %s coin branch on natural 18–19',
    (expectedCondition, coin) => {
      const result = plan(fixture({
        moveName: 'Thunder Fang',
        randomValues: [d20(18), 0, 0, coin],
      }))
      const alternative = expectedCondition === 'Paralysis' ? 'Flinch' : 'Paralysis'
      expect(conditionsFor(result)).toContain(expectedCondition)
      expect(conditionsFor(result)).not.toContain(alternative)
      expect(result.resolution.rollLedger.map(entry => entry.rollId))
        .toContain('thunder-fang.secondary-coin-roll')
    },
  )

  it('applies both Thunder Fang conditions on natural 20 and none below 18', () => {
    const critical = plan(fixture({
      moveName: 'Thunder Fang',
      randomValues: [d20(20), 0, 0, 0, 0],
    }))
    const failed = plan(fixture({
      moveName: 'Thunder Fang',
      randomValues: [d20(17), 0, 0, 0],
    }))
    expect(conditionsFor(critical)).toEqual(expect.arrayContaining(['Paralysis', 'Flinch']))
    expect(damageCalculation(critical, 'thunder-fang.damage')).toMatchObject({
      criticalHit: { critical: true },
    })
    expect(critical.resolution.rollLedger.map(entry => entry.rollId))
      .not.toContain('thunder-fang.secondary-coin-roll')
    expect(conditionsFor(failed)).not.toContain('Paralysis')
    expect(conditionsFor(failed)).not.toContain('Flinch')
    expect(failed.resolution.rollLedger.map(entry => entry.rollId))
      .not.toContain('thunder-fang.secondary-coin-roll')
  })

  it.each([
    ['Paralysis', { types: ['Electric'] }, 0, 'Electric type'],
    ['Flinch', { abilities: ['Inner Focus'] }, 0.99, 'Inner Focus'],
  ] as const)(
    'preserves Thunder Fang damage when %s alone is immune',
    (condition, target, coin, blocker) => {
      const result = plan(fixture({
        moveName: 'Thunder Fang',
        target,
        randomValues: [d20(18), 0, 0, coin],
      }))
      expect(result.resolution.transaction.hpUpdates.map(update => update.id)).toEqual([TARGET_ID])
      expect(conditionsFor(result)).not.toContain(condition)
      const operationId = condition === 'Paralysis'
        ? 'thunder-fang.coin-paralysis'
        : 'thunder-fang.coin-flinch'
      expect(operationEvent(result, operationId)).toMatchObject({
        outcome: 'prevented',
        result: { recipients: [{ blockers: [{ source: blocker }] }] },
      })
    },
  )

  it('honors Thunder Fang miss and Ground immunity before secondary effects', () => {
    const miss = plan(fixture({ moveName: 'Thunder Fang', naturalResult: 1 }))
    const immune = plan(fixture({
      moveName: 'Thunder Fang',
      naturalResult: 20,
      target: { types: ['Ground'] },
    }))
    expect(miss.resolution.transaction.hitTargetIds).toEqual([])
    expect(miss.resolution.transaction.hpUpdates).toEqual([])
    expect(conditionsFor(miss)).toEqual([])
    expect(immune.resolution.transaction.hitTargetIds).toEqual([TARGET_ID])
    expect(immune.resolution.transaction.hpUpdates).toEqual([])
    expect(conditionsFor(immune)).toEqual([])
    expect(JSON.stringify(immune.resolution.auditTrace)).toMatch(/immun/i)
  })

  it.each(MA_204_MOVE_NAMES)(
    'plans %s hit, usage, action cost, and immutable authoritative trace',
    (moveName) => {
      const result = plan(recoveryFixture(moveName), safeOperationId(`${moveName}_hit`))
      expect(result.resolution.transaction.attackedTargetIds).toEqual([TARGET_ID])
      expect(result.resolution.transaction.hitTargetIds).toEqual([TARGET_ID])
      expect(result.resolution.transaction.hpUpdates.map(update => update.id)).toEqual([TARGET_ID])
      expect(result.resolution.auditTrace.program).toMatchObject({
        canonicalId: moveName,
        runtimeKind: 'movespec-v2',
        runtimeVersion: 2,
      })
      expect(result.resolution.auditTrace.events.length).toBeGreaterThan(0)
      expect(result.nextMap.encounterState?.turnResources[ACTOR_ID]?.actions.standard.spent).toBe(1)
      expect(result.resolution.rollLedger.every(entry => entry.parentEffectId.length > 0)).toBe(true)
    },
  )

  it.each(MA_204_MOVE_NAMES)(
    'commits %s once and replays an exact duplicate without rerolling',
    async (moveName) => {
      const input = recoveryFixture(moveName)
      const harness = openHarness(input)
      const evidence = MA_204_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('retry'))!
      const command = commandFor(input, safeOperationId(evidence.scenarioId))
      const first = await executeCommand(harness, command, {
        random: randomSequence(input.randomValues),
      })
      expect(first.result).toMatchObject({
        ok: true,
        previousRevision: 7,
        revision: 8,
      })
      expect(first.move?.transaction).toMatchObject({
        attackedTargetIds: [TARGET_ID],
        hitTargetIds: [TARGET_ID],
      })
      const committedMap = deepCloneJson(harness.maps.getBySlug(input.map.slug))
      const committedSheets = deepCloneJson(harness.sheets.list())
      const committedEvents = deepCloneJson(harness.events)
      const duplicate = await executeCommand(harness, command, {
        random: () => { throw new Error(`duplicate ${moveName} must not reroll`) },
        planner: () => { throw new Error(`duplicate ${moveName} must not replan`) },
      })
      expect(duplicate).toEqual(first)
      expect(harness.maps.getBySlug(input.map.slug)).toEqual(committedMap)
      expect(harness.sheets.list()).toEqual(committedSheets)
      expect(harness.events).toEqual(committedEvents)
    },
  )

  it.each(MA_204_MOVE_NAMES)(
    'rejects stale %s target state without partial map, op, or realtime mutation',
    async (moveName) => {
      const input = recoveryFixture(moveName)
      const harness = openHarness(input)
      const evidence = MA_204_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))!
      const command = commandFor(input, safeOperationId(evidence.scenarioId))
      const mapBefore = deepCloneJson(harness.maps.getBySlug(input.map.slug))
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (plannerInput) => {
        const result = planAuthoritativeMoveState({
          ...plannerInput,
          random: randomSequence(input.randomValues),
        })
        expect(result.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target' }))
        const current = harness.sheets.getByRef('pokemon', 'target')
        if (!current) throw new Error(`Missing ${moveName} raced target sheet.`)
        racedSheet = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: 'target',
          document: racedSheet,
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
      expect(harness.sheets.getByRef('pokemon', 'target')?.sheet).toEqual(racedSheet)
      expect(harness.ops.getOpResult(input.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )
})

interface MoveSpecLike {
  readonly canonicalId: string
}
