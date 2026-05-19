import { describe, expect, it } from 'vitest'
import { parseMoveAutomationConditionSuggestions } from '~/utils/moveAutomationConditionSuggestions'

describe('move automation condition suggestion helpers', () => {
  it('extracts thresholded target condition additions', () => {
    expect(parseMoveAutomationConditionSuggestions('On 15+, the target is Burned.'))
      .toContainEqual(expect.objectContaining({
        recipient: 'target',
        condition: 'Burned',
        action: 'add',
        label: 'Burned on 15+',
        threshold: '15+',
        optional: true,
      }))

    expect(parseMoveAutomationConditionSuggestions('Ember Burns the target on 18+.'))
      .toContainEqual(expect.objectContaining({
        recipient: 'target',
        condition: 'Burned',
        action: 'add',
        label: 'Burned on 18+',
        threshold: '18+',
        optional: true,
      }))

    expect(parseMoveAutomationConditionSuggestions('Bite Flinches the target on 15+.'))
      .toContainEqual(expect.objectContaining({
        recipient: 'target',
        condition: 'Flinch',
        action: 'add',
        label: 'Flinch on 15+',
        threshold: '15+',
        optional: true,
      }))

    expect(parseMoveAutomationConditionSuggestions('Headlong Rush Trips the target on a hit.'))
      .toContainEqual(expect.objectContaining({
        recipient: 'target',
        condition: 'Tripped',
        action: 'add',
        label: 'Tripped',
      }))

    expect(parseMoveAutomationConditionSuggestions('Legal targets hit by Steel Roller are Tripped on a roll of 15+.'))
      .toContainEqual(expect.objectContaining({
        recipient: 'target',
        condition: 'Tripped',
        action: 'add',
        label: 'Tripped on 15+',
        threshold: '15+',
        optional: true,
      }))
  })

  it('routes Rest sleep to the user', () => {
    expect(parseMoveAutomationConditionSuggestions('The user falls Asleep and is set to full Hit Points.'))
      .toContainEqual(expect.objectContaining({
        recipient: 'user',
        condition: 'Sleep',
        action: 'add',
      }))
  })

  it('does not infer Enraged from Dragon Rage move-name mentions', () => {
    expect(parseMoveAutomationConditionSuggestions(
      'If it hits, Dragon Rage causes the target to lose 15 Hit Points. Dragon Rage is Special and interacts with other moves and effects as such.',
    )).toEqual([])
  })

  it('builds clear-status suggestions for target and user text', () => {
    expect(parseMoveAutomationConditionSuggestions('All targets are cured of any Persistent Status.'))
      .toContainEqual(expect.objectContaining({
        recipient: 'target',
        condition: '*',
        action: 'clear',
        label: 'Clear target conditions',
      }))

    expect(parseMoveAutomationConditionSuggestions('The user and any allies are cured of all Permanent and Volatile Statuses.'))
      .toContainEqual(expect.objectContaining({
        recipient: 'user',
        condition: '*',
        action: 'clear',
        label: 'Clear user conditions',
      }))
  })

  it('marks contextual condition mentions optional', () => {
    expect(parseMoveAutomationConditionSuggestions('If the target is already Poisoned, the target becomes Slowed.'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ condition: 'Poisoned', optional: true }),
        expect.objectContaining({ condition: 'Slowed', action: 'add', optional: true }),
      ]))
    expect(parseMoveAutomationConditionSuggestions('On 16+, the target slows down.'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ condition: 'Slowed', action: 'add', threshold: '16+' }),
      ]))
    expect(parseMoveAutomationConditionSuggestions('You may perform a Trip Maneuver against the target as a Free Action.'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ condition: 'Tripped', action: 'add', optional: true }),
      ]))
  })

  it('extracts condition removals from cure text windows', () => {
    expect(parseMoveAutomationConditionSuggestions('The user removes Burned from itself.'))
      .toContainEqual(expect.objectContaining({
        condition: 'Burned',
        action: 'remove',
      }))
  })
})
