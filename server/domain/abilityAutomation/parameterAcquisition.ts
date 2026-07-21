import { createHash, randomInt as cryptoRandomInt } from 'node:crypto'
import type { AbilityInstanceData } from '#shared/abilityAutomation/parameters'
import type { SheetKind } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  RUNTIME_ABILITY_PARAMETER_DEFINITIONS,
} from './instanceParameters'
import { resolveAbilityInstanceData } from '#shared/abilityAutomation/parameters'

const COLOR_OPTIONS = Object.freeze([
  'red', 'red-orange', 'orange', 'yellow-orange', 'yellow', 'yellow-green',
  'green', 'blue-green', 'blue', 'blue-violet', 'violet', 'red-violet',
])

type AbilitySheet = CharacterSheet | TrainerSheet
interface AbilityRow { readonly name: string; readonly automation?: AbilityInstanceData; readonly [key: string]: unknown }

const readyColorData = (row: AbilityRow | undefined): AbilityInstanceData | null => {
  if (!row?.automation) return null
  try {
    const resolved = resolveAbilityInstanceData(
      row.automation,
      'Color Theory',
      RUNTIME_ABILITY_PARAMETER_DEFINITIONS,
    )
    return resolved.status === 'ready' ? resolved.data : null
  }
  catch {
    return null
  }
}
const instanceId = (input: {
  readonly kind: SheetKind
  readonly slug: string
  readonly currentRevision: number
  readonly occurrence: number
}): string => `ability:color-theory:${createHash('sha256').update([
  input.kind, input.slug, String(input.currentRevision), String(input.occurrence), 'Color Theory',
].join('\u0000')).digest('hex').slice(0, 24)}`

/**
 * Materialize server-roll parameters at the setup-save authority boundary.
 * Existing authoritative acquisition results are immutable; client-authored
 * Color Theory values are ignored when a new instance is acquired.
 */
export const acquireServerRolledAbilityParameters = (input: {
  readonly kind: SheetKind
  readonly slug: string
  readonly currentRevision: number
  readonly currentSheet: Record<string, unknown>
  readonly requestedSheet: Record<string, unknown>
  readonly randomInt?: (maximumExclusive: number) => number
}): Record<string, unknown> => {
  const requested = deepCloneJson(input.requestedSheet) as unknown as AbilitySheet
  if (!Array.isArray(requested.abilities)) return requested as unknown as Record<string, unknown>
  const current = input.currentSheet as unknown as AbilitySheet
  const currentRows = Array.isArray(current.abilities) ? current.abilities as AbilityRow[] : []
  const byOccurrence = currentRows.filter(row => row?.name === 'Color Theory')
  let occurrence = 0
  const randomInt = input.randomInt ?? cryptoRandomInt
  requested.abilities = requested.abilities.map((raw): typeof raw => {
    if (!raw || raw.name !== 'Color Theory') return raw
    const authoritative = readyColorData(byOccurrence[occurrence])
    const rowOccurrence = occurrence
    occurrence += 1
    if (authoritative) return { ...raw, automation: authoritative }
    const rolled = randomInt(COLOR_OPTIONS.length)
    if (!Number.isSafeInteger(rolled) || rolled < 0 || rolled >= COLOR_OPTIONS.length) {
      throw new Error('Color Theory server roll returned an out-of-range result.')
    }
    const automation: AbilityInstanceData = {
      schemaVersion: 1,
      instanceId: instanceId({
        kind: input.kind, slug: input.slug,
        currentRevision: input.currentRevision, occurrence: rowOccurrence,
      }),
      canonicalId: 'Color Theory', definitionVersion: 1,
      selections: [{ parameterId: 'color', optionIds: [COLOR_OPTIONS[rolled]!] }],
    }
    return { ...raw, automation }
  })
  return requested as unknown as Record<string, unknown>
}
