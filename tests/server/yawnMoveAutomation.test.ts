import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { dragonRageV2Fixture } from '../fixtures/moveAutomation/dragonRageV2'
import {
  allYawnV2SemanticScenarios,
  YAWN_V2_SEMANTIC_SCENARIOS,
} from '../fixtures/moveAutomation/yawnV2'
import {
  runAndAssertMoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import { planAuthoritativeMoveState } from '~~/server/domain/planAuthoritativeMoveState'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  planAuthoritativeMoveSwitch,
} from '~~/server/domain/moveAutomation/planMoveSwitch'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { YAWN_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/yawn'
import {
  cleanupYawnEffectsForKnockouts,
  isYawnDrowsyEffect,
} from '~~/server/domain/moveAutomation/yawn'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import {
  LivePlayIntegrationHarness,
  assertAccepted,
} from './livePlayIntegrationHarness'

const yawnRow = manifestJson.moves.find(row => row.canonicalId === 'Yawn')!
const harnesses: LivePlayIntegrationHarness[] = []

const actor = { role: 'gm' as const, clientId: 'gm-yawn-client' }

const placement = (input: {
  readonly id: string
  readonly sheetKind?: 'pokemon' | 'trainer'
  readonly sheetSlug: string
  readonly x: number
  readonly initiative: number
  readonly sideId?: string
}): SheetPlacement => ({
  id: input.id,
  sheetKind: input.sheetKind ?? 'pokemon',
  sheetSlug: input.sheetSlug,
  position: { x: input.x, y: 0, z: 1 },
  initiative: input.initiative,
  ...(input.sideId ? { sideId: input.sideId } : {}),
})

const liveMap = (options: {
  readonly electricTerrain?: boolean
  readonly effects?: readonly EncounterEffect[]
  readonly includeTrainer?: boolean
} = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'integration-arena',
  name: 'Yawn Lifecycle Arena',
  folder: '',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: {
    weather: [],
    terrains: options.electricTerrain
      ? [{ kind: 'electric', scope: 'field', source: 'Electric Terrain' }]
      : [],
    rooms: [],
  },
  placements: [
    placement({
      id: 'actor-token',
      sheetSlug: 'actor-mon',
      x: 1,
      initiative: 20,
      sideId: 'side-red',
    }),
    placement({
      id: 'target-token',
      sheetSlug: 'target-mon',
      x: 2,
      initiative: 10,
      sideId: 'side-blue',
    }),
    ...(options.includeTrainer
      ? [placement({
          id: 'trainer-token',
          sheetKind: 'trainer',
          sheetSlug: 'trainer-sheet',
          x: 0,
          initiative: 5,
          sideId: 'side-red',
        })]
      : []),
  ],
  lights: [],
  initiative: {
    activeId: 'actor-token',
    round: 1,
    manualOrderIds: ['actor-token', 'target-token'],
  },
  activeScene: { name: 'Yawn Scene', startedAt: 100 },
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      'side-red': {
        id: 'side-red',
        label: 'Red',
        color: '#ff0000',
        status: 'active',
      },
      'side-blue': {
        id: 'side-blue',
        label: 'Blue',
        color: '#0000ff',
        status: 'active',
      },
    },
    effects: [...(options.effects ?? [])],
  },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
})

const pokemonSheet = (input: {
  readonly slug: string
  readonly species: string
  readonly moves?: CharacterSheet['movelist']
}): PersistedSheet => ({
  kind: 'pokemon',
  slug: input.slug,
  revision: 0,
  updatedAt: 1_700_000_000_000,
  sheet: {
    slug: input.slug,
    nickname: input.species,
    species: input.species,
    level: 20,
    revision: 0,
    updatedAt: 1_700_000_000_000,
    types: ['Normal'],
    stats: {
      atk: { stage: 0 },
      def: { stage: 0 },
      satk: { stage: 0 },
      sdef: { stage: 0 },
      spd: { stage: 0 },
    },
    combatStages: { acc: 0 },
    combat: { currentHp: 50, injuries: 0, conditions: [] },
    movelist: [...(input.moves ?? [])],
  },
})

