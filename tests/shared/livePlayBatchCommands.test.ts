import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_BATCH_LIMITS as REEXPORTED_LIVE_PLAY_BATCH_LIMITS,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_BATCH_LIMITS,
  LIVE_PLAY_BATCH_MAX_AFFECTED_TOKEN_IDS,
  LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS,
  LIVE_PLAY_BATCH_MAX_HAZARD_CELLS,
  LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS,
  formatLivePlayBatchGridCellKey,
  isLivePlayBatchGridCell,
  isLivePlayBatchGridCoordinate,
  isLivePlayBatchRecord,
  isLivePlayBatchValidationCode,
  livePlayBatchGridCellsEqual,
  parseLivePlayBatchAffectedTokenIds,
  parseLivePlayBatchBoundedArray,
  parseLivePlayBatchFieldEffectOperations,
  parseLivePlayBatchHazardCells,
  parseLivePlayBatchStrictObject,
  parseLivePlayBatchTerrainVoxelCells,
  parseLivePlayBatchTerrainVoxels,
  type LivePlayBatchGridCell,
  type LivePlayBatchItemParser,
  type LivePlayBatchValidationResult,
} from '#shared/livePlayBatchCommands'

interface TestFieldEffectOperation {
  readonly category: string
  readonly kind: string
}

interface TestTerrainVoxel extends LivePlayBatchGridCell {
  readonly materialId: string
}

const createCells = (count: number): readonly LivePlayBatchGridCell[] => (
  Array.from({ length: count }, (_, index) => ({ x: index, y: 0, z: 1 }))
)

const findIssue = (
  result: LivePlayBatchValidationResult<unknown>,
  path: string,
) => {
  if (result.valid) throw new Error('expected invalid batch result')
  return result.issues.find((issue) => issue.path === path)
}

const parseFieldEffectOperation: LivePlayBatchItemParser<TestFieldEffectOperation> = (
  value,
  path,
) => {
  const objectResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: ['category', 'kind'],
    requiredFields: ['category', 'kind'],
    description: 'field-effect batch operation',
  })
  if (!objectResult.valid) return { valid: false, issues: objectResult.issues }

  const issues = []
  if (typeof objectResult.value.category !== 'string') {
    issues.push({
      path: `${path}.category`,
      code: 'unknown-field' as const,
      message: `${path}.category must be a string in this test parser.`,
    })
  }
  if (typeof objectResult.value.kind !== 'string') {
    issues.push({
      path: `${path}.kind`,
      code: 'unknown-field' as const,
      message: `${path}.kind must be a string in this test parser.`,
    })
  }
  if (issues.length > 0) return { valid: false, issues }

  return {
    valid: true,
    value: {
      category: objectResult.value.category,
      kind: objectResult.value.kind,
    } as TestFieldEffectOperation,
    issues: [],
  }
}

const parseTerrainVoxel: LivePlayBatchItemParser<TestTerrainVoxel> = (value, path) => {
  const objectResult = parseLivePlayBatchStrictObject(value, {
    path,
    allowedFields: ['x', 'y', 'z', 'materialId'],
    requiredFields: ['x', 'y', 'z', 'materialId'],
    description: 'terrain voxel batch item',
  })
  if (!objectResult.valid) return { valid: false, issues: objectResult.issues }

  const cellResult = parseLivePlayBatchStrictObject(
    {
      x: objectResult.value.x,
      y: objectResult.value.y,
      z: objectResult.value.z,
    },
    {
      path,
      allowedFields: ['x', 'y', 'z'],
      requiredFields: ['x', 'y', 'z'],
      description: 'terrain voxel cell',
    },
  )
  if (!cellResult.valid) return { valid: false, issues: cellResult.issues }

  if (
    typeof objectResult.value.x !== 'number' ||
    typeof objectResult.value.y !== 'number' ||
    typeof objectResult.value.z !== 'number' ||
    typeof objectResult.value.materialId !== 'string'
  ) {
    return {
      valid: false,
      issues: [{
        path,
        code: 'not-object',
        message: `${path} must have numeric cell coordinates and a string material id in this test parser.`,
      }],
    }
  }

  return {
    valid: true,
    value: {
      x: objectResult.value.x,
      y: objectResult.value.y,
      z: objectResult.value.z,
      materialId: objectResult.value.materialId,
    },
    issues: [],
  }
}

