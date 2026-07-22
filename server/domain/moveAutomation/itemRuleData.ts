import { MOVE_ITEM_REFERENCE_LIMITS } from '#shared/moveAutomation/items'
import type { MoveItemRuleFamily } from '#shared/moveAutomation/itemRuleQueries'
import { findItem, toSlug } from '~~/data/ptuReference'
import { POKEMON_TYPES, type PokemonType } from '~/utils/typeChart'

/** Canonical Fling branches from the frozen PTU move-keyword table. */
export const MOVE_AUTOMATION_FLING_CATEGORIES = [
  'consumable',
  'poison-item',
  'fire-item',
  'poke-ball',
  'other',
  'held-item',
  'rare-item',
  'lagging-item',
  'weapon',
] as const

export const MOVE_AUTOMATION_FLING_EFFECTS = [
  'fling.consume-thrown-item',
  'fling.poison',
  'fling.burn',
  'fling.capture-attempt',
  'fling.none',
  'fling.ranged-struggle',
] as const

export type MoveAutomationFlingCategory =
  (typeof MOVE_AUTOMATION_FLING_CATEGORIES)[number]
export type MoveAutomationFlingEffect =
  (typeof MOVE_AUTOMATION_FLING_EFFECTS)[number]

export interface MoveAutomationItemRuleIdentity {
  readonly canonicalItemId: string
  readonly canonicalItemName: string
  readonly family: MoveItemRuleFamily
  readonly moveType: Lowercase<PokemonType> | null
  readonly naturalGiftDamageBase: number | null
  readonly referenceCategories: readonly string[]
}

export interface MoveAutomationItemRuleProfile
  extends MoveAutomationItemRuleIdentity {
  readonly flingCategory: MoveAutomationFlingCategory
  /** Null means the Fling branch does not deal ordinary Fling damage. */
  readonly flingPower: number | null
  readonly flingEffect: MoveAutomationFlingEffect
}

interface BerryRule {
  readonly name: string
  readonly damageBase: 6 | 7 | 8
  readonly type: Lowercase<PokemonType>
}

const berry = (
  name: string,
  damageBase: BerryRule['damageBase'],
  type: BerryRule['type'],
): BerryRule => Object.freeze({ name, damageBase, type })

/**
 * Human-reviewed transcription of the frozen PTU Natural Gift Berry table.
 * Rules prose is never parsed at runtime.
 */
const NATURAL_GIFT_BERRIES = Object.freeze([
  berry('Cheri', 6, 'fire'),
  berry('Chesto', 6, 'water'),
  berry('Pecha', 6, 'electric'),
  berry('Rawst', 6, 'grass'),
  berry('Aspear', 6, 'ice'),
  berry('Leppa', 6, 'fighting'),
  berry('Oran', 6, 'poison'),
  berry('Persim', 6, 'ground'),
  berry('Lum', 6, 'flying'),
  berry('Sitrus', 6, 'psychic'),
  berry('Figy', 6, 'bug'),
  berry('Wiki', 6, 'rock'),
  berry('Mago', 6, 'ghost'),
  berry('Aguav', 6, 'dragon'),
  berry('Iapapa', 6, 'dark'),
  berry('Razz', 6, 'steel'),
  berry('Bluk', 7, 'fire'),
  berry('Nanab', 7, 'water'),
  berry('Wepear', 7, 'electric'),
  berry('Pinap', 7, 'grass'),
  berry('Pomeg', 7, 'ice'),
  berry('Kelpsy', 7, 'fighting'),
  berry('Qualot', 7, 'poison'),
  berry('Hondew', 7, 'ground'),
  berry('Grepa', 7, 'flying'),
  berry('Tamato', 7, 'psychic'),
  berry('Cornn', 7, 'bug'),
  berry('Magost', 7, 'rock'),
  berry('Rabuta', 7, 'ghost'),
  berry('Nomel', 7, 'dragon'),
  berry('Spelon', 7, 'dark'),
  berry('Pamtre', 7, 'steel'),
  berry('Watmel', 8, 'fire'),
  berry('Durin', 8, 'water'),
  berry('Belue', 8, 'electric'),
  berry('Occa', 6, 'fire'),
  berry('Passho', 6, 'water'),
  berry('Wacan', 6, 'electric'),
  berry('Rindo', 6, 'grass'),
  berry('Yache', 6, 'ice'),
  berry('Chople', 6, 'fighting'),
  berry('Kebia', 6, 'poison'),
  berry('Shuca', 6, 'ground'),
  berry('Coba', 6, 'flying'),
  berry('Payapa', 6, 'psychic'),
  berry('Tanga', 6, 'bug'),
  berry('Charti', 6, 'rock'),
  berry('Kasib', 6, 'ghost'),
  berry('Haban', 6, 'dragon'),
  berry('Colbur', 6, 'dark'),
  berry('Babiri', 6, 'steel'),
  berry('Chilan', 6, 'normal'),
  berry('Liechi', 8, 'grass'),
  berry('Ganlon', 8, 'ice'),
  berry('Salac', 8, 'fighting'),
  berry('Petaya', 8, 'poison'),
  berry('Apicot', 8, 'ground'),
  berry('Lansat', 8, 'flying'),
  berry('Starf', 8, 'psychic'),
  berry('Enigma', 8, 'bug'),
  berry('Micle', 8, 'rock'),
  berry('Custap', 8, 'ghost'),
  berry('Jaboca', 8, 'dragon'),
  berry('Rowap', 8, 'dark'),
  berry('Roseli', 8, 'fairy'),
  berry('Maranga', 8, 'dark'),
  berry('Kee', 8, 'fairy'),
] as const)

