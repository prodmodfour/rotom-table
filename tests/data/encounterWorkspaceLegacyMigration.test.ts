import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Manifest {
  schemaVersion: number
  rows: Array<{
    ticket: string
    workspaceOwners: string[]
    legacyOwners: string[]
    productionBoundary: string
    status: string
  }>
  allowedTacticalDependencies: string[]
  forbiddenWorkspaceDependencies: string[]
}

const manifest = JSON.parse(readFileSync('data/encounter-workspace/legacy-migration.v1.json', 'utf8')) as Manifest

describe('map-first encounter surface migration', () => {
  it('closes every Phase 9 migration row with explicit new and old ownership', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.rows.map(row => row.ticket)).toEqual(['EUX-086', 'EUX-087', 'EUX-088', 'EUX-089'])
    for (const row of manifest.rows) {
      expect(row.status, row.ticket).toBe('migrated')
      expect(row.workspaceOwners.length, row.ticket).toBeGreaterThan(0)
      expect(row.legacyOwners.length, row.ticket).toBeGreaterThan(0)
      expect(row.productionBoundary.trim(), row.ticket).not.toBe('')
    }
  })

  it('retains only bounded source-owned tactical workflows and forbids map-first imports in the cockpit', () => {
    expect(manifest.allowedTacticalDependencies).toEqual(expect.arrayContaining([
      'MapSceneRenderer',
      'IsometricGrid',
      'MapAbilityAutomationPanel',
      'CapabilityActionModal',
      'CapabilityAdjudicationModal',
    ]))
    expect(manifest.forbiddenWorkspaceDependencies).toEqual(expect.arrayContaining([
      'EncounterPresentationPanel',
      'InitiativeInfoBar',
      'MapCombatLog',
      'MapMoveResponsePanel',
      'TokenContextMenu',
      'MapAdminPanel',
    ]))
  })
})
