import { describe, expect, it } from 'vitest'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  createDefaultGroupInventoryDocument,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import { applyGroupInventoryRealtimeEvent } from '~/utils/groupInventoryRealtime'

const groupInventory = (overrides: Partial<GroupInventoryDocument> = {}): GroupInventoryDocument => ({
  ...createDefaultGroupInventoryDocument({ now: 100 }),
  revision: 2,
  updatedAt: 200,
  money: 100,
  ...overrides,
})

const updatedEvent = (document: GroupInventoryDocument, overrides: Record<string, unknown> = {}) => ({
  channel: 'group-inventory:main',
  type: 'updated',
  revision: document.revision,
  timestamp: 300,
  data: {
    slug: GROUP_INVENTORY_MAIN_SLUG,
    document,
  },
  ...overrides,
})

describe('group inventory realtime client application', () => {
  it('adopts newer authoritative group inventory documents from realtime events', () => {
    const current = groupInventory({ revision: 2, money: 100 })
    const incoming = groupInventory({ revision: 3, updatedAt: 300, money: 250 })

    expect(applyGroupInventoryRealtimeEvent(updatedEvent(incoming), {
      currentDocument: current,
      clientId: 'client-a',
    })).toEqual({ status: 'adopted', document: incoming })
  })

  it('ignores echo and stale events so the originating tab does not duplicate its own mutation', () => {
    const current = groupInventory({ revision: 4, money: 250 })
    const ownEvent = updatedEvent(current, { clientId: 'client-a' })
    const staleEvent = updatedEvent(groupInventory({ revision: 3, money: 100 }))

    expect(applyGroupInventoryRealtimeEvent(ownEvent, {
      currentDocument: current,
      clientId: 'client-a',
    })).toEqual({ status: 'ignored-echo' })
    expect(applyGroupInventoryRealtimeEvent(staleEvent, {
      currentDocument: current,
      clientId: 'client-a',
    })).toEqual({ status: 'ignored-stale' })
  })

  it('rejects malformed group inventory update payloads', () => {
    const document = groupInventory({ revision: 3 })

    expect(applyGroupInventoryRealtimeEvent(updatedEvent(document, { revision: 4 }))).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('revision'),
    })
    expect(applyGroupInventoryRealtimeEvent({
      channel: 'group-inventory:main',
      type: 'updated',
      data: { slug: 'other', document },
    })).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('complete document'),
    })
  })
})
