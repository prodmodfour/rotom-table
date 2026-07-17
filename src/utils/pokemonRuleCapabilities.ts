import type { EncounterTransformationCapabilitySnapshot } from '#shared/moveAutomation/transformationSnapshots'
import type { CharacterSheet } from '~/types/characterSheet'
import type {
  MovementCapabilitySpeeds,
  MovementCapabilityTraits,
} from '~/types/movement'
import { resolveCapabilities } from '~/utils/sheets/pokemonDerived'

export interface PokemonRuleCapabilityProjection {
  readonly weightClass: number | null
  readonly capabilities: EncounterTransformationCapabilitySnapshot
}

const integerRow = (
  rows: ReturnType<typeof resolveCapabilities>['rows'],
  label: string,
  minimum: number,
): number | null => {
  const value = rows.find(row => row.label === label)?.value
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null
}

const textRow = (
  rows: ReturnType<typeof resolveCapabilities>['rows'],
  label: string,
): string | null => {
  const value = rows.find(row => row.label === label)?.value
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  return text || null
}

/** Resolve the complete non-stat capability base that Transform is allowed to copy. */
export const resolvePokemonRuleCapabilityProjection = (input: {
  readonly sheet: CharacterSheet
  readonly movementSpeeds: MovementCapabilitySpeeds
  readonly movementTraits: MovementCapabilityTraits
}): PokemonRuleCapabilityProjection => {
  const resolved = resolveCapabilities(input.sheet)
  return {
    weightClass: integerRow(resolved.rows, 'Weight', 1),
    capabilities: {
      movementSpeeds: { ...input.movementSpeeds },
      movementTraits: {
        phasing: input.movementTraits.phasing,
        jump: { ...input.movementTraits.jump },
      },
      power: integerRow(resolved.rows, 'Power', 0),
      size: textRow(resolved.rows, 'Size'),
      naturewalk: resolved.naturewalk?.trim() || null,
      other: [...resolved.other],
    },
  }
}