export const MOVE_AUTOMATION_NATURAL_GIFT_BERRY_COUNT = NATURAL_GIFT_BERRIES.length

const BERRY_BY_SLUG = new Map<string, BerryRule>()
for (const rule of NATURAL_GIFT_BERRIES) {
  BERRY_BY_SLUG.set(toSlug(rule.name), rule)
  BERRY_BY_SLUG.set(toSlug(`${rule.name} Berry`), rule)
}

const TYPE_BY_SLUG = new Map(
  POKEMON_TYPES.map(type => [toSlug(type), type.toLowerCase() as Lowercase<PokemonType>]),
)

const TYPE_DISPLAY_NAME = new Map(
  POKEMON_TYPES.map(type => [type.toLowerCase() as Lowercase<PokemonType>, type]),
)

/** Fashion Designer creates canonical-equivalent items under distinct crafted names. */
const FASHION_DESIGNER_ITEM_ALIASES = new Map<string, string>([
  ['lucky-leaf', 'Grass Type Booster'],
  ['tasty-reeds', 'Bug Type Booster'],
  ['dew-cup', 'Occa Berry'],
  ['thorn-mantle', 'Coba Berry'],
  ['chewy-cluster', 'Leftovers'],
])

const DRIVE_BY_SLUG = new Map<string, {
  readonly canonicalItemId: string
  readonly canonicalItemName: string
  readonly type: Lowercase<PokemonType>
}>([
  ['burn-drive', { canonicalItemId: 'burn-drive', canonicalItemName: 'Burn Drive', type: 'fire' }],
  ['fire-drive', { canonicalItemId: 'burn-drive', canonicalItemName: 'Burn Drive', type: 'fire' }],
  ['douse-drive', { canonicalItemId: 'douse-drive', canonicalItemName: 'Douse Drive', type: 'water' }],
  ['water-drive', { canonicalItemId: 'douse-drive', canonicalItemName: 'Douse Drive', type: 'water' }],
  ['shock-drive', { canonicalItemId: 'shock-drive', canonicalItemName: 'Shock Drive', type: 'electric' }],
  ['electric-drive', { canonicalItemId: 'shock-drive', canonicalItemName: 'Shock Drive', type: 'electric' }],
  ['chill-drive', { canonicalItemId: 'chill-drive', canonicalItemName: 'Chill Drive', type: 'ice' }],
  ['ice-drive', { canonicalItemId: 'chill-drive', canonicalItemName: 'Chill Drive', type: 'ice' }],
])

const titleForType = (type: Lowercase<PokemonType>): PokemonType => (
  TYPE_DISPLAY_NAME.get(type) ?? type as PokemonType
)

const referenceCategoriesFor = (itemName: string): readonly string[] => Object.freeze([
  ...(findItem(itemName)?.categories ?? []),
])

