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

  const generateSheet = (species: string, level: string, slugPrefix: string) => {
    generatedDir = mkdtempSync(join(tmpdir(), 'rotom-pokegen-'))

    execFileSync('python3', [
      'ptu-data/cli.py',
      '--species', species,
      '--level', level,
      '--output-dir', generatedDir,
      '--slug-prefix', slugPrefix,
    ], { encoding: 'utf-8' })

    const [fileName] = readdirSync(generatedDir).filter((name) => name.endsWith('.json'))
    expect(fileName).toBeDefined()
    return JSON.parse(readFileSync(join(generatedDir, fileName!), 'utf-8'))
  }

  it('writes a chart-based total experience for the generated level', () => {
    const sheet = generateSheet('Pidgey', '30', 'test-xp')

    expect(sheet).toMatchObject({ species: 'Pidgey', level: 30, totalExp: 1165 })
  })

  it('records up to three species egg moves and only learns eligible inherited ones', () => {
    const sheet = generateSheet('Abra', '30', 'test-egg-moves')
    const pokedex = JSON.parse(readFileSync('data/reference/pokedex.json', 'utf-8'))
    const abra = pokedex.find((entry: { egg_moves?: string[], species?: string }) => entry.species === 'Abra')
    const eggMoveNames = new Set<string>(abra?.egg_moves ?? [])

    expect(Array.isArray(sheet.eggMoves)).toBe(true)
    expect(sheet.eggMoves.length).toBeLessThanOrEqual(3)
    expect(sheet.movelist.length).toBeLessThanOrEqual(6)
    expect(new Set(sheet.movelist.map((move: { name: string }) => move.name)).size).toBe(sheet.movelist.length)

    const knownEggMoves = sheet.eggMoves.filter((move: { name: string }) =>
      sheet.movelist.some((knownMove: { name: string }) => knownMove.name === move.name),
    )
    expect(knownEggMoves.length).toBeLessThanOrEqual(Math.min(sheet.eggMoves.length, 2))

    for (const move of sheet.eggMoves) {
      expect(eggMoveNames.has(move.name)).toBe(true)
    }
  })

  it('can roll the upper bound of three egg moves and learns them when inheritance slots allow', () => {
    const output = execFileSync('python3', ['-c', `
import json
import sys

sys.path.insert(0, 'ptu-data')

import generator
from generator import generate_pokemon
from sheet_emitter import to_character_sheet

with open('data/reference/pokedex.json', encoding='utf-8') as handle:
    pokedex = json.load(handle)
with open('data/reference/moves.json', encoding='utf-8') as handle:
    moves = json.load(handle)
with open('data/reference/abilities.json', encoding='utf-8') as handle:
    abilities = json.load(handle)

entry = next(entry for entry in pokedex if entry['species'] == 'Abra')
generator.random.seed(1)
generator.random.shuffle = lambda values: None
generator.random.randint = lambda low, high: high
sheet = to_character_sheet(
    generate_pokemon(entry, 30, moves, abilities, nature='Hardy'),
    slug='test-egg-move-cap',
)
print(json.dumps({
    'eggMoveNames': [move['name'] for move in sheet['eggMoves']],
    'moveNames': [move['name'] for move in sheet['movelist']],
    'inheritedMoves': sheet.get('inheritedMoves', {}),
}))
`], { encoding: 'utf-8' })
    const result = JSON.parse(output)

    expect(result.eggMoveNames).toEqual(['Ally Switch', 'Barrier', 'Encore'])
    expect(result.moveNames).toEqual(['Ally Switch', 'Barrier', 'Teleport'])
    expect(result.inheritedMoves).toEqual({ 20: 'Ally Switch', 30: 'Barrier' })
  })
})
