import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { planAuthoritativeMoveState as planAuthoritativeMoveStateProduction } from '../../server/domain/planAuthoritativeMoveState'
import { AuthoritativeMoveResolutionError } from '../../server/domain/resolveAuthoritativeMove'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { passDestinationLogLine } from '~/utils/moveAutomationPass'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationAreaTemplate, MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { transformationEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '~~/server/domain/moveAutomation/handlers/registry'
import type { MoveAutomationRuntimeRegistry } from '~~/server/domain/moveAutomation/registry'

const LEGACY_ONLY_RUNTIME_REGISTRY: MoveAutomationRuntimeRegistry = Object.freeze({
  size: 0,
  handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
  resolve: () => null,
  entries: () => Object.freeze([]),
})

let injectedRuntimeRegistry: MoveAutomationRuntimeRegistry | null = null
const planAuthoritativeMoveState = (
  options: Parameters<typeof planAuthoritativeMoveStateProduction>[0],
) => planAuthoritativeMoveStateProduction({
  ...options,
  ...(injectedRuntimeRegistry ? { runtimeRegistry: injectedRuntimeRegistry } : {}),
})

const moveIntent = (overrides: Omit<ResolveMoveIntent, 'schemaVersion'>): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  ...overrides,
})

const placement = (id: string, sheetSlug = id, position: GridAnchor = { x: 0, y: 0, z: 0 }): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position,
})

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'planner-test',
  name: 'Planner Test',
  revision: 7,
  dimensions: { x: 12, y: 3, z: 12 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
    placement('target-token', 'target', { x: 1, y: 0, z: 0 }),
  ],
  lights: [],
  activeScene: { name: 'Scene A', startedAt: 100 },
  initiative: { activeId: null, round: 1 },
  metadata: { note: 'keep me' },
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

const pokemonSheet = (slug: string, moves: CharacterSheetMove[] = [], overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  revision: 3,
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  combat: { currentHp: 40 },
  movelist: moves,
  ...overrides,
})

const pokemonSheets = (
  actorMoves: CharacterSheetMove[],
  overrides: Record<string, CharacterSheet> = {},
): Map<string, CharacterSheet> => new Map<string, CharacterSheet>([
  ['actor', pokemonSheet('actor', actorMoves, { nickname: 'Actor', combat: { currentHp: 20 } })],
  ['target', pokemonSheet('target', [], { nickname: 'Target', species: 'Snorlax', level: 30, combat: { currentHp: 80 } })],
  ...Object.entries(overrides),
])

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

const moveLog = (map: TabletopMap) => map.metadata?.moveLog as Array<{ lines: string[]; at: number }> | undefined

const mixedAreaTemplate: MoveAutomationAreaTemplate = { kind: 'line', size: 3, label: 'Line 3' }

const mistyConditionScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Pound',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: 'Melee, 1 Target',
  effect: 'The target becomes Burned.',
  keywords: ['Melee', '1 Target'],
  criticalRange: null,
  conditionSuggestions: [{
    recipient: 'target',
    condition: 'Burned',
    label: 'Burned',
  }],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const mixedOutcomeAreaScript = (): MoveAutomationScript => ({
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
  range: mixedAreaTemplate.label,
  effect: 'Authoritative planner target identity test script.',
  keywords: [mixedAreaTemplate.label, 'Sonic'],
  criticalRange: null,
  areaTemplates: [mixedAreaTemplate],
  conditionSuggestions: [],
  stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Defense down' }],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const withRegisteredMoveAutomationScript = async <T>(script: MoveAutomationScript, run: () => T | Promise<T>): Promise<T> => {
  const scripts = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
  const previous = scripts.get(script.moveName)
  const previousRegistry = injectedRuntimeRegistry
  scripts.set(script.moveName, script)
  injectedRuntimeRegistry = LEGACY_ONLY_RUNTIME_REGISTRY
  try {
    return await run()
  } finally {
    injectedRuntimeRegistry = previousRegistry
    if (previous) scripts.set(script.moveName, previous)
    else scripts.delete(script.moveName)
  }
}

describe('planAuthoritativeMoveState', () => {
  it('plans usage, self combat stages, one automation log, revisions, timestamp, and detached output', () => {
    const map = mapFixture()
    const sheets = pokemonSheets([{ name: 'Swords Dance' }], {
      actor: pokemonSheet('actor', [{ name: 'Swords Dance' }], { revision: 4, nickname: 'Actor' }),
    })
    const before = JSON.stringify({ map, sheets: [...sheets.entries()] })

    let nowCalls = 0
    const plan = planAuthoritativeMoveState({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Swords Dance', selection: { kind: 'self' } }),
      random: randomSequence([0]),
      now: () => {
        nowCalls += 1
        return 999
      },
    })

    expect(JSON.stringify({ map, sheets: [...sheets.entries()] })).toBe(before)
    expect(nowCalls).toBe(1)
    expect(plan.previousRevision).toBe(7)
    expect(plan.revision).toBe(8)
    expect(plan.resolution.transaction.attackedTargetIds).toEqual([])
    expect(plan.resolution.transaction.hitTargetIds).toEqual([])
    expect(structuredClone(plan.resolution.transaction)).toMatchObject({ attackedTargetIds: [], hitTargetIds: [] })
    expect(JSON.parse(JSON.stringify(plan.resolution.transaction))).toMatchObject({ attackedTargetIds: [], hitTargetIds: [] })
    expect(plan.nextMap.revision).toBe(8)
    expect(plan.nextMap.updatedAt).toBe(999)
    expect(plan.nextMap.createdAt).toBe(1)
    expect(plan.usage).toMatchObject({ moveKey: 'swords-dance', tracking: 'map', uses: 1 })
    expect(plan.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 4 },
      { kind: 'pokemon', slug: 'target', revision: 3 },
    ])
    expect(plan.resolution.sheetReads).toEqual(plan.sheetReads)
    expect(plan.mapChanges.moveUsage).toBeDefined()
    expect(plan.mapChanges.metadata?.previous).toEqual({ note: 'keep me' })
    expect(plan.mapChanges.encounterState?.current.turnResources['actor-token']).toMatchObject({
      round: 1,
      turn: null,
      actions: { standard: { spent: 1 } },
      reaction: { available: true },
      movement: { spent: 0 },
      oncePerTurnFlags: [
        { id: 'encounter.acted-since-entry' },
        { id: 'move.swords-dance' },
      ],
    })
    expect(plan.stateChanges.changes.map(change => change.kind)).toEqual([
      'sheet-state',
      'map-move-usage',
      'map-metadata',
      'encounter-state',
    ])
    expect(plan.stateChanges.changes.map(change => ({
      kind: change.kind,
      sourceOperationId: change.sourceOperationId,
    }))).toEqual([
      { kind: 'sheet-state', sourceOperationId: 'swords-dance.raise-attack' },
      { kind: 'map-move-usage', sourceOperationId: 'swords-dance.usage' },
      { kind: 'map-metadata', sourceOperationId: 'swords-dance.log-completed' },
      { kind: 'encounter-state', sourceOperationId: 'move.swords-dance.resource-spend' },
    ])
    expect(plan.stateChanges.groups.map).toHaveLength(1)
    expect(plan.stateChanges.groups.encounter).toHaveLength(1)
    expect(plan.stateChanges.groups.sheets).toHaveLength(1)
    expect(plan.stateChanges.expectedRevisions).toEqual([
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor', expectedRevision: 4 },
      { kind: 'map', mapSlug: 'planner-test', expectedRevision: 7 },
    ])
    expect(plan.stateChanges.changes[0]?.compensation).toEqual({
      kind: 'inverse',
      strategy: 'restore-previous-value',
    })
    expect(plan.stateChanges.changes[1]?.compensation).toEqual({
      kind: 'inverse',
      strategy: 'restore-previous-value',
    })
    expect(plan.stateChanges.changes[2]?.compensation).toEqual({
      kind: 'unavailable',
      safety: 'externally-observed',
      reasonCode: 'accepted-log-may-be-observed',
    })
    expect(moveLog(plan.nextMap)).toHaveLength(1)
    expect(moveLog(plan.nextMap)?.[0]?.at).toBe(999)
    expect(moveLog(plan.nextMap)?.[0]?.lines.join('\n')).toContain('Actor used Swords Dance.')
    expect(plan.sheetWrites).toHaveLength(1)
    expect(plan.sheetWrites[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'actor',
      expectedRevision: 4,
      revision: 5,
      placementIds: ['actor-token'],
      changedFields: ['combatStages'],
    })
    expect(plan.sheetWrites[0]?.nextSheet.revision).toBe(5)
    expect((plan.sheetWrites[0]?.nextSheet as CharacterSheet & { updatedAt?: number }).updatedAt).toBe(999)
    expect(plan.nextMap).not.toBe(map)
    expect(plan.previousMap).not.toBe(map)
    expect(plan.mapChanges.metadata?.current).not.toBe(map.metadata)
  })

  it('atomically plans a legacy condition with Misty first-turn suppression', async () => {
    await withRegisteredMoveAutomationScript(mistyConditionScript(), () => {
      const map = mapFixture({
        fieldEffects: {
          weather: [],
          terrains: [{ kind: 'misty', scope: 'field', rounds: 5 }],
          rooms: [],
        },
      })
      const plan = planAuthoritativeMoveState({
        map,
        pokemonSheets: pokemonSheets([{ name: 'Pound' }]),
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Pound',
          selection: { kind: 'single-target', targetPlacementId: 'target-token' },
        }),
        random: randomSequence([]),
        now: () => 999,
      })
      const effect = plan.nextMap.encounterState?.effects.find(candidate => (
        candidate.kind === 'condition' && candidate.payload.action === 'suppress'
      ))

      expect(plan.resolution.terrainConditionProtectionEffects).toEqual([effect])
      expect(plan.resolution.auditTrace.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'operation',
          operationId: 'legacy-v1.terrain-condition-protection.1',
          operationKind: 'temporary-effect',
          recipientIds: ['target-token'],
          outcome: 'applied',
          reasonCode: 'terrain.misty.first-turn-status-protection',
        }),
      ]))
      expect(effect).toMatchObject({
        id: expect.stringMatching(/^condition-protection\.[0-9a-f]{32}$/),
        source: {
          operationId: 'legacy-v1.condition.1',
          moveId: 'move.pound',
          placementId: 'actor-token',
        },
        affected: { placementIds: ['target-token'] },
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
        payload: { conditionId: 'burned', action: 'suppress', saveTiming: null },
      })
      expect((plan.sheetWrites[0]?.nextSheet as CharacterSheet).combat?.conditions)
        .toEqual(['Burned'])
      expect(plan.mapChanges.encounterState?.current.effects).toEqual([effect])
      expect(plan.stateChanges.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'sheet-state',
          sourceOperationId: 'legacy-v1.condition.1',
        }),
        expect.objectContaining({
          kind: 'encounter-state',
          reasonCode: 'move-and-resource-state',
        }),
      ]))
      expect(map.encounterState?.effects ?? []).toEqual([])
    })
  })

  it('removes a target transformation atomically when a legacy move knocks its user out', () => {
    const transformation = parseEncounterEffect({
      ...transformationEncounterEffectFixture(),
      id: 'effect.transformation.target-token',
      source: {
        ...transformationEncounterEffectFixture().source,
        placementId: 'target-token',
      },
      affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
      payload: {
        ...transformationEncounterEffectFixture().payload,
        copiedFromPlacementId: 'actor-token',
      },
    })
    const map = mapFixture({
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [transformation],
      },
    })
    const sheets = pokemonSheets([{ name: 'Pound' }], {
      target: pokemonSheet('target', [], {
        nickname: 'Target',
        species: 'Snorlax',
        level: 30,
        combat: { currentHp: 1 },
      }),
    })

    const plan = planAuthoritativeMoveState({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Pound',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      }),
      random: randomSequence([0.5, 0.5]),
      now: () => 1000,
    })

    expect(plan.resolution.transaction.hpUpdates).toEqual([
      expect.objectContaining({ id: 'target-token' }),
    ])
    expect(plan.resolution.transaction.hpUpdates[0]!.currentHp).toBeLessThanOrEqual(0)
    expect(plan.nextMap.encounterState?.effects).toEqual([])
    expect(plan.mapChanges.encounterState).toMatchObject({
      previous: { effects: [expect.objectContaining({ id: transformation.id })] },
      current: { effects: [] },
    })
    expect(map.encounterState?.effects).toEqual([transformation])
    expect((sheets.get('target')?.combat?.currentHp)).toBe(1)
  })

  it('removes a target transformation when native v2 direct HP loss knocks its user out', () => {
    const transformation = parseEncounterEffect({
      ...transformationEncounterEffectFixture(),
      id: 'effect.transformation.target-token.native',
      source: {
        ...transformationEncounterEffectFixture().source,
        placementId: 'target-token',
      },
      affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
      payload: {
        ...transformationEncounterEffectFixture().payload,
        copiedFromPlacementId: 'actor-token',
      },
    })
    const map = mapFixture({
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [transformation],
      },
    })
    const sheets = pokemonSheets([{ name: 'Dragon Rage' }], {
      target: pokemonSheet('target', [], {
        nickname: 'Target',
        species: 'Snorlax',
        level: 30,
        combat: { currentHp: 1 },
      }),
    })

    const plan = planAuthoritativeMoveState({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Dragon Rage',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      }),
      random: randomSequence([0.5]),
      now: () => 1001,
    })

    expect(plan.resolution.script).toMatchObject({ moveName: 'Dragon Rage', version: 2 })
    expect(plan.resolution.transaction.hpUpdates).toEqual([
      expect.objectContaining({ id: 'target-token' }),
    ])
    expect(plan.resolution.transaction.hpUpdates[0]!.currentHp).toBeLessThanOrEqual(0)
    expect(plan.nextMap.encounterState?.effects).toEqual([])
    expect(plan.stateChanges.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'encounter-state' }),
      expect.objectContaining({ kind: 'sheet-state' }),
    ]))
    expect(map.encounterState?.effects).toEqual([transformation])
  })

  it('produces one target sheet write for a single-target HP move and keeps temporary HP map-local', () => {
    const map = mapFixture({
      temporaryHitPoints: {
        scene: { name: 'Scene A', startedAt: 100 },
        byPlacementId: { 'target-token': 5, unaffected: 7 },
      },
    })
    const sheets = pokemonSheets([{ name: 'Pound' }])

    const plan = planAuthoritativeMoveState({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Pound', selection: { kind: 'single-target', targetPlacementId: 'target-token' } }),
      random: randomSequence([0.5, 0]),
      idFactory: () => 'feedback-id',
      now: () => 1000,
    })

    expect(plan.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 3 },
    ])
    expect(plan.resolution.rollLedger.map((roll) => ({
      rollId: roll.rollId,
      parentEffectId: roll.parentEffectId,
      naturalResult: roll.naturalResult,
      finalValue: roll.finalValue,
    }))).toEqual([
      { rollId: 'pound.accuracy-roll.1', parentEffectId: 'pound.accuracy', naturalResult: 11, finalValue: 11 },
      { rollId: 'pound.damage.roll.1', parentEffectId: 'pound.damage', naturalResult: 1, finalValue: 7 },
    ])
    expect(structuredClone(plan.resolution).rollLedger).toEqual(plan.resolution.rollLedger)
    expect(structuredClone(plan.resolution).auditTrace).toEqual(plan.resolution.auditTrace)
    expect(plan.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'roll', roll: expect.objectContaining({ rollId: 'pound.accuracy-roll.1' }) }),
      expect.objectContaining({ kind: 'operation', operationKind: 'damage', recipientIds: ['target-token'] }),
    ]))
    expect(plan.sheetWrites).toHaveLength(1)
    expect(plan.sheetWrites[0]?.slug).toBe('target')
    expect(plan.sheetWrites[0]?.changedFields).toContain('hp')
    expect((plan.sheetWrites[0]?.previousSheet as CharacterSheet).combat?.currentHp).toBe(80)
    expect((plan.sheetWrites[0]?.nextSheet as CharacterSheet).combat?.currentHp).toBeLessThan(80)
    expect((plan.sheetWrites[0]?.nextSheet as CharacterSheet & { temporaryHp?: number }).temporaryHp).toBeUndefined()
    expect(plan.mapChanges.temporaryHitPoints?.current?.byPlacementId.unaffected).toBe(7)
    expect(plan.mapChanges.placements?.current.find((item) => item.id === 'actor-token')?.facing).toBe('south-east')
    expect(plan.stateChanges.changes.find(change => change.kind === 'map-temporary-hit-points')).toMatchObject({
      sourceOperationId: 'pound.damage',
      reasonCode: 'pound.damage',
    })
    expect(plan.stateChanges.groups.sheets[0]?.changes[0]).toMatchObject({
      sourceOperationId: 'pound.damage',
      reasonCode: 'pound.damage',
    })
  })

  it('clones mixed area hit, miss, and immunity target ids into the state plan', async () => {
    await withRegisteredMoveAutomationScript(mixedOutcomeAreaScript(), () => {
      const map = mapFixture({
        placements: [
          placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
          placement('target-token', 'target', { x: 1, y: 0, z: 0 }),
          placement('miss-token', 'miss', { x: 2, y: 0, z: 0 }),
          placement('immune-token', 'immune', { x: 3, y: 0, z: 0 }),
        ],
      })
      const sheets = pokemonSheets([{ name: 'Swift' }], {
        actor: pokemonSheet('actor', [{ name: 'Swift' }], { revision: 11, nickname: 'Actor' }),
        target: pokemonSheet('target', [], {
          revision: 12,
          nickname: 'Target',
          species: 'Snorlax',
          level: 30,
          combat: { currentHp: 80 },
          stats: {
            atk: { stage: 0 },
            def: { stage: -6 },
            satk: { stage: 0 },
            sdef: { stage: 0 },
            spd: { stage: 0 },
          },
          combatStages: { acc: 0 },
        }),
        miss: pokemonSheet('miss', [], { revision: 13, combat: { currentHp: 80 } }),
        immune: pokemonSheet('immune', [], {
          revision: 14,
          combat: { currentHp: 80 },
          abilities: [{ name: 'Soundproof' }],
        }),
      })

      const plan = planAuthoritativeMoveState({
        map,
        pokemonSheets: sheets,
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Swift',
          selection: {
            kind: 'area',
            areaTemplateId: moveAutomationAreaTemplateId(mixedAreaTemplate),
            direction: 'east',
          },
        }),
        random: randomSequence([0.5, 0, 0.5]),
        now: () => 1500,
      })

      const expectedTargetIds = {
        attackedTargetIds: ['target-token', 'miss-token', 'immune-token'],
        hitTargetIds: ['target-token', 'immune-token'],
      }
      expect(plan.resolution.transaction).toMatchObject(expectedTargetIds)
      expect(plan.resolution.transaction.combatStageUpdates.map((update) => update.id)).toEqual(['target-token'])
      expect(plan.sheetWrites).toEqual([])
      expect(plan.sheetReads).toEqual([
        { kind: 'pokemon', slug: 'actor', revision: 11 },
        { kind: 'pokemon', slug: 'target', revision: 12 },
        { kind: 'pokemon', slug: 'miss', revision: 13 },
        { kind: 'pokemon', slug: 'immune', revision: 14 },
      ])
      expect(plan.resolution.sheetReads).toEqual(plan.sheetReads)
      expect(structuredClone(plan.resolution.transaction)).toMatchObject(expectedTargetIds)
      expect(JSON.parse(JSON.stringify(plan.resolution.transaction))).toMatchObject(expectedTargetIds)
      expect(Object.keys(plan.resolution.transaction)).toEqual(expect.arrayContaining(['attackedTargetIds', 'hitTargetIds']))
    })
  })

  it('rejects conflicting sheet revisions observed while finalizing the plan', () => {
    const sheets = pokemonSheets([{ name: 'Pound' }])
    let randomCalls = 0

    try {
      planAuthoritativeMoveState({
        map: mapFixture(),
        pokemonSheets: sheets,
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Pound', selection: { kind: 'single-target', targetPlacementId: 'target-token' } }),
        random: () => {
          randomCalls += 1
          if (randomCalls === 1) sheets.get('target')!.revision = 9
          return 0.5
        },
        idFactory: () => 'feedback-id',
        now: () => 1750,
      })
      throw new Error('Expected conflicting sheet read revisions to reject planning')
    } catch (error) {
      expect(error).toBeInstanceOf(AuthoritativeMoveResolutionError)
      expect((error as AuthoritativeMoveResolutionError).code).toBe('sheet-read-revision-conflict')
    }
  })

  it('combines Daily actor usage and actor HP automation into one sheet revision', () => {
    const sheets = pokemonSheets([{ name: 'Synthesis' }], {
      actor: pokemonSheet('actor', [{ name: 'Synthesis' }], { revision: 11, combat: { currentHp: 1 } }),
    })

    const plan = planAuthoritativeMoveState({
      map: mapFixture(),
      pokemonSheets: sheets,
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Synthesis', selection: { kind: 'self' } }),
      random: randomSequence([0]),
      now: () => 2000,
    })

    expect(plan.usage).toMatchObject({ tracking: 'sheet', moveKey: 'synthesis', uses: 1, sceneUses: 1 })
    expect(plan.mapChanges.moveUsage?.current?.byPlacementId['actor-token']?.synthesis).toMatchObject({ frequency: 'daily', uses: 1 })
    expect(plan.sheetWrites).toHaveLength(1)
    expect(plan.sheetWrites[0]).toMatchObject({
      slug: 'actor',
      expectedRevision: 11,
      revision: 12,
      placementIds: ['actor-token'],
    })
    expect(plan.sheetWrites[0]?.changedFields).toEqual(expect.arrayContaining(['moveUsage', 'hp']))
    expect((plan.sheetWrites[0]?.nextSheet as CharacterSheet).moveUsage?.daily.synthesis).toMatchObject({ uses: 1, updatedAt: 2000 })
  })

  it('advances the map and logs untracked moves without creating move usage state', () => {
    const plan = planAuthoritativeMoveState({
      map: mapFixture(),
      pokemonSheets: pokemonSheets([{ name: 'Hone Claws' }]),
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Hone Claws', selection: { kind: 'self' } }),
      random: randomSequence([0]),
      now: () => 3000,
    })

    expect(plan.usage).toMatchObject({ tracking: 'none', available: true })
    expect(plan.mapChanges.moveUsage).toBeUndefined()
    expect(plan.nextMap.moveUsage).toBeUndefined()
    expect(moveLog(plan.nextMap)).toHaveLength(1)
    expect(plan.revision).toBe(8)
  })
})

