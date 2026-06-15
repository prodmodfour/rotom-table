export const isEscapeKey = (event: Pick<KeyboardEvent, 'key'>): boolean => event.key === 'Escape'

const EDITABLE_KEYBOARD_TARGET_NODE_NAMES = new Set(['input', 'textarea', 'select'])
const INTERACTIVE_KEYBOARD_TARGET_NODE_NAMES = new Set(['a', 'button'])
const KEYBOARD_SHORTCUT_BLOCKING_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="dialog"]',
  '[role="link"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="textbox"]',
  '[aria-modal="true"]',
].join(',')

const keyboardEventTargetNodeName = (target: EventTarget | null): string | null => {
  if (!target || typeof target !== 'object') return null

  const nodeName = (target as { nodeName?: string }).nodeName
  return nodeName?.toLowerCase() ?? null
}

export const isEditableKeyboardEventTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== 'object') return false

  const candidate = target as {
    isContentEditable?: boolean
  }

  if (candidate.isContentEditable) return true

  const nodeName = keyboardEventTargetNodeName(target)
  return nodeName !== null && EDITABLE_KEYBOARD_TARGET_NODE_NAMES.has(nodeName)
}

export const isKeyboardShortcutBlockedTarget = (target: EventTarget | null): boolean => {
  if (isEditableKeyboardEventTarget(target)) return true

  const nodeName = keyboardEventTargetNodeName(target)
  if (nodeName !== null && INTERACTIVE_KEYBOARD_TARGET_NODE_NAMES.has(nodeName)) return true

  const candidate = target as { closest?: (selector: string) => Element | null }
  return typeof candidate.closest === 'function' && Boolean(candidate.closest(KEYBOARD_SHORTCUT_BLOCKING_TARGET_SELECTOR))
}

export const isCtrlLetter = (
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey'>,
  letter: string,
): boolean => event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === letter.toLowerCase()

export const isCtrlShiftLetter = (
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey'>,
  letter: string,
): boolean => event.ctrlKey && event.shiftKey && event.key.toLowerCase() === letter.toLowerCase()
