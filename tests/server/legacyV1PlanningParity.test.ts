import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import type { MoveAutomationManifest } from '#shared/moveAutomation/manifest'
import { adaptV1Transaction } from '~~/server/domain/moveAutomation/adaptV1Transaction'
import { buildLegacyV1MoveResolutionTrace } from '~~/server/domain/moveAutomation/legacyV1Trace'
import {
  createMoveAutomationRuntimeRegistry,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type {
  MoveAutomationAreaTemplate,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { applyMoveFieldEffectToFieldEffects, cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { applyMapHazardPlacement } from '~/utils/mapHazards'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
} from '~/utils/move-automation/registry'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { appendMoveAutomationLogEntry } from '~/utils/moveAutomationLog'
import {
  createLegacyV1PlanningState,
  runLegacyV1PlanningParity,
  runLegacyV1ProjectionParity,
  type LegacyV1PlanningParityResult,
} from '../fixtures/moveAutomation/legacyV1PlanningParity'

const legacyRuntimeRegistryFor = (canonicalId: string) => {
  const manifest = structuredClone(manifestJson) as unknown as MoveAutomationManifest
  const row = manifest.moves.find(move => move.canonicalId === canonicalId)!
  const legacy = legacyFingerprintsJson.entries.find(
    entry => entry.canonicalId === canonicalId,
  )!
  ;(row as { runtime: unknown }).runtime = {
    kind: 'legacy-v1',
    version: legacy.version,
    definitionHash: legacy.definitionHash,
    sourceModule: legacy.sourceModule,
  }
  return createMoveAutomationRuntimeRegistry({
    manifest,
    legacySources: EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
    moveSpecs: REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  })
}

const legacyDragonRageRuntimeRegistry = legacyRuntimeRegistryFor('Dragon Rage')
const legacySwordsDanceRuntimeRegistry = legacyRuntimeRegistryFor('Swords Dance')

const moveIntent = (
  overrides: Omit<ResolveMoveIntent, 'schemaVersion'>,
): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  ...overrides,
})

const placement = (
  id: string,
  sheetSlug: string,
  position: GridAnchor,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position,
})

const mapFixture = (
  placements: SheetPlacement[],
  overrides: Partial<TabletopMap> = {},
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'legacy-v1-parity',
  name: 'Legacy v1 Parity',
  revision: 7,
  dimensions: { x: 10, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  placements,
  lights: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  activeScene: { name: 'Parity Scene', startedAt: 500 },
  initiative: { activeId: 'actor-token', round: 3 },
  metadata: { note: 'preserve parity fixture metadata' },
  createdAt: 100,
  updatedAt: 200,
  ...overrides,
})

const characterSheet = (
  slug: string,
  moves: CharacterSheetMove[] = [],
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  revision: 3,
  nickname: slug,
  species: slug === 'actor' ? 'Pikachu' : 'Snorlax',
  level: 20,
  movelist: moves,
  combat: { currentHp: 80 },
  stats: {
    atk: { stage: 0 },
    def: { stage: 0 },
    satk: { stage: 0 },
    sdef: { stage: 0 },
    spd: { stage: 0 },
  },
  combatStages: { acc: 0 },
  ...overrides,
})

const sheetMap = (
  move: CharacterSheetMove,
  targetSlugs: readonly string[] = [],
  overrides: Readonly<Record<string, Partial<CharacterSheet>>> = {},
): Map<string, CharacterSheet> => new Map([
  ['actor', characterSheet('actor', [move], overrides.actor)],
  ...targetSlugs.map((slug): [string, CharacterSheet] => [
    slug,
    characterSheet(slug, [], overrides[slug]),
  ]),
])

const withRegisteredLegacyScript = <Result>(
  script: MoveAutomationScript,
  run: () => Result,
): Result => {
  const scripts = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
  const previous = scripts.get(script.moveName)
  scripts.set(script.moveName, script)
  try {
    return run()
  }
  finally {
    if (previous) scripts.set(script.moveName, previous)
    else scripts.delete(script.moveName)
  }
}

const lineTemplate: MoveAutomationAreaTemplate = {
  kind: 'line',
  size: 3,
  label: 'Line 3',
}

const mixedAreaScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Swift',
  version: 1,
  targetMode: 'multi-target',
  targetCount: null,
  damaging: false,
  requiresAccuracy: true,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: 2,
  range: lineTemplate.label,
  effect: 'Differential fixture with mixed hit, miss, and immunity outcomes.',
  keywords: [lineTemplate.label, 'Sonic'],
  criticalRange: null,
  areaTemplates: [lineTemplate],
  conditionSuggestions: [],
  stageSuggestions: [{
    recipient: 'target',
    key: 'def',
    delta: -1,
    label: 'Defense down',
  }],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const passTemplate: MoveAutomationAreaTemplate = {
  kind: 'pass',
  size: 4,
  label: 'Pass 4',
}

const passScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Aqua Tail',
  version: 1,
  targetMode: 'multi-target',
  targetCount: null,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Normal',
  ac: 2,
  range: 'Melee, Pass',
  effect: 'Differential fixture for authoritative Pass planning.',
  keywords: ['Pass 4'],
  criticalRange: null,
  areaTemplates: [passTemplate],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

type PlanningCoverage =
  | 'self'
  | 'single-target'
  | 'area'
  | 'pass'
  | 'miss'
  | 'immunity'
  | 'direct-hp'
  | 'field'
  | 'hazard'
  | 'usage'

interface PlanningParityScenario {
  readonly name: string
  readonly coverage: readonly PlanningCoverage[]
  readonly run: () => LegacyV1PlanningParityResult
  readonly verify: (result: LegacyV1PlanningParityResult) => void
}

