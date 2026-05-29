import type { MoveAutomationHpUpdate } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  computePtuInjuryAutomation,
  type PtuInjuryAutomationResult,
} from '~/utils/ptuInjuries'

export type HpDialogMode = 'damage' | 'heal'

export interface HpDialogState {
  id: string
  species: string
  currentHp: number
  maxHp: number
  fullMaxHp?: number
  injuries?: number
  accentColor?: string
  mode: HpDialogMode
  amount: string
}

type HpDialogPokemon = Pick<SpawnedPokemon, 'id' | 'species' | 'currentHp' | 'maxHp' | 'fullMaxHp' | 'injuries' | 'accentColor'>

const parsePositiveInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

const hpDialogFullMaxHp = (dialog: HpDialogState): number => dialog.fullMaxHp ?? dialog.maxHp
const hpDialogInjuries = (dialog: HpDialogState): number => dialog.injuries ?? 0

const maybeHpMetadata = (pokemon: HpDialogPokemon): Pick<HpDialogState, 'fullMaxHp' | 'injuries'> => ({
  ...(pokemon.fullMaxHp != null ? { fullMaxHp: pokemon.fullMaxHp } : {}),
  ...(pokemon.injuries != null ? { injuries: pokemon.injuries } : {}),
})

export const createHpDialogState = (pokemon: HpDialogPokemon): HpDialogState => ({
  id: pokemon.id,
  species: pokemon.species,
  currentHp: pokemon.currentHp,
  maxHp: pokemon.maxHp,
  ...maybeHpMetadata(pokemon),
  ...(pokemon.accentColor ? { accentColor: pokemon.accentColor } : {}),
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
  return Math.min(dialog.maxHp, nextHp)
}

export const getHpDialogInjuryResult = (dialog: HpDialogState | null): PtuInjuryAutomationResult | null => {
  if (!dialog || dialog.mode !== 'damage') return null
  const preview = getHpDialogPreview(dialog)
  if (preview >= dialog.currentHp) return null
  return computePtuInjuryAutomation({
    beforeHp: dialog.currentHp,
    afterHp: preview,
    fullMaxHp: hpDialogFullMaxHp(dialog),
    currentInjuries: hpDialogInjuries(dialog),
    source: 'hp-loss',
  })
}

export const getHpDialogPreviewMaxHp = (dialog: HpDialogState | null): number =>
  getHpDialogInjuryResult(dialog)?.maxHp ?? dialog?.maxHp ?? 0

export const getHpDialogHpUpdate = (dialog: HpDialogState | null): MoveAutomationHpUpdate | null => {
  if (!dialog) return null
  const injuryResult = getHpDialogInjuryResult(dialog)
  return {
    id: dialog.id,
    currentHp: getHpDialogPreview(dialog),
    ...(injuryResult && injuryResult.injuryDelta > 0 ? { injuries: injuryResult.injuries } : {}),
  }
}

export const updateHpDialogFromPokemon = (
  dialog: HpDialogState,
  pokemon: HpDialogPokemon,
): HpDialogState => ({
  ...dialog,
  species: pokemon.species,
  currentHp: pokemon.currentHp,
  maxHp: pokemon.maxHp,
  ...maybeHpMetadata(pokemon),
  accentColor: pokemon.accentColor,
})
