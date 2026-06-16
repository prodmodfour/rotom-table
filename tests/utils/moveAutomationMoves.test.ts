import { describe, expect, it } from 'vitest'
import {
  buildMoveAutomationMoveEntries,
  filterMoveAutomationMoveEntries,
  moveAutomationRequiresTargets,
  selectedMoveAutomationTargets,
  selectMoveAutomationEntry,
  sortMoveAutomationTargets,
  toggleMoveAutomationTargetIds,
} from '~/utils/moveAutomationMoves'
import { STRUGGLE_ATTACK_MOVE_NAMES } from '~/utils/struggleMoves'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 0,
  targetMode: 'multi-target',
  targetCount: null,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: '',
  effect: '',
  keywords: [],
  criticalRange: null,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

const token = (id: string, species: string): SpawnedPokemon => ({
  id,
  species,
  slug: species.toLowerCase(),
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: species.toLowerCase(),
  level: 1,
  currentHp: 10,
  maxHp: 10,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
})

describe('move automation move helpers', () => {
  it('builds move entries only for explicit automated sheet moves', () => {
    const entries = buildMoveAutomationMoveEntries([
      { name: 'Scratch' },
      { name: '  ' },
      { name: 'Custom Move', type: 'Psychic', category: 'Status', effect: 'Focus deeply' },
    ])

    expect(entries.map((entry) => entry.move.name)).toEqual(['Scratch'])
    expect(entries[0].script.moveName).toBe('Scratch')
  })

  it('applies STAB to canonical damaging move DB for automation', () => {
    const [entry] = buildMoveAutomationMoveEntries([{ name: 'Tackle' }], { stabTypes: ['Normal'] })

    expect(entry.hasStab).toBe(true)
    expect(entry.script.damageBase).toBe(6)
    expect(entry.move.damage_roll).toBeNull()
  })

  it('builds reviewed first-batch missing move entries from explicit scripts', () => {
    const reviewedNames = [
      'Accelerock',
      'Branch Poke',
      'Leafage',
      'Aerial Ace',
      'Aura Sphere',
      'False Surrender',
      'Feint Attack',
      'Magnet Bomb',
      'Sacred Sword',
      'Shadow Punch',
      'Shock Wave',
      'Smart Strike',
      'Mud Bomb',
      'Octazooka',
    ]
    const entries = buildMoveAutomationMoveEntries(reviewedNames.map((name) => ({ name })))
    const entriesByName = new Map(entries.map((entry) => [entry.move.name, entry]))

    expect(entries.map((entry) => entry.move.name)).toEqual(reviewedNames)
    for (const name of reviewedNames) {
      expect(entriesByName.get(name)?.script).toMatchObject({
        moveName: name,
        targetMode: 'one-target',
        targetCount: 1,
        damaging: true,
      })
    }

    for (const name of ['Aerial Ace', 'Aura Sphere', 'False Surrender', 'Feint Attack', 'Magnet Bomb', 'Sacred Sword', 'Shadow Punch', 'Shock Wave', 'Smart Strike']) {
      expect(entriesByName.get(name)?.script.requiresAccuracy).toBe(false)
    }

    expect(entriesByName.get('Mud Bomb')?.script.stageSuggestions).toEqual([
      { recipient: 'target', key: 'acc', delta: -1, label: 'Mud Bomb lowers Accuracy on 16+: -1 Accuracy CS', threshold: '16+', optional: true },
    ])
    expect(entriesByName.get('Octazooka')?.script.stageSuggestions).toEqual([
      { recipient: 'target', key: 'acc', delta: -1, label: 'Octazooka lowers Accuracy on even roll: -1 Accuracy CS', threshold: 'even roll', optional: true },
    ])
  })

  it('builds next reviewed plain area damage move entries from explicit scripts', () => {
    const reviewedNames = ['Dragon Hammer', 'Egg Bomb', 'Land’s Wrath']
    const entries = buildMoveAutomationMoveEntries(reviewedNames.map((name) => ({ name })))
    const entriesByName = new Map(entries.map((entry) => [entry.move.name, entry]))

    expect(entries.map((entry) => entry.move.name)).toEqual(reviewedNames)
    for (const name of reviewedNames) {
      expect(entriesByName.get(name)?.script).toMatchObject({
        moveName: name,
        targetMode: 'multi-target',
        targetCount: null,
        damaging: true,
      })
      expect(entriesByName.get(name)?.script.areaTemplates?.length).toBeGreaterThan(0)
    }
  })

  it('uses Pokémon Loyalty for Return and Frustration automation scripts', () => {
    const entries = buildMoveAutomationMoveEntries([
      { name: 'Return' },
      { name: 'Frustration' },
    ], { loyalty: 4 })

    expect(entries.find((entry) => entry.move.name === 'Return')?.script).toMatchObject({
      damaging: true,
      damageBase: 7,
    })
    expect(entries.find((entry) => entry.move.name === 'Frustration')?.script).toMatchObject({
      damaging: true,
      damageBase: 5,
    })
  })

  it('skips loyalty-based automation scripts until Loyalty is set', () => {
    expect(buildMoveAutomationMoveEntries([{ name: 'Return' }])).toEqual([])
  })

  it('defers STAB for dynamic Damage Base move scripts', () => {
    const [entry] = buildMoveAutomationMoveEntries([{ name: 'Fury Attack' }], { stabTypes: ['Normal'] })

    expect(entry.hasStab).toBe(true)
    expect(entry.script.damageBase).toBe(2)
    expect(entry.script.stabDamageBaseBonus).toBe(2)
    expect(entry.script.dynamicDamageBase).toMatchObject({ kind: 'five-strike' })
  })

  it('uses explicit Struggle scripts without STAB and applies Expert Combat Skill overrides', () => {
    const names = STRUGGLE_ATTACK_MOVE_NAMES.map((name) => ({ name }))
    const entries = buildMoveAutomationMoveEntries(names, {
      stabTypes: ['Normal', 'Fire', 'Water', 'Ice', 'Flying', 'Rock', 'Electric'],
      combatSkillRankValue: 5,
    })

    expect(entries.map((entry) => entry.move.name)).toEqual(STRUGGLE_ATTACK_MOVE_NAMES)
    expect(entries.every((entry) => !entry.hasStab)).toBe(true)
    expect(entries.every((entry) => entry.script.ac === 3)).toBe(true)
    expect(entries.every((entry) => entry.script.damageBase === 5)).toBe(true)
    expect(entries.every((entry) => entry.move.damage_roll == null)).toBe(true)
  })

  it('carries canonical move special text into automation entries', () => {
    const [entry] = buildMoveAutomationMoveEntries([{ name: 'Ember' }])

    expect(entry.script.special).toBe('Grants Firestarter')
  })

  it('filters explicit entries by script and sheet move fields while preserving no-query order', () => {
    const entries = buildMoveAutomationMoveEntries([
      { name: 'Scratch', frequency: 'At-Will' },
      { name: 'Psybeam' },
      { name: 'Custom Move', type: 'Psychic', category: 'Status', effect: 'Focus deeply' },
    ])

    expect(filterMoveAutomationMoveEntries(entries, '').map((entry) => entry.move.name)).toEqual(['Scratch', 'Psybeam'])
    expect(filterMoveAutomationMoveEntries(entries, 'psychic').map((entry) => entry.move.name)).toEqual(['Psybeam'])
    expect(filterMoveAutomationMoveEntries(entries, 'scratch').map((entry) => entry.move.name)).toEqual(['Scratch'])
    expect(filterMoveAutomationMoveEntries(entries, 'focus deeply')).toEqual([])
    expect(filterMoveAutomationMoveEntries(buildMoveAutomationMoveEntries([{ name: 'Ember' }]), 'firestarter').map((entry) => entry.move.name)).toEqual(['Ember'])
  })

  it('selects requested move entries with first-entry fallback', () => {
    const entries = buildMoveAutomationMoveEntries([{ name: 'Scratch' }, { name: 'Growl' }])

    expect(selectMoveAutomationEntry(entries, 'Growl')?.move.name).toBe('Growl')
    expect(selectMoveAutomationEntry(entries, 'Missing')?.move.name).toBe('Scratch')
    expect(selectMoveAutomationEntry([], 'Missing')).toBeNull()
  })

  it('sorts and resolves selected targets without mutating inputs', () => {
    const tokens = [token('b', 'Zubat'), token('a', 'Abra')]

    expect(sortMoveAutomationTargets(tokens).map((item) => item.species)).toEqual(['Abra', 'Zubat'])
    expect(tokens.map((item) => item.species)).toEqual(['Zubat', 'Abra'])
    expect(selectedMoveAutomationTargets(['a', 'missing', 'b'], tokens).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('detects target-requiring scripts', () => {
    expect(moveAutomationRequiresTargets(script({ targetMode: 'one-target' }))).toBe(true)
    expect(moveAutomationRequiresTargets(script({ targetMode: 'multi-target' }))).toBe(true)
    expect(moveAutomationRequiresTargets(script({ targetMode: 'self' }))).toBe(false)
    expect(moveAutomationRequiresTargets(null)).toBe(false)
  })

  it('toggles target ids according to mode and target count', () => {
    expect(toggleMoveAutomationTargetIds([], 'a', script({ targetMode: 'one-target', targetCount: 1 }))).toEqual(['a'])
    expect(toggleMoveAutomationTargetIds(['a'], 'a', script({ targetMode: 'one-target', targetCount: 1 }))).toEqual([])
    expect(toggleMoveAutomationTargetIds(['a'], 'b', script({ targetMode: 'one-target', targetCount: 1 }))).toEqual(['b'])

    const limited = script({ targetMode: 'multi-target', targetCount: 2 })
    expect(toggleMoveAutomationTargetIds(['a'], 'b', limited)).toEqual(['a', 'b'])
    expect(toggleMoveAutomationTargetIds(['a', 'b'], 'c', limited)).toEqual(['a', 'b'])
    expect(toggleMoveAutomationTargetIds(['a', 'b'], 'a', limited)).toEqual(['b'])

    expect(toggleMoveAutomationTargetIds(['a'], 'b', null)).toEqual(['a'])
  })
})
