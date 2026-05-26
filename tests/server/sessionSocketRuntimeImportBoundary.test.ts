import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('session socket runtime import boundary', () => {
  it('keeps server command helpers away from the static character-sheet glob catalog', () => {
    const sheetSpawn = readText('src/utils/sheetSpawn.ts')
    const pokemonDerived = readText('src/utils/sheets/pokemonDerived.ts')

    expect(sheetSpawn).toContain("~~/data/reference/pokedex.json")
    expect(pokemonDerived).toContain("~~/data/reference/pokedex.json")
    expect(sheetSpawn).not.toContain("~~/data/characterSheets")
    expect(pokemonDerived).not.toContain("~~/data/characterSheets")
  })
})
