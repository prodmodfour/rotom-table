import { findItem } from '~~/data/ptuReference'

export interface WielderWeaponProfile {
  readonly canonicalItemName: string
  readonly weaponClass: 'small-melee' | 'large-melee'
  readonly damageBaseBonus: number
  readonly accuracyCheckPenalty: number
  readonly grantsReach: boolean
  readonly adeptMoveName: string | null
}

const moveFromEffect = (effect: string, label: 'Adept Move:'): string | null => {
  const start = effect.indexOf(label)
  if (start < 0) return null
  const value = effect.slice(start + label.length).split(/\s+Master Move:/i)[0]?.trim() ?? ''
  return value || null
}

/** Resolve only a size-legal man-made melee weapon held by an effective Wielder. */
export const resolveWielderWeaponProfile = (input: {
  readonly heldItemName: string | null | undefined
  readonly size: string | null | undefined
}): WielderWeaponProfile | null => {
  const item = findItem(input.heldItemName ?? '')
  if (!item) return null
  const effect = (item.effects ?? []).join(' ')
  const small = /\bSmall Melee Weapon\b/i.test(effect)
  const large = /\bLarge Melee Weapon\b/i.test(effect)
  const size = input.size?.trim().toLocaleLowerCase('en-US') ?? ''
  const sizeLegal = size === 'small' ? small : ['medium', 'large', 'huge', 'gigantic'].includes(size) && large
  if (!sizeLegal) return null
  return Object.freeze({
    canonicalItemName: item.name,
    weaponClass: small && size === 'small' ? 'small-melee' : 'large-melee',
    damageBaseBonus: small && size === 'small' ? 1 : 2,
    accuracyCheckPenalty: small && size === 'small' ? 0 : 1,
    grantsReach: /\bgrants Reach for Weapon Attacks\b/i.test(effect),
    adeptMoveName: moveFromEffect(effect, 'Adept Move:'),
  })
}
