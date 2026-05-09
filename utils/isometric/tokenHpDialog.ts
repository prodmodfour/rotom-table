import type { SpawnedPokemon } from '~/types/pokemon'

export type HpDialogMode = 'damage' | 'heal'

export interface HpDialogState {
  id: string
  species: string
  currentHp: number
  maxHp: number
  mode: HpDialogMode
  amount: string
}

type HpDialogPokemon = Pick<SpawnedPokemon, 'id' | 'species' | 'currentHp' | 'maxHp'>

const parsePositiveInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

export const createHpDialogState = (pokemon: HpDialogPokemon): HpDialogState => ({
  id: pokemon.id,
  species: pokemon.species,
  currentHp: pokemon.currentHp,
  maxHp: pokemon.maxHp,
  mode: 'damage',
  amount: '',
})

export const getHpDialogDelta = (dialog: HpDialogState | null): number => {
  if (!dialog) return 0
  const amount = parsePositiveInteger(dialog.amount)
  if (amount === 0) return 0
  return dialog.mode === 'damage' ? -amount : amount
}

export const getHpDialogPreview = (dialog: HpDialogState | null): number => {
  if (!dialog) return 0
  const nextHp = dialog.currentHp + getHpDialogDelta(dialog)
  return Math.max(0, Math.min(dialog.maxHp, nextHp))
}

export const updateHpDialogFromPokemon = (
  dialog: HpDialogState,
  pokemon: HpDialogPokemon,
): HpDialogState => ({
  ...dialog,
  species: pokemon.species,
  currentHp: pokemon.currentHp,
  maxHp: pokemon.maxHp,
})
