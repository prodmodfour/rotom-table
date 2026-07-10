import { createHash } from 'node:crypto'
import type { MoveAutomationScript } from '../src/types/moveAutomation'

export const LEGACY_MOVE_AUTOMATION_DEFINITION_HASH_VERSION = 1 as const

type CanonicalJsonValue = null | boolean | number | string | readonly CanonicalJsonValue[] | {
  readonly [key: string]: CanonicalJsonValue
}

const canonicalizeJson = (value: unknown, path: string): CanonicalJsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`)
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry === undefined) throw new Error(`${path}[${index}] contains undefined.`)
      return canonicalizeJson(entry, `${path}[${index}]`)
    })
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain JSON objects.`)
    }
    const canonical: Record<string, CanonicalJsonValue> = {}
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry !== undefined) canonical[key] = canonicalizeJson(entry, `${path}.${key}`)
    }
    return canonical
  }
  throw new Error(`${path} contains unsupported ${typeof value} data.`)
}

/**
 * Canonical JSON for a v1 definition. Object keys are sorted, array order is
 * retained, and optional undefined object fields are omitted like JSON.stringify.
 */
export const serializeLegacyMoveAutomationDefinition = (
  script: MoveAutomationScript,
): string => JSON.stringify(canonicalizeJson({
  definition: script,
  hashVersion: LEGACY_MOVE_AUTOMATION_DEFINITION_HASH_VERSION,
  runtimeKind: 'legacy-v1',
}, 'legacyMoveAutomationDefinition'))

/** SHA-256 of the complete evaluated v1 script definition. */
export const hashLegacyMoveAutomationDefinition = (
  script: MoveAutomationScript,
): string => createHash('sha256')
  .update(serializeLegacyMoveAutomationDefinition(script), 'utf8')
  .digest('hex')
