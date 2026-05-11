import type { CombatStageMap } from '~/types/combatStages'
import type { SpriteAnimation, SpriteCrop, SpawnedPokemon } from '~/types/pokemon'
import { normalizeCombatStages } from '~/utils/combatStages'
import { getPokemonCenter } from '~/utils/grid'
import { normalizeConditionNames } from '~/utils/statusConditions'

const SPRITE_LIFT_AMOUNT = 0.08
const SHADOW_LIFT_SCALE = 1.3
const SHADOW_LIFT_OPACITY = 0.55
const SHADOW_X_STRETCH = 1.15
const LIFT_SNAP_EPSILON = 0.001

export interface PokemonRenderSpawnState {
  center: { x: number; y: number; z: number }
  width: number
  height: number
  base: number
  clearance: number
  elevation: number
  spriteUrl: string
  backSpriteUrl?: string
  spriteAnimation?: SpriteAnimation
  backSpriteAnimation?: SpriteAnimation
  spriteCrop?: SpriteCrop
  turned: boolean
  displayName: string
  level: number
  currentHp: number
  maxHp: number
  combatStages: CombatStageMap
  conditions: string[]
  tokenItems: string[]
}

export interface PokemonPickDimensions {
  width: number
  height: number
}

export interface TokenSelectionLiftStyle {
  spriteLift: number
  shadowScaleX: number
  shadowScaleY: number
  shadowOpacity: number
}

export const pokemonRenderSpawnState = (pokemon: SpawnedPokemon): PokemonRenderSpawnState => ({
  center: getPokemonCenter(pokemon),
  width: pokemon.width,
  height: pokemon.height,
  base: pokemon.base,
  clearance: pokemon.clearance,
  elevation: pokemon.position.y,
  spriteUrl: pokemon.spriteUrl,
  backSpriteUrl: pokemon.backSpriteUrl,
  spriteAnimation: pokemon.spriteAnimation,
  backSpriteAnimation: pokemon.backSpriteAnimation,
  spriteCrop: pokemon.spriteCrop,
  turned: Boolean(pokemon.turned),
  displayName: pokemon.species,
  level: pokemon.level,
  currentHp: pokemon.currentHp,
  maxHp: pokemon.maxHp,
  combatStages: normalizeCombatStages(pokemon.combatStages),
  conditions: normalizeConditionNames(pokemon.conditions),
  tokenItems: [...pokemon.tokenItems],
})

export const pokemonPickDimensions = (pokemon: SpawnedPokemon): PokemonPickDimensions => ({
  width: Math.max(pokemon.base, pokemon.width, 1),
  height: Math.max(pokemon.clearance, pokemon.height, 1),
})

export const selectionLiftTarget = (selected: boolean): number => (selected ? 1 : 0)

export const nextSelectionLiftFactor = (
  current: number,
  target: number,
  damping: number,
): number => {
  if (Math.abs(current - target) < LIFT_SNAP_EPSILON) return target
  return current + (target - current) * damping
}

export const tokenSelectionLiftStyle = (liftFactor: number): TokenSelectionLiftStyle => {
  const shadowScale = 1 + (SHADOW_LIFT_SCALE - 1) * liftFactor
  return {
    spriteLift: liftFactor * SPRITE_LIFT_AMOUNT,
    shadowScaleX: shadowScale * SHADOW_X_STRETCH,
    shadowScaleY: shadowScale,
    shadowOpacity: 1 + (SHADOW_LIFT_OPACITY - 1) * liftFactor,
  }
}
