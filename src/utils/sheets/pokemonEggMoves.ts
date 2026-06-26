import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { PtuMove } from '~/types/ptuReference'
import {
  POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS,
  POKEMON_KNOWN_MOVE_DATA_FIELDS,
  POKEMON_KNOWN_MOVE_NAME_OPTIONS,
  pokemonKnownMoveFieldValue,
  resolvePokemonKnownMoveReference,
  type PokemonKnownMoveAutofillField,
  type PokemonKnownMoveColumn,
  type PokemonKnownMoveDataField,
} from '~/utils/sheets/pokemonKnownMoves'

export const POKEMON_EGG_MOVE_DATA_FIELDS = POKEMON_KNOWN_MOVE_DATA_FIELDS

export type PokemonEggMoveDataField = PokemonKnownMoveDataField
export type PokemonEggMoveAutofillField = PokemonKnownMoveAutofillField
export type PokemonEggMoveColumn<Field extends PokemonEggMoveDataField = PokemonEggMoveDataField> = PokemonKnownMoveColumn<Field>

export const POKEMON_EGG_MOVE_NAME_COLUMN: PokemonEggMoveColumn<'name'> = {
  key: 'name',
  label: 'Egg Move',
}

export const POKEMON_EGG_MOVE_NAME_OPTIONS = POKEMON_KNOWN_MOVE_NAME_OPTIONS

export const pokemonEggMoveOptionsForSheet = (
  sheet: Pick<CharacterSheet, 'eggMoves'> | null | undefined,
): string[] => {
  const seen = new Set<string>()
  const options: string[] = []
  for (const move of sheet?.eggMoves ?? []) {
    const name = move.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    options.push(name)
  }
  return options
}

export const POKEMON_EGG_MOVE_AUTOFILL_COLUMNS = POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS

export const resolvePokemonEggMoveReference = (move: Pick<CharacterSheetMove, 'name'>): PtuMove | null =>
  resolvePokemonKnownMoveReference(move)

export const pokemonEggMoveFieldValue = (
  move: Pick<CharacterSheetMove, 'name'>,
  field: PokemonEggMoveDataField,
): string => pokemonKnownMoveFieldValue(move, field)
