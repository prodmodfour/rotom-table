export const SHEET_KINDS = ['pokemon', 'trainer'] as const

export type SheetKind = (typeof SHEET_KINDS)[number]

const SHEET_KIND_SET = new Set<unknown>(SHEET_KINDS)

export const isSheetKind = (value: unknown): value is SheetKind => SHEET_KIND_SET.has(value)