describe('live-play batch command guardrails', () => {
  it('exports shared maximums and reusable validation codes', () => {
    expect(LIVE_PLAY_BATCH_MAX_HAZARD_CELLS).toBe(128)
    expect(LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS).toBe(256)
    expect(LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS).toBe(16)
    expect(LIVE_PLAY_BATCH_MAX_AFFECTED_TOKEN_IDS).toBe(64)
    expect(LIVE_PLAY_BATCH_LIMITS).toEqual({
      hazardCells: 128,
      terrainVoxels: 256,
      fieldEffectOperations: 16,
      affectedTokenIds: 64,
    })
    expect(REEXPORTED_LIVE_PLAY_BATCH_LIMITS).toBe(LIVE_PLAY_BATCH_LIMITS)
    expect(isLivePlayBatchValidationCode('too-many-items')).toBe(true)
    expect(isLivePlayBatchValidationCode('permission-denied')).toBe(false)
  })

  it('validates batch records, grid cells, and cell helpers without broad framework imports', () => {
    const cell = { x: 1, y: 0, z: 2 }

    expect(isLivePlayBatchRecord(cell)).toBe(true)
    expect(isLivePlayBatchRecord([cell])).toBe(false)
    expect(isLivePlayBatchGridCoordinate(0)).toBe(true)
    expect(isLivePlayBatchGridCoordinate(-1)).toBe(false)
    expect(isLivePlayBatchGridCell(cell)).toBe(true)
    expect(isLivePlayBatchGridCell({ ...cell, profileId: 'private' })).toBe(false)
    expect(formatLivePlayBatchGridCellKey(cell)).toBe('1,0,2')
    expect(livePlayBatchGridCellsEqual(cell, { x: 1, y: 0, z: 2 })).toBe(true)
    expect(livePlayBatchGridCellsEqual(cell, { x: 1, y: 1, z: 2 })).toBe(false)
  })

  it('rejects oversized bounded arrays for every shared batch resource kind', () => {
    const oversizedHazardCells = createCells(LIVE_PLAY_BATCH_MAX_HAZARD_CELLS + 1)
    const oversizedTerrainCells = createCells(LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS + 1)
    const oversizedFieldEffects = Array.from(
      { length: LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS + 1 },
      () => ({ category: 'weather', kind: 'sunny' }),
    )
    const oversizedTokenIds = Array.from(
      { length: LIVE_PLAY_BATCH_MAX_AFFECTED_TOKEN_IDS + 1 },
      (_, index) => `token-${index}`,
    )

    expect(findIssue(parseLivePlayBatchHazardCells(oversizedHazardCells), 'payload.cells')?.code)
      .toBe('too-many-items')
    expect(findIssue(parseLivePlayBatchTerrainVoxelCells(oversizedTerrainCells), 'payload.cells')?.code)
      .toBe('too-many-items')
    expect(findIssue(
      parseLivePlayBatchFieldEffectOperations(oversizedFieldEffects, {
        parseOperation: parseFieldEffectOperation,
      }),
      'payload.operations',
    )?.code).toBe('too-many-items')
    expect(findIssue(parseLivePlayBatchAffectedTokenIds(oversizedTokenIds), 'payload.tokenIds')?.code)
      .toBe('too-many-items')
  })

  it('rejects empty cell and token batches with clear issues', () => {
    expect(findIssue(parseLivePlayBatchHazardCells([]), 'payload.cells')?.code).toBe('empty-array')
    expect(findIssue(parseLivePlayBatchAffectedTokenIds([]), 'payload.tokenIds')?.code)
      .toBe('empty-array')
    expect(findIssue(
      parseLivePlayBatchBoundedArray('not-array', { path: 'payload.items', maxItems: 2 }),
      'payload.items',
    )?.code).toBe('invalid-array')
  })

  it('rejects duplicate cells by default and can normalize idempotent cell batches', () => {
    const cells = [
      { x: 1, y: 0, z: 2 },
      { x: 1, y: 0, z: 2 },
      { x: 3, y: 0, z: 4 },
    ]
    const before = structuredClone(cells)

    const rejected = parseLivePlayBatchHazardCells(cells)
    expect(findIssue(rejected, 'payload.cells[1]')?.code).toBe('duplicate-cell')

    const normalized = parseLivePlayBatchHazardCells(cells, { duplicatePolicy: 'normalize' })
    expect(normalized.valid).toBe(true)
    if (!normalized.valid) throw new Error('expected normalized cells to be valid')
    expect(normalized.value).toEqual([
      { x: 1, y: 0, z: 2 },
      { x: 3, y: 0, z: 4 },
    ])
    expect(normalized.value[0]).not.toBe(cells[0])
    expect(cells).toEqual(before)
  })

  it('rejects duplicate affected token ids by default and can normalize them', () => {
    const tokenIds = ['token-a', 'token-b', 'token-a']

    const rejected = parseLivePlayBatchAffectedTokenIds(tokenIds)
    expect(findIssue(rejected, 'payload.tokenIds[2]')?.code).toBe('duplicate-token-id')

    const normalized = parseLivePlayBatchAffectedTokenIds(tokenIds, { duplicatePolicy: 'normalize' })
    expect(normalized.valid).toBe(true)
    if (!normalized.valid) throw new Error('expected normalized token ids to be valid')
    expect(normalized.value).toEqual(['token-a', 'token-b'])
    expect(tokenIds).toEqual(['token-a', 'token-b', 'token-a'])
  })

  it('rejects unknown durable-state fields in strict objects, cells, and operations', () => {
    const strictObject = parseLivePlayBatchStrictObject(
      { mode: 'all', profileId: 'private-profile' },
      {
        path: 'payload',
        allowedFields: ['mode'],
        requiredFields: ['mode'],
        description: 'clear hazards payload',
      },
    )
    expect(findIssue(strictObject, 'payload.profileId')?.code).toBe('unknown-field')

    const cellResult = parseLivePlayBatchHazardCells([
      { x: 1, y: 0, z: 2, hiddenState: 'secret' },
    ])
    expect(findIssue(cellResult, 'payload.cells[0].hiddenState')?.code).toBe('unknown-field')

    const operationResult = parseLivePlayBatchFieldEffectOperations([
      { category: 'weather', kind: 'sunny', privateSource: 'gm-only' },
    ], {
      parseOperation: parseFieldEffectOperation,
    })
    expect(findIssue(operationResult, 'payload.operations[0].privateSource')?.code)
      .toBe('unknown-field')
  })

  it('validates terrain voxel item batches through a bounded unique-cell helper', () => {
    const voxels: readonly TestTerrainVoxel[] = [
      { x: 1, y: 0, z: 2, materialId: 'meadow_grass' },
      { x: 1, y: 0, z: 2, materialId: 'stone' },
    ]

    const rejected = parseLivePlayBatchTerrainVoxels(voxels, { parseVoxel: parseTerrainVoxel })
    expect(findIssue(rejected, 'payload.voxels[1]')?.code).toBe('duplicate-cell')

    const normalized = parseLivePlayBatchTerrainVoxels(voxels, {
      parseVoxel: parseTerrainVoxel,
      duplicatePolicy: 'normalize',
    })
    expect(normalized.valid).toBe(true)
    if (!normalized.valid) throw new Error('expected normalized terrain voxels')
    expect(normalized.value).toEqual([{ x: 1, y: 0, z: 2, materialId: 'meadow_grass' }])
  })

  it('returns cloned arrays and parsed cell objects without mutating inputs', () => {
    const items = [{ value: 1 }]
    const bounded = parseLivePlayBatchBoundedArray(items, { path: 'payload.items', maxItems: 2 })
    expect(bounded.valid).toBe(true)
    if (!bounded.valid) throw new Error('expected bounded array to be valid')
    expect(bounded.value).toEqual(items)
    expect(bounded.value).not.toBe(items)

    const cells = [{ x: 4, y: 0, z: 5 }]
    const before = structuredClone(cells)
    const parsedCells = parseLivePlayBatchHazardCells(cells)
    expect(parsedCells.valid).toBe(true)
    if (!parsedCells.valid) throw new Error('expected parsed cells to be valid')
    expect(parsedCells.value).toEqual(cells)
    expect(parsedCells.value).not.toBe(cells)
    expect(parsedCells.value[0]).not.toBe(cells[0])
    expect(cells).toEqual(before)
  })
})
