import { describe, expect, it } from 'vitest'
import {
  ALL_MANEUVERS_ACTION_OPTION,
  buildManeuverActionOptions,
  filterManeuversForIndex,
  maneuverMatchesSearch,
} from '~/utils/reference/maneuverIndex'
import type { PtuManeuver } from '~/types/ptuReference'

const maneuver = (overrides: Partial<PtuManeuver> & Pick<PtuManeuver, 'name'>): PtuManeuver => ({
  name: overrides.name,
  category: overrides.category ?? 'Combat Maneuver',
  action: overrides.action,
  ac: overrides.ac,
  maneuver_class: overrides.maneuver_class,
  range: overrides.range,
  trigger: overrides.trigger,
  effect: overrides.effect,
  special: overrides.special,
  aliases: overrides.aliases,
  source: overrides.source,
})

const sampleManeuvers: PtuManeuver[] = [
  maneuver({
    name: 'Disengage',
    action: 'Shift',
    effect: 'Shift without provoking attacks of opportunity.',
  }),
  maneuver({
    name: 'Push',
    action: 'Standard',
    ac: 4,
    maneuver_class: 'Status',
    range: 'Melee, 1 Target',
    effect: 'Push the target back 1 Meter.',
  }),
  maneuver({
    name: 'Intercept Melee',
    action: 'Full Action, Interrupt',
    maneuver_class: 'Status',
    trigger: 'An ally is hit by an adjacent foe.',
    special: 'Loyalty restrictions apply.',
  }),
]

describe('maneuver index helpers', () => {
  it('builds sorted action options with All first', () => {
    expect(buildManeuverActionOptions(sampleManeuvers)).toEqual([
      ALL_MANEUVERS_ACTION_OPTION,
      { value: 'Full Action, Interrupt', label: 'Full Action, Interrupt' },
      { value: 'Shift', label: 'Shift' },
      { value: 'Standard', label: 'Standard' },
    ])
  })

  it('matches maneuver search haystacks', () => {
    expect(maneuverMatchesSearch(sampleManeuvers[0]!, 'provoking')).toBe(true)
    expect(maneuverMatchesSearch(sampleManeuvers[1]!, 'melee')).toBe(true)
    expect(maneuverMatchesSearch(sampleManeuvers[2]!, 'loyalty')).toBe(true)
    expect(maneuverMatchesSearch(sampleManeuvers[2]!, 'missing')).toBe(false)
  })

  it('filters by action and search term', () => {
    expect(filterManeuversForIndex(sampleManeuvers, { action: 'Standard' }).map((m) => m.name)).toEqual([
      'Push',
    ])
    expect(filterManeuversForIndex(sampleManeuvers, { searchTerm: 'interrupt' }).map((m) => m.name)).toEqual([
      'Intercept Melee',
    ])
    expect(filterManeuversForIndex(sampleManeuvers, { action: 'Standard', searchTerm: 'push' }).map((m) => m.name)).toEqual([
      'Push',
    ])
  })

  it('treats omitted action as All', () => {
    expect(filterManeuversForIndex(sampleManeuvers, {}).map((m) => m.name)).toEqual([
      'Disengage',
      'Push',
      'Intercept Melee',
    ])
  })
})
