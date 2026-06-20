import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

interface ParsedPokedexEntry {
  species: string | null
  types: string[]
  tm_hm_moves: Array<{ kind: 'TM' | 'HM'; number: string; name: string }>
}

const parseEntries = (paths: string[]): Record<string, ParsedPokedexEntry> => {
  const script = String.raw`
import importlib.util
import json
import sys
from pathlib import Path

repo = Path.cwd()
spec = importlib.util.spec_from_file_location('rotom_parse_pokedex', repo / 'ptu-data' / 'parse_pokedex.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

result = {}
for relative_path in sys.argv[1:]:
    entry = module.parse_pokemon_file(str(repo / relative_path))
    result[relative_path] = {
        'species': entry['species'] if entry else None,
        'types': entry.get('types', []) if entry else [],
        'tm_hm_moves': entry.get('tm_hm_moves', []) if entry else [],
    }
print(json.dumps(result))
`

  return JSON.parse(execFileSync('python3', ['-c', script, ...paths], { encoding: 'utf-8' }))
}

describe('PTU Pokédex parser', () => {
  it('keeps punctuated species names from falling through to the HP stat label', () => {
    const entries = parseEntries([
      'books/markdown/pokedexes/gen1/nidoran-f.md',
      'books/markdown/pokedexes/gen1/nidoran-m.md',
      'books/markdown/pokedexes/gen1/farfetchd.md',
      'books/markdown/pokedexes/gen4/mime-jr.md',
      'books/markdown/pokedexes/gen7/zygarde-10.md',
    ])

    expect(entries['books/markdown/pokedexes/gen1/nidoran-f.md']).toMatchObject({ species: 'Nidoran (F)', types: ['Poison'] })
    expect(entries['books/markdown/pokedexes/gen1/nidoran-m.md']).toMatchObject({ species: 'Nidoran (M)', types: ['Poison'] })
    expect(entries['books/markdown/pokedexes/gen1/farfetchd.md'].species).toBe('Farfetch’d')
    expect(entries['books/markdown/pokedexes/gen4/mime-jr.md'].species).toBe('Mime Jr.')
    expect(entries['books/markdown/pokedexes/gen7/zygarde-10.md'].species).toBe('Zygarde 10% Forme')
  })

  it('keeps title subtitles that are part of form names', () => {
    const entries = parseEntries([
      'books/markdown/pokedexes/gen4/rotom.md',
      'books/markdown/pokedexes/gen4/wormadam.md',
    ])

    expect(entries['books/markdown/pokedexes/gen4/rotom.md'].species).toBe('Rotom Appliance Forms')
    expect(entries['books/markdown/pokedexes/gen4/wormadam.md'].species).toBe('Wormadam Plant Cloak Form')
  })

  it('parses machine moves from TM-only labels and all-machine notes', () => {
    const entries = parseEntries([
      'books/markdown/pokedexes/gen1/mew.md',
      'books/markdown/pokedexes/gen8/grookey.md',
    ])

    const mewMachines = entries['books/markdown/pokedexes/gen1/mew.md'].tm_hm_moves
    expect(mewMachines.length).toBeGreaterThan(100)
    expect(mewMachines).toContainEqual({ kind: 'HM', number: '01', name: 'Cut' })
    expect(mewMachines).toContainEqual({ kind: 'TM', number: '100', name: 'Confide' })

    const grookeyMachines = entries['books/markdown/pokedexes/gen8/grookey.md'].tm_hm_moves
    expect(grookeyMachines).toContainEqual({ kind: 'TM', number: '01', name: 'Work Up' })
    expect(grookeyMachines).toContainEqual({ kind: 'TM', number: '100', name: 'Confide' })
  })
})
