import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'
import {
  ACCEPTED_MOVE_COMPENSATION_MAX_OPERATIONS,
  type AcceptedMoveAvailableCompensationOperation,
} from '~~/server/domain/moveAutomation/acceptedMoveCompensation'
import { createAcceptedMoveCompensationResult } from '~~/server/domain/moveAutomation/planAcceptedMoveCompensation'
import {
  AcceptedMoveCorrectionPlanError,
  planAcceptedMoveCorrection,
  type AcceptedMoveCorrectionPlanErrorCode,
  type PlanAcceptedMoveCorrectionInput,
} from '~~/server/domain/moveAutomation/planAcceptedMoveCorrection'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
} from '~~/server/domain/moveAutomation/plan'

const sheet = (input: {
  revision: number
  currentHp: number
  attackStage: number
  conditions: readonly string[]
}): CharacterSheet => ({
  slug: 'target',
  nickname: 'Private nickname',
  species: 'Pikachu',
  level: 20,
  revision: input.revision,
  stats: { atk: { stage: input.attackStage } },
  combatStages: { acc: 0 },
  combat: {
    currentHp: input.currentHp,
    injuries: 0,
    conditions: [...input.conditions],
  },
  movelist: [],
})

const previousSheet = (): CharacterSheet => sheet({
  revision: 4,
  currentHp: 40,
  attackStage: 0,
  conditions: [],
})

const acceptedSheet = (): CharacterSheet => sheet({
  revision: 5,
  currentHp: 22,
  attackStage: 2,
  conditions: ['Burned'],
})

const mapDocument = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  folder: '',
  revision: 8,
  dimensions: { x: 6, y: 2, z: 6 },
  playerVisible: true,
  voxels: [],
  hazards: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [{
    id: 'target-token',
    sheetKind: 'pokemon',
    sheetSlug: 'target',
    position: { x: 0, y: 0, z: 0 },
  }],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: { moveLog: [{ moveName: 'Private move log' }] },
  updatedAt: 800,
})

