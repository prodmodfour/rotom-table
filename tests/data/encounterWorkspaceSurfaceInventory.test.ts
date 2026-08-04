import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import inventoryJson from '../../data/encounter-workspace/live-play-surface-inventory.json'

const ROOT = resolve(import.meta.dirname, '../..')
const VALID_LAYERS = new Set([
  'world',
  'persistent-controls',
  'decision',
  'system-recovery',
  'inspector-director',
])

const REQUIRED_MOUNTED_OWNERS = [
  'src/components/map/MapNavigationRail.vue',
  'src/components/map/MapScenePanel.vue',
  'src/components/map/MapSceneRenderer.vue',
  'src/components/map/EncounterVfxOverlay.vue',
  'src/components/map/EncounterPresentationPanel.vue',
  'src/components/map/MapAbilityAutomationPanel.vue',
  'src/components/map/MapPresencePanel.vue',
  'src/components/map/LivePlayCommandRecoveryPanel.vue',
  'src/components/map/LivePlayLatencyDebugPanel.vue',
  'src/components/maps/CapabilityActionModal.vue',
  'src/components/maps/CapabilityAdjudicationModal.vue',
  'src/components/map/StartTurnModal.vue',
  'src/components/map/PokeballCaptureResultModal.vue',
  'src/components/map/FieldEffectsMenuModal.vue',
  'src/components/map/SheetsMenuModal.vue',
  'src/components/map/InitiativeMenuModal.vue',
  'src/components/map/MapAdminPanel.vue',
  'src/components/map/InitiativeInfoBar.vue',
  'src/components/map/MapCombatLog.vue',
  'src/components/map/MapMoveCorrectionPanel.vue',
  'src/components/map/MapActionSplash.vue',
  'src/components/map/MoveVfxDebugPanel.vue',
  'src/components/map/MapAttackOfOpportunityOverlay.vue',
  'src/components/map/MapMoveResponsePanel.vue',
  'src/components/isometric/PendingMoveMovementOverlay.vue',
  'src/components/isometric/PendingMoveHazardCellOverlay.vue',
  'src/components/isometric/RenderMetricsOverlay.vue',
  'src/components/isometric/AttackOfOpportunityAttentionOverlay.vue',
  'src/components/isometric/TokenContextMenu.vue',
  'src/components/isometric/TokenActionDialogs.vue',
  'src/components/isometric/TokenHpDialog.vue',
  'src/components/isometric/TokenTempHpDialog.vue',
  'src/components/isometric/TokenCombatStagesDialog.vue',
  'src/components/isometric/TokenConditionsDialog.vue',
  'src/components/isometric/TokenExperienceDialog.vue',
  'src/components/isometric/TokenDamageDialog.vue',
] as const

describe('current live-play surface inventory', () => {
  it('maps every audited owner to one normative layer and a future migration ticket', () => {
    expect(inventoryJson).toMatchObject({
      schemaVersion: 1,
      auditedRoute: '/maps/:slug',
      designAuthority: 'DESIGN.md',
    })
    expect(inventoryJson.surfaces).toHaveLength(35)
    expect(new Set(inventoryJson.surfaces.map(surface => surface.id)).size).toBe(35)

    const plan = readFileSync(resolve(ROOT, 'implementation-plans/done/ENCOUNTER_UI_UX_PLAN.md'), 'utf8')
    for (const surface of inventoryJson.surfaces) {
      expect(VALID_LAYERS.has(surface.currentLayer), surface.id).toBe(true)
      expect(surface.currentOwners.length, surface.id).toBeGreaterThan(0)
      expect(surface.capabilities.length, surface.id).toBeGreaterThan(0)
      expect(surface.concerns.length, surface.id).toBeGreaterThan(0)
      expect(surface.futureHome.trim(), surface.id).not.toBe('')
      expect(surface.compatibility.trim(), surface.id).not.toBe('')
      expect(plan, `${surface.id} links ${surface.migrationTicket}`).toContain(`**${surface.migrationTicket} `)
      for (const owner of surface.currentOwners) {
        expect(existsSync(resolve(ROOT, owner)), `${surface.id} owner ${owner}`).toBe(true)
      }
    }
  })

  it('covers every currently mounted top-level surface and nested token dialog', () => {
    const owners = new Set(inventoryJson.surfaces.flatMap(surface => surface.currentOwners))
    for (const owner of REQUIRED_MOUNTED_OWNERS) expect(owners, owner).toContain(owner)
    expect(new Set(inventoryJson.surfaces.map(surface => surface.currentLayer))).toEqual(VALID_LAYERS)
  })
})
