import { parseEncounterUxMetricSample, type EncounterUxMetricSample } from '#shared/encounterWorkspace/metrics'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface EncounterUxMetricAggregate {
  readonly event: string
  readonly dimensions: EncounterUxMetricSample['dimensions']
  readonly sampleCount: number
  readonly valueSum: number
  readonly valueMinimum: number
  readonly valueMaximum: number
  readonly updatedAt: number
}

interface AggregateRow {
  event: unknown
  role_kind: unknown
  viewport_class: unknown
  input_kind: unknown
  motion_preference: unknown
  fixture_id: unknown
  spatiality_level: unknown
  terminal_status: unknown
  sample_count: unknown
  value_sum: unknown
  value_min: unknown
  value_max: unknown
  updated_at: unknown
}

const finite = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} is invalid.`)
  return value
}
const integer = (value: unknown, label: string): number => {
  const number = finite(value, label)
  if (!Number.isSafeInteger(number)) throw new Error(`${label} is invalid.`)
  return number
}
const rowToAggregate = (row: AggregateRow): EncounterUxMetricAggregate => {
  const sample = parseEncounterUxMetricSample({
    schemaVersion: 1,
    event: row.event,
    value: finite(row.value_max, 'encounter UX metric value_max'),
    dimensions: {
      roleKind: row.role_kind,
      viewportClass: row.viewport_class,
      inputKind: row.input_kind,
      motionPreference: row.motion_preference,
      fixtureId: row.fixture_id,
      spatialityLevel: row.spatiality_level,
      terminalStatus: row.terminal_status,
    },
  })
  return Object.freeze({
    event: sample.event,
    dimensions: sample.dimensions,
    sampleCount: integer(row.sample_count, 'encounter UX metric sample_count'),
    valueSum: finite(row.value_sum, 'encounter UX metric value_sum'),
    valueMinimum: finite(row.value_min, 'encounter UX metric value_min'),
    valueMaximum: sample.value,
    updatedAt: integer(row.updated_at, 'encounter UX metric updated_at'),
  })
}

export interface EncounterUxMetricRepository {
  record(sample: EncounterUxMetricSample, now?: number): EncounterUxMetricAggregate
  list(): readonly EncounterUxMetricAggregate[]
}

export const createEncounterUxMetricRepository = (
  database: RotomDatabase = getRotomDatabase(),
): EncounterUxMetricRepository => {
  const list = (): readonly EncounterUxMetricAggregate[] => (
    database.connection.prepare(`
      SELECT event, role_kind, viewport_class, input_kind, motion_preference,
        fixture_id, spatiality_level, terminal_status,
        sample_count, value_sum, value_min, value_max, updated_at
      FROM encounter_ux_metric_aggregates
      ORDER BY event, role_kind, viewport_class, input_kind, motion_preference,
        fixture_id, spatiality_level, terminal_status
    `).all() as unknown as AggregateRow[]
  ).map(rowToAggregate)

  const record = (input: EncounterUxMetricSample, now = Date.now()): EncounterUxMetricAggregate => {
    const sample = parseEncounterUxMetricSample(input)
    const updatedAt = integer(now, 'Encounter UX metric updatedAt')
    const dimensions = sample.dimensions
    database.connection.prepare(`
      INSERT INTO encounter_ux_metric_aggregates (
        event, role_kind, viewport_class, input_kind, motion_preference,
        fixture_id, spatiality_level, terminal_status,
        sample_count, value_sum, value_min, value_max, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT (
        event, role_kind, viewport_class, input_kind, motion_preference,
        fixture_id, spatiality_level, terminal_status
      ) DO UPDATE SET
        sample_count = sample_count + 1,
        value_sum = value_sum + excluded.value_sum,
        value_min = MIN(value_min, excluded.value_min),
        value_max = MAX(value_max, excluded.value_max),
        updated_at = excluded.updated_at
    `).run(
      sample.event,
      dimensions.roleKind,
      dimensions.viewportClass,
      dimensions.inputKind,
      dimensions.motionPreference,
      dimensions.fixtureId,
      dimensions.spatialityLevel,
      dimensions.terminalStatus,
      sample.value,
      sample.value,
      sample.value,
      updatedAt,
    )
    const aggregate = list().find(candidate => candidate.event === sample.event
      && Object.entries(dimensions).every(([key, expected]) => (
        candidate.dimensions[key as keyof typeof dimensions] === expected
      )))
    if (!aggregate) throw new Error('Encounter UX metric aggregate was not persisted.')
    return aggregate
  }
  return Object.freeze({ record, list })
}
