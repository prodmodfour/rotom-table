import { findMove, moves } from '~~/data/ptuReference'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { PtuMove } from '~/types/ptuReference'

export const POKEMON_EGG_MOVE_DATA_FIELDS = [
  'name',
  'type',
  'damage_class',
  'damage_base',
  'frequency',
  'ac',
  'range',
  'effect',
  'special',
] as const satisfies readonly (keyof PtuMove)[]

export type PokemonEggMoveDataField = (typeof POKEMON_EGG_MOVE_DATA_FIELDS)[number]
export type PokemonEggMoveAutofillField = Exclude<PokemonEggMoveDataField, 'name'>

export interface PokemonEggMoveColumn<Field extends PokemonEggMoveDataField = PokemonEggMoveDataField> {
  key: Field
  label: string
  multiline?: boolean
}

export const POKEMON_EGG_MOVE_NAME_COLUMN: PokemonEggMoveColumn<'name'> = {
  key: 'name',
  label: 'Egg Move',
}

export const POKEMON_EGG_MOVE_NAME_OPTIONS: readonly string[] = moves.map((move) => move.name)

export const POKEMON_EGG_MOVE_AUTOFILL_COLUMNS = [
  { key: 'type', label: 'Type', multiline: false },
  { key: 'damage_class', label: 'Cat.', multiline: false },
  { key: 'damage_base', label: 'DB', multiline: false },
  { key: 'frequency', label: 'Freq', multiline: true },
  { key: 'ac', label: 'AC', multiline: false },
  { key: 'range', label: 'Range', multiline: true },
  { key: 'effect', label: 'Effect', multiline: true },
  { key: 'special', label: 'Special', multiline: true },
] as const satisfies readonly PokemonEggMoveColumn<PokemonEggMoveAutofillField>[]

export const resolvePokemonEggMoveReference = (move: Pick<CharacterSheetMove, 'name'>): PtuMove | null =>
  findMove(move.name)

const formatPokemonEggMoveDataValue = (value: PtuMove[PokemonEggMoveDataField] | undefined): string => {
  if (Array.isArray(value)) return value.join(', ')
  if (value == null) return ''
  return String(value)
}

export const pokemonEggMoveFieldValue = (
  move: Pick<CharacterSheetMove, 'name'>,
  field: PokemonEggMoveDataField,
): string => {
  if (field === 'name') return move.name
  const reference = resolvePokemonEggMoveReference(move)
  if (!reference) return ''
  return formatPokemonEggMoveDataValue(reference[field])
}
