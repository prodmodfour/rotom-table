import { describe, expect, it } from 'vitest'
import { buildCombatLogMessages } from '~/utils/combatLog'

describe('buildCombatLogMessages', () => {
  it('combines move, ability, order, and movement entries in chronological order', () => {
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
      'Crockefeller Moves',
      'Foil used Ember.',
    ])
    expect(messages.map((message) => message.source)).toEqual([
      'move',
      'ability',
      'order',
      'movement',
      'move',
    ])
    expect(messages[2]?.details).toEqual(['Target: Any Ally'])
    expect(messages[3]?.details).toEqual(['3 squares from (0, 0, 0) to (3, 0, 0).'])
    expect(messages[4]?.details).toEqual(['Crockefeller: 9 damage.'])
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
})
