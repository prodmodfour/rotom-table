import { describe, expect, it } from 'vitest'
import {
  checkedValueFromEvent,
  finiteNumberFromEvent,
  looseNumberFromEvent,
  looseNumberFromText,
  textValueFromEvent,
  trimmedTextValueFromEvent,
} from '~/utils/domEvents'

const eventWithTarget = (target: unknown): Event => ({ target }) as Event

describe('dom event helpers', () => {
  it('extracts text input values with optional trimming', () => {
    const event = eventWithTarget({ value: '  search  ' })

    expect(textValueFromEvent(event)).toBe('  search  ')
    expect(trimmedTextValueFromEvent(event)).toBe('search')
    expect(textValueFromEvent(eventWithTarget(null))).toBe('')
  })

  it('extracts checkbox checked state with a safe fallback', () => {
    expect(checkedValueFromEvent(eventWithTarget({ checked: true }))).toBe(true)
    expect(checkedValueFromEvent(eventWithTarget({ checked: false }))).toBe(false)
    expect(checkedValueFromEvent(eventWithTarget(null))).toBe(false)
  })

  it('parses loose numbers while preserving invalid text', () => {
    expect(looseNumberFromText('12.5')).toBe(12.5)
    expect(looseNumberFromText('abc')).toBe('abc')
    expect(looseNumberFromEvent(eventWithTarget({ value: '7' }))).toBe(7)
  })

  it('parses finite numeric values with fallbacks', () => {
    expect(finiteNumberFromEvent(eventWithTarget({ value: '-2' }))).toBe(-2)
    expect(finiteNumberFromEvent(eventWithTarget({ value: 'nope' }), 3)).toBe(3)
  })
})
