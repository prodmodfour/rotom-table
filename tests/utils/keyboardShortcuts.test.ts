import { describe, expect, it } from 'vitest'
import { isCtrlShiftLetter, isEscapeKey } from '~/utils/keyboardShortcuts'

const keyEvent = (overrides: Partial<KeyboardEvent>): KeyboardEvent => ({
  key: '',
  ctrlKey: false,
  shiftKey: false,
  ...overrides,
}) as KeyboardEvent

describe('keyboard shortcut helpers', () => {
  it('detects Escape by key only', () => {
    expect(isEscapeKey(keyEvent({ key: 'Escape' }))).toBe(true)
    expect(isEscapeKey(keyEvent({ key: 'Esc' }))).toBe(false)
    expect(isEscapeKey(keyEvent({ key: 'Enter' }))).toBe(false)
  })

  it('detects ctrl+shift letter shortcuts case-insensitively', () => {
    expect(isCtrlShiftLetter(keyEvent({ key: 'a', ctrlKey: true, shiftKey: true }), 'A')).toBe(true)
    expect(isCtrlShiftLetter(keyEvent({ key: 'A', ctrlKey: true, shiftKey: true }), 'a')).toBe(true)
    expect(isCtrlShiftLetter(keyEvent({ key: 'a', ctrlKey: false, shiftKey: true }), 'a')).toBe(false)
    expect(isCtrlShiftLetter(keyEvent({ key: 'b', ctrlKey: true, shiftKey: true }), 'a')).toBe(false)
  })
})
