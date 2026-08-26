import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acceptance from '../../data/gm-campaign-toolkit/production-liveplay-acceptance.v1.json'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')

describe('P12-095 production liveplay acceptance', () => {
  it('records one-worker desktop and mobile production outcomes with no critical defect', () => {
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      ticket: 'P12-095',
      status: 'accepted',
      runtime: { mode: 'production-build-liveplay', localHostingAuthority: false, reuseExistingServer: false, workers: 1 },
      projects: ['chromium', 'mobile-chromium'],
      results: {
        tests: 6,
        passed: 6,
        failed: 0,
        traces: 6,
        criticalUsabilityDefects: 0,
        seriousOrCriticalAxeViolations: 0,
        horizontalOverflowFailures: 0,
        minimumPrimaryTargetCssPx: 44,
        minimumTestedCssWidthAtTwoHundredPercentZoom: 160,
      },
    })
    expect(Object.values(acceptance.acceptance).every(Boolean)).toBe(true)
  })

  it('covers GM preparation-to-Builder and structurally denied player journeys in both projects', () => {
    expect(acceptance.journeys.map(journey => [journey.id, journey.projectsPassed])).toEqual([
      ['gm-wild-and-npc-preview', 2],
      ['ready-preparation-to-immutable-builder-handoff', 2],
      ['player-structural-denial', 2],
    ])
    expect(acceptance.journeys[1]).toMatchObject({ focusRestored: true, politeAnnouncements: true, responsiveReflow: true })
    expect(acceptance.journeys[2]).toMatchObject({ privateNavigationPresent: false, privateRouteAuthorityPresent: false })
  })

  it('hash-binds the executable suite/config and records bounded local review artifacts', () => {
    for (const row of acceptance.sourceEvidence) expect(sha256(row.path), row.path).toBe(row.sha256)
    expect(acceptance.reviewedScreenshots).toHaveLength(6)
    for (const row of acceptance.reviewedScreenshots) {
      expect(row.path).toMatch(/^\.pi\/artifacts\/ui-validation\/gm-campaign-toolkit\//u)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/u)
    }
    expect(acceptance.traceRoot).toBe('.pi/artifacts/ui-validation/gm-campaign-toolkit/playwright')
  })
})
