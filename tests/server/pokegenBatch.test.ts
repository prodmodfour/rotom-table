import { join as joinPath } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runPokegenForRolledEncounters } from '~~/server/utils/pokegenBatch'
import type { CharacterSheet } from '~/types/characterSheet'
import type { RolledEncounter } from '~/types/encounterTable'

const rolled: RolledEncounter[] = [
  { species: 'Pidgey', level: 5, roll: 1 },
  { species: 'Rattata', level: 6, roll: 42 },
]

const generatedSheet = (species: string, level: number): CharacterSheet => ({
  slug: species.toLowerCase(),
  nickname: species,
  species,
  level,
})

const sequenceRandom = (...values: number[]) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

describe('runPokegenForRolledEncounters', () => {
  it('runs pokegen sequentially, decorates persisted JSON files, and reports generated files', async () => {
    const files: string[] = ['existing.json']
    const contents = new Map<string, string>()
    const runPokegen = vi.fn(async (species: string, level: number, dir: string, slugPrefix: string) => {
      const filename = `${slugPrefix}-${species.toLowerCase()}.json`
      files.push(filename)
      contents.set(joinPath(dir, filename), JSON.stringify(generatedSheet(species, level)))
      return { ok: true, stderr: '' }
    })
    const writeTextFile = vi.fn((path: string, content: string) => contents.set(path, content))

    const result = await runPokegenForRolledEncounters({
      rolled,
      dir: '/repo/out',
      slugPrefix: 'wild-forest',
      preview: false,
      pathExists: (path) => path === '/repo/out',
      listDirectory: () => [...files],
      readTextFile: (path) => contents.get(path) ?? 'null',
      writeTextFile,
      random: sequenceRandom(0, 0, 0),
      runPokegen,
    })

    expect(runPokegen).toHaveBeenNthCalledWith(1, 'Pidgey', 5, '/repo/out', 'wild-forest')
    expect(runPokegen).toHaveBeenNthCalledWith(2, 'Rattata', 6, '/repo/out', 'wild-forest')
    expect(result).toEqual({
      beforeCount: 1,
      failures: 0,
      files: [
        { name: 'wild-forest-pidgey.json', content: undefined },
        { name: 'wild-forest-rattata.json', content: undefined },
      ],
    })
    expect(writeTextFile).toHaveBeenCalledTimes(2)
    const persisted = JSON.parse(contents.get('/repo/out/wild-forest-pidgey.json')!) as CharacterSheet
    expect(persisted.skillBackground).toEqual({
      description: 'Wary Canopy Trail-Bounder',
      raised: ['Acrobatics', 'Athletics'],
      lowered: ['Charm'],
    })
    expect(contents.get('/repo/out/wild-forest-pidgey.json')).toMatch(/\n$/)
  })

  it('includes decorated preview file contents when requested', async () => {
    const files: string[] = []
    const contents = new Map<string, string>()
    const runPokegen = vi.fn(async (_species: string, _level: number, dir: string) => {
      files.push('preview-pidgey.json')
      contents.set(joinPath(dir, 'preview-pidgey.json'), JSON.stringify(generatedSheet('Pidgey', 5)))
      return { ok: true, stderr: '' }
    })
    const writeTextFile = vi.fn()

    const result = await runPokegenForRolledEncounters({
      rolled: [rolled[0]],
      dir: '/tmp/preview',
      slugPrefix: 'preview-forest',
      preview: true,
      pathExists: () => false,
      listDirectory: () => [...files],
      readTextFile: (path) => contents.get(path) ?? 'null',
      writeTextFile,
      random: sequenceRandom(0, 0, 0),
      runPokegen,
    })

    expect(result).toMatchObject({
      beforeCount: 0,
      failures: 0,
      files: [{ name: 'preview-pidgey.json' }],
    })
    expect(JSON.parse(result.files[0]!.content!)).toMatchObject({
      skillBackground: {
        description: 'Wary Canopy Trail-Bounder',
        raised: ['Acrobatics', 'Athletics'],
        lowered: ['Charm'],
      },
    })
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('records failed and no-output runs without stopping later encounters', async () => {
    const files: string[] = []
    const runPokegen = vi.fn(async (species: string) => {
      if (species === 'Pidgey') return { ok: false, stderr: ' nope\n' }
      return { ok: true, stderr: '' }
    })

    const result = await runPokegenForRolledEncounters({
      rolled,
      dir: '/repo/out',
      slugPrefix: 'wild-forest',
      preview: false,
      pathExists: () => true,
      listDirectory: () => [...files],
      readTextFile: () => 'unused',
      writeTextFile: vi.fn(),
      random: sequenceRandom(0),
      runPokegen,
    })

    expect(runPokegen).toHaveBeenCalledTimes(2)
    expect(result.failures).toBe(2)
    expect(result.files).toEqual([
      { name: 'Pidgey Lv 5', error: 'nope' },
      { name: 'Rattata Lv 6', error: 'pokegen exited 0 but did not write a new file' },
    ])
  })

  it('reports invalid generated JSON as a per-file decorating failure', async () => {
    const files: string[] = []
    const runPokegen = vi.fn(async (_species: string, _level: number, dir: string, slugPrefix: string) => {
      const filename = `${slugPrefix}-pidgey.json`
      files.push(filename)
      return { ok: true, stderr: '' }
    })

    const result = await runPokegenForRolledEncounters({
      rolled: [rolled[0]],
      dir: '/repo/out',
      slugPrefix: 'wild-forest',
      preview: false,
      pathExists: () => true,
      listDirectory: () => [...files],
      readTextFile: () => '{not json',
      writeTextFile: vi.fn(),
      random: sequenceRandom(0),
      runPokegen,
    })

    expect(result.failures).toBe(1)
    expect(result.files).toEqual([
      expect.objectContaining({
        name: 'wild-forest-pidgey.json',
        error: expect.any(String),
      }),
    ])
  })
})
