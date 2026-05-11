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
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'manual-fallback',
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
  it('builds move entries from non-empty sheet moves with manual fallback scripts', () => {
    const entries = buildMoveAutomationMoveEntries([
      { name: 'Scratch' },
      { name: '  ' },
      { name: 'Custom Move', type: 'Psychic', category: 'Status', effect: 'Focus deeply' },
    ])

    expect(entries.map((entry) => entry.move.name)).toEqual(['Scratch', 'Custom Move'])
    expect(entries[0].script.moveName).toBe('Scratch')
    expect(entries[1]).toMatchObject({ hasExplicitScript: false })
    expect(entries[1].script.effect).toContain('Focus deeply')
  })

  it('applies STAB to canonical damaging move DB for automation', () => {
    const [entry] = buildMoveAutomationMoveEntries([{ name: 'Tackle' }], { stabTypes: ['Normal'] })

    expect(entry.hasStab).toBe(true)
    expect(entry.script.damageBase).toBe(6)
    expect(entry.move.damage_roll).toBeNull()
  })

  it('filters entries by script and sheet move fields while preserving no-query order', () => {
    const entries = buildMoveAutomationMoveEntries([
      { name: 'Scratch', frequency: 'At-Will' },
      { name: 'Custom Move', type: 'Psychic', category: 'Status', effect: 'Focus deeply' },
    ])

    expect(filterMoveAutomationMoveEntries(entries, '').map((entry) => entry.move.name)).toEqual(['Scratch', 'Custom Move'])
    expect(filterMoveAutomationMoveEntries(entries, 'psychic').map((entry) => entry.move.name)).toEqual(['Custom Move'])
    expect(filterMoveAutomationMoveEntries(entries, 'at-will').map((entry) => entry.move.name)).toEqual(['Scratch'])
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
