export type TextValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

export const textValueFromEvent = (event: Event): string => {
  const target = event.target as TextValueElement | null
  return target?.value ?? ''
}

export const trimmedTextValueFromEvent = (event: Event): string => textValueFromEvent(event).trim()

export const checkedValueFromEvent = (event: Event): boolean => {
  const target = event.target as HTMLInputElement | null
  return target?.checked ?? false
}

export const looseNumberFromText = (value: string): number | string => {
  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? value : parsed
}

export const looseNumberFromEvent = (event: Event): number | string =>
  looseNumberFromText(textValueFromEvent(event))

export const finiteNumberFromEvent = (event: Event, fallback = 0): number => {
  const value = Number(textValueFromEvent(event))
  return Number.isFinite(value) ? value : fallback
}
