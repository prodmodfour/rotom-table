import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ENCOUNTER_GENERATION_PROJECT_ROOT,
  resolveGenerateEncountersRuntime,
} from '~/server/utils/generateEncountersRuntime'

const cleanup = (path: string) => rmSync(path, { recursive: true, force: true })

describe('generate encounter runtime dependencies', () => {
  it('derives project-relative defaults and preserves injected seams', async () => {
    const now = () => 1
    const random = () => 0.25
    const pathExists = vi.fn(() => true)
    const readTextFile = vi.fn(() => '{}')
    const listDirectory = vi.fn(() => [])
    const ensureDirectory = vi.fn()
    const makeTempDir = vi.fn(() => '/tmp/generated')
    const cleanupDirectory = vi.fn()
    const uniqueOutputDir = vi.fn((parent: string) => `${parent}/unique`)
    const runPokegen = vi.fn(async () => ({ ok: true, stderr: '' }))

    const runtime = resolveGenerateEncountersRuntime({
      projectRoot: '/repo',
      now,
      random,
      pathExists,
      readTextFile,
      listDirectory,
      ensureDirectory,
      makeTempDir,
      cleanupDirectory,
      uniqueOutputDir,
      runPokegen,
    })

    expect(runtime.projectRoot).toBe('/repo')
    expect(runtime.encounterRoot).toBe(resolvePath('/repo', 'encounter_tables'))
    expect(runtime.now).toBe(now)
    expect(runtime.random).toBe(random)
    expect(runtime.pathExists).toBe(pathExists)
    expect(runtime.readTextFile).toBe(readTextFile)
    expect(runtime.listDirectory).toBe(listDirectory)
    expect(runtime.ensureDirectory).toBe(ensureDirectory)
    expect(runtime.makeTempDir).toBe(makeTempDir)
    expect(runtime.cleanupDirectory).toBe(cleanupDirectory)
    expect(runtime.uniqueOutputDir).toBe(uniqueOutputDir)
    await expect(runtime.runPokegen('Pidgey', 5, '/out', 'prefix')).resolves.toEqual({ ok: true, stderr: '' })
    expect(runPokegen).toHaveBeenCalledWith('Pidgey', 5, '/out', 'prefix')
  })

  it('honors an explicit encounter table root', () => {
    const runtime = resolveGenerateEncountersRuntime({
      projectRoot: '/repo',
      encounterRoot: '/tables',
      runPokegen: vi.fn(async () => ({ ok: true, stderr: '' })),
    })

    expect(runtime.encounterRoot).toBe('/tables')
  })

  it('keeps filesystem defaults at the runtime boundary', () => {
    const root = mkdtempSync(joinPath(tmpdir(), 'rotom-runtime-root-'))
    const tempDirPrefix = `rotom-runtime-temp-${Date.now()}-`
    let generatedTempDir = ''

    try {
      const runtime = resolveGenerateEncountersRuntime({ projectRoot: root })
      const textPath = joinPath(root, 'sample.txt')
      const nestedDir = joinPath(root, 'nested')

      writeFileSync(textPath, 'hello runtime')
      expect(runtime.projectRoot).toBe(root)
      expect(runtime.encounterRoot).toBe(resolvePath(root, 'encounter_tables'))
      expect(runtime.pathExists(textPath)).toBe(true)
      expect(runtime.readTextFile(textPath)).toBe('hello runtime')

      runtime.ensureDirectory(nestedDir)
      expect(existsSync(nestedDir)).toBe(true)
      expect(runtime.listDirectory(root)).toEqual(expect.arrayContaining(['sample.txt', 'nested']))

      generatedTempDir = runtime.makeTempDir(tempDirPrefix)
      expect(generatedTempDir).toContain(tempDirPrefix)
      expect(existsSync(generatedTempDir)).toBe(true)
      runtime.cleanupDirectory(generatedTempDir)
      expect(existsSync(generatedTempDir)).toBe(false)
      generatedTempDir = ''
    } finally {
      if (generatedTempDir) cleanup(generatedTempDir)
      cleanup(root)
    }
  })

  it('documents the process-root default separately from the use case', () => {
    const runtime = resolveGenerateEncountersRuntime({
      runPokegen: vi.fn(async () => ({ ok: true, stderr: '' })),
    })

    expect(runtime.projectRoot).toBe(DEFAULT_ENCOUNTER_GENERATION_PROJECT_ROOT)
    expect(runtime.encounterRoot).toBe(resolvePath(DEFAULT_ENCOUNTER_GENERATION_PROJECT_ROOT, 'encounter_tables'))
  })
})
