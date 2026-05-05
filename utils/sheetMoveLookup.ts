import { findMove } from '~/data/ptuReference'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { PtuMove } from '~/types/ptuReference'
import type { TrainerMove } from '~/types/trainerSheet'

export type SheetMoveLike = CharacterSheetMove | TrainerMove

export interface MoveLookupRow<T extends SheetMoveLike> {
  move: T
  reference: PtuMove | null
}

const LOOKUP_BACKED_MOVE_KEYS = [
  'type',
  'category',
  'db',
  'damageRoll',
  'damageRollMod',
  'frequency',
  'ac',
  'range',
  'effect',
  'contestStats',
] as const

export const lookupMoveReference = (move: Pick<SheetMoveLike, 'name'>): PtuMove | null => {
  const name = typeof move.name === 'string' ? move.name.trim() : ''
  return name ? findMove(name) : null
}

export const makeMoveLookupRows = <T extends SheetMoveLike>(moves: readonly T[] | undefined): MoveLookupRow<T>[] =>
  (moves ?? []).map((move) => ({
    move,
    reference: lookupMoveReference(move),
  }))

export const formatLookupValue = (value: unknown): string =>
  value === null || value === undefined || value === '' ? '—' : String(value)

export const clearLookupBackedMoveFields = (move: SheetMoveLike): void => {
  const target = move as Record<string, unknown>
  for (const key of LOOKUP_BACKED_MOVE_KEYS) delete target[key]
}

export const setLookupMoveName = (move: SheetMoveLike, value: unknown): void => {
  move.name = typeof value === 'string' ? value : value == null ? '' : String(value)
  // The sheet stores only the selected move name; display/runtime details come
  // from ptu-data/data/moves.json via data/ptuReference.ts.
  clearLookupBackedMoveFields(move)
}
