import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createEncounterUxMetricRepository } from '~~/server/storage/encounterUxMetricRepository'
import {
  encounterUxViewportClass,
  parseEncounterUxMetricSample,
  type EncounterUxMetricSample,
} from '#shared/encounterWorkspace/metrics'

const databases: RotomDatabase[] = []
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const sample = (value: number, viewportClass: EncounterUxMetricSample['dimensions']['viewportClass'] = 'desktop'): EncounterUxMetricSample => parseEncounterUxMetricSample({
  schemaVersion: 1,
  event: 'workspace-ready',
  value,
  dimensions: {
    roleKind: 'gm',
    viewportClass,
    inputKind: 'keyboard',
    motionPreference: 'reduced',
    fixtureId: 'runtime',
    spatialityLevel: 'none',
    terminalStatus: 'none',
  },
})

describe('aggregate encounter UX metrics', () => {
  it('fails closed on unknown fields, identifiers, labels, and unbounded values', () => {
    expect(() => parseEncounterUxMetricSample({ ...sample(1), encounterId: 'private-map' })).toThrow(/unknown or missing/i)
    expect(() => parseEncounterUxMetricSample({
      ...sample(1),
      dimensions: { ...sample(1).dimensions, participantId: 'private-participant' },
    })).toThrow(/unknown or missing/i)
    expect(() => parseEncounterUxMetricSample({ ...sample(1), event: 'custom-label' })).toThrow(/event is invalid/i)
    expect(() => parseEncounterUxMetricSample({ ...sample(1), value: Number.POSITIVE_INFINITY })).toThrow(/finite and bounded/i)
  })

  it('upserts only closed dimensions into aggregate rows', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    databases.push(database)
    const repository = createEncounterUxMetricRepository(database)
    expect(repository.record(sample(120), 1_000)).toMatchObject({ sampleCount: 1, valueSum: 120 })
    expect(repository.record(sample(80), 1_001)).toMatchObject({
      sampleCount: 2,
      valueSum: 200,
      valueMinimum: 80,
      valueMaximum: 120,
      updatedAt: 1_001,
    })
    repository.record(sample(40, 'mobile'), 1_002)
    expect(repository.list()).toHaveLength(2)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM encounter_ux_metric_aggregates').get()).toEqual({ count: 2 })
  })

  it('classifies bounded responsive and table-display viewport dimensions', () => {
    expect(encounterUxViewportClass(390, false)).toBe('mobile')
    expect(encounterUxViewportClass(700, false)).toBe('tablet')
    expect(encounterUxViewportClass(1200, false)).toBe('laptop')
    expect(encounterUxViewportClass(1600, false)).toBe('desktop')
    expect(encounterUxViewportClass(1600, true)).toBe('table-display')
  })
})
