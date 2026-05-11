import { describe, expect, it, vi } from 'vitest'
import {
  createEncounterOutputPlan,
  encounterOutputSlugPrefix,
  resolveEncounterOutputDir,
  type EncounterOutputRequest,
} from '~/server/utils/encounterOutput'

const safePersistedRequest: EncounterOutputRequest = {
  tableKey: 'forest-edge',
  count: 3,
  outRoot: 'data/sheets/wild',
  preview: false,
}

describe('encounter output helpers', () => {
  it('creates persistent output directories through injected filesystem boundaries', () => {
    const ensureDirectory = vi.fn()
    const uniqueOutputDir = vi.fn(() => '/repo/data/sheets/wild/forest-edge_3-2')

    const output = resolveEncounterOutputDir(safePersistedRequest, {
      projectRoot: '/repo',
      pathExists: (path) => path.endsWith('-existing'),
      ensureDirectory,
      makeTempDir: vi.fn(),
      uniqueOutputDir,
    })

    expect(output).toEqual({
      dir: '/repo/data/sheets/wild/forest-edge_3-2',
      cleanup: false,
    })
    expect(ensureDirectory).toHaveBeenNthCalledWith(1, '/repo/data/sheets/wild')
    expect(ensureDirectory).toHaveBeenNthCalledWith(2, '/repo/data/sheets/wild/forest-edge_3-2')
    expect(uniqueOutputDir).toHaveBeenCalledWith(
      '/repo/data/sheets/wild',
      'forest-edge_3',
      expect.any(Function),
    )
  })

  it('uses temporary output directories for previews without creating persistent folders', () => {
    const ensureDirectory = vi.fn()
    const makeTempDir = vi.fn(() => '/tmp/rotom-encounter-forest-edge-abc')

    const output = resolveEncounterOutputDir({ ...safePersistedRequest, preview: true }, {
      projectRoot: '/repo',
      pathExists: () => false,
      ensureDirectory,
      makeTempDir,
    })

    expect(output).toEqual({
      dir: '/tmp/rotom-encounter-forest-edge-abc',
      cleanup: true,
    })
    expect(makeTempDir).toHaveBeenCalledWith('rotom-encounter-forest-edge-')
    expect(ensureDirectory).not.toHaveBeenCalled()
  })

  it('builds compatible response paths and slug prefixes for persisted and preview output', () => {
    const persistent = createEncounterOutputPlan(safePersistedRequest, {
      projectRoot: '/repo',
      pathExists: () => false,
      ensureDirectory: vi.fn(),
      makeTempDir: vi.fn(),
      uniqueOutputDir: () => '/repo/data/sheets/wild/forest-edge_3',
      now: () => 9876,
    })

    expect(persistent).toMatchObject({
      responseDir: '/repo/data/sheets/wild/forest-edge_3',
      responseRelDir: 'data/sheets/wild/forest-edge_3',
      slugPrefix: 'wild-forest-edge-3',
      cleanup: false,
    })

    const preview = createEncounterOutputPlan({ ...safePersistedRequest, preview: true }, {
      projectRoot: '/repo',
      pathExists: () => false,
      ensureDirectory: vi.fn(),
      makeTempDir: () => '/tmp/rotom-encounter-forest-edge-abc',
      now: () => 9876,
    })

    expect(preview).toMatchObject({
      responseDir: '',
      responseRelDir: '',
      slugPrefix: 'preview-forest-edge-9876',
      cleanup: true,
    })
  })

  it('keeps slug prefix formatting compatible with legacy data/sheets stripping', () => {
    expect(encounterOutputSlugPrefix(
      '/repo',
      '/repo/data/sheets/team_a/deep/forest-edge_3',
      'ignored-for-persisted',
      false,
      () => 123,
    )).toBe('team-a-deep-forest-edge-3')
  })

  it('rejects escaped persistent output roots before creating directories', () => {
    const ensureDirectory = vi.fn()

    expect(() => resolveEncounterOutputDir({
      ...safePersistedRequest,
      outRoot: '../outside',
    }, {
      projectRoot: '/repo',
      pathExists: () => false,
      ensureDirectory,
      makeTempDir: vi.fn(),
    })).toThrow('Invalid outRoot')

    expect(ensureDirectory).not.toHaveBeenCalled()
  })
})
