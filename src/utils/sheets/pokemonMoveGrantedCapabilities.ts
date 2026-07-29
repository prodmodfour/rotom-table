import { findMove } from '~~/data/ptuReference'
import type { CharacterSheetMove, CharacterSheetCapabilities } from '~/types/characterSheet'

export type NumberedMoveCapabilityKey = Extract<
  keyof CharacterSheetCapabilities,
  'overland' | 'sky' | 'swim' | 'levitate' | 'burrow' | 'power'
>

export interface ValuedOtherCapabilityBonus {
  capability: string
  bonus: number
}

export interface PokemonMoveGrantedCapabilities {
  numberedBonuses: Partial<Record<NumberedMoveCapabilityKey, number>>
  jumpBonuses: {
    long: number
    high: number
  }
  other: string[]
  valuedOtherBonuses: ValuedOtherCapabilityBonus[]
}

const EMPTY_MOVE_GRANTED_CAPABILITIES: PokemonMoveGrantedCapabilities = {
  numberedBonuses: {},
  jumpBonuses: { long: 0, high: 0 },
  other: [],
  valuedOtherBonuses: [],
}

const GRANTS_PATTERN = /^Grants?\s+(.+)$/i
const LEADING_BONUS_PATTERN = /^\+(\d+)\s+(.+)$/
const TRAILING_BONUS_PATTERN = /^(.+?)\s+\+(\d+)$/
const TRAILING_VALUE_PATTERN = /^(.+?)\s+(\d+)$/
const JUMP_LABEL_PATTERN = /^(Long|High)\s+Jump$/i

const NUMBERED_CAPABILITY_KEYS: Record<string, NumberedMoveCapabilityKey> = {
  overland: 'overland',
  sky: 'sky',
  swim: 'swim',
  levitate: 'levitate',
  burrow: 'burrow',
  power: 'power',
}

const normalizeCapabilityLabel = (raw: string): string =>
  raw.trim().replace(/\s+/g, ' ')

const capabilityLookupKey = (raw: string): string =>
  normalizeCapabilityLabel(raw).toLowerCase()

