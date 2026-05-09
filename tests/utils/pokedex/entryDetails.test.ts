import { describe, expect, it } from 'vitest'
import {
  capabilityTokensForEntry,
  dietSummaryForEntry,
  eggGroupSummaryForEntry,
  eggMoveTokensForEntry,
  genderSummaryForEntry,
  habitatSummaryForEntry,
  heightLabelForEntry,
  isPlacementOnlyEntry,
  pageNumberForSelectedEntry,
  skillPhraseForEntry,
  tmHmTokensForEntry,
  tutorMoveTokensForEntry,
  weightLabelForEntry,
} from '~/utils/pokedex/entryDetails'
import type { PokedexRecord } from '~/types/pokemon'

describe('pokedex entry detail helpers', () => {
  const entry: PokedexRecord = {
    species: 'Pikachu',
    size: 'Small',
    height: 0.4,
    weight: 1,
    male_pct: 50,
    female_pct: 50,
    egg_groups: ['Field', 'Fairy'],
    diet: ['Herbivore'],
    habitat: ['Forest', 'Urban'],
    capabilities: { overland: 6, sky: 0, jump: '2/3', other: ['Glow'] },
    tm_hm_moves: [
      { kind: 'TM', number: '24', name: 'Thunderbolt' },
      { kind: 'HM', number: '03', name: 'Surf' },
    ],
    egg_moves: ['Fake Out'],
    tutor_moves: [
      { name: 'Iron Tail', heart_scale: true },
      { name: 'Signal Beam', heart_scale: false },
    ],
    skills: { Athletics: '3d6', Acrobatics: '4d6+2', Charm: '2d6' },
  }

  it('summarizes identity, vitals, and placement-only state', () => {
    expect(isPlacementOnlyEntry({ species: 'Token only' })).toBe(true)
    expect(isPlacementOnlyEntry({ species: 'Stat block', base_stats: { hp: 1, atk: 1, def: 1, spatk: 1, spdef: 1, spd: 1 } })).toBe(false)
    expect(genderSummaryForEntry(entry)).toBe('50% M / 50% F')
    expect(genderSummaryForEntry({ species: 'Ditto', genderless: true })).toBe('Genderless')
    expect(heightLabelForEntry(entry)).toBe('1\' 4" / 0.4m (Small)')
    expect(weightLabelForEntry(entry)).toBe('Weight Class 1')
  })

  it('builds capability and move display tokens', () => {
    expect(capabilityTokensForEntry(entry)).toEqual([
      { display: 'Overland 6', ref: null },
      { display: 'Jump 2/3', ref: null },
      { display: 'Glow', ref: 'Glow' },
    ])
    expect(tmHmTokensForEntry(entry)).toEqual([
      { name: 'Thunderbolt', display: '24 Thunderbolt' },
      { name: 'Surf', display: 'H03 Surf' },
    ])
    expect(eggMoveTokensForEntry(entry)).toEqual([{ name: 'Fake Out', display: 'Fake Out' }])
    expect(tutorMoveTokensForEntry(entry)).toEqual([
      { name: 'Iron Tail', display: 'Iron Tail (N)' },
      { name: 'Signal Beam', display: 'Signal Beam' },
    ])
  })

  it('formats skill, breeding, diet, habitat, and page-number summaries', () => {
    expect(skillPhraseForEntry(entry)).toBe('Athl 3d6, Acro 4d6+2, Charm 2d6')
    expect(eggGroupSummaryForEntry(entry)).toBe('Field / Fairy')
    expect(dietSummaryForEntry(entry)).toBe('Herbivore')
    expect(habitatSummaryForEntry(entry)).toBe('Forest, Urban')
    expect(pageNumberForSelectedEntry('c', [{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(3)
    expect(pageNumberForSelectedEntry('b', [{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(2)
    expect(pageNumberForSelectedEntry(null, [], [])).toBeNull()
  })
})
