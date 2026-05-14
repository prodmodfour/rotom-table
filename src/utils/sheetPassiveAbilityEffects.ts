import { computeMultiplier } from '~/utils/typeChart'
import {
  sheetHasCanonicalAbility,
  type SheetAbilityNameSource,
} from '~/utils/sheetAbilities'

export const LEVITATE_ABILITY_NAME = 'Levitate'
export const LEVITATE_GRANTED_SPEED = 4
export const LEVITATE_EXISTING_SPEED_BONUS = 2
export const LEVITATE_GROUND_RESISTANCE_MULTIPLIER = 0.5

export interface GroundResistanceCapabilities {
  sky?: number | string | null
  levitate?: number | string | null
}

export const hasLevitateAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, LEVITATE_ABILITY_NAME)

const positiveCapabilitySpeed = (value: number | string | null | undefined): boolean => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value !== 'string') return false

  const parsed = Number.parseFloat(value.trim())
  return Number.isFinite(parsed) && parsed > 0
}

export const hasSkyCapability = (
  capabilities: GroundResistanceCapabilities | null | undefined,
): boolean => positiveCapabilitySpeed(capabilities?.sky)

export const hasLevitateCapability = (
  capabilities: GroundResistanceCapabilities | null | undefined,
): boolean => positiveCapabilitySpeed(capabilities?.levitate)

export const hasGroundResistingCapability = (
  capabilities: GroundResistanceCapabilities | null | undefined,
): boolean => hasSkyCapability(capabilities) || hasLevitateCapability(capabilities)

export const hasPassiveGroundResistance = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: GroundResistanceCapabilities | null,
): boolean => hasLevitateAbility(abilities) || hasGroundResistingCapability(capabilities)

export const getPassiveGroundResistanceSource = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: GroundResistanceCapabilities | null,
): string | null => {
  if (hasLevitateAbility(abilities)) return LEVITATE_ABILITY_NAME

  const capabilitySources = [
    hasSkyCapability(capabilities) ? 'Sky' : null,
    hasLevitateCapability(capabilities) ? 'Levitate' : null,
  ].filter((source): source is string => Boolean(source))

  return capabilitySources.length ? `${capabilitySources.join('/')} Capability` : null
}

/**
 * Levitate grants a Levitate speed of 4 if none exists, otherwise +2 to the
 * existing Levitate speed. A value of 0 is treated as no existing speed.
 */
export const resolveLevitateAbilitySpeed = (
  baseLevitate: number | null | undefined,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number | undefined => {
  if (!hasLevitateAbility(abilities)) return baseLevitate ?? undefined
  return typeof baseLevitate === 'number' && Number.isFinite(baseLevitate) && baseLevitate > 0
    ? baseLevitate + LEVITATE_EXISTING_SPEED_BONUS
    : LEVITATE_GRANTED_SPEED
}

/**
 * Passive type effects used by sheets and token automation. Levitate ability,
 * Sky capability, and Levitate capability grant Ground resistance rather than
 * full immunity; an existing type immunity still wins, and an already-stronger
 * resistance is preserved. Multiple passive sources do not stack.
 */
export const applySheetPassiveTypeEffectiveness = (
  attackingType: string,
  baseMultiplier: number,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: GroundResistanceCapabilities | null,
): number => {
  if (
    attackingType !== 'Ground'
    || !hasPassiveGroundResistance(abilities, capabilities)
    || baseMultiplier === 0
  ) {
    return baseMultiplier
  }
  return Math.min(baseMultiplier, LEVITATE_GROUND_RESISTANCE_MULTIPLIER)
}

/** Backwards-compatible ability-only wrapper. */
export const applySheetPassiveAbilityTypeEffectiveness = (
  attackingType: string,
  baseMultiplier: number,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number => applySheetPassiveTypeEffectiveness(attackingType, baseMultiplier, abilities)

export const computeSheetAbilityAwareMultiplier = (
  attackingType: string,
  defenders: ReadonlyArray<string | undefined>,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: GroundResistanceCapabilities | null,
): number => applySheetPassiveTypeEffectiveness(
  attackingType,
  computeMultiplier(attackingType, defenders),
  abilities,
  capabilities,
)
