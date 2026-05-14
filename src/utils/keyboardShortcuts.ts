export const isEscapeKey = (event: Pick<KeyboardEvent, 'key'>): boolean => event.key === 'Escape'

export const isCtrlLetter = (
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey'>,
  letter: string,
): boolean => event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === letter.toLowerCase()

export const isCtrlShiftLetter = (
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey'>,
  letter: string,
): boolean => event.ctrlKey && event.shiftKey && event.key.toLowerCase() === letter.toLowerCase()
