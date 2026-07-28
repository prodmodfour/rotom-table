import { ENCOUNTER_PRESENTATION_LIMITS } from './catalog'

const normalizePart = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9._/-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'unknown'

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Build a bounded stable wire identity without exposing it as player copy. */
export const encounterPresentationStableId = (
  namespace: string,
  ...parts: readonly string[]
): string => {
  const normalized = [namespace, ...parts].map(normalizePart).join(':')
  if (normalized.length <= ENCOUNTER_PRESENTATION_LIMITS.identifierLength) return normalized
  const suffix = `:${fnv1a32(normalized)}`
  return `${normalized.slice(0, ENCOUNTER_PRESENTATION_LIMITS.identifierLength - suffix.length).replace(/[^a-z0-9]+$/g, '')}${suffix}`
}
