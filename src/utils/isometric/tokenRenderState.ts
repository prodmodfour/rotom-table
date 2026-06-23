import type { CombatStageMap } from '~/types/combatStages'
import type { SpriteAnimation, SpriteCrop, SpawnedPokemon } from '~/types/pokemon'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import { normalizeCombatStages } from '~/utils/combatStages'
import { getPokemonCenter } from '~/utils/gridGeometry'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { tokenFacingForPlacement, tokenFacingStoresLegacyTurned } from '~/utils/tokenFacing'

const SPRITE_LIFT_AMOUNT = 0.08
const SHADOW_LIFT_SCALE = 1.3
const SHADOW_LIFT_OPACITY = 0.55
const SHADOW_X_STRETCH = 1.15
export const TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED = 0.000001
export const TOKEN_SELECTION_LIFT_SNAP_EPSILON = 0.001

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
  facing: TokenFacingDirection
  turned: boolean
  displayName: string
  level: number
  currentHp: number
  temporaryHp?: number
  maxHp: number
  fullMaxHp?: number
  injuries?: number
  combatStages: CombatStageMap
  conditions: string[]
  tokenItems: string[]
  accentColor?: string
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

export interface TokenRenderAnimationPoint {
  x: number
  y: number
  z: number
}

export interface TokenRenderAnimationState {
  currentCenter: TokenRenderAnimationPoint
  targetCenter: TokenRenderAnimationPoint
  liftFactor: number
  liftTarget: number
}

export const pokemonRenderSpawnState = (pokemon: SpawnedPokemon): PokemonRenderSpawnState => {
  const facing = tokenFacingForPlacement(pokemon)

  return {
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
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
    displayName: pokemon.species,
    level: pokemon.level,
    currentHp: pokemon.currentHp,
    temporaryHp: pokemon.temporaryHp,
    maxHp: pokemon.maxHp,
    fullMaxHp: pokemon.fullMaxHp,
    injuries: pokemon.injuries,
    combatStages: normalizeCombatStages(pokemon.combatStages),
    conditions: normalizeConditionNames(pokemon.conditions),
    tokenItems: [...pokemon.tokenItems],
    accentColor: pokemon.accentColor,
  }
}

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
  if (Math.abs(current - target) < TOKEN_SELECTION_LIFT_SNAP_EPSILON) return target
  return current + (target - current) * damping
}

export const tokenCenterLerpNeedsAnimation = (
  token: Pick<TokenRenderAnimationState, 'currentCenter' | 'targetCenter'>,
): boolean => {
  const dx = token.currentCenter.x - token.targetCenter.x
  const dy = token.currentCenter.y - token.targetCenter.y
  const dz = token.currentCenter.z - token.targetCenter.z

  return dx * dx + dy * dy + dz * dz >= TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED
}

export const tokenSelectionLiftNeedsAnimation = (
  token: Pick<TokenRenderAnimationState, 'liftFactor' | 'liftTarget'>,
): boolean => Math.abs(token.liftFactor - token.liftTarget) >= TOKEN_SELECTION_LIFT_SNAP_EPSILON

export const tokenRenderStateNeedsAnimation = (
  token: TokenRenderAnimationState,
): boolean => tokenCenterLerpNeedsAnimation(token) || tokenSelectionLiftNeedsAnimation(token)

export const anyTokenRenderStateNeedsAnimation = (
  tokens: Iterable<TokenRenderAnimationState>,
): boolean => {
  for (const token of tokens) {
    if (tokenRenderStateNeedsAnimation(token)) return true
  }

  return false
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
