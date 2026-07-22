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
  type ResolveMoveSelection,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationAreaTemplate } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { deepCloneJson } from '~/utils/serialization'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  ENCOUNTER_EXHAUST_COMMAND_FLAG_ID,
  ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
  spendEncounterMoveResourceCosts,
} from '~~/server/domain/moveAutomation/reduceEncounterResources'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  BLAST_BURN_MOVE_SPEC,
  ETERNABEAM_MOVE_SPEC,
  FRENZY_PLANT_MOVE_SPEC,
  HYDRO_CANNON_MOVE_SPEC,
  MA_205_MOVE_NAMES,
  METEOR_ASSAULT_MOVE_SPEC,
  PRISMATIC_LASER_MOVE_SPEC,
  type ExhaustAreaDamage205MoveName,
} from '~~/server/domain/moveAutomation/specs/exhaustAreaDamage205'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
} from '~~/server/useCases/applyResolveMoveCommand'
import {
  MA_205_SCENARIOS_BY_MOVE,
  type ExhaustAreaDamage205ScenarioEvidence,
} from '../fixtures/moveAutomation/exhaustAreaDamage205'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const NOW = 7_000
const SOURCE_MODULE = 'server/domain/moveAutomation/specs/exhaustAreaDamage205.ts'

const CLOSE_BLAST_3: MoveAutomationAreaTemplate = {
  kind: 'close-blast',
  size: 3,
  label: 'Close Blast 3',
}
const BURST_1: MoveAutomationAreaTemplate = { kind: 'burst', size: 1, label: 'Burst 1' }
const LINE_6: MoveAutomationAreaTemplate = { kind: 'line', size: 6, label: 'Line 6' }
const LINE_8: MoveAutomationAreaTemplate = { kind: 'line', size: 8, label: 'Line 8' }
const LINE_9: MoveAutomationAreaTemplate = { kind: 'line', size: 9, label: 'Line 9' }

interface MoveDefinition {
  readonly slug: string
  readonly damageBase: 15 | 16
  readonly damageClass: 'physical' | 'special'
  readonly moveType: 'dragon' | 'fighting' | 'fire' | 'grass' | 'psychic' | 'water'
  readonly frequency: 'Daily x2' | 'Scene'
  readonly template: MoveAutomationAreaTemplate | null
}

const MOVE_DEFINITIONS: Readonly<Record<ExhaustAreaDamage205MoveName, MoveDefinition>> = {
  'Blast Burn': {
    slug: 'blast-burn',
    damageBase: 15,
    damageClass: 'special',
    moveType: 'fire',
    frequency: 'Daily x2',
    template: CLOSE_BLAST_3,
  },
  Eternabeam: {
    slug: 'eternabeam',
    damageBase: 16,
    damageClass: 'special',
    moveType: 'dragon',
    frequency: 'Scene',
    template: LINE_6,
  },
  'Frenzy Plant': {
    slug: 'frenzy-plant',
    damageBase: 15,
    damageClass: 'special',
    moveType: 'grass',
    frequency: 'Daily x2',
    template: null,
  },
  'Hydro Cannon': {
    slug: 'hydro-cannon',
    damageBase: 15,
    damageClass: 'special',
    moveType: 'water',
    frequency: 'Daily x2',
    template: LINE_9,
  },
  'Meteor Assault': {
    slug: 'meteor-assault',
    damageBase: 15,
    damageClass: 'physical',
    moveType: 'fighting',
    frequency: 'Daily x2',
    template: BURST_1,
  },
  'Prismatic Laser': {
    slug: 'prismatic-laser',
    damageBase: 16,
    damageClass: 'special',
    moveType: 'psychic',
    frequency: 'Daily x2',
    template: LINE_8,
  },
}

const MOVE_SPECS = new Map([
  ['Blast Burn', BLAST_BURN_MOVE_SPEC],
  ['Eternabeam', ETERNABEAM_MOVE_SPEC],
  ['Frenzy Plant', FRENZY_PLANT_MOVE_SPEC],
  ['Hydro Cannon', HYDRO_CANNON_MOVE_SPEC],
  ['Meteor Assault', METEOR_ASSAULT_MOVE_SPEC],
  ['Prismatic Laser', PRISMATIC_LASER_MOVE_SPEC],
] as const)

