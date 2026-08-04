import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface RolloutStage {
  stage: number
  id: string
  flags: Record<string, boolean>
  entryGates: string[]
  exitGates: string[]
}
interface RolloutManifest {
  schemaVersion: number
  featureFlags: Record<string, string>
  invariants: string[]
  stages: RolloutStage[]
  flowMigrationOrder: Array<{ order: number, flow: string, from: string, to: string, fallback: string }>
  rollbackTriggers: Array<{ severity: string, id: string, threshold: number }>
  rollbackActions: string[]
}
const manifest = JSON.parse(readFileSync('data/encounter-workspace/rollout.v1.json', 'utf8')) as RolloutManifest
const requiredFlags = [
  'encounterWorkspaceEnabled',
  'encounterWorkspaceDefaultForLivePlay',
  'battlefieldWorkshopEnabled',
  'encounterWorkspaceMetricsEnabled',
]

describe('encounter workspace staged rollout and rollback manifest', () => {
  it('defines contiguous opt-in-to-default stages with closed feature flags and measurable gates', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.stages.map(stage => stage.stage)).toEqual([0, 1, 2])
    for (const stage of manifest.stages) {
      expect(Object.keys(stage.flags).sort()).toEqual([...requiredFlags].sort())
      expect(stage.entryGates.length).toBeGreaterThan(0)
      expect(stage.exitGates.length).toBeGreaterThan(0)
      expect(stage.flags.battlefieldWorkshopEnabled).toBe(true)
    }
    expect(manifest.stages[0]!.flags.encounterWorkspaceDefaultForLivePlay).toBe(false)
    expect(manifest.stages[1]!.flags.encounterWorkspaceDefaultForLivePlay).toBe(false)
    expect(manifest.stages[2]!.flags.encounterWorkspaceDefaultForLivePlay).toBe(true)
  })

  it('moves live-play flows one at a time with an explicit source-owned fallback', () => {
    expect(manifest.flowMigrationOrder.map(row => row.order)).toEqual([1, 2, 3, 4, 5, 6])
    for (const row of manifest.flowMigrationOrder) {
      expect(row.flow).toBeTruthy()
      expect(row.from).toBeTruthy()
      expect(row.to).toBeTruthy()
      expect(row.fallback).toMatch(/Workshop|recovery|map/i)
    }
  })

  it('rolls presentation back without deleting or reinterpreting authority data', () => {
    expect(manifest.rollbackTriggers.map(trigger => trigger.id)).toEqual(expect.arrayContaining([
      'private-projection-leak',
      'duplicate-authoritative-mutation',
      'command-authority-bypass',
    ]))
    expect(manifest.rollbackActions.join(' ')).toContain('encounterWorkspaceDefaultForLivePlay to false')
    expect(manifest.rollbackActions.join(' ')).toMatch(/Do not revert SQLite schema or delete Encounter Documents/)
    expect(manifest.invariants.join(' ')).toMatch(/never migrates or rewrites campaign authority data/i)
  })
})
