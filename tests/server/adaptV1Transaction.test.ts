import { describe, expect, it } from 'vitest'
import {
  adaptV1Transaction,
  V1TransactionAdaptationError,
} from '~~/server/domain/moveAutomation/adaptV1Transaction'
import { buildLegacyV1MoveResolutionTrace } from '~~/server/domain/moveAutomation/legacyV1Trace'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type {
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'

const stages = (overrides: Partial<CombatStageMap> = {}): CombatStageMap => ({
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
  ...overrides,
})

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'v1-adapter-arena',
  name: 'V1 Adapter Arena',
  revision: 7,
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
  ],
  lights: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  activeScene: { name: 'Adapter Scene', startedAt: 10 },
  initiative: { activeId: 'actor-token', round: 1 },
  temporaryHitPoints: {
    scene: { name: 'Adapter Scene', startedAt: 10 },
    byPlacementId: { 'target-token': 5 },
  },
  metadata: { note: 'preserved' },
})

const sheet = (
  slug: string,
  revision: number,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  revision,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  movelist: [],
  combat: { currentHp: 40 },
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

const script = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Adapter Move',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Normal',
  ac: 2,
  range: 'Melee, 1 Target',
  effect: 'Legacy rules prose is evidence, not executable adapter input.',
  keywords: [],
  criticalRange: null,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: ['Do not infer another state change from this note.'],
})

const transaction = (): MoveAutomationTransaction => ({
  userId: 'actor-token',
  userName: 'Actor',
  moveName: 'Adapter Move',
  scriptKind: 'explicit',
  scriptVersion: 1,
  attackedTargetIds: ['target-token'],
  hitTargetIds: ['target-token'],
  hpUpdates: [{ id: 'target-token', currentHp: 30, temporaryHp: 2, injuries: 1 }],
  conditionUpdates: [{ id: 'target-token', conditions: ['Burned'] }],
  combatStageUpdates: [{ id: 'actor-token', stages: stages({ atk: 1 }) }],
  hazardsToAdd: [{ kind: 'spikes', x: 2, y: 0, z: 2, owner: 'Actor' }],
  fieldEffectsToApply: [{ kind: 'weather', value: 'sunny', source: 'Actor' }],
  logLines: [
    'Actor used Adapter Move.',
    'Automation note: preserve this prose without executing it.',
  ],
})

const traceFor = (value: MoveAutomationTransaction) => buildLegacyV1MoveResolutionTrace({
  program: {
    canonicalId: 'Adapter Move',
    runtimeKind: 'legacy-v1',
    runtimeVersion: 1,
    definitionHash: 'a'.repeat(64),
  },
  ruleset: {
    rulesetId: 'adapter-test-rules',
    sourceDataSha256: 'b'.repeat(64),
  },
  actorPlacementId: 'actor-token',
  selectionKind: 'single-target',
  selectedTargetIds: ['target-token'],
  script: script(),
  transaction: value,
  rollLedger: [],
})

const adaptationInput = () => {
  const previousMap = mapFixture()
  const value = transaction()
  const previousTarget = sheet('target', 3)
  const nextTarget = sheet('target', 4, {
    combat: { currentHp: 30, injuries: 1, conditions: ['Burned'] },
  })
  const previousActor = sheet('actor', 4)
  const nextActor = sheet('actor', 5, {
    stats: {
      atk: { stage: 1 },
      def: { stage: 0 },
      satk: { stage: 0 },
      sdef: { stage: 0 },
      spd: { stage: 0 },
    },
  })

  return {
    transaction: value,
    trace: traceFor(value),
    previousMap,
    expectedMapRevision: 7,
    mapChanges: {
      moveUsage: {
        previous: undefined,
        current: {
          scene: { name: 'Adapter Scene', startedAt: 10 },
          byPlacementId: {},
        },
      },
      temporaryHitPoints: {
        previous: previousMap.temporaryHitPoints,
        current: {
          scene: { name: 'Adapter Scene', startedAt: 10 },
          byPlacementId: { 'target-token': 2 },
        },
      },
      hazards: {
        previous: [],
        current: value.hazardsToAdd,
      },
      fieldEffects: {
        previous: { weather: [], terrains: [], rooms: [] },
        current: {
          weather: [{ kind: 'sunny' as const, source: 'Actor' }],
          terrains: [],
          rooms: [],
        },
      },
      metadata: {
        previous: previousMap.metadata,
        current: { note: 'preserved', moveLog: [{ lines: value.logLines }] },
      },
    },
    sheetWrites: [
      {
        kind: 'pokemon' as const,
        slug: 'target',
        expectedRevision: 3,
        previousSheet: previousTarget,
        nextSheet: nextTarget,
        placementIds: ['target-token'],
        changedFields: ['hp', 'conditions'] as const,
      },
      {
        kind: 'pokemon' as const,
        slug: 'actor',
        expectedRevision: 4,
        previousSheet: previousActor,
        nextSheet: nextActor,
        placementIds: ['actor-token'],
        changedFields: ['combatStages'] as const,
      },
    ],
  }
}

