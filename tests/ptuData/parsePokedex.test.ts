import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const parseEntries = (paths: string[]): Record<string, { species: string; types: string[] }> => {
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
    }
print(json.dumps(result))
`

  return JSON.parse(execFileSync('python3', ['-c', script, ...paths], { encoding: 'utf-8' }))
}

describe('PTU Pokédex parser species titles', () => {
  it('keeps punctuated species names from falling through to the HP stat label', () => {
    const entries = parseEntries([
      'books/markdown/pokedexes/gen1/nidoran-f.md',
      'books/markdown/pokedexes/gen1/nidoran-m.md',
      'books/markdown/pokedexes/gen1/farfetchd.md',
      'books/markdown/pokedexes/gen4/mime-jr.md',
      'books/markdown/pokedexes/gen7/zygarde-10.md',
    ])

    expect(entries['books/markdown/pokedexes/gen1/nidoran-f.md']).toEqual({ species: 'Nidoran (F)', types: ['Poison'] })
    expect(entries['books/markdown/pokedexes/gen1/nidoran-m.md']).toEqual({ species: 'Nidoran (M)', types: ['Poison'] })
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
})
