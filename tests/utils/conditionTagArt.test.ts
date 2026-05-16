import { describe, expect, it } from 'vitest'
import {
  CONDITION_TAGS,
  conditionTagFallbackDefinition,
  conditionTagSvgMarkup,
} from '~/utils/conditionTagArt'
import {
  conditionTagDefinition,
  conditionDisplayName,
  conditionTagSvg,
  conditionsFromText,
  disabledMoveNamesFromConditions,
  formatInfatuationCondition,
  infatuationCrushName,
  isMoveDisabledByConditions,
  normalizeConditionName,
  normalizeConditionNames,
} from '~/utils/statusConditions'

describe('condition tag art helpers', () => {
  it('keeps canonical tag definitions in the focused art module', () => {
    expect(CONDITION_TAGS.Burned).toEqual({ label: 'BRN', color: '#fb4b0b', icon: 'flame' })
    expect(CONDITION_TAGS['Badly Poisoned']).toEqual({ label: 'TOX', color: '#8f3fb0', icon: 'toxic' })
  })

  it('builds deterministic fallback labels without requiring condition data', () => {
    expect(conditionTagFallbackDefinition('Wide Open')).toEqual({
      label: 'WO',
      color: '#7c6f64',
      icon: 'generic',
    })
    expect(conditionTagFallbackDefinition('')).toEqual({
      label: '???',
      color: '#7c6f64',
      icon: 'generic',
    })
  })

  it('escapes user-visible SVG text and scales known sizes', () => {
    const svg = conditionTagSvgMarkup('Bad & <Condition>', {
      label: 'A&B',
      color: '#123456',
      icon: 'generic',
    }, 'xs')

    expect(svg).toContain('condition-tag-svg--xs')
    expect(svg).toContain('width="47"')
    expect(svg).toContain('height="13"')
    expect(svg).toContain('aria-label="Bad &amp; &lt;Condition&gt;"')
    expect(svg).toContain('A&amp;B')
    expect(svg).toContain('fill="#123456"')
  })

  it('preserves status-condition normalization and tag SVG integration', () => {
    expect(normalizeConditionName('brn')).toBe('Burned')
    expect(normalizeConditionName('slow condition')).toBe('Slowed')
    expect(conditionTagDefinition('burnt')).toEqual(CONDITION_TAGS.Burned)
    expect(conditionTagSvg('Badly Poisoned', 'sm')).toContain('TOX')
    expect(conditionsFromText('The target is burned and asleep.')).toEqual(['Burned', 'Sleep'])
    expect(conditionsFromText('Bite Flinches the target on 15+.')).toEqual(['Flinch'])
    expect(conditionsFromText('The battlefield contains Slow Terrain.')).toEqual([])
  })

  it('preserves Flinch as a stackable condition', () => {
    expect(normalizeConditionNames(['Flinched', 'Flinches', 'Burn', 'Burned'])).toEqual([
      'Burned',
      'Flinch',
      'Flinch',
    ])
  })

  it('preserves move-specific Disabled condition instances', () => {
    expect(normalizeConditionName('Disabled: Thunder Wave')).toBe('Disabled')
    expect(normalizeConditionNames([
      'Disable: Thunder Wave',
      'disabled (Quick Attack)',
      'Disabled: thunder wave',
      'Burn',
    ])).toEqual(['Burned', 'Disabled: Quick Attack', 'Disabled: Thunder Wave'])
    expect(disabledMoveNamesFromConditions(['Disabled: Thunder Wave', 'Burned'])).toEqual(['Thunder Wave'])
    expect(isMoveDisabledByConditions('thunder wave', ['Disabled: Thunder Wave'])).toBe(true)
    expect(conditionTagSvg('Disabled: Thunder Wave', 'sm')).toContain('aria-label="Disabled: Thunder Wave"')
  })

  it('preserves crush-specific Infatuation condition instances', () => {
    expect(normalizeConditionName('Infatuated: Eevee')).toBe('Infatuation')
    expect(formatInfatuationCondition('  Eevee  ')).toBe('Infatuation: Eevee')
    expect(normalizeConditionNames(['Infatuated (Eevee)', 'Infatuation: Pikachu'])).toEqual(['Infatuation: Eevee'])
    expect(infatuationCrushName('Infatuation: Eevee')).toBe('Eevee')
    expect(conditionDisplayName('Infatuation: Eevee')).toBe('Infatuation: Eevee')
    expect(conditionTagSvg('Infatuation: Eevee', 'sm')).toContain('aria-label="Infatuation: Eevee"')
  })
})
