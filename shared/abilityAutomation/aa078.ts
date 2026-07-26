import type { AbilityOwnedStateEntry } from './ownedState'

export const AA078_LIGHTNING_KICKS_MARK_ID = 'aa078.lightning-kicks.next-kick' as const
export const AA078_LIQUID_VOICE_MARK_ID = 'aa078.liquid-voice.next-sonic' as const
export const AA078_LIQUID_VOICE_DB1_MARK_ID = 'aa078.liquid-voice.next-sonic-db1' as const
export const AA078_MAELSTROM_PULSE_MARK_ID = 'aa078.maelstrom-pulse.next-water-move' as const
export const AA078_LONG_REACH_BRANCH_ID = 'ability.long-reach.range-8' as const
export const AA078_LUNCHBOX_TEMP_HP_REASON = 'ability.lunchbox.stacking-temporary-hp' as const

export const AA078_LIQUID_VOICE_OPTION_BY_ID = Object.freeze({
  transform: AA078_LIQUID_VOICE_MARK_ID,
  'transform-and-db1': AA078_LIQUID_VOICE_DB1_MARK_ID,
} as const)

export const AA078_LIQUID_OOZE_DRAIN_MOVE_IDS = Object.freeze([
  'Absorb',
  'Drain Punch',
  'Giga Drain',
  'Horn Leech',
  'Leech Life',
  'Mega Drain',
] as const)

export const aa078OwnedMarks = (input: {
  readonly entries: readonly AbilityOwnedStateEntry[] | null | undefined
  readonly ownerPlacementId: string
  readonly canonicalId: 'Lightning Kicks' | 'Liquid Voice' | 'Maelstrom Pulse'
  readonly markIds: ReadonlySet<string>
  readonly activeAbilityInstanceIds?: ReadonlySet<string>
}): readonly AbilityOwnedStateEntry[] => Object.freeze((input.entries ?? []).filter(entry => (
  entry.ownerPlacementId === input.ownerPlacementId
  && entry.canonicalId === input.canonicalId
  && entry.payload.kind === 'mark'
  && input.markIds.has(entry.payload.markId)
  && (input.activeAbilityInstanceIds === undefined
    || input.activeAbilityInstanceIds.has(entry.sourceAbilityInstanceId))
)))