interface TargetProfile {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
}

interface CohortFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds: readonly string[]
  readonly randomValues: readonly number[]
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
  position: TargetProfile['position'],
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
  readonly moveName?: ExhaustAreaDamage205MoveName
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: 'Mew',
  types: [...(options.types ?? ['Normal'])],
  level: 30,
  revision: 3,
  capabilities: { overland: 6, size: 'Medium' },
  movelist: options.moveName ? [{ name: options.moveName }] : [],
  abilities: (options.abilities ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 500 },
    atk: {
      added: 20,
      stage: options.abilities?.includes('Flash Fire') ? 6 : 0,
    },
    def: { added: 10, stage: 0 },
    satk: {
      added: 20,
      stage: options.abilities?.includes('Flash Fire') ? 6 : 0,
    },
    sdef: { added: 10, stage: 0 },
    spd: { added: 10, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 500, conditions: [] },
})

const defaultTargets = (moveName: ExhaustAreaDamage205MoveName): readonly TargetProfile[] => (
  moveName === 'Meteor Assault'
    ? [{ id: 'target-a', position: { x: 5, y: 0, z: 5 } }, {
        id: 'target-b',
        position: { x: 4, y: 0, z: 4 },
      }]
    : [{ id: 'target-a', position: { x: 5, y: 0, z: 5 } }, {
        id: 'target-b',
        position: { x: 6, y: 0, z: 5 },
      }]
)

const selectionFor = (
  moveName: ExhaustAreaDamage205MoveName,
  targets: readonly TargetProfile[],
): ResolveMoveSelection => {
  const definition = MOVE_DEFINITIONS[moveName]
  if (definition.template === null) {
    return { kind: 'target-count', targetPlacementIds: targets.map(target => target.id) }
  }
  if (definition.template.kind === 'line') {
    return {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(definition.template),
      direction: 'east',
    }
  }
  if (definition.template.kind === 'close-blast') {
    return {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(definition.template),
      aimCell: { ...targets[0]!.position },
    }
  }
  return {
    kind: 'area',
    areaTemplateId: moveAutomationAreaTemplateId(definition.template),
  }
}

const fixture = (options: {
  readonly moveName: ExhaustAreaDamage205MoveName
  readonly targets?: readonly TargetProfile[]
  readonly naturalResults?: readonly number[]
}): CohortFixture => {
  const definition = MOVE_DEFINITIONS[options.moveName]
  const targets = options.targets ?? defaultTargets(options.moveName)
  const encounter = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `ma205-${definition.slug}`,
    name: `MA-205 ${options.moveName}`,
    revision: 7,
    dimensions: { x: 20, y: 3, z: 15 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 4, y: 0, z: 5 }, 'heroes'),
      ...targets.map(target => placement(target.id, target.id, target.position, 'foes')),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'MA-205 scene', startedAt: 100 },
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
  const sheets = new Map<string, CharacterSheet>([[
    'actor',
    pokemonSheet({
      slug: 'actor',
      moveName: options.moveName,
      types: [definition.moveType],
    }),
  ]])
  for (const target of targets) {
    sheets.set(target.id, pokemonSheet({
      slug: target.id,
      types: target.types,
      abilities: target.abilities,
    }))
  }
  return {
    map,
    pokemonSheets: sheets,
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: options.moveName,
      selection: selectionFor(options.moveName, targets),
    },
    candidateScopePlacementIds: targets.map(target => target.id),
    randomValues: [
      ...(options.naturalResults ?? targets.map((_, index) => index === 0 ? 10 : 1)).map(d20),
      ...Array.from({ length: 64 }, () => 0),
    ],
  }
}

const plan = (
  input: CohortFixture,
  operationId = 'op_ma205_plan',
): AuthoritativeMoveStatePlan => planAuthoritativeMoveState({
  ...input,
  random: randomSequence(input.randomValues),
  now: () => NOW,
  operationId,
  idFactory: (() => {
    let sequence = 0
    return () => `ma205-plan-id-${++sequence}`
  })(),
})

const operationEvent = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
) => result.resolution.auditTrace.events.findLast(event => (
  event.kind === 'operation' && event.operationId === operationId
))