const parsePositiveInteger = (raw: string | undefined): number | null => {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const addNumberedBonus = (
  grants: PokemonMoveGrantedCapabilities,
  key: NumberedMoveCapabilityKey,
  bonus: number,
): void => {
  grants.numberedBonuses[key] = (grants.numberedBonuses[key] ?? 0) + bonus
}

const addUniqueOtherCapability = (
  grants: PokemonMoveGrantedCapabilities,
  capability: string,
  seenOtherCapabilities: Set<string>,
): void => {
  const normalized = normalizeCapabilityLabel(capability)
  if (!normalized) return
  const key = capabilityLookupKey(normalized)
  if (seenOtherCapabilities.has(key)) return
  seenOtherCapabilities.add(key)
  grants.other.push(normalized)
}

const addValuedOtherBonus = (
  grants: PokemonMoveGrantedCapabilities,
  capability: string,
  bonus: number,
): void => {
  const normalized = normalizeCapabilityLabel(capability)
  if (!normalized || bonus <= 0) return

  const existing = grants.valuedOtherBonuses.find(
    (valueBonus) => capabilityLookupKey(valueBonus.capability) === capabilityLookupKey(normalized),
  )
  if (existing) {
    existing.bonus += bonus
    return
  }

  grants.valuedOtherBonuses.push({ capability: normalized, bonus })
}

const addCapabilityGrant = (
  grants: PokemonMoveGrantedCapabilities,
  rawGrant: string,
  seenOtherCapabilities: Set<string>,
): void => {
  const grant = normalizeCapabilityLabel(rawGrant)
  if (!grant) return

  const leadingBonus = LEADING_BONUS_PATTERN.exec(grant)
  if (leadingBonus) {
    const bonus = parsePositiveInteger(leadingBonus[1])
    const label = normalizeCapabilityLabel(leadingBonus[2] ?? '')
    const numberedKey = NUMBERED_CAPABILITY_KEYS[capabilityLookupKey(label)]
    if (bonus && numberedKey) addNumberedBonus(grants, numberedKey, bonus)
    else if (bonus) addValuedOtherBonus(grants, label, bonus)
    return
  }

  const trailingBonus = TRAILING_BONUS_PATTERN.exec(grant)
  if (trailingBonus) {
    const label = normalizeCapabilityLabel(trailingBonus[1] ?? '')
    const bonus = parsePositiveInteger(trailingBonus[2])
    if (!bonus) return

    const jumpLabel = JUMP_LABEL_PATTERN.exec(label)
    if (jumpLabel) {
      const jumpKey = jumpLabel[1]?.toLowerCase() === 'long' ? 'long' : 'high'
      grants.jumpBonuses[jumpKey] += bonus
      return
    }

    const numberedKey = NUMBERED_CAPABILITY_KEYS[capabilityLookupKey(label)]
    if (numberedKey) addNumberedBonus(grants, numberedKey, bonus)
    else addValuedOtherBonus(grants, label, bonus)
    return
  }

  const trailingValue = TRAILING_VALUE_PATTERN.exec(grant)
  if (trailingValue) {
    const label = normalizeCapabilityLabel(trailingValue[1] ?? '')
    const value = parsePositiveInteger(trailingValue[2])
    const numberedKey = NUMBERED_CAPABILITY_KEYS[capabilityLookupKey(label)]
    if (value && numberedKey) {
      addNumberedBonus(grants, numberedKey, value)
      return
    }
    if (value) {
      addValuedOtherBonus(grants, label, value)
      return
    }
  }

  addUniqueOtherCapability(grants, grant, seenOtherCapabilities)
}

const capabilityGrantFromSpecial = (special: string | null | undefined): string | null => {
  const match = GRANTS_PATTERN.exec(String(special ?? '').trim())
  return match?.[1]?.trim() || null
}

const CANONICAL_CAPABILITY_MOVE_GRANTS: Readonly<Record<string, string>> = Object.freeze({
  Fly: 'Grants Sky +4',
  Dive: 'Grants Swim +3',
  Dig: 'Grants Burrow +3',
  Teleport: 'Grants Teleporter +4',
  Transform: 'Grants Shapeshifter',
  Stockpile: 'Grants Inflatable',
})
const specialTextForMove = (move: Pick<CharacterSheetMove, 'name' | 'special'>): string | null => {
  const moveName = typeof move.name === 'string' ? move.name.trim() : ''
  const reviewedCapabilityGrant = CANONICAL_CAPABILITY_MOVE_GRANTS[moveName]
  if (reviewedCapabilityGrant) return reviewedCapabilityGrant
  const reference = moveName ? findMove(moveName) : null
  return reference?.special ?? move.special ?? null
}

export const resolveMoveGrantedCapabilities = (
  moves: readonly Pick<CharacterSheetMove, 'name' | 'special'>[] | null | undefined,
): PokemonMoveGrantedCapabilities => {
  if (!moves?.length) return EMPTY_MOVE_GRANTED_CAPABILITIES

  const grants: PokemonMoveGrantedCapabilities = {
    numberedBonuses: {},
    jumpBonuses: { long: 0, high: 0 },
    other: [],
    valuedOtherBonuses: [],
  }
  const seenMoveGrantKeys = new Set<string>()
  const seenOtherCapabilities = new Set<string>()

  for (const move of moves) {
    const grant = capabilityGrantFromSpecial(specialTextForMove(move))
    if (!grant) continue

    const moveName = typeof move.name === 'string' ? move.name.trim() : ''
    const grantKey = `${moveName.toLowerCase()}::${grant.toLowerCase()}`
    if (seenMoveGrantKeys.has(grantKey)) continue
    seenMoveGrantKeys.add(grantKey)

    addCapabilityGrant(grants, grant, seenOtherCapabilities)
  }

  return grants
}

export const applyNumberedCapabilityBonus = (
  baseValue: number | null | undefined,
  bonus: number | null | undefined,
): number | undefined => {
  const normalizedBonus = bonus ?? 0
  if (!normalizedBonus) return baseValue ?? undefined
  const base = typeof baseValue === 'number' && Number.isFinite(baseValue) ? baseValue : 0
  return base + normalizedBonus
}

export const removeNumberedCapabilityBonusForStorage = (
  effectiveValue: number | null | undefined,
  bonus: number | null | undefined,
): number | undefined => {
  if (effectiveValue == null) return undefined
  const base = effectiveValue - (bonus ?? 0)
  return Math.max(0, base)
}

const parseJumpValue = (value: string | null | undefined): { long: number; high: number } | null => {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(value ?? ''))
  if (!match) return null
  return {
    long: Number.parseInt(match[1] ?? '0', 10),
    high: Number.parseInt(match[2] ?? '0', 10),
  }
}

export const applyJumpCapabilityBonuses = (
  baseValue: string | null | undefined,
  bonuses: PokemonMoveGrantedCapabilities['jumpBonuses'] | null | undefined,
): string | undefined => {
  const longBonus = bonuses?.long ?? 0
  const highBonus = bonuses?.high ?? 0
  if (!longBonus && !highBonus) return baseValue ?? undefined

  const parsed = parseJumpValue(baseValue) ?? { long: 0, high: 0 }
  return `${parsed.long + longBonus}/${parsed.high + highBonus}`
}

export const removeJumpCapabilityBonusesForStorage = (
  effectiveValue: string | null | undefined,
  bonuses: PokemonMoveGrantedCapabilities['jumpBonuses'] | null | undefined,
): string | undefined => {
  const parsed = parseJumpValue(effectiveValue)
  if (!parsed) return effectiveValue?.trim() ? effectiveValue.trim() : undefined

  const long = Math.max(0, parsed.long - (bonuses?.long ?? 0))
  const high = Math.max(0, parsed.high - (bonuses?.high ?? 0))
  return `${long}/${high}`
}
