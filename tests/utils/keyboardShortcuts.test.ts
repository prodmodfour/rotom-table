import { describe, expect, it } from 'vitest'
import {
  isCtrlLetter,
  isCtrlShiftLetter,
  isEditableKeyboardEventTarget,
  isEscapeKey,
  isKeyboardShortcutBlockedTarget,
} from '~/utils/keyboardShortcuts'

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

  it('detects ctrl letter shortcuts case-insensitively', () => {
    expect(isCtrlLetter(keyEvent({ key: 'b', ctrlKey: true }), 'B')).toBe(true)
    expect(isCtrlLetter(keyEvent({ key: 'B', ctrlKey: true }), 'b')).toBe(true)
    expect(isCtrlLetter(keyEvent({ key: 'b', ctrlKey: false }), 'b')).toBe(false)
    expect(isCtrlLetter(keyEvent({ key: 'b', ctrlKey: true, shiftKey: true }), 'b')).toBe(false)
    expect(isCtrlLetter(keyEvent({ key: 'a', ctrlKey: true }), 'b')).toBe(false)
  })

  it('detects ctrl+shift letter shortcuts case-insensitively', () => {
    expect(isCtrlShiftLetter(keyEvent({ key: 'a', ctrlKey: true, shiftKey: true }), 'A')).toBe(true)
    expect(isCtrlShiftLetter(keyEvent({ key: 'A', ctrlKey: true, shiftKey: true }), 'a')).toBe(true)
    expect(isCtrlShiftLetter(keyEvent({ key: 'a', ctrlKey: false, shiftKey: true }), 'a')).toBe(false)
    expect(isCtrlShiftLetter(keyEvent({ key: 'b', ctrlKey: true, shiftKey: true }), 'a')).toBe(false)
  })

  it('detects editable keyboard event targets', () => {
    expect(isEditableKeyboardEventTarget({ nodeName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isEditableKeyboardEventTarget({ nodeName: 'textarea' } as unknown as EventTarget)).toBe(true)
    expect(isEditableKeyboardEventTarget({ nodeName: 'select' } as unknown as EventTarget)).toBe(true)
    expect(isEditableKeyboardEventTarget({ nodeName: 'div', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isEditableKeyboardEventTarget({ nodeName: 'button' } as unknown as EventTarget)).toBe(false)
    expect(isEditableKeyboardEventTarget(null)).toBe(false)
  })

  it('blocks global shortcuts from interactive and modal targets', () => {
    expect(isKeyboardShortcutBlockedTarget({ nodeName: 'button' } as unknown as EventTarget)).toBe(true)
    expect(isKeyboardShortcutBlockedTarget({ nodeName: 'input' } as unknown as EventTarget)).toBe(true)
    expect(isKeyboardShortcutBlockedTarget({
      nodeName: 'section',
      closest: () => ({ nodeName: 'section' }),
    } as unknown as EventTarget)).toBe(true)
    expect(isKeyboardShortcutBlockedTarget({
      nodeName: 'canvas',
      closest: () => null,
    } as unknown as EventTarget)).toBe(false)
  })
})
