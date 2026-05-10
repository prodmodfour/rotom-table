export type EditableCellValue = string | number | boolean | null | undefined

export type EditableCellType = 'text' | 'number' | 'textarea' | 'select'

export interface EditableCellOption {
  value: string
  label: string
}

export interface ParseEditableCellDraftOptions {
  type: EditableCellType
  currentValue: EditableCellValue
  min?: number
  max?: number
}

export const isEmptyEditableCellValue = (value: EditableCellValue): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value === '')

export const formatEditableCellDisplay = (
  value: EditableCellValue,
  formatter?: (value: EditableCellValue) => string,
): string => {
  if (formatter) return formatter(value)
  if (isEmptyEditableCellValue(value)) return ''
  return String(value)
}

export const editableCellDraftFromValue = (value: EditableCellValue): string =>
  isEmptyEditableCellValue(value) ? '' : String(value)

export const resolveEditableCellOptions = (
  options: Array<string | EditableCellOption>,
): EditableCellOption[] => options.map((option) => (
  typeof option === 'string' ? { value: option, label: option } : option
))

export const parseEditableCellDraft = (
  raw: string,
  { type, currentValue, min, max }: ParseEditableCellDraftOptions,
): EditableCellValue => {
  if (type !== 'number') return raw

  const trimmed = raw.trim()
  if (trimmed === '') return undefined

  const numericValue = Number(trimmed)
  if (!Number.isFinite(numericValue)) return currentValue
  if (min != null && numericValue < min) return min
  if (max != null && numericValue > max) return max
  return numericValue
}
