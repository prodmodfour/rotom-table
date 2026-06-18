import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type AbilityRecord = {
  trigger?: string
}

const parserAbilityNames = ['Chilling Neigh', 'Quick Draw', 'Thunder Boost']
const runtimeAbilityNames = [...parserAbilityNames, 'Perish Body']

const parseAbilities = (): Record<string, AbilityRecord> => {
  const script = String.raw`
import contextlib
import importlib.util
import json
import os
import sys
from pathlib import Path

repo = Path.cwd()
spec = importlib.util.spec_from_file_location('rotom_parse_abilities', repo / 'ptu-data' / 'parse_abilities.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with open(os.devnull, 'w', encoding='utf-8') as devnull:
    with contextlib.redirect_stdout(devnull):
        abilities = module.parse_abilities()

print(json.dumps({name: abilities[name] for name in sys.argv[1:]}))
`

  return JSON.parse(execFileSync('python3', ['-c', script, ...parserAbilityNames], { encoding: 'utf-8' }))
}

const readRuntimeAbilities = (): Record<string, AbilityRecord> => {
  const abilitiesPath = join(process.cwd(), 'data', 'reference', 'abilities.json')
  const abilities = JSON.parse(readFileSync(abilitiesPath, 'utf-8')) as Record<string, AbilityRecord>
  return Object.fromEntries(runtimeAbilityNames.map((name) => [name, abilities[name]]))
}

const expectMultilineTriggers = (abilities: Record<string, AbilityRecord>) => {
  expect(abilities['Chilling Neigh'].trigger).toBe('The user causes a foe to Faint with a damaging attack')
  expect(abilities['Quick Draw'].trigger).toBe('A foe uses a Move, and the user has not acted this round')
  expect(abilities['Thunder Boost'].trigger).toBe('An adjacent Ally uses a damaging Electric-Type Move')
}

describe('PTU ability parser triggers', () => {
  it('keeps continuation lines in trigger fields', () => {
    expectMultilineTriggers(parseAbilities())
  })
})

describe('runtime PTU ability reference triggers', () => {
  it('contains complete trigger text used by Pokédex ability tooltips', () => {
    const abilities = readRuntimeAbilities()

    expectMultilineTriggers(abilities)
    expect(abilities['Perish Body'].trigger).toBe('The user is hit with a Melee attack')
  })
})
