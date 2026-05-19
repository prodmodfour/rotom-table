import type { MoveAutomationHpUpdate } from '~/types/moveAutomation'
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
import {
  computePtuInjuryAutomation,
  type PtuInjuryAutomationResult,
} from '~/utils/ptuInjuries'

export type DamageDialogMode = 'physical' | 'special'
export type DamageDialogSource = 'flat' | 'db'
export type DamageDialogMultiplierTone = 'is-immune' | 'is-resist' | 'is-weak' | null

export interface DamageDialogState {
  id: string
  species: string
  currentHp: number
  maxHp: number
  fullMaxHp?: number
  injuries?: number
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
  'id' | 'species' | 'currentHp' | 'maxHp' | 'fullMaxHp' | 'injuries' | 'def' | 'sdef' | 'defenderTypes' | 'defenderCapabilities' | 'abilityNames'
>

type DamageDialogAttacker = Pick<SpawnedPokemon, 'id' | 'species' | 'atk' | 'satk'>

const parsePositiveInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

const damageDialogFullMaxHp = (dialog: DamageDialogState): number => dialog.fullMaxHp ?? dialog.maxHp
const damageDialogInjuries = (dialog: DamageDialogState): number => dialog.injuries ?? 0

const maybeHpMetadata = (pokemon: DamageDialogPokemon): Pick<DamageDialogState, 'fullMaxHp' | 'injuries'> => ({
  ...(pokemon.fullMaxHp != null ? { fullMaxHp: pokemon.fullMaxHp } : {}),
  ...(pokemon.injuries != null ? { injuries: pokemon.injuries } : {}),
})

export const createDamageDialogState = (pokemon: DamageDialogPokemon): DamageDialogState => {
  const abilityNames = [...(pokemon.abilityNames ?? [])]
  return {
    id: pokemon.id,
    species: pokemon.species,
    currentHp: pokemon.currentHp,
    maxHp: pokemon.maxHp,
    ...maybeHpMetadata(pokemon),
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
  return dialog.currentHp - getDamageDialogHpLoss(dialog, attacker)
}

export const getDamageDialogInjuryResult = (
  dialog: DamageDialogState | null,
  attacker: DamageDialogAttacker | null,
): PtuInjuryAutomationResult | null => {
  if (!dialog) return null
  const preview = getDamageDialogPreview(dialog, attacker)
  if (preview >= dialog.currentHp) return null
  return computePtuInjuryAutomation({
    beforeHp: dialog.currentHp,
    afterHp: preview,
    fullMaxHp: damageDialogFullMaxHp(dialog),
    currentInjuries: damageDialogInjuries(dialog),
    source: 'damage',
  })
}

export const getDamageDialogPreviewMaxHp = (
  dialog: DamageDialogState | null,
  attacker: DamageDialogAttacker | null,
): number => getDamageDialogInjuryResult(dialog, attacker)?.maxHp ?? dialog?.maxHp ?? 0

export const getDamageDialogHpUpdate = (
  dialog: DamageDialogState | null,
  attacker: DamageDialogAttacker | null,
): MoveAutomationHpUpdate | null => {
  if (!dialog) return null
  const injuryResult = getDamageDialogInjuryResult(dialog, attacker)
  return {
    id: dialog.id,
    currentHp: getDamageDialogPreview(dialog, attacker),
    ...(injuryResult && injuryResult.injuryDelta > 0 ? { injuries: injuryResult.injuries } : {}),
  }
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
    ...maybeHpMetadata(pokemon),
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