const PLANNING_SCENARIOS: readonly PlanningParityScenario[] = [
  {
    name: 'self stage change and EOT usage',
    coverage: ['self', 'usage'],
    run: () => runLegacyV1PlanningParity({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
      ]),
      pokemonSheets: sheetMap({ name: 'Swords Dance' }),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Swords Dance',
        selection: { kind: 'self' },
      }),
      randomValues: [],
      runtimeRegistry: legacySwordsDanceRuntimeRegistry,
    }),
    verify: ({ adaptedPlan }) => {
      expect(adaptedPlan.resolution.transaction.combatStageUpdates).toEqual([
        {
          id: 'actor-token',
          stages: { atk: 2, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
        },
      ])
      expect(adaptedPlan.usage).toMatchObject({ tracking: 'map', uses: 1 })
      expect(adaptedPlan.stateChanges.changes.map(change => change.kind)).toEqual([
        'map-move-usage',
        'map-metadata',
        'sheet-state',
        'encounter-state',
      ])
    },
  },
  {
    name: 'single-target damaging hit',
    coverage: ['single-target'],
    run: () => runLegacyV1PlanningParity({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
        placement('target-token', 'target', { x: 2, y: 0, z: 1 }),
      ]),
      pokemonSheets: sheetMap({ name: 'Tackle' }, ['target']),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      }),
      randomValues: [0.5, 0],
    }),
    verify: ({ adaptedPlan }) => {
      expect(adaptedPlan.resolution.transaction).toMatchObject({
        attackedTargetIds: ['target-token'],
        hitTargetIds: ['target-token'],
      })
      expect(adaptedPlan.resolution.feedback?.id).toBe('adapted-generated-id-1')
      const targetWrite = adaptedPlan.sheetWrites.find(write => write.slug === 'target')
      expect((targetWrite?.nextSheet as CharacterSheet).combat?.currentHp).toBeLessThan(80)
      expect(adaptedPlan.stateChanges.groups.placements).toHaveLength(1)
    },
  },
  {
    name: 'single-target miss with no target mutation',
    coverage: ['miss'],
    run: () => runLegacyV1PlanningParity({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
        placement('target-token', 'target', { x: 2, y: 0, z: 1 }),
      ]),
      pokemonSheets: sheetMap({ name: 'Tackle' }, ['target']),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      }),
      randomValues: [0],
    }),
    verify: ({ adaptedPlan }) => {
      expect(adaptedPlan.resolution.transaction).toMatchObject({
        attackedTargetIds: ['target-token'],
        hitTargetIds: [],
        hpUpdates: [],
      })
      expect(adaptedPlan.sheetWrites).toEqual([])
      expect(adaptedPlan.stateChanges.groups.sheets).toEqual([])
    },
  },
  {
    name: 'area hit, miss, and whole-move immunity',
    coverage: ['area', 'immunity'],
    run: () => withRegisteredLegacyScript(mixedAreaScript(), () => runLegacyV1PlanningParity({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
        placement('hit-token', 'hit', { x: 2, y: 0, z: 1 }),
        placement('miss-token', 'miss', { x: 3, y: 0, z: 1 }),
        placement('immune-token', 'immune', { x: 4, y: 0, z: 1 }),
      ]),
      pokemonSheets: sheetMap({ name: 'Swift' }, ['hit', 'miss', 'immune'], {
        immune: { abilities: [{ name: 'Soundproof' }] },
      }),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Swift',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId(lineTemplate),
          direction: 'east',
        },
      }),
      randomValues: [0.5, 0, 0.5],
    })),
    verify: ({ adaptedPlan }) => {
      expect(adaptedPlan.resolution.transaction).toMatchObject({
        attackedTargetIds: ['hit-token', 'miss-token', 'immune-token'],
        hitTargetIds: ['hit-token', 'immune-token'],
      })
      expect(adaptedPlan.resolution.transaction.combatStageUpdates.map(update => update.id)).toEqual([
        'hit-token',
      ])
      expect(adaptedPlan.sheetWrites.map(write => write.slug)).toEqual(['hit'])
    },
  },
  {
    name: 'Pass movement and crossed-target damage',
    coverage: ['pass'],
    run: () => withRegisteredLegacyScript(passScript(), () => runLegacyV1PlanningParity({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
        placement('target-token', 'target', { x: 2, y: 0, z: 1 }),
        placement('occupied-end', 'blocker', { x: 5, y: 0, z: 1 }),
      ], {
        dimensions: { x: 8, y: 3, z: 4 },
      }),
      pokemonSheets: sheetMap({ name: 'Aqua Tail' }, ['target', 'blocker']),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Aqua Tail',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId(passTemplate),
          direction: 'east',
        },
      }),
      randomValues: [0.5, 0, 0],
    })),
    verify: ({ adaptedPlan }) => {
      expect(adaptedPlan.resolution.movement).toMatchObject({
        kind: 'pass',
        from: { x: 1, y: 0, z: 1 },
      })
      const actor = adaptedPlan.nextMap.placements.find(item => item.id === 'actor-token')
      expect(actor?.position).toEqual(adaptedPlan.resolution.movement?.destination)
      expect(adaptedPlan.stateChanges.groups.placements[0]?.changes[0]).toMatchObject({
        sourceOperationId: 'legacy-v1.movement.1',
      })
    },
  },
  {
    name: 'fixed direct HP loss',
    coverage: ['direct-hp'],
    run: () => runLegacyV1PlanningParity({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
        placement('target-token', 'target', { x: 3, y: 0, z: 1 }),
      ]),
      pokemonSheets: sheetMap({ name: 'Dragon Rage' }, ['target'], {
        target: { combat: { currentHp: 50 } },
      }),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Dragon Rage',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      }),
      randomValues: [0.5],
      runtimeRegistry: legacyDragonRageRuntimeRegistry,
    }),
    verify: ({ adaptedPlan }) => {
      expect(adaptedPlan.resolution.transaction.hpUpdates).toEqual([
        expect.objectContaining({ id: 'target-token', currentHp: 35 }),
      ])
      expect(adaptedPlan.resolution.rollLedger).toHaveLength(1)
      expect(adaptedPlan.stateChanges.groups.sheets[0]?.changes[0]).toMatchObject({
        sourceOperationId: 'legacy-v1.hp.1',
      })
    },
  },
]

const BATTLEFIELD_PLANNED_AT = 1_900_000_000_303

const battlefieldScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Battlefield Adapter Fixture',
  version: 1,
  targetMode: 'field',
  targetCount: null,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: 'Field, Hazard',
  effect: 'Synthetic adapter-boundary fixture for legacy map effects.',
  keywords: ['Field', 'Hazard'],
  criticalRange: null,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const battlefieldTransaction = (): MoveAutomationTransaction => ({
  userId: 'actor-token',
  userName: 'Pikachu',
  moveName: 'Battlefield Adapter Fixture',
  scriptKind: 'explicit',
  scriptVersion: 1,
  attackedTargetIds: [],
  hitTargetIds: [],
  hpUpdates: [],
  conditionUpdates: [],
  combatStageUpdates: [],
  hazardsToAdd: [{ kind: 'spikes', x: 3, y: 0, z: 2, owner: 'Pikachu' }],
  fieldEffectsToApply: [{ kind: 'weather', value: 'sunny', source: 'Battlefield Adapter Fixture' }],
  logLines: ['Pikachu changed the battlefield.'],
})

