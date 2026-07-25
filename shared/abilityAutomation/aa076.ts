import type { EncounterEffect } from '../moveAutomation/encounterEffects'

export const AA076_INTIMIDATE_TARGET_CAPABILITY_ID = 'aa076.intimidate.targeted-this-scene' as const

export const AA076_IRON_FIST_MOVE_IDS = Object.freeze([
  'Bullet Punch',
  'Comet Punch',
  'Dizzy Punch',
  'Double Iron Bash',
  'Drain Punch',
  'Dynamic Punch',
  'Fire Punch',
  'Focus Punch',
  'Hammer Arm',
  'Ice Punch',
  'Mach Punch',
  'Mega Punch',
  'Meteor Mash',
  'Power-Up Punch',
  'Shadow Punch',
  'Sky Uppercut',
  'Thunder Punch',
] as const)

const activeEffect = (effect: Pick<EncounterEffect, 'duration' | 'suppression'>): boolean => (
  (effect.duration.remaining === null || effect.duration.remaining > 0)
  && effect.suppression.sources.length === 0
)

export const aa076IntimidateTargetedThisScene = (input: {
  readonly effects: readonly EncounterEffect[] | null | undefined
  readonly actorPlacementId: string
  readonly targetPlacementId: string
}): boolean => (input.effects ?? []).some(effect => (
  effect.kind === 'capability'
  && activeEffect(effect)
  && effect.source.placementId === input.actorPlacementId
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA076_INTIMIDATE_TARGET_CAPABILITY_ID
  && effect.affected.placementIds.includes(input.targetPlacementId)
))