const operations = (): readonly AcceptedMoveAvailableCompensationOperation[] => {
  const result = createAcceptedMoveCompensationResult({
    mapSlug: 'arena',
    originOperationId: 'op_correctionplanorigin1',
    plan: createMoveStateChangePlan([
      {
        kind: 'map-hazards',
        scope: { kind: 'map', mapSlug: 'arena' },
        expectedRevision: 7,
        sourceOperationId: 'move.add-hazard',
        reasonCode: 'hazard-added',
        previous: [],
        current: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
      {
        kind: 'sheet-state',
        scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target' },
        expectedRevision: 4,
        sourceOperationId: 'move.damage-and-afflict',
        reasonCode: 'sheet-effects-applied',
        previous: previousSheet(),
        current: acceptedSheet(),
        changedFields: ['hp', 'combatStages', 'conditions'],
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    ]),
  })
  return result.operations.filter(
    (operation): operation is AcceptedMoveAvailableCompensationOperation => (
      operation.availability === 'available'
    ),
  )
}

const plannerInput = (
  selectedOperations: readonly AcceptedMoveAvailableCompensationOperation[] = operations(),
): PlanAcceptedMoveCorrectionInput => ({
  map: mapDocument(),
  sheets: new Map([[
    'pokemon:target',
    {
      kind: 'pokemon',
      slug: 'target',
      revision: 5,
      sheet: acceptedSheet() as unknown as Readonly<Record<string, unknown>>,
    },
  ]]),
  operations: selectedOperations,
  updatedAt: 1_000,
})

const operationByKind = (
  kind: AcceptedMoveAvailableCompensationOperation['inverse']['kind'],
): AcceptedMoveAvailableCompensationOperation => {
  const operation = operations().find(candidate => candidate.inverse.kind === kind)
  if (!operation) throw new Error(`missing test operation ${kind}`)
  return operation
}

const expectPlanError = (
  input: PlanAcceptedMoveCorrectionInput,
  code: AcceptedMoveCorrectionPlanErrorCode,
): void => {
  try {
    planAcceptedMoveCorrection(input)
    throw new Error('expected correction planning to fail')
  }
  catch (error) {
    expect(error).toBeInstanceOf(AcceptedMoveCorrectionPlanError)
    expect(error).toMatchObject({ code })
  }
}

describe('pure accepted move correction planning', () => {
  it('produces deterministic typed writes and a mechanics-free audit projection without mutating snapshots', () => {
    const input = plannerInput()
    const mapBefore = deepCloneJson(input.map)
    const sheetBefore = deepCloneJson(input.sheets.get('pokemon:target'))

    const first = planAcceptedMoveCorrection(input)
    const second = planAcceptedMoveCorrection(input)

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      previousRevision: 8,
      revision: 9,
      nextMap: { slug: 'arena', revision: 9, hazards: [], updatedAt: 1_000 },
      mapChanges: {
        hazards: {
          previous: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
          current: [],
        },
      },
      sheetWrites: [{
        kind: 'pokemon',
        slug: 'target',
        expectedRevision: 5,
        revision: 6,
        changedFields: ['hp', 'combatStages', 'conditions'],
        nextSheet: {
          revision: 6,
          updatedAt: 1_000,
          stats: { atk: { stage: 0 } },
          combat: { currentHp: 40, injuries: 0, conditions: [] },
        },
      }],
      resourceChanges: [
        { kind: 'map', mapSlug: 'arena', expectedRevision: 8, revision: 9 },
        {
          kind: 'sheet',
          sheetKind: 'pokemon',
          sheetSlug: 'target',
          expectedRevision: 5,
          revision: 6,
        },
      ],
    })
    expect(first.operationIds).toEqual(input.operations.map(operation => operation.operationId))

    const publicAuditProjection = {
      operationIds: first.operationIds,
      resources: first.resourceChanges,
      sheets: first.sheetRefs,
      changes: first.mapChanges,
    }
    const auditJson = JSON.stringify(publicAuditProjection)
    expect(auditJson).not.toContain('Private nickname')
    expect(auditJson).not.toContain('Pikachu')
    expect(auditJson).not.toContain('expectedCurrent')
    expect(auditJson).not.toContain('restore')
    expect(auditJson).not.toContain('currentHp')

    expect(input.map).toEqual(mapBefore)
    expect(input.sheets.get('pokemon:target')).toEqual(sheetBefore)
  })

  it('rejects every stale resource revision and exact post-move value drift without mutating input', () => {
    const hazardOperation = operationByKind('restore-map-hazards')
    const hpOperation = operationByKind('restore-sheet-hp')

    const staleMap = plannerInput([hazardOperation])
    ;(staleMap.map as TabletopMap).revision = 9
    const staleMapBefore = deepCloneJson(staleMap.map)
    expectPlanError(staleMap, 'resource-revision-conflict')
    expect(staleMap.map).toEqual(staleMapBefore)

    const driftedMap = plannerInput([hazardOperation])
    ;(driftedMap.map as TabletopMap).hazards = []
    expectPlanError(driftedMap, 'current-value-conflict')

    const staleSheet = plannerInput([hpOperation])
    const staleSnapshot = staleSheet.sheets.get('pokemon:target')!
    ;(staleSheet.sheets as Map<string, typeof staleSnapshot>).set('pokemon:target', {
      ...staleSnapshot,
      revision: 6,
    })
    expectPlanError(staleSheet, 'resource-revision-conflict')

    const driftedSheet = plannerInput([hpOperation])
    const driftedSnapshot = driftedSheet.sheets.get('pokemon:target')!
    ;(driftedSheet.sheets as Map<string, typeof driftedSnapshot>).set('pokemon:target', {
      ...driftedSnapshot,
      sheet: sheet({
        revision: 5,
        currentHp: 21,
        attackStage: 2,
        conditions: ['Burned'],
      }) as unknown as Readonly<Record<string, unknown>>,
    })
    const driftedSheetBefore = deepCloneJson(driftedSheet.sheets.get('pokemon:target'))
    expectPlanError(driftedSheet, 'current-value-conflict')
    expect(driftedSheet.sheets.get('pokemon:target')).toEqual(driftedSheetBefore)
  })

  it('rejects duplicate inverse targets and planner inputs beyond the durable operation bound', () => {
    const hazardOperation = operationByKind('restore-map-hazards')
    const overlappingOperation: AcceptedMoveAvailableCompensationOperation = {
      ...deepCloneJson(hazardOperation),
      operationId: `${hazardOperation.operationId}.overlap`,
    }
    expectPlanError(
      plannerInput([hazardOperation, overlappingOperation]),
      'duplicate-target',
    )

    const oversized = Array.from(
      { length: ACCEPTED_MOVE_COMPENSATION_MAX_OPERATIONS + 1 },
      (_, index): AcceptedMoveAvailableCompensationOperation => ({
        ...deepCloneJson(hazardOperation),
        operationId: `${hazardOperation.operationId}.${index}`,
      }),
    )
    expectPlanError(plannerInput(oversized), 'invalid-operation')
  })
})
