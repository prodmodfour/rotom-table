import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS,
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  parseResolveMoveIntent,
} from '#shared/livePlayMoveResolution'

const baseIntent = (selection: unknown) => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection,
})

const expectValid = (value: unknown) => {
  const result = parseResolveMoveIntent(value)
  expect(result.valid).toBe(true)
  if (!result.valid) throw new Error('expected valid intent')
  return result.intent
}

const expectInvalidCodes = (value: unknown): string[] => {
  const result = parseResolveMoveIntent(value)
  expect(result.valid).toBe(false)
  return result.valid ? [] : result.issues.map((issue) => issue.code)
}

describe('live play move-resolution intent parsing', () => {
  it('parses valid self, single-target, target-count and area intents with cloned normalized values', () => {
    expect(expectValid(baseIntent({ kind: 'self' }))).toEqual({
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Tackle',
      selection: { kind: 'self' },
    })

    expect(expectValid({
      ...baseIntent({ kind: 'single-target', targetPlacementId: ' target-token ' }),
      moveName: ' Tackle ',
      targetBranchId: ' branch-a ',
    })).toEqual({
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor-token',
      moveName: 'Tackle',
      targetBranchId: 'branch-a',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    })

    const targetPlacementIds = ['target-a', 'target-b']
    const intent = expectValid(baseIntent({ kind: 'target-count', targetPlacementIds }))
    expect(intent.selection).toEqual({ kind: 'target-count', targetPlacementIds: ['target-a', 'target-b'] })
    expect(intent.selection.kind === 'target-count' ? intent.selection.targetPlacementIds : []).not.toBe(targetPlacementIds)

    expect(expectValid(baseIntent({ kind: 'area', areaTemplateId: ' burst:any:1 ' })).selection).toEqual({
      kind: 'area',
      areaTemplateId: 'burst:any:1',
    })
    expect(expectValid(baseIntent({ kind: 'area', areaTemplateId: 'cone:any:2', direction: 'north-east' })).selection).toEqual({
      kind: 'area',
      areaTemplateId: 'cone:any:2',
      direction: 'north-east',
    })

    const aimCell = { x: 1, y: 2, z: 3 }
    const excludedTargetPlacementIds = ['target-a']
    const areaIntent = expectValid(baseIntent({
      kind: 'area',
      areaTemplateId: 'ranged-blast:8:2',
      aimCell,
      excludedTargetPlacementIds,
    }))
    expect(areaIntent.selection).toEqual({
      kind: 'area',
      areaTemplateId: 'ranged-blast:8:2',
      aimCell: { x: 1, y: 2, z: 3 },
      excludedTargetPlacementIds: ['target-a'],
    })
    expect(areaIntent.selection.kind === 'area' ? areaIntent.selection.aimCell : null).not.toBe(aimCell)
    expect(areaIntent.selection.kind === 'area' ? areaIntent.selection.excludedTargetPlacementIds : []).not.toBe(excludedTargetPlacementIds)
  })

  it('rejects duplicate and empty target-count selections plus malformed area placement intents', () => {
    expect(expectInvalidCodes(baseIntent({ kind: 'target-count', targetPlacementIds: ['a', 'a'] }))).toContain('duplicate-target')
    expect(expectInvalidCodes(baseIntent({ kind: 'target-count', targetPlacementIds: [] }))).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({ kind: 'area', areaTemplateId: 'cone:any:2', direction: 'north', aimCell: { x: 1, y: 0, z: 0 } }))).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({ kind: 'area', areaTemplateId: 'cone:any:2', direction: 'sideways' }))).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({ kind: 'area', areaTemplateId: 'blast:8:2', aimCell: { x: 1.5, y: 0, z: 0 } }))).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({ kind: 'area', areaTemplateId: 'burst:any:1', excludedTargetPlacementIds: ['a', 'a'] }))).toContain('duplicate-target')
  })

  it('rejects oversized ids, move names, branch ids and submitted target counts', () => {
    const oversized = 'x'.repeat(121)
    expect(expectInvalidCodes({ ...baseIntent({ kind: 'self' }), placementId: oversized })).toContain('invalid-field')
    expect(expectInvalidCodes({ ...baseIntent({ kind: 'self' }), moveName: oversized })).toContain('invalid-field')
    expect(expectInvalidCodes({ ...baseIntent({ kind: 'self' }), targetBranchId: oversized })).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({ kind: 'target-count', targetPlacementIds: [oversized] }))).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({ kind: 'area', areaTemplateId: oversized }))).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({ kind: 'area', areaTemplateId: 'burst:any:1', excludedTargetPlacementIds: [oversized] }))).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({
      kind: 'target-count',
      targetPlacementIds: Array.from({ length: LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS + 1 }, (_, index) => `target-${index}`),
    }))).toContain('too-many-targets')
    expect(expectInvalidCodes(baseIntent({
      kind: 'area',
      areaTemplateId: 'burst:any:1',
      excludedTargetPlacementIds: Array.from({ length: LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS + 1 }, (_, index) => `target-${index}`),
    }))).toContain('too-many-targets')
  })

  it('rejects roll, script, runtime, transaction, resolved area and target-count shaped client authority fields', () => {
    expect(expectInvalidCodes({
      ...baseIntent({ kind: 'single-target', targetPlacementId: 'target' }),
      accuracyRoll: 20,
      rollLedger: [{ rollId: 'client-roll' }],
      trace: { events: [] },
      auditTrace: { events: [] },
      damageRoll: { total: 99 },
      script: { moveName: 'Fake' },
      runtime: { kind: 'movespec-v2' },
      runtimeKind: 'movespec-v2',
      runtimeVersion: 99,
      spec: { canonicalId: 'Tackle' },
      specHash: 'client-selected',
      transaction: { hpUpdates: [] },
    })).toEqual(expect.arrayContaining(['forbidden-field']))

    expect(expectInvalidCodes(baseIntent({
      kind: 'target-count',
      targetPlacementIds: ['a'],
      targetCount: 99,
      range: 99,
      hitChance: 100,
    }))).toEqual(expect.arrayContaining(['forbidden-field']))

    expect(expectInvalidCodes(baseIntent({
      kind: 'area',
      areaTemplateId: 'burst:any:1',
      cells: [{ x: 1, y: 0, z: 0 }],
      areaCells: [{ x: 1, y: 0, z: 0 }],
      pathCells: [{ x: 1, y: 0, z: 0 }],
      movement: { kind: 'pass' },
      movementDistance: 4,
      from: { x: 0, y: 0, z: 0 },
      to: { x: 2, y: 0, z: 0 },
      targetIds: ['target-a'],
      targetPlacementIds: ['target-a'],
      candidateIds: ['target-a'],
      candidateTargetIds: ['target-a'],
      selectedTargetIds: ['target-a'],
      excludedTargetIds: ['target-a'],
      affectedIds: ['target-a'],
      destination: { x: 2, y: 0, z: 0 },
      passDestination: { x: 2, y: 0, z: 0 },
    }))).toEqual(expect.arrayContaining(['forbidden-field']))
  })
})