const liveSheets = (): readonly PersistedSheet[] => [
  pokemonSheet({ slug: 'actor-mon', species: 'Slowpoke', moves: [{ name: 'Yawn' }] }),
  pokemonSheet({ slug: 'target-mon', species: 'Snorlax' }),
]

const yawnIntent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Yawn',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const drowsyEffect = (overrides: {
  readonly sourcePlacementId?: string
  readonly targetPlacementId?: string
} = {}): EncounterEffect => parseEncounterEffect({
  id: 'condition.11111111111111111111111111111111',
  kind: 'condition',
  source: {
    operationId: 'yawn.drowsy',
    moveId: 'move.yawn',
    placementId: overrides.sourcePlacementId ?? 'actor-token',
  },
  affected: {
    placementIds: [overrides.targetPlacementId ?? 'target-token'],
    sideIds: [],
    cells: [],
  },
  createdRound: 1,
  createdTurn: 0,
  duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'refresh', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['condition'],
  payload: { conditionId: 'yawn', action: 'apply', saveTiming: null },
  dispel: { policy: 'matching-tags', tags: ['condition'] },
  transferPolicy: 'retain',
  suppression: { sources: [] },
})

const resolveYawn = async (harness: LivePlayIntegrationHarness, opId: string) => {
  const command = harness.resolveMoveCommand({
    opId,
    baseRevision: 0,
    intent: yawnIntent(),
    candidateScopePlacementIds: ['target-token'],
  })
  return {
    command,
    first: await harness.resolveMove({ actor, command }),
    duplicate: await harness.resolveMove({ actor, command }),
  }
}

const advanceTargetTurn = async (harness: LivePlayIntegrationHarness) => {
  const toTarget = await harness.nextInitiative({
    actor,
    command: harness.nextInitiativeCommand({
      opId: 'op_yawn_to_target',
      baseRevision: 1,
      orderIds: ['actor-token', 'target-token'],
      activeId: 'actor-token',
      round: 1,
    }),
  })
  assertAccepted(toTarget.result)

  const command = harness.nextInitiativeCommand({
    opId: 'op_yawn_target_turn_end',
    baseRevision: 2,
    orderIds: ['actor-token', 'target-token'],
    activeId: 'target-token',
    round: 1,
  })
  const first = await harness.nextInitiative({ actor, command })
  const duplicate = await harness.nextInitiative({ actor, command })
  return { first, duplicate }
}

const persistentConditions = async (
  harness: LivePlayIntegrationHarness,
): Promise<readonly string[]> => {
  const stored = await harness.readSheet('pokemon', 'target-mon')
  return ((stored?.sheet.combat as { conditions?: readonly string[] } | undefined)?.conditions ?? [])
}

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

