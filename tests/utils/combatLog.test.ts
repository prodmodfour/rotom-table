import { describe, expect, it } from 'vitest'
import {
  buildCombatLogMessages,
  clearCombatLogMetadata,
  countCombatLogMessages,
} from '~/utils/combatLog'

describe('combatLog utilities', () => {
  it('combines move, ability, order, maneuver, movement, and initiative entries in chronological order', () => {
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
      initiativeLog: [
        {
          at: 180,
          userName: 'Crockefeller',
          actionName: 'Initiative',
          lines: ['Crockefeller has gained initiative!'],
        },
      ],
    })

    expect(messages.map((message) => message.title)).toEqual([
      'Doug used Leer.',
      'Lux activated Intimidate.',
      'Lenora used Mobilize.',
      'Pike used Trip.',
      'Crockefeller Moves',
      'Crockefeller has gained initiative!',
      'Foil used Ember.',
    ])
    expect(messages.map((message) => message.source)).toEqual([
      'move',
      'ability',
      'order',
      'maneuver',
      'movement',
      'initiative',
      'move',
    ])
    expect(messages[2]?.details).toEqual(['Target: Any Ally'])
    expect(messages[3]?.details).toEqual(['Target: Doug'])
    expect(messages[4]?.details).toEqual(['3 squares from (0, 0, 0) to (3, 0, 0).'])
    expect(messages[5]?.details).toEqual([])
    expect(messages[6]?.details).toEqual(['Crockefeller: 9 damage.'])
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

  it('scopes display and counts to the active scene when requested', () => {
    const scene = { name: 'Moonlit Rooftop', startedAt: 200 }
    const metadata = {
      moveLog: [
        { at: 100, userName: 'Old', moveName: 'Scratch', lines: ['Old used Scratch.'] },
        { at: 210, userName: 'Pika', moveName: 'Thunderbolt', lines: ['Pika used Thunderbolt.'] },
        { at: 120, userName: 'Foil', moveName: 'Ember', scene, lines: ['Foil used Ember.'] },
        {
          at: 220,
          userName: 'Lux',
          moveName: 'Leer',
          scene: { name: 'Different Scene', startedAt: 205 },
          lines: ['Lux used Leer.'],
        },
      ],
      initiativeLog: [
        { at: 230, userName: 'Pika', actionName: 'Initiative', lines: ['Pika has gained initiative!'] },
      ],
    }

    expect(buildCombatLogMessages(metadata, { scene }).map((message) => message.title)).toEqual([
      'Foil used Ember.',
      'Pika used Thunderbolt.',
      'Pika has gained initiative!',
    ])
    expect(countCombatLogMessages(metadata, { scene })).toBe(3)
    expect(buildCombatLogMessages(metadata, { scene: null })).toEqual([])
    expect(countCombatLogMessages(metadata, { scene: null })).toBe(0)
  })

  it('adds actor profile entries from the shared profile-image source when available', () => {
    const profileEntry = {
      name: 'Foil',
      profileUrl: '/profile-sprites/pokemon/foil.png',
      sprite: {
        url: '/sprites/foil.png',
        isSpriteSheet: false,
        frameWidth: 32,
        frameHeight: 32,
        scale: 1,
      },
    }
    const messages = buildCombatLogMessages({
      moveLog: [
        { at: 100, userId: 'token-1', userName: 'Foil', moveName: 'Ember', lines: ['Foil used Ember.'] },
        { at: 200, userId: 'token-2', userName: 'Doug', moveName: 'Leer', lines: ['Doug used Leer.'] },
      ],
    }, {
      actorProfiles: [
        { id: 'token-1', ...profileEntry },
      ],
    })

    expect(messages.map((message) => message.profileEntry)).toEqual([profileEntry, undefined])
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
      initiativeLog: [
        { at: 400, userName: 'Doug', actionName: 'Initiative', lines: ['Doug has gained initiative!'] },
      ],
    })).toBe(3)
  })

  it('clears combat log metadata while preserving unrelated metadata', () => {
    expect(clearCombatLogMetadata({
      moveLog: [{ at: 100, userName: 'Foil', moveName: 'Ember', lines: ['Foil used Ember.'] }],
      abilityLog: [{ at: 110, userName: 'Lux', abilityName: 'Intimidate', lines: ['Lux used Intimidate.'] }],
      orderLog: [{ at: 120, userName: 'Lenora', orderName: 'Mobilize', lines: ['Lenora used Mobilize.'] }],
      maneuverLog: [{ at: 130, userName: 'Pike', maneuverName: 'Trip', lines: ['Pike used Trip.'] }],
      movementLog: [{ at: 140, userName: 'Doug', actionName: 'Movement', lines: ['Doug moved.'] }],
      initiativeLog: [{ at: 145, userName: 'Doug', actionName: 'Initiative', lines: ['Doug has gained initiative!'] }],
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