const battlefieldNextMap = (
  previousMap: TabletopMap,
  transaction: MoveAutomationTransaction,
): TabletopMap => {
  const hazardResult = applyMapHazardPlacement({
    hazards: previousMap.hazards ?? [],
    hazard: transaction.hazardsToAdd[0]!,
    dimensions: previousMap.dimensions,
  })
  if (!hazardResult.ok) throw new Error(hazardResult.message)

  const fieldResult = applyMoveFieldEffectToFieldEffects(
    previousMap.fieldEffects,
    transaction.fieldEffectsToApply[0]!,
  )
  if (!fieldResult.ok) throw new Error(fieldResult.message)

  return {
    ...structuredClone(previousMap),
    revision: 8,
    updatedAt: BATTLEFIELD_PLANNED_AT,
    hazards: [...structuredClone(hazardResult.hazards)],
    fieldEffects: structuredClone(fieldResult.fieldEffects),
    metadata: appendMoveAutomationLogEntry(previousMap.metadata, transaction, {
      now: () => BATTLEFIELD_PLANNED_AT,
    }),
  }
}

describe('legacy v1 planning differential parity', () => {
  it.each(PLANNING_SCENARIOS)('$name', (scenario) => {
    const result = scenario.run()

    expect(result.adaptedState).not.toEqual(result.legacyState)
    expect(result.normalizedAdaptedState).toEqual(result.normalizedLegacyState)
    expect(result.normalizedAdaptedEvidence).toEqual(result.normalizedLegacyEvidence)
    expect(result.adaptedPlan.resolution.auditTrace.program.runtimeKind).toBe('legacy-v1')
    scenario.verify(result)
  })

  it('projects legacy field and hazard planning through identical typed state', () => {
    const previousMap = mapFixture([
      placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
    ], {
      fieldEffects: {
        weather: [{ kind: 'rainy', source: 'Previous Weather' }],
        terrains: [],
        rooms: [],
      },
    })
    const transaction = battlefieldTransaction()
    const nextMap = battlefieldNextMap(previousMap, transaction)
    const trace = buildLegacyV1MoveResolutionTrace({
      program: {
        canonicalId: transaction.moveName,
        runtimeKind: 'legacy-v1',
        runtimeVersion: 1,
        definitionHash: 'a'.repeat(64),
      },
      ruleset: {
        rulesetId: 'legacy-v1-parity-rules',
        sourceDataSha256: 'b'.repeat(64),
      },
      actorPlacementId: transaction.userId,
      selectionKind: 'self',
      selectedTargetIds: [],
      script: battlefieldScript(),
      transaction,
      rollLedger: [],
    })
    const adapted = adaptV1Transaction({
      transaction,
      trace,
      previousMap,
      expectedMapRevision: 7,
      mapChanges: {
        hazards: {
          previous: structuredClone(previousMap.hazards ?? []),
          current: structuredClone(nextMap.hazards ?? []),
        },
        fieldEffects: {
          previous: cloneMapFieldEffects(previousMap.fieldEffects),
          current: cloneMapFieldEffects(nextMap.fieldEffects),
        },
        metadata: {
          previous: structuredClone(previousMap.metadata),
          current: structuredClone(nextMap.metadata),
        },
      },
      sheetWrites: [],
    })

    const parity = runLegacyV1ProjectionParity({
      initial: createLegacyV1PlanningState(
        previousMap,
        new Map<string, CharacterSheet>([['actor', characterSheet('actor')]]),
        new Map<string, TrainerSheet>(),
      ),
      legacy: { previousMap, nextMap, sheetWrites: [] },
      adapted: {
        previousMap,
        revision: 8,
        plannedAt: BATTLEFIELD_PLANNED_AT,
        stateChanges: adapted.stateChanges,
      },
      legacyPlannedAt: BATTLEFIELD_PLANNED_AT,
    })

    expect(parity.normalizedAdaptedState).toEqual(parity.normalizedLegacyState)
    expect(adapted.stateChanges.changes.map(change => change.kind)).toEqual([
      'map-hazards',
      'map-field-effects',
      'map-metadata',
    ])
  })

  it('keeps every required v1 compatibility shape in the differential matrix', () => {
    const covered = new Set<PlanningCoverage>([
      ...PLANNING_SCENARIOS.flatMap(scenario => scenario.coverage),
      'field',
      'hazard',
    ])

    expect([...covered].sort()).toEqual([
      'area',
      'direct-hp',
      'field',
      'hazard',
      'immunity',
      'miss',
      'pass',
      'self',
      'single-target',
      'usage',
    ])
  })
})
