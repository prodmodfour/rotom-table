import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type MoveRecord = {
  name: string
  effect?: string
}

const moveNames = ['Acid Armor', 'Acid', 'Acid Spray', 'Solar Blade', 'Pin Missile', 'Water Shuriken']

const parseMoves = (): Record<string, MoveRecord> => {
  const script = String.raw`
import contextlib
import importlib.util
import json
import os
import sys
from pathlib import Path

repo = Path.cwd()
spec = importlib.util.spec_from_file_location('rotom_parse_moves', repo / 'ptu-data' / 'parse_moves.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with open(os.devnull, 'w', encoding='utf-8') as devnull:
    with contextlib.redirect_stdout(devnull):
        moves = module.parse_moves()

print(json.dumps({name: moves[name] for name in sys.argv[1:]}))
`

  return JSON.parse(execFileSync('python3', ['-c', script, ...moveNames], { encoding: 'utf-8' }))
}

const readRuntimeMoves = (): Record<string, MoveRecord> => {
  const movesPath = join(process.cwd(), 'data', 'reference', 'moves.json')
  return JSON.parse(readFileSync(movesPath, 'utf-8'))
}

const expectMoveEffects = (moves: Record<string, MoveRecord>) => {
  expect(moves['Acid Armor'].effect).toContain('Set-Up Effect:')
  expect(moves['Acid Armor'].effect).toContain('Resolution Effect:')
  expect(moves['Acid Armor'].effect).not.toContain('Contest Type:')
  expect(moves['Solar Blade'].effect).toContain('Set-Up Effect:')
  expect(moves['Solar Blade'].effect).toContain('Effect: The user attacks with Solar Blade.')
  expect(moves.Acid.effect).toBe('Acid lowers the target’s Special Defense 1 Combat Stage on 18+.')
  expect(moves['Acid Spray'].effect).toBe('Acid Spray lowers the target’s Special Defense 2 Combat Stages.')
  expect(moves['Pin Missile'].effect).toBe('None')
  expect(moves['Water Shuriken'].effect).toBe('None')
}

describe('PTU move parser effects', () => {
  it('keeps labelled set-up effects and plain/None effects', () => {
    expectMoveEffects(parseMoves())
  })
})

describe('runtime PTU move reference effects', () => {
  it('contains parser-generated move descriptions used by lookups', () => {
    expectMoveEffects(readRuntimeMoves())
  })
})
