import type { MoveAutomationHpUpdate } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { normalizeTemporaryHpAmount } from '~/utils/mapTemporaryHitPoints'

export interface TempHpDialogState {
  id: string
  species: string
  currentHp: number
  currentTemporaryHp: number
  accentColor?: string
  amount: string
}

type TempHpDialogPokemon = Pick<SpawnedPokemon, 'id' | 'species' | 'currentHp' | 'temporaryHp' | 'accentColor'>

const parsePositiveInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

export const createTempHpDialogState = (pokemon: TempHpDialogPokemon): TempHpDialogState => ({
  id: pokemon.id,
  species: pokemon.species,
  currentHp: pokemon.currentHp,
  currentTemporaryHp: normalizeTemporaryHpAmount(pokemon.temporaryHp),
  ...(pokemon.accentColor ? { accentColor: pokemon.accentColor } : {}),
  amount: '',
})

export const getTempHpDialogAmount = (dialog: TempHpDialogState | null): number => (
  dialog ? parsePositiveInteger(dialog.amount) : 0
)

export const getTempHpDialogPreview = (dialog: TempHpDialogState | null): number => (
  dialog ? dialog.currentTemporaryHp + getTempHpDialogAmount(dialog) : 0
)

export const getTempHpDialogHpUpdate = (dialog: TempHpDialogState | null): MoveAutomationHpUpdate | null => {
  if (!dialog) return null
  const temporaryHp = getTempHpDialogPreview(dialog)
  if (temporaryHp === dialog.currentTemporaryHp) return null
  return {
    id: dialog.id,
    currentHp: dialog.currentHp,
    temporaryHp,
  }
}

export const updateTempHpDialogFromPokemon = (
  dialog: TempHpDialogState,
  pokemon: TempHpDialogPokemon,
): TempHpDialogState => ({
  ...dialog,
  species: pokemon.species,
  currentHp: pokemon.currentHp,
  currentTemporaryHp: normalizeTemporaryHpAmount(pokemon.temporaryHp),
  accentColor: pokemon.accentColor,
})
