import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import budgets from '../../data/complete-play-loop/performance-scale-budgets.v1.json'
import { INVENTORY_ACTION_LIMITS } from '../../shared/itemAutomation/inventoryActions'
import { ENCOUNTER_PRESENTATION_LIMITS } from '../../shared/encounterPresentation/catalog'
import { ENCOUNTER_SETTLEMENT_LIMITS } from '../../shared/encounterSettlement/document'
import { CAMPAIGN_ATTENTION_PROJECTION_LIMIT } from '../../shared/campaignAttention/projection'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-095 performance and scale budget contract', () => {
  it('records lower-end laptop, mobile, and large-campaign acceptance profiles', () => {
    expect(budgets).toMatchObject({ schemaVersion: 1, ticket: 'P8-095', status: 'enforced' })
    expect(budgets.profiles.lowerEndLaptop.initialRenderTargetMs).toBe(2000)
    expect(budgets.profiles.mobile).toMatchObject({
      maximumRenderedInventoryRows: 80,
      maximumRenderedActionOffers: 80,
      minimumControlSizePx: 44,
    })
    expect(budgets.profiles.largeCampaign).toMatchObject({
      inventoryRows: 5000,
      equipmentOwnerCount: 512,
      attentionItemCount: 10000,
      realtimeClientCount: 32,
    })
  })

  it('uses stress scales at or within every strict runtime contract bound', () => {
    expect(budgets.scenarios.largeInventory.projectionOffers).toBe(INVENTORY_ACTION_LIMITS.offers)
    expect(budgets.scenarios.actionDock.offerCount).toBeLessThanOrEqual(ENCOUNTER_PRESENTATION_LIMITS.offers)
    expect(budgets.scenarios.rewardPackage.rewardLines).toBe(ENCOUNTER_SETTLEMENT_LIMITS.rewardLines)
    expect(budgets.scenarios.rewardPackage.allocations).toBeLessThanOrEqual(ENCOUNTER_SETTLEMENT_LIMITS.allocations)
    expect(budgets.scenarios.attentionQueue.itemCount).toBe(CAMPAIGN_ATTENTION_PROJECTION_LIMIT)
    expect(budgets.scenarios.multiClientRealtime.eventsPerBatch * budgets.scenarios.multiClientRealtime.clientCount)
      .toBe(32000)
  })

  it('enforces bounded semantic DOM growth rather than silently truncating authority', () => {
    expect(budgets.domGrowth).toEqual({
      inventoryStrategy: 'fixed-page',
      actionDockStrategy: 'incremental-batch',
      pageOrBatchSize: 80,
      unboundedRenderingAllowed: false,
    })
    const inventory = readFileSync(resolve(root, 'src/components/inventory/InventoryItemTable.vue'), 'utf8')
    const actionDock = readFileSync(resolve(root, 'src/components/encounter/workspace/EncounterActionDock.vue'), 'utf8')
    const inventoryContract = readFileSync(resolve(root, 'shared/itemAutomation/inventoryActions.ts'), 'utf8')
    expect(inventory).toContain('const ROW_PAGE_SIZE = 80')
    expect(inventory).toContain('.slice(pageStart.value, pageStart.value + ROW_PAGE_SIZE)')
    expect(actionDock).toContain('const RENDER_BATCH_SIZE = 80')
    expect(actionDock).toContain('orderedFiltered.value.slice(0, renderLimit.value)')
    expect(inventoryContract).toContain('nodes: 65_536')
  })

  it('hash-binds runtime, benchmark, documentation, command, and quality-gate evidence', () => {
    expect(budgets.sourceEvidence.length).toBeGreaterThanOrEqual(12)
    const paths = new Set<string>()
    for (const row of budgets.sourceEvidence) {
      expect(paths.has(row.path), row.path).toBe(false)
      paths.add(row.path)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(acceptedSuccessorHead(row.path, row.sha256), row.path)
        .toBe(sha256(readFileSync(resolve(root, row.path))))
    }
    expect(paths).toEqual(new Set([
      'shared/itemAutomation/inventoryActions.ts',
      'server/domain/itemAutomation/equipmentContributions.ts',
      'shared/encounterPresentation/validation.ts',
      'shared/encounterSettlement/document.ts',
      'shared/campaignAttention/projection.ts',
      'server/realtime/realtimeEventAccessPolicy.ts',
      'src/components/inventory/InventoryItemTable.vue',
      'src/components/encounter/workspace/EncounterActionDock.vue',
      'tests/server/completePlayLoopPerformanceBudgets.test.ts',
      'tests/components/completePlayLoopPerformanceBudgets.test.ts',
      'tests/data/completePlayLoopPerformanceBudgets.test.ts',
      'docs/complete-play-loop-performance-and-scale.md',
      'package.json',
      'scripts/quality-gate.sh',
    ]))
  })
})
