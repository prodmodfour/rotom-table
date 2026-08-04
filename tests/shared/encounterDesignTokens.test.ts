import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertEncounterDesignTokens,
  contrastRatio,
  encounterDesignTokens,
  evaluateEncounterContrastPairs,
} from '#shared/encounterWorkspace/designTokens'

const ROOT = resolve(import.meta.dirname, '../..')
const CSS = readFileSync(resolve(ROOT, 'src/assets/css/encounter-design-system.css'), 'utf8')
const camelToKebab = (value: string): string => value
  .replace(/[A-Z]/g, match => `-${match.toLocaleLowerCase()}`)
  .replace(/([a-z])(\d)/g, '$1-$2')

describe('encounter design tokens', () => {
  it('pins the versioned DESIGN.md token contract', () => {
    expect(encounterDesignTokens).toMatchObject({
      schemaVersion: 1,
      tokenSetId: 'rotom-encounter-design-v1',
      source: 'DESIGN.md',
      sourceTicket: 'EUX-010',
      touch: { minimumTarget: '44px' },
      breakpoints: { mobile: '639px', tablet: '899px', laptop: '1199px', wide: '1600px' },
    })
    expect(Object.keys(encounterDesignTokens.themes)).toEqual(['dark', 'light'])
    expect(Object.keys(encounterDesignTokens.contexts)).toEqual(['field-guide', 'workshop', 'live-encounter'])
    expect(Object.keys(encounterDesignTokens.density)).toEqual(['comfortable', 'standard', 'compact'])
    expect(Object.keys(encounterDesignTokens.typography.roles)).toEqual([
      'display-xl', 'display-lg', 'heading-md', 'action-md', 'body-md', 'body-sm', 'label-sm', 'meta-xs',
    ])
    expect(encounterDesignTokens.motion.vocabulary).toEqual([
      'pulse', 'lock', 'sweep', 'travel', 'impact', 'settle', 'correct',
    ])
    expect(() => assertEncounterDesignTokens()).not.toThrow()
  })

  it('keeps every reviewed foreground/background pair above its declared threshold', () => {
    const results = evaluateEncounterContrastPairs()
    expect(results).toHaveLength(16)
    expect(results.every(result => result.passes)).toBe(true)
    for (const result of results) {
      expect(result.ratio, result.id).toBeGreaterThanOrEqual(result.minimum)
      expect(contrastRatio(result.foregroundValue, result.backgroundValue), result.id).toBeCloseTo(result.ratio, 8)
    }
  })

  it('does not overload semantic roles with duplicate colour values inside a theme', () => {
    const semanticKeys = ['brand', 'focus', 'pending', 'success', 'danger', 'info'] as const
    for (const theme of Object.values(encounterDesignTokens.themes)) {
      const values = semanticKeys.map(key => theme.colors[key].toLocaleLowerCase())
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('publishes every colour and spacing token as a CSS custom property', () => {
    for (const theme of Object.values(encounterDesignTokens.themes)) {
      for (const [name, value] of Object.entries(theme.colors)) {
        expect(CSS, `${name} ${value}`).toContain(`--rt-${camelToKebab(name)}: ${value};`)
      }
    }
    for (const [name, value] of Object.entries(encounterDesignTokens.spacing)) {
      expect(CSS).toContain(`--rt-space-${name}: ${value};`)
    }
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(CSS).toContain('@media (forced-colors: active)')
  })
})
