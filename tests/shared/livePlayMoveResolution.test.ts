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
  it('parses valid self, single-target and target-count intents with cloned normalized values', () => {
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
  })

  it('rejects duplicate and empty target-count selections', () => {
    expect(expectInvalidCodes(baseIntent({ kind: 'target-count', targetPlacementIds: ['a', 'a'] }))).toContain('duplicate-target')
    expect(expectInvalidCodes(baseIntent({ kind: 'target-count', targetPlacementIds: [] }))).toContain('invalid-field')
  })

  it('rejects oversized ids, move names, branch ids and submitted target counts', () => {
    const oversized = 'x'.repeat(121)
    expect(expectInvalidCodes({ ...baseIntent({ kind: 'self' }), placementId: oversized })).toContain('invalid-field')
    expect(expectInvalidCodes({ ...baseIntent({ kind: 'self' }), moveName: oversized })).toContain('invalid-field')
    expect(expectInvalidCodes({ ...baseIntent({ kind: 'self' }), targetBranchId: oversized })).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({ kind: 'target-count', targetPlacementIds: [oversized] }))).toContain('invalid-field')
    expect(expectInvalidCodes(baseIntent({
      kind: 'target-count',
      targetPlacementIds: Array.from({ length: LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS + 1 }, (_, index) => `target-${index}`),
    }))).toContain('too-many-targets')
  })

  it('rejects roll, script, transaction and target-count shaped client authority fields', () => {
    expect(expectInvalidCodes({
      ...baseIntent({ kind: 'single-target', targetPlacementId: 'target' }),
      accuracyRoll: 20,
      damageRoll: { total: 99 },
      script: { moveName: 'Fake' },
      transaction: { hpUpdates: [] },
    })).toEqual(expect.arrayContaining(['forbidden-field']))

    expect(expectInvalidCodes(baseIntent({
      kind: 'target-count',
      targetPlacementIds: ['a'],
      targetCount: 99,
      range: 99,
      hitChance: 100,
    }))).toEqual(expect.arrayContaining(['forbidden-field']))
  })
})