describe('Yawn native MoveSpec and lifecycle automation', () => {
  it('selects the reviewed complete runtime and links all conformance evidence', () => {
    expect(yawnRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: 'c1779bbbe5b46a813822b178358985b82aafbb6bf9b39c97b75c071749c9663e',
        sourceModule: 'server/domain/moveAutomation/specs/yawn.ts',
      },
      capabilityTags: ['conditions.typed', 'lifecycle.effects'],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(yawnRow.scenarioIds).toEqual(
      YAWN_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(yawnRow.conformanceEvidence.scenarios).toEqual(YAWN_V2_SEMANTIC_SCENARIOS)
    expect(registeredMoveAutomationRuntimeFor('Yawn')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: YAWN_MOVE_SPEC },
      definitionHash: yawnRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Yawn' }),
    )
  })

  it.each(allYawnV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)
      expect(result.plan.value?.nextMap.encounterState?.effects).toHaveLength(1)
      expect(isYawnDrowsyEffect(
        result.plan.value!.nextMap.encounterState!.effects[0]!,
      )).toBe(true)
    },
  )

  it('persists drowsy across reconnect, triggers Sleep at the target turn end, and replays both commands once', async () => {
    const harness = LivePlayIntegrationHarness.create({ map: liveMap(), sheets: liveSheets() })
    harnesses.push(harness)
    const resolved = await resolveYawn(harness, 'op_yawn_delayed_live')

    expect(assertAccepted(resolved.first.result)).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(resolved.duplicate.result).toEqual(resolved.first.result)
    expect(harness.operationRecordCount()).toBe(1)
    const afterMove = await harness.readMap()
    expect(afterMove?.moveUsage?.byPlacementId['actor-token']?.yawn?.uses).toBe(1)
    const effect = afterMove?.encounterState?.effects.find(isYawnDrowsyEffect)
    expect(effect).toMatchObject({
      affected: { placementIds: ['target-token'] },
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
    })
    expect(await persistentConditions(harness)).toEqual([])
    expect(projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: afterMove?.encounterState?.effects,
      target: { placementId: 'target-token' },
    }).conditions).toEqual(['Yawn'])

    const refreshed = await harness.loadClient('refreshed-yawn-client')
    expect(refreshed.map?.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(true)
    refreshed.disconnect()

    const toTarget = await harness.nextInitiative({
      actor,
      command: harness.nextInitiativeCommand({
        opId: 'op_yawn_to_target',
        baseRevision: 1,
        orderIds: ['actor-token', 'target-token'],
        activeId: 'actor-token',
        round: 1,
      }),
    })
    expect(assertAccepted(toTarget.result)).toMatchObject({ previousRevision: 1, revision: 2 })
    await refreshed.reconnect()
    expect(refreshed.map?.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(true)

    const command = harness.nextInitiativeCommand({
      opId: 'op_yawn_target_turn_end',
      baseRevision: 2,
      orderIds: ['actor-token', 'target-token'],
      activeId: 'target-token',
      round: 1,
    })
    const due = await harness.nextInitiative({ actor, command })
    const duplicateDue = await harness.nextInitiative({ actor, command })

    const acceptedDue = assertAccepted(due.result)
    expect(acceptedDue).toMatchObject({ previousRevision: 2, revision: 3 })
    expect(duplicateDue.result).toEqual(due.result)
    const lifecycle = acceptedDue.patches.find(
      patch => patch.type === 'map.initiative',
    )?.payload as { lifecycle?: { operationIds?: readonly string[] } } | undefined
    expect(lifecycle?.lifecycle?.operationIds).toEqual([
      expect.stringMatching(/^yawn\.sleep\.[a-f0-9]{32}$/),
    ])
    expect(await persistentConditions(harness)).toEqual(['Sleep'])
    expect((await harness.readMap())?.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(false)
    expect(refreshed.map?.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(false)
    expect(harness.operationRecordCount()).toBe(3)
  })

  it('rechecks current Sleep immunity when drowsy becomes due and still removes Yawn', async () => {
    const harness = LivePlayIntegrationHarness.create({
      map: liveMap({ electricTerrain: true }),
      sheets: liveSheets(),
    })
    harnesses.push(harness)
    const resolved = await resolveYawn(harness, 'op_yawn_immune_live')
    assertAccepted(resolved.first.result)
    const due = await advanceTargetTurn(harness)

    expect(assertAccepted(due.first.result)).toMatchObject({ previousRevision: 2, revision: 3 })
    expect(due.duplicate.result).toEqual(due.first.result)
    expect(await persistentConditions(harness)).toEqual([])
    expect((await harness.readSheet('pokemon', 'target-mon'))?.revision).toBe(0)
    expect((await harness.readMap())?.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(false)
  })

  it('removes drowsy when its target switches but retains it when only the source switches', () => {
    const effect = drowsyEffect()
    const map = liveMap({ effects: [effect], includeTrainer: true })
    const replacement = (id: string, source: SheetPlacement): SheetPlacement => ({
      ...source,
      id,
      sheetSlug: `${id}-sheet`,
    })
    const target = map.placements.find(entry => entry.id === 'target-token')!
    const source = map.placements.find(entry => entry.id === 'actor-token')!

    const targetSwitch = planAuthoritativeMoveSwitch({
      map,
      transition: {
        operationId: 'operation.switch-target',
        recalledPlacementId: target.id,
        sentOutPlacement: replacement('target-replacement', target),
        trainerPlacementId: 'trainer-token',
        trainerSheetSlug: 'trainer-sheet',
        positionPolicy: 'recalled-position',
        initiativePolicy: 'inherit-slot',
        stateTransferPolicy: 'none',
      },
    })
    const sourceSwitch = planAuthoritativeMoveSwitch({
      map,
      transition: {
        operationId: 'operation.switch-source',
        recalledPlacementId: source.id,
        sentOutPlacement: replacement('source-replacement', source),
        trainerPlacementId: 'trainer-token',
        trainerSheetSlug: 'trainer-sheet',
        positionPolicy: 'recalled-position',
        initiativePolicy: 'inherit-slot',
        stateTransferPolicy: 'none',
      },
    })

    expect(targetSwitch.nextMap.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(false)
    expect(targetSwitch.cleanupEventIds).toHaveLength(1)
    expect(sourceSwitch.nextMap.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(true)
    expect(sourceSwitch.cleanupEventIds).toEqual([])
  })

  it('removes drowsy only when its affected target is knocked out', () => {
    const effect = drowsyEffect()
    const map = liveMap({ effects: [effect] })

    const sourceKo = cleanupYawnEffectsForKnockouts({
      map,
      placementIds: ['actor-token'],
    })
    const targetKo = cleanupYawnEffectsForKnockouts({
      map,
      placementIds: ['target-token'],
    })

    expect(sourceKo.changed).toBe(false)
    expect(sourceKo.map.encounterState?.effects).toEqual([effect])
    expect(targetKo.changed).toBe(true)
    expect(targetKo.removedEffectIds).toEqual([effect.id])
    expect(targetKo.map.encounterState?.effects).toEqual([])
    expect(map.encounterState?.effects).toEqual([effect])

    const fixture = dragonRageV2Fixture('dragon-rage.v2-hit')
    const target = fixture.pokemonSheets.get('target')!
    const pokemonSheets = new Map(fixture.pokemonSheets)
    pokemonSheets.set('target', {
      ...target,
      combat: { ...target.combat, currentHp: 10 },
    })
    const plan = planAuthoritativeMoveState({
      ...fixture,
      map: {
        ...fixture.map,
        encounterState: {
          ...createEmptyEncounterState(),
          effects: [effect],
        },
      },
      pokemonSheets,
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      now: () => 5_000,
      operationId: 'op_yawn_target_ko',
    })
    expect(plan.resolution.transaction.hpUpdates.find(
      update => update.id === 'target-token',
    )?.currentHp).toBeLessThanOrEqual(0)
    expect(plan.nextMap.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(false)
  })

  it('cleans drowsy at scene end without applying Sleep and replays scene cleanup once', async () => {
    const harness = LivePlayIntegrationHarness.create({ map: liveMap(), sheets: liveSheets() })
    harnesses.push(harness)
    const resolved = await resolveYawn(harness, 'op_yawn_scene_live')
    assertAccepted(resolved.first.result)
    const command = harness.setSceneCommand({
      opId: 'op_yawn_scene_end',
      baseRevision: 1,
      name: null,
    })

    const ended = await harness.setScene({ actor, command })
    const duplicate = await harness.setScene({ actor, command })

    expect(assertAccepted(ended.result)).toMatchObject({ previousRevision: 1, revision: 2 })
    expect(duplicate.result).toEqual(ended.result)
    expect((await harness.readMap())?.encounterState?.effects.some(isYawnDrowsyEffect)).toBe(false)
    expect(await persistentConditions(harness)).toEqual([])
    expect(harness.operationRecordCount()).toBe(2)
  })
})