describe('legacy v1 transaction adapter', () => {
  it('links exact flat outcomes and trace entries to immutable typed state changes', () => {
    const input = adaptationInput()
    const before = structuredClone(input)

    const adapted = adaptV1Transaction(input)

    expect(input).toEqual(before)
    expect(adapted.stateChanges.changes.map(change => change.kind)).toEqual([
      'map-move-usage',
      'map-temporary-hit-points',
      'map-hazards',
      'map-field-effects',
      'map-metadata',
      'sheet-state',
      'sheet-state',
    ])
    expect(adapted.stateChanges.changes.map(change => ({
      kind: change.kind,
      sourceOperationId: change.sourceOperationId,
      reasonCode: change.reasonCode,
    }))).toEqual([
      { kind: 'map-move-usage', sourceOperationId: null, reasonCode: 'legacy-v1-move-usage' },
      { kind: 'map-temporary-hit-points', sourceOperationId: 'legacy-v1.hp.1', reasonCode: 'legacy-hp-update' },
      { kind: 'map-hazards', sourceOperationId: 'legacy-v1.hazard.1', reasonCode: 'legacy-hazard-add' },
      { kind: 'map-field-effects', sourceOperationId: 'legacy-v1.field.1', reasonCode: 'legacy-field-apply' },
      { kind: 'map-metadata', sourceOperationId: 'legacy-v1.log.1', reasonCode: 'legacy-log-projection' },
      { kind: 'sheet-state', sourceOperationId: null, reasonCode: 'legacy-v1-sheet-state' },
      { kind: 'sheet-state', sourceOperationId: 'legacy-v1.combat-stage.1', reasonCode: 'legacy-combat-stage-update' },
    ])
    expect(adapted.stateChanges.groups.map).toHaveLength(1)
    expect(adapted.stateChanges.groups.sheets).toHaveLength(2)
    expect(adapted.stateChanges.expectedRevisions).toEqual([
      { kind: 'map', mapSlug: 'v1-adapter-arena', expectedRevision: 7 },
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target', expectedRevision: 3 },
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor', expectedRevision: 4 },
    ])

    const operationIds = adapted.trace.events.flatMap(event => (
      event.kind === 'operation' ? [event.operationId] : []
    ))
    expect(operationIds).toEqual(expect.arrayContaining([
      'legacy-v1.hp.1',
      'legacy-v1.condition.1',
      'legacy-v1.combat-stage.1',
      'legacy-v1.hazard.1',
      'legacy-v1.field.1',
      'legacy-v1.log.1',
    ]))
    const logEvent = adapted.trace.events.find(event => (
      event.kind === 'operation' && event.operationId === 'legacy-v1.log.1'
    ))
    expect(logEvent).toMatchObject({
      result: { lines: input.transaction.logLines },
    })
    expect(operationIds).toHaveLength(6)
    expect(Object.isFrozen(adapted)).toBe(true)
    expect(Object.isFrozen(adapted.trace)).toBe(true)
    expect(Object.isFrozen(adapted.stateChanges)).toBe(true)
  })

  it('routes every registered legacy definition without interpreting its prose fields', () => {
    const previousMap = mapFixture()

    for (const [canonicalId, registeredScript] of EXPLICIT_MOVE_AUTOMATION_SCRIPTS) {
      const value: MoveAutomationTransaction = {
        userId: 'actor-token',
        userName: 'Actor',
        moveName: registeredScript.moveName,
        scriptKind: registeredScript.kind,
        scriptVersion: registeredScript.version,
        attackedTargetIds: [],
        hitTargetIds: [],
        hpUpdates: [],
        conditionUpdates: [],
        combatStageUpdates: [],
        hazardsToAdd: [],
        fieldEffectsToApply: [],
        logLines: [`Compatibility projection for ${canonicalId}.`],
      }
      const trace = buildLegacyV1MoveResolutionTrace({
        program: {
          canonicalId,
          runtimeKind: 'legacy-v1',
          runtimeVersion: registeredScript.version,
          definitionHash: 'c'.repeat(64),
        },
        ruleset: {
          rulesetId: 'adapter-test-rules',
          sourceDataSha256: 'd'.repeat(64),
        },
        actorPlacementId: 'actor-token',
        selectionKind: 'self',
        selectedTargetIds: [],
        script: registeredScript,
        transaction: value,
        rollLedger: [],
      })
      const adapted = adaptV1Transaction({
        transaction: value,
        trace,
        previousMap,
        expectedMapRevision: 7,
        mapChanges: {
          metadata: {
            previous: previousMap.metadata,
            current: { note: 'preserved', projectedMove: canonicalId },
          },
        },
        sheetWrites: [],
      })

      expect(adapted.stateChanges.changes).toEqual([
        expect.objectContaining({
          kind: 'map-metadata',
          sourceOperationId: 'legacy-v1.log.1',
        }),
      ])
      expect(adapted.trace.program.canonicalId).toBe(canonicalId)
    }
  })

  it('fails closed when a trace no longer describes the resolved transaction', () => {
    const input = adaptationInput()
    const driftedTransaction = structuredClone(input.transaction)
    driftedTransaction.hpUpdates[0]!.currentHp = 29

    expect(() => adaptV1Transaction({
      ...input,
      transaction: driftedTransaction,
    })).toThrowError(expect.objectContaining({
      name: V1TransactionAdaptationError.name,
      code: 'trace-mismatch',
    }))
  })
})
