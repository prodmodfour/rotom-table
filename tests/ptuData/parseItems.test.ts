import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

type ItemRecord = {
  name: string
  costs?: string[]
  effects?: string[]
}

const typeNames = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison',
  'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark',
  'Steel', 'Fairy',
] as const

const parseItems = (): Record<string, ItemRecord | null> => {
  const script = String.raw`
import contextlib
import importlib.util
import json
import os
import sys
from pathlib import Path

repo = Path.cwd()
spec = importlib.util.spec_from_file_location('rotom_parse_items', repo / 'ptu-data' / 'parse_items.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with open(os.devnull, 'w', encoding='utf-8') as devnull:
    with contextlib.redirect_stdout(devnull):
        items = module.parse_items()

print(json.dumps({name: items.get(name) for name in sys.argv[1:]}))
`

  return JSON.parse(execFileSync('python3', [
    '-c',
    script,
    'Type Boosters',
    ...typeNames.map((typeName) => `${typeName} Type Booster`),
    'Type Brace',
    ...typeNames.map((typeName) => `${typeName} Type Brace`),
  ], { encoding: 'utf-8' }))
}

describe('PTU item parser', () => {
  it('splits the generic Type Boosters row into type-specific held items', () => {
    const items = parseItems()

    expect(items['Type Boosters']).toBeNull()
    for (const typeName of typeNames) {
      expect(items[`${typeName} Type Booster`]).toMatchObject({
        name: `${typeName} Type Booster`,
        costs: ['$1800'],
        effects: [
          `Grants a +5 Damage Bonus to all direct damage ${typeName} Type Moves when performed by the user. Accessory Item for Trainers.`,
        ],
      })
    }
  })

  it('splits the generic Type Brace row into type-specific held items', () => {
    const items = parseItems()

    expect(items['Type Brace']).toBeNull()
    for (const typeName of typeNames) {
      expect(items[`${typeName} Type Brace`]).toMatchObject({
        name: `${typeName} Type Brace`,
        costs: ['$2000'],
        effects: [
          `Grants the holder 15 Damage Reduction against ${typeName} Type attacks. Accessory Item for Trainers.`,
        ],
      })
    }
  })
})
