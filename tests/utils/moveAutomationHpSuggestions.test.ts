import { describe, expect, it } from 'vitest'
import { parseMoveAutomationHpSuggestions } from '~/utils/moveAutomationHpSuggestions'
import type { MoveAutomationMoveLike } from '~/utils/moveAutomation'

const move = (overrides: Partial<MoveAutomationMoveLike>): MoveAutomationMoveLike => ({
  name: 'Test Move',
  effect: '',
  range: '',
  ...overrides,
})

describe('move automation HP suggestion parsing', () => {
  it('parses user HP loss and fainting suggestions from effect text', () => {
    const suggestions = parseMoveAutomationHpSuggestions(move({
      effect: 'The user loses 1/2 of their Max Hit Points and immediately Faints.',
    }))

    expect(suggestions).toEqual([
      { recipient: 'user', mode: 'lose-percent-max', percent: 50, label: 'User loses 50% of Max HP' },
      { recipient: 'user', mode: 'set-zero', label: 'User HP becomes 0' },
    ])
  })

  it('parses recoil and target fixed/current HP loss suggestions', () => {
    const suggestions = parseMoveAutomationHpSuggestions(move({
      range: 'Melee, 1 Target, Recoil 1/4',
      effect: 'The target loses 1/2 of their current Hit Points and causes the target to lose 15 Hit Points.',
    }))

    expect(suggestions).toEqual([
      { recipient: 'user', mode: 'recoil-percent-damage-dealt', percent: 25, rounding: 'floor', label: 'Recoil 1/4' },
      { recipient: 'target', mode: 'lose-percent-current', percent: 50, label: 'Target loses half current HP' },
      { recipient: 'target', mode: 'fixed-loss', amount: 15, label: 'Target loses 15 HP' },
    ])
  })

  it('parses named and target healing suggestions with optional weather modifiers', () => {
    const userHealing = parseMoveAutomationHpSuggestions(move({
      name: 'Synthesis',
      effect: 'The user regains Hit Points equal to half of its full Hit Point value. Sunny Weather may change this.',
    }))
    expect(userHealing).toEqual([
      { recipient: 'user', mode: 'heal-percent-max', percent: 50, label: 'User heals 50% Max HP', optional: true },
    ])

    const targetHealing = parseMoveAutomationHpSuggestions(move({
      effect: 'The target recovers 50% of their max Hit Points; they may instead do nothing.',
    }))
    expect(targetHealing).toEqual([
      { recipient: 'target', mode: 'heal-percent-max', percent: 50, label: 'Target heals 50% Max HP', optional: true },
    ])
  })

  it('deduplicates equivalent HP suggestions while preserving first occurrence labels', () => {
    const suggestions = parseMoveAutomationHpSuggestions(move({
      name: 'Recover',
      effect: 'The user regains Hit Points equal to half. The user regains hit points equal to 50%.',
    }))

    expect(suggestions).toEqual([
      { recipient: 'user', mode: 'heal-percent-max', percent: 50, label: 'User heals 50% Max HP', optional: false },
    ])
  })
})