const operationRecipient = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
  recipientId: string,
): Readonly<Record<string, unknown>> | null => {
  const event = operationEvent(result, operationId)
  if (!event || event.kind !== 'operation' || typeof event.result !== 'object' || !event.result) {
    return null
  }
  const recipients = 'recipients' in event.result && Array.isArray(event.result.recipients)
    ? event.result.recipients
    : []
  return recipients.find((recipient): recipient is Readonly<Record<string, unknown>> => (
    typeof recipient === 'object'
    && recipient !== null
    && 'recipientId' in recipient
    && recipient.recipientId === recipientId
  )) ?? null
}

const normalizedEvidence = (
  scenarios: readonly ExhaustAreaDamage205ScenarioEvidence[],
) => scenarios.map(scenario => ({
  scenarioId: scenario.scenarioId,
  evidenceClasses: [...scenario.evidenceClasses].sort(),
})).sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const flagCount = (
  map: TabletopMap | null,
  placementId: string,
  flagId: string,
): number => map?.encounterState?.turnResources[placementId]?.oncePerTurnFlags
  .filter(flag => flag.id === flagId).length ?? 0

const safeOperationId = (moveName: ExhaustAreaDamage205MoveName, suffix: string): string => (
  `op_ma205_${moveName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')}_${suffix}`
)

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
  clientId: 'ma205-test-client',
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
    return () => `ma205-command-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const acceptedEventCount = (events: readonly unknown[]): number => events.filter(event => (
  typeof event === 'object'
  && event !== null
  && (event as { readonly type?: string }).type === 'live-play-command-accepted'
)).length

const immunityFixture = (
  moveName: Exclude<ExhaustAreaDamage205MoveName, 'Hydro Cannon'>,
): CohortFixture => {
  const target: TargetProfile = {
    id: 'target-a',
    position: { x: 5, y: 0, z: 5 },
    ...(moveName === 'Blast Burn'
      ? { abilities: ['Flash Fire'] }
      : moveName === 'Frenzy Plant'
        ? { abilities: ['Sap Sipper'] }
        : moveName === 'Eternabeam'
          ? { types: ['Fairy'] }
          : moveName === 'Meteor Assault'
            ? { types: ['Ghost'] }
            : { types: ['Dark'] }),
  }
  return fixture({ moveName, targets: [target], naturalResults: [10] })
}

describe('MA-205 Exhaust area damage cohort', () => {
  it('selects exactly six complete reviewed native runtimes with linked evidence', () => {
    for (const moveName of MA_205_MOVE_NAMES) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === moveName)!
      expect(row).toMatchObject({
        baseStatus: 'complete',
        interactionStatus: 'unassessed',
        runtime: {
          kind: 'movespec-v2',
          version: 2,
          definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          sourceModule: SOURCE_MODULE,
        },
        capabilityTags: ['targeting.authoritative'],
        suggestedCapabilityTags: [],
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: '2026-07-19',
        rolloutCohortId: 'ma-205',
      })
      expect(row.scenarioIds).toEqual(
        MA_205_SCENARIOS_BY_MOVE[moveName].map(({ scenarioId }) => scenarioId),
      )
      expect(normalizedEvidence(row.conformanceEvidence.scenarios))
        .toEqual(normalizedEvidence(MA_205_SCENARIOS_BY_MOVE[moveName]))
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        definition: { spec: { canonicalId: moveName } },
        definitionHash: row.runtime.definitionHash,
      })
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(entry => entry.canonicalId === moveName))
        .toHaveLength(1)
      expect(menuStatusJson.moves.find(candidate => candidate.canonicalId === moveName))
        .toMatchObject({ baseStatus: 'complete', runtimeKind: 'movespec-v2', blockerCodes: [] })

      const presentation = nativeMoveAutomationPresentationScriptForMove(moveName)
      expect(presentation).toMatchObject({
        moveName,
        damaging: true,
        damageBase: MOVE_DEFINITIONS[moveName].damageBase,
        damageClass: MOVE_DEFINITIONS[moveName].damageClass === 'physical'
          ? 'Physical'
          : 'Special',
        automationNotes: [],
      })
      expect(presentation?.areaTemplates).toEqual(
        MOVE_DEFINITIONS[moveName].template ? [MOVE_DEFINITIONS[moveName].template] : [],
      )
      expect(presentation?.targetCount).toBe(moveName === 'Frenzy Plant' ? 5 : null)
    }
  })

  it('encodes every canonical damage profile and cleanup-timed Exhaust cost', () => {
    for (const moveName of MA_205_MOVE_NAMES) {
      const definition = MOVE_DEFINITIONS[moveName]
      const spec = MOVE_SPECS.get(moveName)!
      expect(spec).toMatchObject({
        canonicalId: moveName,
        version: 2,
        targeting: moveName === 'Frenzy Plant'
          ? { kind: 'multi-target', minTargets: 1, maxTargets: 5 }
          : { kind: 'area', minTargets: 0, maxTargets: 32 },
        costs: [{
          id: `${definition.slug}.cost.standard-action`,
          phase: 'pay',
          cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
        }, {
          id: `${definition.slug}.cost.exhaust`,
          phase: 'cleanup',
          cost: { kind: 'exhaust', timing: 'next-turn', forfeitCommand: true },
        }],
      })
      const operations = spec.phases.flatMap(phase => phase.operations)
      expect(operations).toContainEqual(expect.objectContaining({
        id: `${definition.slug}.damage`,
        recipients: { kind: 'attacked-targets' },
        payload: expect.objectContaining({
          damageBase: definition.damageBase,
          damageClass: definition.damageClass,
          moveType: definition.moveType,
          accuracyRollId: `${definition.slug}.accuracy-roll`,
          criticalRollId: `${definition.slug}.accuracy-roll`,
        }),
      }))
    }
  })

  it.each(MA_205_MOVE_NAMES)(
    '%s resolves authoritative recipients, mixed Smite outcomes, usage, and Exhaust atomically',
    (moveName) => {
      const input = fixture({ moveName, naturalResults: [10, 1] })
      const operationId = safeOperationId(moveName, 'mixed')
      const result = plan(input, operationId)
      const definition = MOVE_DEFINITIONS[moveName]
      const targetIds = input.candidateScopePlacementIds

      expect(result.resolution.selectedTargetIds).toEqual(targetIds)
      expect(result.resolution.transaction).toMatchObject({
        attackedTargetIds: targetIds,
        hitTargetIds: [targetIds[0]],
      })
      expect(result.resolution.transaction.hpUpdates.map(update => update.id)).toEqual(targetIds)
      expect(result.resolution.rollLedger.filter(entry => (
        entry.parentEffectId === `${definition.slug}.accuracy`
      )).map(entry => entry.naturalResult)).toEqual([10, 1])
      expect(result.resolution.rollLedger.filter(entry => (
        entry.parentEffectId === `${definition.slug}.damage`
      ))).toHaveLength(2)
      expect(operationEvent(result, `${definition.slug}.damage`)).toMatchObject({
        outcome: 'applied',
        recipientIds: targetIds,
      })
      expect(operationRecipient(result, `${definition.slug}.damage`, targetIds[1]!))
        .toMatchObject({
          outcome: 'applied',
          details: { calculation: { damagePipeline: { stages: expect.arrayContaining([
            expect.objectContaining({
              stage: 'type-effectiveness',
              modifiers: [expect.objectContaining({
                reasonCode: 'damage.smite-miss-resistance-step',
                value: expect.any(Number),
              })],
            }),
          ]) } } },
        })

      if (definition.template) {
        expect(result.resolution.area).toMatchObject({
          template: definition.template,
          candidateTargetIds: targetIds,
        })
        expect(result.resolution.area?.targetEvaluations).toEqual(targetIds.map(targetId => (
          expect.objectContaining({ targetPlacementId: targetId, outcome: 'included' })
        )))
      }
      else {
        expect(result.resolution.area).toBeUndefined()
      }

      expect(result.nextMap.encounterState?.turnResources[ACTOR_ID])
        .toMatchObject({ actions: { standard: { spent: 1 } } })
      expect(flagCount(result.nextMap, ACTOR_ID, ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID)).toBe(1)
      expect(flagCount(result.nextMap, ACTOR_ID, ENCOUNTER_EXHAUST_COMMAND_FLAG_ID)).toBe(1)
      expect(result.usage).toMatchObject({
        moveName,
        frequency: definition.frequency,
        uses: 1,
        remainingUses: definition.frequency === 'Scene' ? 0 : 1,
      })
      expect(result.sheetWrites.map(write => write.slug).sort())
        .toEqual([
          ...(definition.frequency === 'Scene' ? [] : ['actor']),
          ...targetIds,
        ].sort())
    },
  )

  it.each(MA_205_MOVE_NAMES)('%s reuses its natural twenty for critical damage', (moveName) => {
    const input = fixture({
      moveName,
      targets: [defaultTargets(moveName)[0]!],
      naturalResults: [20],
    })
    const definition = MOVE_DEFINITIONS[moveName]
    const result = plan(input, safeOperationId(moveName, 'critical'))
    expect(operationRecipient(result, `${definition.slug}.damage`, 'target-a')).toMatchObject({
      outcome: 'applied',
      details: { calculation: { criticalHit: { naturalRoll: 20, critical: true } } },
    })
    expect(result.resolution.transaction.hitTargetIds).toEqual(['target-a'])
    expect(result.resolution.rollLedger.filter(entry => (
      entry.parentEffectId === `${definition.slug}.accuracy`
    ))).toHaveLength(1)
  })

  it.each([
    ['Blast Burn', 'Flash Fire'],
    ['Eternabeam', 'Fairy type'],
    ['Frenzy Plant', 'Sap Sipper'],
    ['Meteor Assault', 'Ghost type'],
    ['Prismatic Laser', 'Dark type'],
  ] as const)('%s traces canonical %s immunity without erasing costs', (moveName, source) => {
    const input = immunityFixture(moveName)
    const definition = MOVE_DEFINITIONS[moveName]
    const result = plan(input, safeOperationId(moveName, 'immunity'))
    expect(result.resolution.transaction.hpUpdates).toEqual([])
    expect(operationRecipient(result, `${definition.slug}.damage`, 'target-a')).toMatchObject({
      outcome: 'prevented',
      reasonCode: 'damage-immunity',
      blockers: [expect.objectContaining({ source })],
    })
    expect(flagCount(result.nextMap, ACTOR_ID, ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID)).toBe(1)
    expect(result.usage).toMatchObject({ uses: 1 })
  })

  it('records Water immunity as reviewed not-applicable evidence', () => {
    const row = manifestJson.moves.find(candidate => candidate.canonicalId === 'Hydro Cannon')!
    expect(row.conformanceEvidence.notApplicable).toEqual([{
      evidenceClass: 'immunity',
      reason: 'The frozen type chart has no type immune to Water damage; broader ability interactions remain separately unassessed.',
    }])
    expect(row.conformanceEvidence.requirementTags).not.toContain('branch.immunity')
  })

  it('accepts one through five direct Frenzy Plant targets and rejects a sixth or out-of-range target before RNG', () => {
    const positions = [
      { x: 5, y: 0, z: 5 },
      { x: 6, y: 0, z: 5 },
      { x: 7, y: 0, z: 5 },
      { x: 4, y: 0, z: 4 },
      { x: 4, y: 0, z: 3 },
      { x: 4, y: 0, z: 2 },
    ]
    const targets = positions.map((position, index): TargetProfile => ({
      id: `target-${index + 1}`,
      position,
    }))
    const five = fixture({ moveName: 'Frenzy Plant', targets: targets.slice(0, 5) })
    expect(plan(five, 'op_ma205_frenzy_five').resolution.selectedTargetIds)
      .toEqual(targets.slice(0, 5).map(target => target.id))

    const six = fixture({ moveName: 'Frenzy Plant', targets })
    expect(() => planAuthoritativeMoveState({
      ...six,
      random: () => { throw new Error('six-target rejection must not roll') },
      now: () => NOW,
      operationId: 'op_ma205_frenzy_six',
    })).toThrowError(expect.objectContaining({ code: 'too-many-targets' }))

    const outOfRange = fixture({
      moveName: 'Frenzy Plant',
      targets: [{ id: 'target-a', position: { x: 10, y: 0, z: 5 } }],
    })
    expect(() => planAuthoritativeMoveState({
      ...outOfRange,
      random: () => { throw new Error('range rejection must not roll') },
      now: () => NOW,
      operationId: 'op_ma205_frenzy_range',
    })).toThrowError(expect.objectContaining({ code: 'target-out-of-range' }))
  })

  it.each(MA_205_MOVE_NAMES)(
    '%s rejects Exhaust after a prior Shift spend without mutating source state',
    (moveName) => {
      const input = fixture({ moveName, targets: [defaultTargets(moveName)[0]!] })
      const seeded = spendEncounterMoveResourceCosts(
        input.map.encounterState?.turnResources ?? {},
        {
          placementId: ACTOR_ID,
          canonicalMoveId: 'Earlier Shift',
          resolutionId: 'resolution.earlier-shift',
          sourceOperationId: 'op_earlier_shift',
          costs: [{
            id: 'earlier.cost.shift',
            phase: 'pay',
            cost: { kind: 'action-resource', resource: 'shift', amount: 1 },
          }],
          movementBudget: null,
          movementDistance: 0,
          round: 1,
          turn: null,
          actedThisRound: false,
        },
      )
      const map: TabletopMap = {
        ...deepCloneJson(input.map),
        encounterState: {
          ...deepCloneJson(input.map.encounterState!),
          turnResources: seeded.resources,
        },
      }
      const snapshot = deepCloneJson({ map, sheets: [...input.pokemonSheets] })
      expect(() => planAuthoritativeMoveState({
        ...input,
        map,
        random: randomSequence(input.randomValues),
        now: () => NOW,
        operationId: safeOperationId(moveName, 'exhaust_reject'),
      })).toThrowError(expect.objectContaining({
        code: 'move-resource-unavailable',
        message: expect.stringContaining('exhaust-prerequisite-failed'),
      }))
      expect({ map, sheets: [...input.pokemonSheets] }).toEqual(snapshot)
    },
  )

  it.each(MA_205_MOVE_NAMES)(
    '%s replays an accepted duplicate without rerolling, spending, damaging, or publishing twice',
    async (moveName) => {
      const input = fixture({
        moveName,
        targets: [defaultTargets(moveName)[0]!],
        naturalResults: [10],
      })
      const harness = openHarness(input)
      const command = commandFor(input, safeOperationId(moveName, 'duplicate'))
      const first = await executeCommand(harness, command, {
        random: randomSequence(input.randomValues),
      })
      expect(first.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
      expect(first.move).toMatchObject({
        canonicalMoveName: moveName,
        selectedTargetIds: ['target-a'],
        transaction: { attackedTargetIds: ['target-a'], hitTargetIds: ['target-a'] },
      })
      const committedMap = deepCloneJson(harness.maps.getBySlug(input.map.slug))
      const committedSheets = deepCloneJson(harness.sheets.list())
      const committedEvents = deepCloneJson(harness.events)

      const duplicate = await executeCommand(harness, command, {
        random: () => { throw new Error('duplicate MA-205 command must not reroll') },
        planner: () => { throw new Error('duplicate MA-205 command must not replan') },
      })
      expect(duplicate).toEqual(first)
      expect(harness.maps.getBySlug(input.map.slug)).toEqual(committedMap)
      expect(harness.sheets.list()).toEqual(committedSheets)
      expect(harness.events).toEqual(committedEvents)
      expect(acceptedEventCount(harness.events)).toBe(1)
      expect(flagCount(committedMap, ACTOR_ID, ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID)).toBe(1)
      expect(flagCount(committedMap, ACTOR_ID, ENCOUNTER_EXHAUST_COMMAND_FLAG_ID)).toBe(1)
    },
  )

  it.each(MA_205_MOVE_NAMES)(
    '%s rejects a raced target revision without partial damage, usage, Exhaust, op, or realtime state',
    async (moveName) => {
      const input = fixture({
        moveName,
        targets: [defaultTargets(moveName)[0]!],
        naturalResults: [10],
      })
      const harness = openHarness(input)
      const command = commandFor(input, safeOperationId(moveName, 'stale'))
      const mapBefore = deepCloneJson(harness.maps.getBySlug(input.map.slug))
      const actorBefore = deepCloneJson(harness.sheets.getByRef('pokemon', 'actor'))
      let racedTarget: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (plannerInput) => {
        const result = planAuthoritativeMoveState({
          ...plannerInput,
          random: randomSequence(input.randomValues),
        })
        expect(result.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target-a' }))
        const current = harness.sheets.getByRef('pokemon', 'target-a')
        if (!current) throw new Error('Missing MA-205 raced target sheet.')
        racedTarget = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: 'target-a',
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
      expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toEqual(racedTarget)
      expect(harness.ops.getOpResult(input.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )
})
