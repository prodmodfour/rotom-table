import { describe, expect, it } from 'vitest'
import {
  initiativeOrderIds,
  orderInitiativeEntries,
  type InitiativeOrderEntry,
} from '#shared/initiativeOrder'

const entry = (
  id: string,
  initiativeScore: number,
  displayName = id,
  hasExplicitInitiative = true,
): InitiativeOrderEntry => ({
  id,
  displayName,
  hasExplicitInitiative,
  initiativeScore,
})

const calculatedEntries = [
  entry('b', 20, 'Bravo'),
  entry('c', 10, 'Charlie'),
  entry('a', 30, 'Alpha'),
]

describe('initiative order', () => {
  it('returns calculated order when no manual list is provided', () => {
    expect(orderInitiativeEntries(calculatedEntries).map((orderedEntry) => orderedEntry.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(initiativeOrderIds(calculatedEntries)).toEqual(['a', 'b', 'c'])
  })

  it('overlays manual ids before appending remaining calculated entries', () => {
    expect(initiativeOrderIds(calculatedEntries, ['c', 'a'])).toEqual(['c', 'a', 'b'])
  })

  it('ignores unknown manual ids', () => {
    expect(initiativeOrderIds(calculatedEntries, ['missing', 'c', 'a'])).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('ignores duplicate manual ids after the first occurrence', () => {
    expect(initiativeOrderIds(calculatedEntries, ['c', 'a', 'c', 'b'])).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('appends combatants missing from manual order in calculated order', () => {
    const entriesWithNewCombatants = [
      ...calculatedEntries,
      entry('d', 25, 'Delta'),
      entry('e', 5, 'Echo'),
    ]

    expect(initiativeOrderIds(entriesWithNewCombatants, ['c', 'a'])).toEqual([
      'c',
      'a',
      'd',
      'b',
      'e',
    ])
  })
})
