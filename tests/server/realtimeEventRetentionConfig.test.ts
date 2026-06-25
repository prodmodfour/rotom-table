import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REALTIME_EVENT_MAX_ROWS,
  DEFAULT_REALTIME_EVENT_PRUNE_INTERVAL_MS,
  DEFAULT_REALTIME_EVENT_RETENTION_DAYS,
  loadRealtimeEventRetentionPolicy,
} from '../../server/realtime/realtimeEventRetentionConfig'

describe('realtime event retention configuration', () => {
  it('parses conservative defaults without touching the database', () => {
    expect(loadRealtimeEventRetentionPolicy({})).toEqual({
      enabled: true,
      retentionDays: DEFAULT_REALTIME_EVENT_RETENTION_DAYS,
      maxRows: DEFAULT_REALTIME_EVENT_MAX_ROWS,
      pruneIntervalMs: DEFAULT_REALTIME_EVENT_PRUNE_INTERVAL_MS,
    })
  })

  it('parses explicit environment overrides', () => {
    expect(loadRealtimeEventRetentionPolicy({
      ROTOM_REALTIME_EVENT_RETENTION_ENABLED: 'false',
      ROTOM_REALTIME_EVENT_RETENTION_DAYS: '7',
      ROTOM_REALTIME_EVENT_MAX_ROWS: '1000',
      ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS: '60000',
    })).toEqual({
      enabled: false,
      retentionDays: 7,
      maxRows: 1000,
      pruneIntervalMs: 60_000,
    })
  })

  it('rejects invalid production configuration clearly', () => {
    expect(() => loadRealtimeEventRetentionPolicy({
      ROTOM_REALTIME_EVENT_RETENTION_DAYS: '0',
    })).toThrow(/ROTOM_REALTIME_EVENT_RETENTION_DAYS.*between/)
    expect(() => loadRealtimeEventRetentionPolicy({
      ROTOM_REALTIME_EVENT_MAX_ROWS: '1.5',
    })).toThrow(/ROTOM_REALTIME_EVENT_MAX_ROWS.*safe integer/)
    expect(() => loadRealtimeEventRetentionPolicy({
      ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS: '99999999999999999999',
    })).toThrow(/ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS.*safe integer/)
    expect(() => loadRealtimeEventRetentionPolicy({
      ROTOM_REALTIME_EVENT_RETENTION_ENABLED: 'sometimes',
    })).toThrow(/ROTOM_REALTIME_EVENT_RETENTION_ENABLED.*true or false/)
  })
})
