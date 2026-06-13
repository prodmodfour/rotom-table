import { describe, expect, it } from 'vitest'
import { findItem, items } from '~~/data/ptuReference'

describe('PTU item reference data', () => {
  it('exposes fishing rods as three distinct purchasable items', () => {
    expect(items.map((item) => item.name)).not.toContain('Fishing Rod')

    expect(findItem('Old Rod')).toMatchObject({
      name: 'Old Rod',
      costs: ['$1000'],
    })
    expect(findItem('Good Rod')).toMatchObject({
      name: 'Good Rod',
      costs: ['$5,000'],
    })
    expect(findItem('Super Rod')).toMatchObject({
      name: 'Super Rod',
      costs: ['$15,000'],
    })
  })
})
