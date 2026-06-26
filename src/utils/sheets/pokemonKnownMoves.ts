import { findMove, moves } from '~~/data/ptuReference'
import type { EditableCellOption, EditableCellValue } from '~/utils/editableCell'
import type {
  CharacterSheet,
  CharacterSheetAppliedMoveSource,
  CharacterSheetMove,
} from '~/types/characterSheet'
import type { PokedexLevelUpMove, PokedexRecord } from '~/types/pokemon'
import type { PtuMove } from '~/types/ptuReference'

export const POKEMON_KNOWN_MOVE_DATA_FIELDS = [
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

export type PokemonKnownMoveDataField = (typeof POKEMON_KNOWN_MOVE_DATA_FIELDS)[number]
export type PokemonKnownMoveAutofillField = Exclude<PokemonKnownMoveDataField, 'name'>

export interface PokemonKnownMoveColumn<Field extends PokemonKnownMoveDataField = PokemonKnownMoveDataField> {
  key: Field
  label: string
  multiline?: boolean
}

export const POKEMON_KNOWN_MOVE_NAME_OPTIONS: readonly string[] = moves.map((move) => move.name)

export const POKEMON_KNOWN_MOVE_SOURCE_OPTIONS: readonly EditableCellOption[] = [
  { value: 'tm', label: 'TM/HM' },
  { value: 'tutor', label: 'Tutor' },
]

export const POKEMON_KNOWN_MOVE_AUTOFILL_COLUMNS = [
  { key: 'type', label: 'Type', multiline: false },
  { key: 'damage_class', label: 'Cat.', multiline: false },
  { key: 'damage_base', label: 'DB', multiline: false },
  { key: 'frequency', label: 'Freq', multiline: true },
  { key: 'ac', label: 'AC', multiline: false },
  { key: 'range', label: 'Range', multiline: true },
  { key: 'effect', label: 'Effect', multiline: true },
  { key: 'special', label: 'Special', multiline: true },
] as const satisfies readonly PokemonKnownMoveColumn<PokemonKnownMoveAutofillField>[]

export const resolvePokemonKnownMoveReference = (move: Pick<CharacterSheetMove, 'name'>): PtuMove | null =>
  findMove(move.name)

const formatPokemonKnownMoveDataValue = (value: PtuMove[PokemonKnownMoveDataField] | undefined): string => {
  if (Array.isArray(value)) return value.join(', ')
  if (value == null) return ''
  return String(value)
}

export const pokemonKnownMoveFieldValue = (
  move: Pick<CharacterSheetMove, 'name'>,
  field: PokemonKnownMoveDataField,
): string => {
  if (field === 'name') return move.name
  const reference = resolvePokemonKnownMoveReference(move)
  if (!reference) return ''
  return formatPokemonKnownMoveDataValue(reference[field])
}

export const pokemonKnownLevelUpMoveFieldValue = (
  move: Pick<PokedexLevelUpMove, 'name' | 'type'>,
  field: PokemonKnownMoveDataField,
): string => {
  if (field === 'name') return move.name
  const lookupValue = pokemonKnownMoveFieldValue({ name: move.name }, field)
  if (lookupValue) return lookupValue
  return field === 'type' ? move.type : ''
}

export const resolveUnlockedPokemonLevelUpMoves = (
  sheet: Pick<CharacterSheet, 'level'> | null | undefined,
  species: Pick<PokedexRecord, 'level_up_moves'> | null | undefined,
): PokedexLevelUpMove[] => {
  const level = Math.max(1, Math.floor(Number(sheet?.level) || 1))
  const seen = new Set<string>()
  const unlocked: PokedexLevelUpMove[] = []

  for (const move of species?.level_up_moves ?? []) {
    if (!Number.isFinite(move.level) || move.level > level) continue
    const key = move.name.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    unlocked.push(move)
  }

  return unlocked
}

export const coercePokemonAppliedMoveSource = (value: EditableCellValue): CharacterSheetAppliedMoveSource => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'tutor' || normalized === 'tutoring' ? 'tutor' : 'tm'
}

export const pokemonAppliedMoveSourceLabel = (value: EditableCellValue): string => (
  coercePokemonAppliedMoveSource(value) === 'tutor' ? 'Tutor' : 'TM/HM'
)
