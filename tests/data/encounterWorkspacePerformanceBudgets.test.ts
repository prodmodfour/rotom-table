import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const source = (path: string): string => readFileSync(path, 'utf8')

interface Budgets {
  schemaVersion: number
  criteriaSource: string
  runtime: Record<string, number>
  measurement: { warmupRuns: number, measuredRuns: number, fixtures: string[] }
  resourcePolicy: Record<string, string>
}
interface Criteria {
  criteria: Array<{ id: string, target: { value: number }, guardrail?: { value: number } }>
}

describe('encounter cockpit performance budgets', () => {
  const budgets = readJson<Budgets>('data/encounter-workspace/performance-budgets.json')
  const criteria = readJson<Criteria>('data/encounter-workspace/ux-success-criteria.json')
  const criterion = (id: string) => criteria.criteria.find(value => value.id === id)!

  it('is versioned and exactly mirrors the release-gate latency and frame budgets', () => {
    expect(budgets.schemaVersion).toBe(1)
    expect(budgets.runtime.adapterP95Ms).toBe(criterion('workspace-adapter-budget').target.value)
    expect(budgets.runtime.interactionP95Ms).toBe(criterion('workspace-interaction-latency').target.value)
    expect(budgets.runtime.acceptedPresentationP95Ms).toBe(criterion('accepted-presentation-latency').target.value)
    expect(budgets.runtime.tacticalStartupP95Ms).toBe(criterion('tactical-lens-startup').target.value)
    expect(budgets.runtime.tacticalWarmP95Ms).toBe(criterion('tactical-lens-startup').guardrail?.value)
    expect(budgets.runtime.largeEncounterP10Fps).toBe(criterion('large-encounter-frame-rate').target.value)
    expect(budgets.measurement).toMatchObject({ warmupRuns: 5, measuredRuns: 30 })
  })

  it('bounds rendered long lists, projection size, DOM, heap growth, and every choreography animation', () => {
    expect(budgets.runtime.maximumRenderedActionOffers).toBe(80)
    expect(budgets.runtime.maximumRenderedHistoryEntries).toBe(80)
    expect(budgets.runtime.maximumProjectionBytes).toBeLessThanOrEqual(1024 * 1024)
    expect(budgets.runtime.maximumWorkspaceDomNodes).toBeLessThanOrEqual(5000)
    expect(budgets.runtime.maximumHeapGrowthBytes).toBeLessThanOrEqual(128 * 1024 * 1024)
    expect(budgets.runtime.maximumAnimationMs).toBeLessThanOrEqual(800)

    expect(source('src/components/encounter/workspace/EncounterActionDock.vue')).toContain('const RENDER_BATCH_SIZE = 80')
    expect(source('src/components/encounter/workspace/EncounterEventFeed.vue')).toContain('const HISTORY_BATCH_SIZE = 80')
    const designCss = source('src/assets/css/encounter-design-system.css')
    expect(designCss).not.toMatch(/animation-iteration-count:\s*infinite/)
    expect(designCss).toContain('animation-iteration-count: 1')
  })

  it('documents a reproducible lower-end profile and lazy tactical resource policy', () => {
    expect(budgets.measurement.fixtures).toEqual([
      'crowded-wild-pack',
      'boss-phases-environment',
      'capability-movement-feature',
    ])
    expect(budgets.resourcePolicy.tacticalRenderer).toContain('lazy')
    expect(budgets.resourcePolicy.projection).toContain('privacy')
  })
})
