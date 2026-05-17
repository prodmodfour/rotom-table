import { describe, expect, it } from 'vitest'
import { splitInitiativeTimeline } from '~/utils/initiativeTimeline'

const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }))

describe('splitInitiativeTimeline', () => {
  it('splits acted, current, and upcoming turns without duplicating entries', () => {
    const timeline = splitInitiativeTimeline(rows, 'c')

    expect(timeline.past.map((row) => row.id)).toEqual(['a', 'b'])
    expect(timeline.current?.id).toBe('c')
    expect(timeline.upcoming.map((row) => row.id)).toEqual(['d'])
  })

  it('treats the order as upcoming when no active turn is set', () => {
    const timeline = splitInitiativeTimeline(rows, null)

    expect(timeline.past).toEqual([])
    expect(timeline.current).toBeNull()
    expect(timeline.upcoming.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('shows the previous-round turn just gone once at the top of a later round', () => {
    const timeline = splitInitiativeTimeline(rows, 'a', 2)

    expect(timeline.past.map((row) => row.id)).toEqual(['d'])
    expect(timeline.current?.id).toBe('a')
    expect(timeline.upcoming.map((row) => row.id)).toEqual(['b', 'c'])
  })
})
