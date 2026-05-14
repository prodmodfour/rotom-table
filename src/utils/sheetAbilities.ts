import { findAbility } from '~~/data/ptuReference'

export interface SheetAbilityNameLike {
  name: string
}

export type SheetAbilityNameSource = SheetAbilityNameLike | string | null | undefined

export const rawSheetAbilityName = (ability: SheetAbilityNameSource): string => {
  if (typeof ability === 'string') return ability.trim()
  if (!ability || typeof ability.name !== 'string') return ''
  return ability.name.trim()
}

export const resolveCanonicalSheetAbilityName = (ability: SheetAbilityNameSource): string | null => {
  const rawName = rawSheetAbilityName(ability)
  if (!rawName) return null
  return findAbility(rawName)?.name ?? null
}

export const sheetHasCanonicalAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  canonicalName: string,
): boolean => {
  for (const ability of abilities ?? []) {
    if (resolveCanonicalSheetAbilityName(ability) === canonicalName) return true
  }
  return false
}

export const sheetAbilityNames = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): string[] => (abilities ?? [])
  .map(rawSheetAbilityName)
  .filter((name) => name.length > 0)