const typedFamilyIdentity = (
  slug: string,
): MoveAutomationItemRuleIdentity | null => {
  const boosterMatch = slug.match(/^([a-z]+)-type-booster$/)
  if (boosterMatch) {
    const type = TYPE_BY_SLUG.get(boosterMatch[1]!)
    if (type) {
      return Object.freeze({
        canonicalItemId: `${type}-type-booster`,
        canonicalItemName: `${titleForType(type)} Type Booster`,
        family: 'other' as const,
        moveType: type,
        naturalGiftDamageBase: null,
        referenceCategories: referenceCategoriesFor(`${titleForType(type)} Type Booster`),
      })
    }
  }

  const plateMatch = slug.match(/^([a-z]+)-(?:type-)?plate$/)
  if (plateMatch) {
    const type = TYPE_BY_SLUG.get(plateMatch[1]!)
    if (type) {
      return Object.freeze({
        canonicalItemId: `${type}-type-plate`,
        canonicalItemName: `${titleForType(type)} Type Plate`,
        family: 'plate' as const,
        moveType: type,
        naturalGiftDamageBase: null,
        referenceCategories: referenceCategoriesFor('Type Plate'),
      })
    }
  }

  const drive = DRIVE_BY_SLUG.get(slug)
  if (drive) {
    return Object.freeze({
      ...drive,
      family: 'drive' as const,
      moveType: drive.type,
      naturalGiftDamageBase: null,
      referenceCategories: Object.freeze([]),
    })
  }

  const memoryMatch = slug.match(/^([a-z]+)-(?:type-)?memory(?:-disc)?$/)
  if (memoryMatch) {
    const type = TYPE_BY_SLUG.get(memoryMatch[1]!)
    if (type) {
      return Object.freeze({
        canonicalItemId: `${type}-memory-disc`,
        canonicalItemName: `${titleForType(type)} Memory Disc`,
        family: 'memory' as const,
        moveType: type,
        naturalGiftDamageBase: null,
        referenceCategories: Object.freeze([]),
      })
    }
  }

  return null
}

const genericFamily = (
  canonicalItemId: string,
): MoveItemRuleFamily => {
  if (canonicalItemId === 'type-plate') return 'plate'
  if (canonicalItemId === 'drive' || canonicalItemId.endsWith('-drive')) return 'drive'
  if (canonicalItemId === 'memory-disc' || canonicalItemId.endsWith('-memory-disc')) return 'memory'
  return 'other'
}

/**
 * Resolve a stable move-automation identity without interpreting item prose.
 * Parameterized Plate/Drive/Memory aliases retain their selected type instead
 * of collapsing to the generic reference-data row.
 */
export const resolveMoveAutomationItemRuleIdentity = (
  value: string,
): MoveAutomationItemRuleIdentity | null => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MOVE_ITEM_REFERENCE_LIMITS.canonicalItemIdChars) return null
  const slug = toSlug(trimmed)

  const craftedAlias = FASHION_DESIGNER_ITEM_ALIASES.get(slug)
  if (craftedAlias) return resolveMoveAutomationItemRuleIdentity(craftedAlias)
  if (slug === 'decorative-twine') {
    return Object.freeze({
      canonicalItemId: 'decorative-twine',
      canonicalItemName: 'Decorative Twine',
      family: 'other' as const,
      moveType: null,
      naturalGiftDamageBase: null,
      referenceCategories: Object.freeze(['Held Item']),
    })
  }

  const berryRule = BERRY_BY_SLUG.get(slug)
  if (berryRule) {
    return Object.freeze({
      canonicalItemId: `${toSlug(berryRule.name)}-berry`,
      canonicalItemName: `${berryRule.name} Berry`,
      family: 'berry' as const,
      moveType: berryRule.type,
      naturalGiftDamageBase: berryRule.damageBase,
      referenceCategories: Object.freeze([]),
    })
  }

  const typed = typedFamilyIdentity(slug)
  if (typed) return typed

  if (slug === 'memory' || slug === 'memory-disc') {
    return Object.freeze({
      canonicalItemId: 'memory-disc',
      canonicalItemName: 'Memory Disc',
      family: 'memory' as const,
      moveType: null,
      naturalGiftDamageBase: null,
      referenceCategories: Object.freeze([]),
    })
  }
  if (slug === 'drive' || slug === 'drive-item') {
    return Object.freeze({
      canonicalItemId: 'drive',
      canonicalItemName: 'Drive',
      family: 'drive' as const,
      moveType: null,
      naturalGiftDamageBase: null,
      referenceCategories: Object.freeze([]),
    })
  }

  const referenceItem = findItem(trimmed)
  if (!referenceItem) return null
  const canonicalItemId = toSlug(referenceItem.name)
  return Object.freeze({
    canonicalItemId,
    canonicalItemName: referenceItem.name,
    family: genericFamily(canonicalItemId),
    moveType: null,
    naturalGiftDamageBase: null,
    referenceCategories: Object.freeze([...referenceItem.categories]),
  })
}

