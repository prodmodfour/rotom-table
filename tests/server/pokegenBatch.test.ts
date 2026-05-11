import { describe, expect, it, vi } from 'vitest'
import { runPokegenForRolledEncounters } from '~/server/utils/pokegenBatch'
import type { RolledEncounter } from '~/types/encounterTable'

const rolled: RolledEncounter[] = [
  { species: 'Pidgey', level: 5, roll: 1 },
  { species: 'Rattata', level: 6, roll: 42 },
]

describe('runPokegenForRolledEncounters', () => {
  it('runs pokegen sequentially and reports generated persisted files', async () => {
    const files: string[] = ['existing.json']
    const runPokegen = vi.fn(async (species: string, _level: number, _dir: string, slugPrefix: string) => {
      files.push(`${slugPrefix}-${species.toLowerCase()}.json`)
      return { ok: true, stderr: '' }
    })

    const result = await runPokegenForRolledEncounters({
      rolled,
      dir: '/repo/out',
      slugPrefix: 'wild-forest',
      preview: false,
      pathExists: (path) => path === '/repo/out',
      listDirectory: () => [...files],
      readTextFile: () => 'unused',
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
  })

  it('includes preview file contents when requested', async () => {
    const files: string[] = []
    const runPokegen = vi.fn(async () => {
      files.push('preview-pidgey.json')
      return { ok: true, stderr: '' }
    })

    await expect(runPokegenForRolledEncounters({
      rolled: [rolled[0]],
      dir: '/tmp/preview',
      slugPrefix: 'preview-forest',
      preview: true,
      pathExists: () => false,
      listDirectory: () => [...files],
      readTextFile: (path) => `content:${path}`,
      runPokegen,
    })).resolves.toMatchObject({
      beforeCount: 0,
      failures: 0,
      files: [{ name: 'preview-pidgey.json', content: 'content:/tmp/preview/preview-pidgey.json' }],
    })
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
      runPokegen,
    })

    expect(runPokegen).toHaveBeenCalledTimes(2)
    expect(result.failures).toBe(2)
    expect(result.files).toEqual([
      { name: 'Pidgey Lv 5', error: 'nope' },
      { name: 'Rattata Lv 6', error: 'pokegen exited 0 but did not write a new file' },
    ])
  })
})
