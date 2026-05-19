import { computeMultiplier, resistMultiplierOneStepFurther } from '~/utils/typeChart'
import {
  sheetHasCanonicalAbility,
  type SheetAbilityNameSource,
} from '~/utils/sheetAbilities'

export const LEVITATE_ABILITY_NAME = 'Levitate'
export const FLASH_FIRE_ABILITY_NAME = 'Flash Fire'
export const TOLERANCE_ABILITY_NAME = 'Tolerance'
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
  baseMultiplier?: number | null
}

export interface SheetPassiveTypeEffectivenessResult {
  multiplier: number
  sources: string[]
}

export const hasLevitateAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, LEVITATE_ABILITY_NAME)

export const hasFlashFireAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, FLASH_FIRE_ABILITY_NAME)

export const hasToleranceAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, TOLERANCE_ABILITY_NAME)

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

const isResistanceMultiplier = (multiplier: number): boolean => multiplier > 0 && multiplier < 1

export const resolveSheetPassiveTypeEffectiveness = (
  attackingType: string,
  baseMultiplier: number,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: AirborneMovementCapabilities | null,
  context: SheetPassiveTypeEffectivenessContext = {},
): SheetPassiveTypeEffectivenessResult => {
  const groundsourceSource = getGroundsourceMoveImmunitySource(capabilities, context.moveKeywords)
  if (groundsourceSource) return { multiplier: 0, sources: [groundsourceSource] }
  if (attackingType === 'Fire' && hasFlashFireAbility(abilities)) {
    return { multiplier: 0, sources: [FLASH_FIRE_ABILITY_NAME] }
  }

  let multiplier = baseMultiplier
  const sources: string[] = []

  if (attackingType === 'Ground' && hasPassiveGroundResistance(abilities) && multiplier !== 0) {
    const nextMultiplier = resistMultiplierOneStepFurther(multiplier)
    if (!Object.is(nextMultiplier, multiplier)) sources.push(LEVITATE_ABILITY_NAME)
    multiplier = nextMultiplier
  }

  if (hasToleranceAbility(abilities) && isResistanceMultiplier(multiplier)) {
    const nextMultiplier = resistMultiplierOneStepFurther(multiplier)
    if (!Object.is(nextMultiplier, multiplier)) sources.push(TOLERANCE_ABILITY_NAME)
    multiplier = nextMultiplier
  }

  return { multiplier, sources }
}

export const getPassiveTypeEffectivenessSource = (
  attackingType: string,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: AirborneMovementCapabilities | null,
  context: SheetPassiveTypeEffectivenessContext = {},
): string | null => {
  const result = resolveSheetPassiveTypeEffectiveness(
    attackingType,
    context.baseMultiplier ?? 1,
    abilities,
    capabilities,
    context,
  )
  const sources = context.baseMultiplier == null
    ? result.sources.filter((source) => source !== TOLERANCE_ABILITY_NAME)
    : result.sources
  return sources.length ? sources.join(', ') : null
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
 * step more resisted. Tolerance makes any currently resisted type one
 * additional step resisted. Sky and Levitate capabilities make moves with the
 * Groundsource keyword immune. Existing type immunities still win.
 */
export const applySheetPassiveTypeEffectiveness = (
  attackingType: string,
  baseMultiplier: number,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  capabilities?: AirborneMovementCapabilities | null,
  context: SheetPassiveTypeEffectivenessContext = {},
): number => resolveSheetPassiveTypeEffectiveness(
  attackingType,
  baseMultiplier,
  abilities,
  capabilities,
  context,
).multiplier

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