const passTemplate: MoveAutomationAreaTemplate = { kind: 'pass', size: 4, label: 'Pass 4' }
const passTemplateId = moveAutomationAreaTemplateId(passTemplate)

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
  effect: 'Authoritative planner Pass test script.',
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

const withRegisteredScratchScript = <T>(run: () => T | Promise<T>): Promise<T> =>
  withRegisteredMoveAutomationScript(passScript(), run)

describe('planAuthoritativeMoveState Pass movement', () => {
  it('updates Pass position and facing and logs the Pass destination exactly once', async () => {
    await withRegisteredScratchScript(() => {
      const map = mapFixture({
        dimensions: { x: 8, y: 3, z: 4 },
        placements: [
          placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
          placement('target-a', 'target', { x: 2, y: 0, z: 1 }),
          placement('target-b', 'target-b', { x: 3, y: 0, z: 1 }),
          placement('occupied-end', 'occupied-end', { x: 5, y: 0, z: 1 }),
        ],
      })
      const sheets = pokemonSheets([{ name: 'Aqua Tail' }], {
        'target-b': pokemonSheet('target-b'),
        'occupied-end': pokemonSheet('occupied-end'),
      })

      const plan = planAuthoritativeMoveState({
        map,
        pokemonSheets: sheets,
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Aqua Tail',
          selection: { kind: 'area', areaTemplateId: passTemplateId, direction: 'east' },
        }),
        random: randomSequence([0.5, 0]),
        now: () => 4000,
      })

      const actor = plan.mapChanges.placements?.current.find((item) => item.id === 'actor-token')
      expect(actor?.position).toEqual(plan.resolution.movement?.destination)
      expect(actor?.facing).toBe('north-east')
      expect(actor?.turned).toBe(false)
      expect(plan.stateChanges.groups.placements[0]?.changes[0]).toMatchObject({
        sourceOperationId: 'legacy-v1.movement.1',
        reasonCode: 'legacy-pass-movement',
      })
      expect(plan.nextMap.encounterState?.turnResources['actor-token']).toMatchObject({
        actions: { standard: { spent: 1 } },
        movement: { spent: 3 },
        oncePerTurnFlags: [
          { id: 'encounter.acted-since-entry' },
          { id: 'move.aqua-tail' },
        ],
      })
      const expectedLine = passDestinationLogLine({ species: 'Actor' } as never, plan.resolution.movement!.destination)
      const lines = moveLog(plan.nextMap)?.[0]?.lines ?? []
      expect(lines.filter((line) => line === expectedLine)).toHaveLength(1)
    })
  })
})
