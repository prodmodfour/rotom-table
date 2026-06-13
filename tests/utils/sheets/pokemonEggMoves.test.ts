import { describe, expect, it } from 'vitest'
import { pokemonEggMoveFieldValue, pokemonEggMoveOptionsForSheet } from '~/utils/sheets/pokemonEggMoves'
import type { CharacterSheet } from '~/types/characterSheet'

const sheet = (eggMoves: CharacterSheet['eggMoves']): Pick<CharacterSheet, 'eggMoves'> => ({ eggMoves })

describe('pokemon egg move helpers', () => {
  it('builds inherited-move dropdown options from the sheet egg moves', () => {
    expect(pokemonEggMoveOptionsForSheet(sheet([
      { name: 'Fake Out' },
      { name: '  ' },
      { name: 'Volt Tackle' },
      { name: 'Fake Out' },
    ]))).toEqual(['Fake Out', 'Volt Tackle'])
  })

  it('returns no inherited-move options when the sheet has no egg moves', () => {
    expect(pokemonEggMoveOptionsForSheet(sheet(undefined))).toEqual([])
    expect(pokemonEggMoveOptionsForSheet(null)).toEqual([])
  })

  it('looks up reference-backed egg move details', () => {
    expect(pokemonEggMoveFieldValue({ name: 'Tackle' }, 'type')).toBe('Normal')
    expect(pokemonEggMoveFieldValue({ name: 'Unknown Move' }, 'type')).toBe('')
  })
})
