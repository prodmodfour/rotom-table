import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

let generatedDir: string | null = null

describe('PTU Pokémon generator CLI', () => {
  afterEach(() => {
    if (generatedDir) rmSync(generatedDir, { recursive: true, force: true })
    generatedDir = null
  })

  it('writes a chart-based total experience for the generated level', () => {
    generatedDir = mkdtempSync(join(tmpdir(), 'rotom-pokegen-'))

    execFileSync('python3', [
      'ptu-data/cli.py',
      '--species', 'Pidgey',
      '--level', '30',
      '--output-dir', generatedDir,
      '--slug-prefix', 'test-xp',
    ], { encoding: 'utf-8' })

    const [fileName] = readdirSync(generatedDir).filter((name) => name.endsWith('.json'))
    expect(fileName).toBeDefined()
    const sheet = JSON.parse(readFileSync(join(generatedDir, fileName!), 'utf-8'))

    expect(sheet).toMatchObject({ species: 'Pidgey', level: 30, totalExp: 1165 })
  })
})
