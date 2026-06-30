import { describe, expect, it } from 'vitest'
import {
  groupInventoryChannel,
  isRealtimeEcho,
  mapChannel,
  normalizeRealtimeClientId,
  sheetChannel,
  shopChannel,
  shopsChannel,
  type RealtimeEvent,
} from '#shared/realtime'

describe('realtime helpers', () => {
  it('builds canonical channel names', () => {
    expect(mapChannel('demo-map')).toBe('map:demo-map')
    expect(sheetChannel('pokemon', 'pikachu')).toBe('sheet:pokemon:pikachu')
    expect(sheetChannel('trainer', 'brock')).toBe('sheet:trainer:brock')
    expect(groupInventoryChannel('main')).toBe('group-inventory:main')
    expect(shopChannel('viridian-mart')).toBe('shop:viridian-mart')
    expect(shopsChannel).toBe('shops')
  })

  it('normalizes optional client ids at request boundaries', () => {
    expect(normalizeRealtimeClientId('client-1')).toBe('client-1')
    expect(normalizeRealtimeClientId('')).toBe('')
    expect(normalizeRealtimeClientId(123)).toBeUndefined()
    expect(normalizeRealtimeClientId(null)).toBeUndefined()
    expect(normalizeRealtimeClientId(undefined)).toBeUndefined()
  })

  it('detects own realtime echoes without treating missing client ids as echoes', () => {
    const ownEvent = { clientId: 'client-1' } as Pick<RealtimeEvent, 'clientId'>
    const otherEvent = { clientId: 'client-2' } as Pick<RealtimeEvent, 'clientId'>
    const anonymousEvent = {} as Pick<RealtimeEvent, 'clientId'>

    expect(isRealtimeEcho(ownEvent, 'client-1')).toBe(true)
    expect(isRealtimeEcho(otherEvent, 'client-1')).toBe(false)
    expect(isRealtimeEcho(anonymousEvent, 'client-1')).toBe(false)
    expect(isRealtimeEcho(ownEvent, undefined)).toBe(false)
    expect(isRealtimeEcho(null, 'client-1')).toBe(false)
  })
})
