import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createContestUxMetricRepository } from '../../server/storage/contestUxMetricRepository'
import { CONTEST_UX_METRIC_IDS } from '../../shared/contests/metrics'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })

describe('aggregate-only Contest UX metrics', () => {
  it('stores only bounded day/id/count/total/maximum aggregates', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
    const metrics = createContestUxMetricRepository(database)
    metrics.record({ metricId: 'appeal-decision-time', value: 2_000, timestamp: 100 })
    metrics.record({ metricId: 'appeal-decision-time', value: 4_000, timestamp: 200 })
    expect(metrics.list()).toEqual([{ metricDay: 0, metricId: 'appeal-decision-time', sampleCount: 2, totalValue: 6_000, maximumValue: 4_000 }])
    const columns = database.connection.prepare('PRAGMA table_info(contest_ux_metric_aggregates)').all().map((row: any) => row.name)
    expect(columns).toEqual(['metric_day','metric_id','sample_count','total_value','maximum_value'])
    expect(CONTEST_UX_METRIC_IDS).not.toContain('campaign-id')
    expect(() => metrics.record({ metricId: 'round-duration', value: 3_600_001 })).toThrow(/bounded aggregate/)
  })
})
