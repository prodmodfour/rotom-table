import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/inventory-accessibility.v1.json'

describe('P8-069 responsive inventory accessibility contract', () => {
  it('requires semantic table-to-card reflow through a 320-pixel zoom-equivalent viewport', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-069',
      status: 'current-semantics',
      contract: 'inventory-responsive-accessibility-v1',
      responsive: {
        narrowBreakpointPx: 760,
        minimumReflowViewportPx: 320,
        pageHorizontalOverflowPx: 1,
      },
      interaction: {
        selectedMockup: '.pi/artifacts/ui-mockups/inventory-accessible-reflow/v001.png',
        selectedMockupScore: '10/10',
        desktopTablePreserved: true,
        mobileCardReflow: true,
      },
    })
    expect(contract.responsive.fieldLabels).toEqual(expect.arrayContaining([
      'Name', 'Qty', 'Cost', 'Description', 'Actions',
    ]))
    expect(contract.responsive.zoom).toContain('400 percent zoom')
  })

  it('locks roving navigation, editor keys, decision focus, and 44-pixel targets', () => {
    expect(contract.keyboard).toMatchObject({
      sheetNavigation: expect.stringContaining('Home, and End'),
      sectionTabs: expect.stringContaining('ARIA tablist and tabpanel'),
      sourceChoices: expect.stringContaining('ARIA radiogroup'),
      inlineEditing: expect.stringContaining('Escape cancels'),
      decisionOpen: expect.stringContaining('decision heading'),
      decisionClose: expect.stringContaining('originating row action'),
    })
    expect(contract.touch.minimumPrimaryTargetPx).toBe(44)
    expect(contract.touch.coveredTargets).toEqual(expect.arrayContaining([
      'sheet and inventory section controls',
      'row action buttons and links',
      'confirmation labels and decision actions',
    ]))
    expect(contract.motion).toEqual({
      reducedMotion: expect.stringContaining('prefers-reduced-motion'),
      requiredMotion: false,
    })
  })

  it('keeps source, quantity, consequences, and disabled reasons textual and privacy-safe', () => {
    expect(contract.screenReader).toMatchObject({
      table: expect.stringContaining('column-header'),
      selectedSource: expect.stringContaining('Selected source text'),
      editors: expect.stringContaining('field'),
      unavailableActions: expect.stringContaining('textual reason'),
      rowChanges: expect.stringContaining('polite live region'),
    })
    expect(contract.sensoryIndependence.selection).toContain('Selected source text')
    expect(contract.sensoryIndependence.destructive).toEqual(expect.arrayContaining([
      'Irreversible heading',
      'exact quantity and permanent-removal consequence',
      'explicit confirmation control before submit',
    ]))
    expect(contract.privacy.forbiddenVisibleFields).toEqual(expect.arrayContaining([
      'operation, declaration, or request ID',
      'Profile ID',
      'stable inventory row or source-instance ID',
      'raw command, ownership evidence, or private note',
    ]))
    expect(contract.evidence.tests).toContain('tests/e2e/inventory-accessibility.spec.ts')
  })
})
