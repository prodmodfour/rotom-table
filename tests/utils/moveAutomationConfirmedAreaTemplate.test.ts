import { describe, expect, it } from 'vitest'
import { moveAutomationScriptForConfirmedAreaTemplate } from '~/utils/moveAutomationConfirmedAreaTemplate'
import type { MoveAutomationScript } from '~/types/moveAutomation'

const baseScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Template Test',
  version: 1,
  targetMode: 'multi-target',
  targetCount: null,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: 'Burst 1 or Cone 2, Friendly',
  effect: 'Test.',
  keywords: ['Burst 1 or Cone 2', 'Friendly'],
  criticalRange: null,
  areaTemplates: [
    { kind: 'burst', size: 1, label: 'Burst 1' },
    { kind: 'cone', size: 2, label: 'Cone 2' },
  ],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

describe('moveAutomationScriptForConfirmedAreaTemplate', () => {
  it('keeps only the confirmed template and removes alternative template labels without mutating input', () => {
    const script = baseScript()
    const before = JSON.stringify(script)
    const confirmed = moveAutomationScriptForConfirmedAreaTemplate(script, script.areaTemplates![1]!)

    expect(confirmed).not.toBe(script)
    expect(confirmed.areaTemplates).toEqual([{ kind: 'cone', size: 2, label: 'Cone 2' }])
    expect(confirmed.areaTemplates).not.toBe(script.areaTemplates)
    expect(confirmed.keywords).toEqual(['Cone 2', 'Friendly'])
    expect(confirmed.range).toBe('Cone 2, Friendly')
    expect(JSON.stringify(script)).toBe(before)
  })

  it('preserves current single-visible-template client behaviour when labels are supplied', () => {
    const script = baseScript()
    const confirmed = moveAutomationScriptForConfirmedAreaTemplate(script, script.areaTemplates![0]!, {
      alternativeTemplateLabels: ['Burst 1'],
    })

    expect(confirmed.areaTemplates).toEqual([{ kind: 'burst', size: 1, label: 'Burst 1' }])
    expect(confirmed.keywords).toEqual(script.keywords)
    expect(confirmed.keywords).not.toBe(script.keywords)
    expect(confirmed.range).toBe(script.range)
  })
})