const categoryIncludes = (
  identity: MoveAutomationItemRuleIdentity,
  category: string,
): boolean => identity.referenceCategories.includes(category)

const typeItemId = (
  identity: MoveAutomationItemRuleIdentity,
  type: 'fire' | 'poison',
): boolean => {
  const id = identity.canonicalItemId
  return id === `${type}-type-booster`
    || id === `${type}-type-brace`
    || id === `${type}-type-plate`
}

const flingBranch = (
  identity: MoveAutomationItemRuleIdentity,
  rareBenefitEligible: boolean,
): Pick<MoveAutomationItemRuleProfile, 'flingCategory' | 'flingPower' | 'flingEffect'> => {
  if (
    identity.family === 'berry'
    || (
      categoryIncludes(identity, 'Medicine')
      && identity.canonicalItemId !== 'bandages'
    )
    || categoryIncludes(identity, 'Herb')
  ) {
    return {
      flingCategory: 'consumable',
      flingPower: null,
      flingEffect: 'fling.consume-thrown-item',
    }
  }
  if (identity.canonicalItemId === 'toxic-orb' || typeItemId(identity, 'poison')) {
    return { flingCategory: 'poison-item', flingPower: 3, flingEffect: 'fling.poison' }
  }
  if (identity.canonicalItemId === 'flame-orb' || typeItemId(identity, 'fire')) {
    return { flingCategory: 'fire-item', flingPower: 3, flingEffect: 'fling.burn' }
  }
  if (categoryIncludes(identity, 'Poké Ball') || categoryIncludes(identity, 'Apricorn')) {
    return { flingCategory: 'poke-ball', flingPower: 3, flingEffect: 'fling.capture-attempt' }
  }
  if (
    rareBenefitEligible
    && ['metal-powder', 'rare-leek', 'thick-club', 'pink-pearl']
      .includes(identity.canonicalItemId)
  ) {
    return { flingCategory: 'rare-item', flingPower: 10, flingEffect: 'fling.none' }
  }
  if (identity.canonicalItemId === 'iron-ball' || identity.canonicalItemId === 'lagging-item') {
    return { flingCategory: 'lagging-item', flingPower: 12, flingEffect: 'fling.none' }
  }
  if (categoryIncludes(identity, 'Weapon')) {
    return { flingCategory: 'weapon', flingPower: null, flingEffect: 'fling.ranged-struggle' }
  }
  if (
    identity.family === 'plate'
    || identity.family === 'drive'
    || identity.family === 'memory'
    || categoryIncludes(identity, 'Held Item')
    || categoryIncludes(identity, 'Evolutionary Stone')
    || categoryIncludes(identity, 'Evolutionary Keepsake')
  ) {
    return { flingCategory: 'held-item', flingPower: 7, flingEffect: 'fling.none' }
  }
  return { flingCategory: 'other', flingPower: 6, flingEffect: 'fling.none' }
}

/** Build the bounded mechanics profile used by item expressions. */
export const resolveMoveAutomationItemRuleProfile = (
  value: string,
  options: { readonly rareBenefitEligible?: boolean } = {},
): MoveAutomationItemRuleProfile | null => {
  const identity = resolveMoveAutomationItemRuleIdentity(value)
  if (!identity) return null
  return Object.freeze({
    ...identity,
    ...flingBranch(identity, options.rareBenefitEligible === true),
  })
}
