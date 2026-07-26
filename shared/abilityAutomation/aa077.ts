import type { EncounterEffect } from '../moveAutomation/encounterEffects'
import type { AbilityOwnedStateEntry } from './ownedState'

export const AA077_KLUTZ_ITEM_REQUIREMENT_ID = 'ability.klutz.target-equipped' as const
export const AA077_KLUTZ_ITEM_SET_ID = 'ability.klutz.target-items' as const
export const AA077_KLUTZ_ITEM_REQUEST_ID = 'ability.klutz.item-window' as const
export const AA077_KLUTZ_GROUND_DESTINATION_ID = 'ability.klutz.to-ground' as const
export const AA077_KLUTZ_NONE_OPTION_ID = 'ability.klutz.none' as const

export const AA077_LANCER_DISENGAGE_FLAG_ID = 'aa077.lancer.disengaged-this-turn' as const
export const AA077_LEAF_RUSH_MARK_ID = 'aa077.leaf-rush.next-grass-move' as const
export const AA077_LEAF_GIFT_EFFECT_TAG = 'aa077-leaf-gift' as const
export const AA077_LEAFY_CLOAK_EFFECT_TAG = 'aa077-leafy-cloak' as const

export const AA077_LEAF_GIFT_SUITS = Object.freeze({
  nourishing: Object.freeze(['Sun Blanket', 'Leaf Guard'] as const),
  heavy: Object.freeze(['Sturdy', 'Overcoat'] as const),
  vibrant: Object.freeze(['Chlorophyll', 'Photosynthesis'] as const),
})
export type Aa077LeafGiftSuit = keyof typeof AA077_LEAF_GIFT_SUITS

export const AA077_LEAFY_CLOAK_ABILITIES = Object.freeze([
  'Chlorophyll',
  'Leaf Guard',
  'Overcoat',
] as const)
export const AA077_LEAFY_CLOAK_OPTION_BY_ID = Object.freeze({
  chlorophyll: 'Chlorophyll',
  'leaf-guard': 'Leaf Guard',
  overcoat: 'Overcoat',
} as const)

const activeEffect = (effect: Pick<EncounterEffect, 'duration' | 'suppression'>): boolean => (
  (effect.duration.remaining === null || effect.duration.remaining > 0)
  && effect.suppression.sources.length === 0
)

export const aa077LeafRushMarks = (input: {
  readonly entries: readonly AbilityOwnedStateEntry[] | null | undefined
  readonly ownerPlacementId: string
  readonly activeAbilityInstanceIds?: ReadonlySet<string>
}): readonly AbilityOwnedStateEntry[] => Object.freeze((input.entries ?? []).filter(entry => (
  entry.ownerPlacementId === input.ownerPlacementId
  && entry.canonicalId === 'Leaf Rush'
  && entry.payload.kind === 'mark'
  && entry.payload.markId === AA077_LEAF_RUSH_MARK_ID
  && (input.activeAbilityInstanceIds === undefined
    || input.activeAbilityInstanceIds.has(entry.sourceAbilityInstanceId))
)))

export const aa077HasActiveDesignerSuit = (input: {
  readonly effects: readonly EncounterEffect[] | null | undefined
  readonly placementId: string
}): boolean => (input.effects ?? []).some(effect => (
  effect.kind === 'capability'
  && activeEffect(effect)
  && effect.tags.includes('designer')
  && effect.affected.placementIds.includes(input.placementId)
))
