import { describe, expect, it } from 'vitest'
import {
  itemInventoryInstanceId,
  parseItemInventoryInstanceId,
} from '#shared/itemAutomation/inventory'

describe('item inventory instance identity', () => {
  it('round-trips a source container, section, and stable row identity', () => {
    const ref = {
      containerKind: 'trainer' as const,
      containerSlug: 'fixture-trainer',
      section: 'medicalKit' as const,
      rowId: 'fixture-potion-row',
    }
    const instanceId = itemInventoryInstanceId(ref)
    expect(instanceId).toBe('item-instance:trainer:fixture-trainer:medicalKit:fixture-potion-row')
    expect(parseItemInventoryInstanceId(instanceId)).toEqual(ref)
  })

  it('separates equal row labels in different containers and sections', () => {
    const trainer = itemInventoryInstanceId({
      containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
    })
    const group = itemInventoryInstanceId({
      containerKind: 'group', containerSlug: 'main', section: 'medicalKit', rowId: 'potion-row',
    })
    const equipment = itemInventoryInstanceId({
      containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', rowId: 'potion-row',
    })
    expect(new Set([trainer, group, equipment]).size).toBe(3)
  })

  it('fails closed for malformed or unstable identities', () => {
    expect(parseItemInventoryInstanceId('trainer:ash:medicalKit:potion-row')).toBeNull()
    expect(parseItemInventoryInstanceId('item-instance:trainer:ash:unknown:potion-row')).toBeNull()
    expect(parseItemInventoryInstanceId('item-instance:trainer:ash:medicalKit:bad%00row')).toBeNull()
    expect(() => itemInventoryInstanceId({
      containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'bad row',
    })).toThrow('bounded stable identifier')
  })
})
