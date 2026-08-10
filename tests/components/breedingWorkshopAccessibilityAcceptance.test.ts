import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acceptanceJson from '../../data/breeding-automation/workshop-interaction-acceptance.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'

const root = resolve(import.meta.dirname, '../..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const components = [
  'src/components/breeding/BreedingWorkshopShell.vue',
  'src/components/breeding/BreedingProjectWizard.vue',
  'src/components/breeding/BreedingWorkshopActivityCards.vue',
  'src/components/breeding/BreedingConsentCenter.vue',
  'src/components/breeding/BreedingHatchDecisionFlow.vue',
] as const

describe('BR-078 Breeding Workshop interaction acceptance', () => {
  it('binds a complete accepted matrix to DESIGN.md and the existing private presentation contracts', () => {
    const digest = createHash('sha256').update(stableJsonStringify(acceptanceJson.definition)).digest('hex')
    expect(acceptanceJson.definitionSha256).toBe(digest)
    expect(acceptanceJson.definition).toMatchObject({
      ticket: 'BR-078',
      context: 'Workshop',
      status: 'component-accepted',
      authority: {
        design: 'DESIGN.md',
        mechanics: 'server-projected-only',
        privacy: 'structural-role-projections',
        browserAcceptanceOwner: 'BR-079',
      },
      touch: { minimumEssentialTargetCssPx: 44, hoverOnlyAction: false, rightClickOnlyAction: false },
      zoomAndReflow: { requiredZoomPercent: [200, 400], minimumEffectiveCssWidth: 320 },
      tableDistance: { primaryPageTitleMinimumCssPx: 32, essentialControlMinimumCssPx: 44 },
    })
    expect(acceptanceJson.definition.componentMatrix).toHaveLength(components.length)
    for (const row of acceptanceJson.definition.componentMatrix) {
      expect(Object.values(row).filter(value => typeof value === 'boolean')).not.toContain(false)
    }
    expect(Object.values(acceptanceJson.definition.acceptance)).toEqual(Array(8).fill('pass'))
  })

  it('keeps every Workshop component responsive, focus-visible, touch-operable, wrap-safe, and reduced-motion safe', () => {
    for (const path of components) {
      const text = source(path)
      expect(text, path).toContain('@media (max-width:')
      expect(text, path).toContain('@media (prefers-reduced-motion: reduce)')
      expect(text, path).toContain(':focus-visible')
      expect(text, path).toContain('touch-action: manipulation')
      expect(text, path).toContain('overflow-wrap: anywhere')
      expect(text, path).toMatch(/min-height:\s*(?:44px|2\.75rem|2\.8rem)/u)
      expect(text, path).not.toMatch(/@media\s*\([^)]*prefers-reduced-motion[^)]*\)\s*\{\s*\}/u)
    }
  })

  it('contains both blocking dialogs, restores origin focus, and advances wizard focus without creating command authority', () => {
    const focus = source('src/composables/breeding/useBreedingFocusBoundary.ts')
    expect(focus).toContain("event.key !== 'Tab'")
    expect(focus).toContain('event.shiftKey')
    expect(focus).toContain('returnTarget')
    expect(focus).toContain('preventScroll: true')
    expect(focus).not.toMatch(/fetch|\$fetch|commandKind|operationId/u)

    const consent = source('src/components/breeding/BreedingConsentCenter.vue')
    const hatch = source('src/components/breeding/BreedingHatchDecisionFlow.vue')
    const wizard = source('src/components/breeding/BreedingProjectWizard.vue')
    for (const dialog of [consent, hatch]) {
      expect(dialog).toContain('aria-modal="true"')
      expect(dialog).toContain('aria-labelledby=')
      expect(dialog).toContain('trap: true')
      expect(dialog).toContain('@keydown=')
    }
    expect(wizard).toContain('trap: false')
    expect(wizard).toContain('stepHeadingIds')
    expect(wizard).toContain("event.key === 'Escape'")
  })

  it('provides a reflow-safe main Workshop hierarchy for zoom and table-distance use', () => {
    const page = source('src/pages/breeding/index.vue')
    const shell = source('src/components/breeding/BreedingWorkshopShell.vue')
    const activity = source('src/components/breeding/BreedingWorkshopActivityCards.vue')
    expect(page).toContain('<main class="breeding-workshop-page')
    expect(page).toContain('data-rt-context="workshop"')
    expect(page).toContain('width: min(100%, 96rem)')
    expect(shell).toContain('font-size: clamp(2rem, 5vw, 3.25rem)')
    expect(shell).toContain('grid-template-columns: 1fr')
    expect(activity).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(activity).toContain('.breeding-card-grid { grid-template-columns: 1fr; }')
    expect(source('src/components/breeding/BreedingConsentCenter.vue')).toContain('max-height: calc(100dvh - 1rem)')
    expect(source('src/components/breeding/BreedingHatchDecisionFlow.vue')).toContain('max-height: calc(100dvh - 1rem)')
  })
})
