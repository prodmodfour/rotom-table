import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acceptance from '../../data/complete-play-loop/accessibility-responsive-visual-acceptance.v1.json'
import tokens from '../../data/encounter-workspace/design-tokens.v1.json'
import {
  assertLocalUiArtifactPath,
  isLocalUiArtifactPath,
  readOptionalLocalUiArtifact,
} from '../helpers/localUiArtifacts'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex')

const relativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

const contrastRatio = (foreground: string, background: string): number => {
  const left = relativeLuminance(foreground)
  const right = relativeLuminance(background)
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}

const pngDimensions = (path: string, bytes: Buffer): { width: number, height: number } => {
  expect(bytes.subarray(1, 4).toString('ascii'), path).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const optionalArtifact = (path: string): Buffer | null => readOptionalLocalUiArtifact(root, path)

describe('P8-096 accessibility, responsive, and visual acceptance', () => {
  it('covers every acceptance category across all four primary complete-loop surfaces', () => {
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-096',
      status: 'accepted',
      hardFailures: 0,
      criticalUsabilityDebt: 0,
    })
    expect(new Set(acceptance.acceptanceCategories)).toEqual(new Set([
      'keyboard',
      'screen-reader',
      'touch',
      'zoom-200-percent',
      'reflow-320px',
      'contrast',
      'reduced-motion',
      'table-distance',
      'desktop',
      'mobile',
    ]))
    expect(acceptance.surfaces.map(surface => surface.surfaceId)).toEqual([
      'item-inventory',
      'equipment-and-item-use',
      'finish-encounter-settlement',
      'campaign-continuation',
    ])
    const covered = new Set(acceptance.surfaces.flatMap(surface => surface.categories))
    expect(covered).toEqual(new Set(acceptance.acceptanceCategories))
    for (const surface of acceptance.surfaces) {
      expect(surface.categories).toContain('keyboard')
      expect(surface.categories).toContain('screen-reader')
      expect(surface.categories).toContain('touch')
      expect(surface.categories).toContain('contrast')
      expect(surface.categories).toContain('desktop')
      expect(surface.categories).toContain('mobile')
      expect(surface.browserProjectsPassed).toBe(2)
      expect(surface.axeViolations).toBe(0)
      expect(surface.maximumOverflowPx).toBeLessThanOrEqual(1)
      expect(surface.minimumControlPx).toBeGreaterThanOrEqual(43.5)
    }
  })

  it('passes every declared dark and light WCAG contrast pair', () => {
    expect(tokens.contrastPairs).toHaveLength(16)
    for (const pair of tokens.contrastPairs) {
      const colors = tokens.themes[pair.theme as keyof typeof tokens.themes].colors
      const foreground = colors[pair.foreground as keyof typeof colors]
      const background = colors[pair.background as keyof typeof colors]
      expect(contrastRatio(foreground, background), pair.id).toBeGreaterThanOrEqual(pair.minimum)
    }
    expect(tokens.touch.minimumTarget).toBe('44px')
    expect(tokens.typography.families.interface).toBe('Atkinson Hyperlegible')
  })

  it('revalidates any available local reports, reviews, and desktop/mobile image dimensions', () => {
    const inventoryReportPath = acceptance.surfaces[0]!.browserReport!
    const inventoryReportBytes = optionalArtifact(inventoryReportPath)
    if (inventoryReportBytes) {
      const inventoryReport = JSON.parse(inventoryReportBytes.toString('utf8'))
      expect(inventoryReport.productionLiveplay).toMatchObject({ passed: 2, failed: 0 })
      expect(inventoryReport.assertions).toMatchObject({
        semanticDesktopTableHeadersAndRowHeaders: true,
        cssOnlyNarrowCardReflow: true,
        reflowValidatedAtCssWidths: [412, 320],
        maximumHorizontalPageOverflowPx: 1,
        minimumInventoryActionTargetPx: 43.5,
        scopedAxeViolations: 0,
        consoleWarningsErrorsOrPageErrors: 0,
      })
    }

    const commerceReportPath = acceptance.surfaces[1]!.browserReport!
    const commerceReportBytes = optionalArtifact(commerceReportPath)
    if (commerceReportBytes) {
      const commerceReport = JSON.parse(commerceReportBytes.toString('utf8'))
      expect(commerceReport.productionLiveplay).toMatchObject({ passed: 2, failed: 0, workers: 1 })
      expect(commerceReport.assertions).toMatchObject({
        scopedAxeViolations: 0,
        maximumAllowedHorizontalPageOverflowPx: 1,
        consoleWarningsErrorsOrPageErrors: 0,
        privateIdentityLeaks: 0,
      })
    }

    for (const surface of acceptance.surfaces) {
      const desktopBytes = optionalArtifact(surface.desktopEvidence)
      const mobileBytes = optionalArtifact(surface.mobileEvidence)
      const desktop = desktopBytes ? pngDimensions(surface.desktopEvidence, desktopBytes) : null
      const mobile = mobileBytes ? pngDimensions(surface.mobileEvidence, mobileBytes) : null
      if (desktop) {
        expect(desktop.width, `${surface.surfaceId} desktop`).toBeGreaterThanOrEqual(1000)
        expect(desktop.height).toBeGreaterThan(400)
      }
      if (mobile) {
        expect(mobile.width, `${surface.surfaceId} mobile`).toBeLessThanOrEqual(1200)
        expect(mobile.height).toBeGreaterThan(400)
      }
      if (desktop && mobile) expect(mobile.width, `${surface.surfaceId} mobile`).toBeLessThan(desktop.width)

      const reviewBytes = optionalArtifact(surface.review)
      if (reviewBytes) {
        const review = reviewBytes.toString('utf8').toLowerCase()
        expect(review, surface.review).toMatch(/accepted|pass/)
        expect(review, surface.review).not.toMatch(/unresolved (?:hard failure|critical blocker)|hard failure:\s*yes/)
      }
    }
  })

  it('keeps the cross-surface accessibility and privacy invariants explicit', () => {
    expect(acceptance.crossSurfaceAssertions).toEqual({
      semanticTablesPreserved: true,
      cssOnlyMobileTableReflow: true,
      pagedRowsRetainGlobalAriaIndices: true,
      rovingTabsArrowHomeEnd: true,
      enterSpaceActivation: true,
      escapeAndAcceptedFocusReturn: true,
      dialogFocusTrap: true,
      selectedStateNotColorOnly: true,
      destructiveStateNotColorOnly: true,
      reducedMotionHonored: true,
      noHorizontalOverflowAt320: true,
      tokenContrastPairsPass: true,
      privacySafeProjectionOnly: true,
    })
    expect(acceptance.designWorkflow).toMatchObject({ skillLoaded: true, newMockupRequired: false })
    expect(acceptance.designWorkflow.skipReason).toContain('no open hierarchy')
  })

  it('hash-binds current implementation, tests, production browser evidence, and guidance', () => {
    expect(acceptance.sourceEvidence.length).toBeGreaterThanOrEqual(30)
    const paths = new Set<string>()
    for (const row of acceptance.sourceEvidence) {
      expect(paths.has(row.path), row.path).toBe(false)
      paths.add(row.path)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/)
      const bytes = isLocalUiArtifactPath(row.path)
        ? optionalArtifact(row.path)
        : readFileSync(resolve(root, row.path))
      if (bytes) expect(sha256(bytes), row.path).toBe(row.sha256)
    }
    for (const surface of acceptance.surfaces) {
      for (const path of [surface.desktopEvidence, surface.mobileEvidence, surface.review]) {
        assertLocalUiArtifactPath(path)
        expect(paths.has(path), path).toBe(true)
      }
      expect(paths.has(surface.browserSpec), surface.browserSpec).toBe(true)
      if (surface.browserReport) {
        assertLocalUiArtifactPath(surface.browserReport)
        expect(paths.has(surface.browserReport), surface.browserReport).toBe(true)
      }
    }
    for (const required of [
      'DESIGN.md',
      'data/encounter-workspace/design-tokens.v1.json',
      'src/components/inventory/InventoryItemTable.vue',
      'src/components/sheets/EquipmentContributionInspector.vue',
      'src/components/encounter/workspace/EncounterFinishExperience.vue',
      'src/components/campaign/CampaignContinuationDashboard.vue',
      'tests/components/completePlayLoopAccessibilityAcceptance.test.ts',
      'docs/complete-play-loop-accessibility-responsive-visual-acceptance.md',
      'package.json',
      'scripts/quality-gate.sh',
    ]) expect(paths.has(required), required).toBe(true)
  })
})
