import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  projectEncounterCreatureRules,
  type EffectiveEncounterCreatureRules,
} from '#shared/moveAutomation/creatureRuleOverlays'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'

const stableCapabilitySegment = (value: string): string => value
  .trim()
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const baseCapabilityIds = (token: SpawnedPokemon): readonly string[] => {
  const ids = token.movementProfile?.modes.flatMap(mode => (
    mode.available ? [`movement.${mode.mode}`] : []
  )) ?? []
  for (const capability of token.ruleCapabilities?.other ?? []) {
    const segment = stableCapabilitySegment(capability)
    if (segment) ids.push(`capability.${segment}`)
  }
  return [...new Set(ids)]
}

const baseSize = (token: SpawnedPokemon): string | null => (
  token.ruleCapabilities?.size ?? token.size ?? null
)

const baseFormId = (token: SpawnedPokemon): string => {
  const normalized = stableCapabilitySegment(token.slug)
  return normalized || 'unknown-form'
}

const targetFor = (
  placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>,
  token: SpawnedPokemon,
) => ({
  placementId: placement.id,
  ...(placement.sideId === undefined ? {} : { sideId: placement.sideId }),
  position: placement.position,
  base: token.base,
  clearance: token.clearance,
})

/** Build a source-free fallback profile for standalone/server query consumers. */
export const encounterCreatureRuleProfileForToken = (
  token: SpawnedPokemon,
): EffectiveEncounterCreatureRules => token.creatureRules ?? projectEncounterCreatureRules({
  base: {
    typeIds: token.defenderTypes,
    abilityNames: token.abilityNames ?? [],
    formId: baseFormId(token),
    size: baseSize(token),
    capabilityIds: baseCapabilityIds(token),
    grounding: token.movementProfile?.state.grounding ?? 'grounded',
  },
  target: {
    placementId: token.id,
    position: token.position,
    base: token.base,
    clearance: token.clearance,
  },
})

const displaySize = (
  size: EffectiveEncounterCreatureRules['size'],
): string | null => size === null
  ? null
  : `${size.slice(0, 1).toUpperCase()}${size.slice(1)}`

/**
 * Apply non-destructive creature overlays after an optional Transform base.
 * Existing mechanics continue to consume `defenderTypes`, `abilityNames`, and
 * `movementProfile`; the complete profile gives new rules one shared query.
 */
export const projectEncounterCreatureRuleToken = (input: {
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
  readonly token: SpawnedPokemon
  readonly effects?: readonly EncounterEffect[] | null
}): SpawnedPokemon => {
  const profile = projectEncounterCreatureRules({
    base: {
      typeIds: input.token.defenderTypes,
      abilityNames: input.token.abilityNames ?? [],
      formId: baseFormId(input.token),
      size: baseSize(input.token),
      capabilityIds: baseCapabilityIds(input.token),
      grounding: input.token.movementProfile?.state.grounding ?? 'grounded',
    },
    effects: input.effects,
    target: targetFor(input.placement, input.token),
  })
  if (profile.sources.length === 0) return input.token

  const { abilityNames: _abilityNames, ...retained } = input.token
  const size = displaySize(profile.size)
  return {
    ...retained,
    defenderTypes: [...profile.typeIds],
    ...(profile.abilityNames.length > 0
      ? { abilityNames: [...profile.abilityNames] }
      : {}),
    ...(retained.ruleCapabilities && size !== null
      ? {
          ruleCapabilities: {
            ...retained.ruleCapabilities,
            movementSpeeds: { ...retained.ruleCapabilities.movementSpeeds },
            movementTraits: {
              ...retained.ruleCapabilities.movementTraits,
              jump: { ...retained.ruleCapabilities.movementTraits.jump },
            },
            other: [...retained.ruleCapabilities.other],
            size,
          },
        }
      : {}),
    creatureRules: profile,
  }
}
