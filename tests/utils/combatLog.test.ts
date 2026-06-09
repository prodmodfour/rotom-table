import { describe, expect, it } from 'vitest'
import {
  buildCombatLogMessages,
  clearCombatLogMetadata,
  countCombatLogMessages,
} from '~/utils/combatLog'

describe('combatLog utilities', () => {
  it('combines move, ability, order, maneuver, and movement entries in chronological order', () => {
    const messages = buildCombatLogMessages({
      moveLog: [
        {
          at: 200,
          userName: 'Foil',
          moveName: 'Ember',
          lines: [
            'Foil used Ember.',
            'Explicit move script v1 used.',
            'Crockefeller: 9 damage.',
          ],
        },
        {
          at: 100,
          userName: 'Doug',
          moveName: 'Leer',
          lines: ['Doug used Leer.'],
        },
      ],
      abilityLog: [
        {
          at: 150,
          userName: 'Lux',
          abilityName: 'Intimidate',
          lines: ['Lux activated Intimidate.'],
        },
      ],
      orderLog: [
        {
          at: 160,
          userName: 'Lenora',
          orderName: 'Mobilize',
          lines: ['Lenora used Mobilize.', 'Target: Any Ally'],
        },
      ],
      maneuverLog: [
        {
          at: 165,
          userName: 'Pike',
          maneuverName: 'Trip',
          lines: ['Pike used Trip.', 'Target: Doug'],
        },
      ],
      movementLog: [
        {
          at: 175,
          userName: 'Crockefeller',
          actionName: 'Movement',
          lines: ['Crockefeller moved 3 squares from (0, 0, 0) to (3, 0, 0).'],
        },
      ],
    })

    expect(messages.map((message) => message.title)).toEqual([
      'Doug used Leer.',
      'Lux activated Intimidate.',
      'Lenora used Mobilize.',
      'Pike used Trip.',
      'Crockefeller Moves',
      'Foil used Ember.',
    ])
    expect(messages.map((message) => message.source)).toEqual([
      'move',
      'ability',
      'order',
      'maneuver',
      'movement',
      'move',
    ])
    expect(messages[2]?.details).toEqual(['Target: Any Ally'])
    expect(messages[3]?.details).toEqual(['Target: Doug'])
    expect(messages[4]?.details).toEqual(['3 squares from (0, 0, 0) to (3, 0, 0).'])
    expect(messages[5]?.details).toEqual(['Crockefeller: 9 damage.'])
  })

  it('includes Poké Ball capture attempts', () => {
    const messages = buildCombatLogMessages({
      captureLog: [
        {
          at: 123,
          userId: 'trainer',
          userName: 'Lenora',
          actionName: 'Throw Basic Ball',
          pokeballName: 'Basic Ball',
          lines: ['Lenora threw Basic Ball at Pidgey.', 'Result: Pidgey was captured!'],
        },
      ],
    })

    expect(messages).toEqual([
      {
        id: 'capture-123-0',
        at: 123,
        source: 'capture',
        userName: 'Lenora',
        actionName: 'Throw Basic Ball',
        title: 'Lenora threw Basic Ball at Pidgey.',
        details: ['Result: Pidgey was captured!'],
      },
    ])
  })

  it('returns the newest limited action messages while keeping display order', () => {
    const messages = buildCombatLogMessages({
      moveLog: [
        { at: 100, userName: 'A', moveName: 'One', lines: ['one'] },
        { at: 200, userName: 'B', moveName: 'Two', lines: ['two', 'three'] },
        { at: 300, userName: 'C', moveName: 'Four', lines: ['four'] },
      ],
    }, { maxMessages: 2 })

    expect(messages.map((message) => message.title)).toEqual(['two', 'four'])
    expect(messages[0]?.details).toEqual(['three'])
  })

  it('adds normalized actor accent colours when available', () => {
    const messages = buildCombatLogMessages({
      moveLog: [
        { at: 100, userId: 'token-1', userName: 'Foil', moveName: 'Ember', lines: ['Foil used Ember.'] },
        { at: 200, userId: 'token-2', userName: 'Doug', moveName: 'Leer', accentColor: '#ABCDEF', lines: ['Doug used Leer.'] },
        { at: 300, userId: 'token-3', userName: 'Lux', moveName: 'Growl', lines: ['Lux used Growl.'] },
      ],
    }, {
      actorAccents: [
        { id: 'token-1', accentColor: '#12AB34' },
        { id: 'token-3', accentColor: 'not a color' },
      ],
    })

    expect(messages.map((message) => message.accentColor)).toEqual(['#12ab34', '#abcdef', undefined])
  })

  it('ignores malformed entries, blank lines, and internal implementation lines', () => {
    const messages = buildCombatLogMessages({
      moveLog: [
        null,
        { at: Number.NaN, userName: '  ', moveName: '', lines: ['  ', 'Fallback line'] },
        { at: 200, userName: 'Hidden', moveName: 'Hidden', lines: ['Explicit move script v1 used.'] },
        { at: 300, userName: 'No Lines', moveName: 'Splash', lines: 'not an array' },
      ],
      abilityLog: 'not an array',
    })

    expect(messages).toEqual([
      {
        id: 'move-0-1',
        at: 0,
        source: 'move',
        userName: 'Unknown',
        actionName: 'Move',
        title: 'Fallback line',
        details: [],
      },
    ])
  })

  it('counts displayable combat log messages', () => {
    expect(countCombatLogMessages({
      moveLog: [
        { at: 100, userName: 'Foil', moveName: 'Ember', lines: ['Foil used Ember.'] },
        { at: 200, userName: 'Hidden', moveName: 'Hidden', lines: ['Explicit move script v1 used.'] },
      ],
      movementLog: [
        { at: 300, userName: 'Doug', actionName: 'Movement', lines: ['Doug moved from here to there.'] },
      ],
    })).toBe(2)
  })

  it('clears combat log metadata while preserving unrelated metadata', () => {
    expect(clearCombatLogMetadata({
      moveLog: [{ at: 100, userName: 'Foil', moveName: 'Ember', lines: ['Foil used Ember.'] }],
      abilityLog: [{ at: 110, userName: 'Lux', abilityName: 'Intimidate', lines: ['Lux used Intimidate.'] }],
      orderLog: [{ at: 120, userName: 'Lenora', orderName: 'Mobilize', lines: ['Lenora used Mobilize.'] }],
      maneuverLog: [{ at: 130, userName: 'Pike', maneuverName: 'Trip', lines: ['Pike used Trip.'] }],
      movementLog: [{ at: 140, userName: 'Doug', actionName: 'Movement', lines: ['Doug moved.'] }],
      captureLog: [{ at: 150, userName: 'Lenora', actionName: 'Throw Basic Ball', lines: ['Lenora threw a ball.'] }],
      encounterName: 'Route 1',
    })).toEqual({ encounterName: 'Route 1' })
  })

  it('returns undefined when clearing leaves no metadata', () => {
    expect(clearCombatLogMetadata({
      moveLog: [{ at: 100, userName: 'Foil', moveName: 'Ember', lines: ['Foil used Ember.'] }],
    })).toBeUndefined()
  })
})
