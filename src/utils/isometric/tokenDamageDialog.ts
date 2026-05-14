import type { SpawnedPokemon } from '~/types/pokemon'
import {
  calculatePtuDamageLoss,
  findManualDamageBase,
  type DamageBaseDef,
  type PtuDamageRollResult,
} from '~/utils/ptuDamage'
import { formatMultiplier } from '~/utils/typeChart'
import {
  computeSheetAbilityAwareMultiplier,
  type GroundResistanceCapabilities,
} from '~/utils/sheetPassiveAbilityEffects'

export type DamageDialogMode = 'physical' | 'special'
export type DamageDialogSource = 'flat' | 'db'
export type DamageDialogMultiplierTone = 'is-immune' | 'is-resist' | 'is-weak' | null

export interface DamageDialogState {
  id: string
  species: string
  currentHp: number
  maxHp: number
  def: number
  sdef: number
  defenderTypes: string[]
  defenderCapabilities?: GroundResistanceCapabilities
  abilityNames?: string[]
  mode: DamageDialogMode
  attackType: string
  source: DamageDialogSource
  amount: string
  db: number
  roll: PtuDamageRollResult | null
  attackerId: string | null
}

type DamageDialogPokemon = Pick<
  SpawnedPokemon,
  'id' | 'species' | 'currentHp' | 'maxHp' | 'def' | 'sdef' | 'defenderTypes' | 'defenderCapabilities' | 'abilityNames'
>

type DamageDialogAttacker = Pick<SpawnedPokemon, 'id' | 'species' | 'atk' | 'satk'>

const parsePositiveInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

export const createDamageDialogState = (pokemon: DamageDialogPokemon): DamageDialogState => {
  const abilityNames = [...(pokemon.abilityNames ?? [])]
  return {
    id: pokemon.id,
    species: pokemon.species,
    currentHp: pokemon.currentHp,
    maxHp: pokemon.maxHp,
    def: pokemon.def,
    sdef: pokemon.sdef,
    defenderTypes: [...pokemon.defenderTypes],
    ...(pokemon.defenderCapabilities ? { defenderCapabilities: { ...pokemon.defenderCapabilities } } : {}),
    ...(abilityNames.length ? { abilityNames } : {}),
    mode: 'physical',
    attackType: 'Normal',
    source: 'flat',
    amount: '',
    db: 1,
    roll: null,
    attackerId: null,
  }
}

export const getDamageDialogDbDefinition = (
  dialog: DamageDialogState | null,
): DamageBaseDef | null => {
  if (!dialog) return null
  return findManualDamageBase(dialog.db)
}

export const getDamageDialogRawAmount = (dialog: DamageDialogState | null): number => {
  if (!dialog) return 0
  if (dialog.source === 'db') return dialog.roll?.total ?? 0
  return parsePositiveInteger(dialog.amount)
}

export const getDamageDialogDefense = (dialog: DamageDialogState | null): number => {
  if (!dialog) return 0
  return dialog.mode === 'physical' ? dialog.def : dialog.sdef
}

export const getDamageDialogAttackerOptions = <T extends DamageDialogAttacker>(
  pokemons: readonly T[],
): T[] => [...pokemons].sort((a, b) => a.species.localeCompare(b.species))

export const getDamageDialogAttacker = <T extends DamageDialogAttacker>(
  dialog: DamageDialogState | null,
  pokemons: readonly T[],
): T | null => {
  if (!dialog?.attackerId) return null
  return pokemons.find((pokemon) => pokemon.id === dialog.attackerId) ?? null
}

export const getDamageDialogAttackBonus = (
  dialog: DamageDialogState | null,
  attacker: DamageDialogAttacker | null,
): number => {
  if (!dialog || dialog.source !== 'db' || !attacker) return 0
  return dialog.mode === 'physical' ? attacker.atk : attacker.satk
}

export const getDamageDialogMultiplier = (dialog: DamageDialogState | null): number => {
  if (!dialog) return 1
  return computeSheetAbilityAwareMultiplier(
    dialog.attackType,
    dialog.defenderTypes,
    dialog.abilityNames,
    dialog.defenderCapabilities,
  )
}

export const getDamageDialogHpLoss = (
  dialog: DamageDialogState | null,
  attacker: DamageDialogAttacker | null,
): number => calculatePtuDamageLoss({
  rawDamage: getDamageDialogRawAmount(dialog),
  attackBonus: getDamageDialogAttackBonus(dialog, attacker),
  defense: getDamageDialogDefense(dialog),
  multiplier: getDamageDialogMultiplier(dialog),
})

export const getDamageDialogPreview = (
  dialog: DamageDialogState | null,
  attacker: DamageDialogAttacker | null,
): number => {
  if (!dialog) return 0
  return Math.max(0, dialog.currentHp - getDamageDialogHpLoss(dialog, attacker))
}

export const getDamageDialogMultiplierTone = (multiplier: number): DamageDialogMultiplierTone => {
  if (multiplier === 0) return 'is-immune'
  if (multiplier < 1) return 'is-resist'
  if (multiplier > 1) return 'is-weak'
  return null
}

export const getDamageDialogMultiplierLabel = (multiplier: number): string =>
  formatMultiplier(multiplier)

export const updateDamageDialogFromPokemon = (
  dialog: DamageDialogState,
  pokemon: DamageDialogPokemon,
  availableAttackers: readonly DamageDialogAttacker[],
): DamageDialogState => {
  const abilityNames = [...(pokemon.abilityNames ?? [])]
  const next: DamageDialogState = {
    ...dialog,
    species: pokemon.species,
    currentHp: pokemon.currentHp,
    maxHp: pokemon.maxHp,
    def: pokemon.def,
    sdef: pokemon.sdef,
    defenderTypes: [...pokemon.defenderTypes],
    attackerId: dialog.attackerId && availableAttackers.some((attacker) => attacker.id === dialog.attackerId)
      ? dialog.attackerId
      : null,
  }
  if (pokemon.defenderCapabilities) next.defenderCapabilities = { ...pokemon.defenderCapabilities }
  else delete next.defenderCapabilities
  if (abilityNames.length) next.abilityNames = abilityNames
  else delete next.abilityNames
  return next
}
