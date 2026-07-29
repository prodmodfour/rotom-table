import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { activeEncounterTransformation } from '#shared/moveAutomation/transformationEffects'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon, SpriteAnimation, SpriteCrop } from '~/types/pokemon'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import { projectEffectiveMovement } from '~/utils/encounterMovement'

const cloneAnimation = (
  animation: SpriteAnimation | null,
): SpriteAnimation | undefined => animation === null
  ? undefined
  : { ...animation, durationsMs: [...animation.durationsMs] }

const cloneCrop = (crop: SpriteCrop | null): SpriteCrop | undefined => (
  crop === null ? undefined : { ...crop }
)

const defenderCapabilitiesForMovement = (
  movement: ReturnType<typeof projectEffectiveMovement>,
): SpawnedPokemon['defenderCapabilities'] => {
  const sky = movement.speeds.sky
  const levitate = movement.speeds.levitate
  if ((sky ?? 0) <= 0 && (levitate ?? 0) <= 0) return undefined
  return {
    ...((sky ?? 0) > 0 ? { sky } : {}),
    ...((levitate ?? 0) > 0 ? { levitate } : {}),
  }
}

/**
 * Overlay one active durable form onto a token projection.
 *
 * Only the canonical Transform copy set is replaced. HP, temporary HP,
 * injuries, stats, stages, conditions' persistent sheet source, items, level,
 * identity, and ownership all remain the transforming user's values. Generic
 * condition/capability effects are then projected over the copied form base.
 */
export const projectEncounterTransformationToken = (input: {
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
  readonly token: SpawnedPokemon
  readonly effects?: readonly EncounterEffect[] | null
  /** Server movement snapshots apply generic movement effects after static providers. */
  readonly deferEncounterMovementProjection?: boolean
}): SpawnedPokemon => {
  const effect = activeEncounterTransformation({
    placementId: input.placement.id,
    effects: input.effects,
  })
  if (!effect) return input.token

  const { appearance, capabilities } = effect.payload
  const target = {
    placementId: input.placement.id,
    ...(input.placement.sideId === undefined ? {} : { sideId: input.placement.sideId }),
    position: input.placement.position,
    base: appearance.base,
    clearance: appearance.clearance,
  }
  const sheetConditions = [...(input.token.sheetConditions ?? input.token.conditions)]
  const conditions = projectEffectiveConditions({
    sheetConditions,
    encounterEffects: input.effects,
    target,
  }).conditions
  const movement = projectEffectiveMovement({
    sheetCapabilities: capabilities.movementSpeeds,
    sheetTraits: capabilities.movementTraits,
    sheetConditions: conditions,
    encounterEffects: input.deferEncounterMovementProjection ? [] : input.effects,
    target,
  })
  const defenderCapabilities = defenderCapabilitiesForMovement(movement)
  const spriteAnimation = cloneAnimation(appearance.spriteAnimation)
  const backSpriteAnimation = cloneAnimation(appearance.backSpriteAnimation)
  const spriteCrop = cloneCrop(appearance.spriteCrop)
  const {
    profileSpriteUrl: _profileSpriteUrl,
    backSpriteUrl: _backSpriteUrl,
    spriteAnimation: _spriteAnimation,
    backSpriteAnimation: _backSpriteAnimation,
    spriteCrop: _spriteCrop,
    defenderCapabilities: _defenderCapabilities,
    abilityNames: _abilityNames,
    ...retained
  } = input.token

  return {
    ...retained,
    size: appearance.size,
    width: appearance.width,
    height: appearance.height,
    base: appearance.base,
    clearance: appearance.clearance,
    slug: appearance.slug,
    spriteUrl: appearance.spriteUrl,
    ...(appearance.profileSpriteUrl === null
      ? {}
      : { profileSpriteUrl: appearance.profileSpriteUrl }),
    ...(appearance.backSpriteUrl === null
      ? {}
      : { backSpriteUrl: appearance.backSpriteUrl }),
    ...(spriteAnimation === undefined ? {} : { spriteAnimation }),
    ...(backSpriteAnimation === undefined ? {} : { backSpriteAnimation }),
    ...(spriteCrop === undefined ? {} : { spriteCrop }),
    entityKind: 'pokemon',
    defenderTypes: [...effect.payload.typeIds],
    weightClass: effect.payload.weightClass,
    ruleCapabilities: {
      ...capabilities,
      movementSpeeds: { ...movement.speeds },
      movementTraits: {
        phasing: movement.traits.phasing,
        jump: { ...movement.traits.jump },
      },
      other: [...capabilities.other],
    },
    transformation: {
      effectId: effect.id,
      copiedFromPlacementId: effect.payload.copiedFromPlacementId,
      appearanceSpecies: appearance.species,
    },
    movementCapabilities: { ...movement.speeds },
    movementTraits: {
      phasing: movement.traits.phasing,
      jump: { ...movement.traits.jump },
    },
    movementProfile: movement,
    ...(defenderCapabilities === undefined ? {} : { defenderCapabilities }),
    ...(effect.payload.abilityNames.length === 0
      ? {}
      : { abilityNames: [...effect.payload.abilityNames] }),
    sheetConditions,
    conditions: [...conditions],
  }
}
