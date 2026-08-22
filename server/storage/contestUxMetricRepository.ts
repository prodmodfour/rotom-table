import type { ContestUxMetricId } from '#shared/contests/metrics'
import type { RotomDatabase } from './database'

export interface ContestUxMetricAggregate { readonly metricDay: number, readonly metricId: ContestUxMetricId, readonly sampleCount: number, readonly totalValue: number, readonly maximumValue: number }

export const createContestUxMetricRepository = (database: RotomDatabase) => ({
  record(input: { metricId: ContestUxMetricId, value: number, timestamp?: number }): void {
    if (!Number.isSafeInteger(input.value) || input.value < 0 || input.value > 3_600_000) throw new Error('Contest UX metric value is outside the bounded aggregate contract.')
    const timestamp = input.timestamp ?? Date.now()
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Contest UX metric timestamp is invalid.')
    const day = Math.floor(timestamp / 86_400_000)
    database.connection.prepare(`
      INSERT INTO contest_ux_metric_aggregates (metric_day, metric_id, sample_count, total_value, maximum_value)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(metric_day, metric_id) DO UPDATE SET
        sample_count = sample_count + 1,
        total_value = total_value + excluded.total_value,
        maximum_value = MAX(maximum_value, excluded.maximum_value)
    `).run(day, input.metricId, input.value, input.value)
  },
  list(): readonly ContestUxMetricAggregate[] {
    const rows = database.connection.prepare('SELECT metric_day, metric_id, sample_count, total_value, maximum_value FROM contest_ux_metric_aggregates ORDER BY metric_day, metric_id').all() as Array<Record<string, unknown>>
    return Object.freeze(rows.map(row => Object.freeze({ metricDay: Number(row.metric_day), metricId: String(row.metric_id) as ContestUxMetricId, sampleCount: Number(row.sample_count), totalValue: Number(row.total_value), maximumValue: Number(row.maximum_value) })))
  },
})
