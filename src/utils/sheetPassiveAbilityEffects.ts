import { computeMultiplier, resistMultiplierOneStepFurther } from '~/utils/typeChart'
import {
  sheetHasCanonicalAbility,
  type SheetAbilityNameSource,
} from '~/utils/sheetAbilities'

export const LEVITATE_ABILITY_NAME = 'Levitate'
export const FLASH_FIRE_ABILITY_NAME = 'Flash Fire'
export const GROUNDSOURCE_KEYWORD = 'Groundsource'
export const LEVITATE_GRANTED_SPEED = 4
export const LEVITATE_EXISTING_SPEED_BONUS = 2

export interface AirborneMovementCapabilities {
  sky?: number | string | null
  levitate?: number | string | null
}

/** @deprecated Use AirborneMovementCapabilities. */
export type GroundResistanceCapabilities = AirborneMovementCapabilities

export interface SheetPassiveTypeEffectivenessContext {
  moveKeywords?: readonly string[] | null
}

export const hasLevitateAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, LEVITATE_ABILITY_NAME)

export const hasFlashFireAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, FLASH_FIRE_ABILITY_NAME)

const positiveCapabilitySpeed = (value: number | string | null | undefined): boolean => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value !== 'string') return false

  const parsed = Number.parseFloat(value.trim())
  return Number.isFinite(parsed) && parsed > 0
}

export const hasSkyCapability = (
  capabilities: AirborneMovementCapabilities | null | undefined,
): boolean => positiveCapabilitySpeed(capabilities?.sky)

export const hasLevitateCapability = (
  capabilities: AirborneMovementCapabilities | null | undefined,
): boolean => positiveCapabilitySpeed(capabilities?.levitate)

export const hasGroundsourceImmunityCapability = (
  capabilities: AirborneMovementCapabilities | null | undefined,
): boolean => hasSkyCapability(capabilities) || hasLevitateCapability(capabilities)

/** @deprecated Sky and Levitate capabilities now grant Groundsource immunity, not general Ground resistance. */
export const hasGroundResistingCapability = (
  _capabilities: AirborneMovementCapabilities | null | undefined,
): boolean => false

export const hasPassiveGroundResistance = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => hasLevitateAbility(abilities)

export const getPassiveGroundResistanceSource = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): string | null => hasLevitateAbility(abilities) ? LEVITATE_ABILITY_NAME : null

const normalizedMoveKeyword = (keyword: string): string => keyword.trim().replace(/\s+/g, ' ').toLowerCase()

export const moveHasGroundsourceKeyword = (
  moveKeywords: readonly string[] | null | undefined,
): boolean => (moveKeywords ?? []).some((keyword) => normalizedMoveKeyword(keyword) === GROUNDSOURCE_KEYWORD.toLowerCase())

export const getGroundsourceMoveImmunitySource = (
  capabilities: AirborneMovementCapabilities | null | undefined,
  moveKeywords: readonly string[] | null | undefined,
): string | null => {
  if (!moveHasGroundsourceKeyword(moveKeywords)) return null

  const capabilitySources = [
    hasSkyCapability(capabilities) ? 'Sky' : null,
    hasLevitateCapability(capabilities) ? 'Levitate' : null,
  ].filter((source): source is string => Boolean(source))

  return capabilitySources.length ? `${capabilitySources.join('/')} Capability` : null
}

export const getPassiveFireImmunitySource = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): string | null => hasFlashFireAbility(abilities) ? FLASH_FIRE_ABILITY_NAME : null

export const getPassiveTypeEffectivenessSource = (
  attackingType: string,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: AirborneMovementCapabilities | null,
  context: SheetPassiveTypeEffectivenessContext = {},
): string | null => {
  const groundsourceSource = getGroundsourceMoveImmunitySource(capabilities, context.moveKeywords)
  if (groundsourceSource) return groundsourceSource
  if (attackingType === 'Fire') return getPassiveFireImmunitySource(abilities)
  if (attackingType === 'Ground') return getPassiveGroundResistanceSource(abilities)
  return null
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
 * Passive type effects used by sheets and token automation. Flash Fire makes
 * Fire attacks immune. The Levitate ability makes Ground one effectiveness
 * step more resisted. Sky and Levitate capabilities make moves with the
 * Groundsource keyword immune. Existing type immunities still win.
 */
export const applySheetPassiveTypeEffectiveness = (
  attackingType: string,
  baseMultiplier: number,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: AirborneMovementCapabilities | null,
  context: SheetPassiveTypeEffectivenessContext = {},
): number => {
  if (getGroundsourceMoveImmunitySource(capabilities, context.moveKeywords)) return 0
  if (attackingType === 'Fire' && hasFlashFireAbility(abilities)) return 0

  if (
    attackingType !== 'Ground'
    || !hasPassiveGroundResistance(abilities)
    || baseMultiplier === 0
  ) {
    return baseMultiplier
  }
  return resistMultiplierOneStepFurther(baseMultiplier)
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
  capabilities?: AirborneMovementCapabilities | null,
  context: SheetPassiveTypeEffectivenessContext = {},
): number => applySheetPassiveTypeEffectiveness(
  attackingType,
  computeMultiplier(attackingType, defenders),
  abilities,
  capabilities,
  context,
)
