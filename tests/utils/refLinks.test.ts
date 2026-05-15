import { describe, expect, it } from 'vitest'
import {
  describeRefTarget,
  getRefTooltipDetail,
  presentRefValue,
  refTargetPath,
} from '~/utils/refLinks'

describe('refLinks helpers', () => {
  it('builds target paths for reference kinds', () => {
    expect(refTargetPath('move', 'tackle')).toBe('/moves/tackle')
    expect(refTargetPath('maneuver', 'grapple')).toBe('/maneuvers/grapple')
    expect(refTargetPath('ability', 'static')).toBe('/abilities/static')
    expect(refTargetPath('capability', 'naturewalk')).toBe('/capabilities/naturewalk')
    expect(refTargetPath('condition', 'burned')).toBe('/conditions/burned')
    expect(refTargetPath('rule', 'combat-stages')).toBe('/rules/combat-stages')
    expect(refTargetPath('feature', 'ace-trainer')).toBe('/features/ace-trainer')
    expect(refTargetPath('edge', 'skill-edge')).toBe('/edges/skill-edge')
    expect(refTargetPath('item', 'potion')).toBe('/items/potion')
    expect(refTargetPath('move', null)).toBeNull()
  })

  it('describes resolved ref targets with canonical slugs', () => {
    const target = describeRefTarget('move', 'Flamethrower')

    expect(target.targetPath).toBe('/moves/flamethrower')
    expect(target.descriptor).toMatchObject({
      kind: 'move',
      name: 'Flamethrower',
      canonical: 'Flamethrower',
      slug: 'flamethrower',
    })
  })

  it('resolves maneuver aliases', () => {
    const target = describeRefTarget('maneuver', 'AoO')

    expect(target.targetPath).toBe('/maneuvers/attack-of-opportunity')
    expect(target.descriptor).toMatchObject({
      kind: 'maneuver',
      name: 'AoO',
      canonical: 'Attack of Opportunity',
      slug: 'attack-of-opportunity',
    })
  })

  it('keeps missing refs linkless', () => {
    const target = describeRefTarget('move', 'Definitely Not A Move')

    expect(target.targetPath).toBeNull()
    expect(target.descriptor.slug).toBeNull()
  })

  it('builds move tooltip metadata and effect sections', () => {
    const tooltip = getRefTooltipDetail('move', 'Tackle')

    expect(tooltip?.kind).toBe('move')
    expect(tooltip?.name).toBe('Tackle')
    expect(tooltip?.meta).toEqual([
      { label: 'Type', value: 'Normal', badge: 'type' },
      { label: 'Class', value: 'Physical', badge: 'damage-class' },
      { label: 'Freq', value: 'At-Will' },
      { label: 'DB', value: 4 },
      { label: 'Roll', value: '1d8+6 / 11' },
      { label: 'AC', value: 2 },
      { label: 'Range', value: 'Melee, 1 Target, Dash, Push' },
    ])
    expect(tooltip?.sections[0]).toEqual({ heading: 'Effect', body: 'The target is pushed 2 Meters.' })
  })

  it('includes move special sections in tooltips', () => {
    expect(getRefTooltipDetail('move', 'Ember')?.sections).toContainEqual({
      heading: 'Special',
      body: 'Grants Firestarter',
    })
  })

  it('builds maneuver tooltip metadata and effect sections', () => {
    const tooltip = getRefTooltipDetail('maneuver', 'Grapple')

    expect(tooltip?.kind).toBe('maneuver')
    expect(tooltip?.name).toBe('Grapple')
    expect(tooltip?.meta).toEqual([
      { label: 'Category', value: 'Combat Maneuver' },
      { label: 'Action', value: 'Standard' },
      { label: 'Class', value: 'Status', badge: 'damage-class' },
      { label: 'AC', value: 4 },
      { label: 'Range', value: 'Melee, 1 Target' },
    ])
    expect(tooltip?.sections[0]?.heading).toBe('Effect')
    expect(tooltip?.sections[0]?.body).toContain('gain Dominance')
  })

  it('builds ability tooltip trigger/effect sections', () => {
    const tooltip = getRefTooltipDetail('ability', 'Static')

    expect(tooltip).toMatchObject({
      kind: 'ability',
      name: 'Static',
      meta: [{ label: 'Freq', value: 'Scene – Free Action' }],
    })
    expect(tooltip?.sections.map((section) => section.heading)).toEqual(['Trigger', 'Effect'])
  })

  it('builds Gen 7/8 ability tooltips that were split across source columns', () => {
    const stamina = getRefTooltipDetail('ability', 'Stamina')
    expect(stamina).toMatchObject({
      kind: 'ability',
      name: 'Stamina',
      meta: [{ label: 'Freq', value: 'At-Will – Free Action' }],
    })
    expect(stamina?.sections).toEqual([
      { heading: 'Trigger', body: 'The user is hit by a Damaging Attack' },
      { heading: 'Effect', body: 'The user receives +1 Defense Combat Stage. Defensive.' },
    ])

    expect(getRefTooltipDetail('ability', 'Screen Cleaner')?.sections.map((section) => section.heading))
      .toEqual(['Effect', 'Bonus'])
  })

  it('builds capability and condition tooltips', () => {
    expect(getRefTooltipDetail('capability', 'Naturewalk')?.sections[0]?.heading).toBe('Effect')
    expect(getRefTooltipDetail('capability', 'Overland')?.sections[0]?.body).toContain('dry land')
    expect(getRefTooltipDetail('capability', 'Teleporter 4')?.name).toBe('Teleporter')

    const condition = getRefTooltipDetail('condition', 'Burned')
    expect(condition?.meta).toEqual([
      { label: 'Category', value: 'Persistent Affliction' },
      { label: 'Source', value: '07-combat.md' },
    ])
  })

  it('does not show rich tooltips for unsupported or missing refs', () => {
    expect(getRefTooltipDetail('item', 'Potion')).toBeNull()
    expect(getRefTooltipDetail('move', 'Definitely Not A Move')).toBeNull()
  })

  it('treats zero as present and empty values as absent', () => {
    expect(presentRefValue(0)).toBe(true)
    expect(presentRefValue('value')).toBe(true)
    expect(presentRefValue('')).toBe(false)
    expect(presentRefValue(null)).toBe(false)
    expect(presentRefValue(undefined)).toBe(false)
  })
})
