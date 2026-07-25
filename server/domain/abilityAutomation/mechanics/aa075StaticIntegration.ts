import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { SUBSTITUTE_COAT_CAPABILITY_ID } from '#shared/moveAutomation/substitute'
import { aa075IceFaceFeatureMarkerActive } from '#shared/abilityAutomation/aa075'
import type { MoveCoreTokenDamageResolution } from '../../moveAutomation/reducers/coreTokenEffectTypes'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { projectEncounterCreatureRuleToken } from '~/utils/encounterCreatureRules'
import { aa071ResistDamageType } from './aa071StaticIntegration'

export const aa075HypnoticAutomaticHit = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
}): boolean => input.script.moveName === 'Hypnosis'
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Hypnotic')

export const aa075IceScalesDamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly damageClass: string
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => input.damageClass.trim().toLowerCase() === 'special'
  && input.context.queries.abilities.has(input.recipientId, 'Ice Scales')
  ? aa071ResistDamageType({ resolved: input.resolved, steps: 1, sources: ['Ice Scales'] })
  : input.resolved

const hasBlindsense = (token: SpawnedPokemon): boolean => (
  token.creatureRules?.capabilityIds.some(id => (
    id === 'capability.blindsense' || id.startsWith('capability.blindsense-')
  )) === true
  || token.ruleCapabilities?.other.some(value => (
    /^blindsense(?:\s|$)/i.test(value.trim())
  )) === true
)

export const aa075IlluminateAccuracyModifier = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly targetPlacementId?: string
}): number => {
  if (!input.targetPlacementId
    || !input.context.queries.abilities.has(input.targetPlacementId, 'Illuminate')
    || input.context.queries.abilities.has(input.context.actor.placement.id, 'Keen Eye')
    || hasBlindsense(input.context.actor.token)) return 0
  return -2
}

export const aa075ImposterTransformOverride = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
}): boolean => input.script.moveName === 'Transform'
  && input.context.actor.token.transformation === undefined
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Imposter')

export const aa075InfiltratorStealthBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
  readonly skill: string
}): number => input.skill.trim().toLowerCase() === 'stealth'
  && input.context.queries.abilities.has(input.placementId, 'Infiltrator')
  ? 2
  : 0

export const aa075InfiltratorIgnoresHazards = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): boolean => input.context.queries.abilities.has(input.placementId, 'Infiltrator')

export const aa075InfiltratorBlocksResponsiveBlessings = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actingPlacementId: string
}): boolean => input.context.queries.abilities.has(input.actingPlacementId, 'Infiltrator')

export const aa075SubstituteActiveForPlacement = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): boolean => (effects ?? []).some(effect => (
  effect.kind === 'capability'
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
  && effect.suppression.sources.length === 0
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === SUBSTITUTE_COAT_CAPABILITY_ID
  && effect.tags.includes('substitute')
  && effect.affected.placementIds.includes(placementId)
))

export const aa075InfiltratorBypassesTemporaryHp = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
}): boolean => input.context.queries.abilities.has(input.context.actor.placement.id, 'Infiltrator')
  && aa075SubstituteActiveForPlacement(input.context.map.encounterState?.effects, input.recipientId)

export const aa075WithTemporaryHpBypass = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
  readonly resolution: MoveCoreTokenDamageResolution
}): MoveCoreTokenDamageResolution => aa075InfiltratorBypassesTemporaryHp(input)
  ? { ...input.resolution, bypassTemporaryHp: true }
  : input.resolution

/** Ice Face form follows only the pool owned by its durable feature marker. */
export const aa075IceFaceFormToken = (input: {
  readonly token: SpawnedPokemon
  readonly hasIceFace: boolean
  readonly effects: readonly EncounterEffect[] | null | undefined
}): SpawnedPokemon => {
  if (!input.hasIceFace) return input.token
  const token = input.token.creatureRules
    ? input.token
    : projectEncounterCreatureRuleToken({
        placement: { id: input.token.id, position: input.token.position },
        token: input.token,
        effects: input.effects,
        forceProfile: true,
      })
  if (!token.creatureRules) return token
  const featurePoolRemaining = (token.temporaryHp ?? 0) > 0
    && aa075IceFaceFeatureMarkerActive(input.effects, token.id)
  return {
    ...token,
    creatureRules: {
      ...token.creatureRules,
      formId: featurePoolRemaining ? 'ice-face' : 'noice-face',
    },
  }
}
