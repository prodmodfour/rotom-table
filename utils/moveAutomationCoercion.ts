export const coerceMoveAccuracy = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '--') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

export const coerceMoveDamageBase = (value: unknown): number | null => {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}
