import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { parseCapabilityLabel } from '#shared/capabilityAutomation/catalog'
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
  const movementCanonical: Readonly<Partial<Record<string, string>>> = {
    overland: 'Overland', sky: 'Sky', swim: 'Swim', levitate: 'Levitate',
    burrow: 'Burrow', teleport: 'Teleporter', climb: 'Wallclimber',
  }
  const ids = token.movementProfile?.modes.flatMap(mode => {
    if (!mode.available) return []
    const canonicalId = movementCanonical[mode.mode]
    return canonicalId
      ? [`movement.${mode.mode}`, canonicalId, `capability.${stableCapabilitySegment(canonicalId)}`]
      : [`movement.${mode.mode}`]
  }) ?? []
  for (const capability of token.ruleCapabilities?.other ?? []) {
    const segment = stableCapabilitySegment(capability)
    if (segment) ids.push(`capability.${segment}`)
    const parsed = parseCapabilityLabel(capability)
    if (parsed.canonicalId) {
      ids.push(parsed.canonicalId, `capability.${stableCapabilitySegment(parsed.canonicalId)}`)
    }
  }
  const jump = token.movementTraits?.jump ?? token.movementProfile?.traits.jump
  if (jump) ids.push('movement.jump', 'Jump', 'capability.jump')
  const teleporter = token.movementCapabilities?.teleporter
  if (typeof teleporter === 'number' && Number.isFinite(teleporter) && teleporter >= 0) {
    ids.push('movement.teleport', 'Teleporter', 'capability.teleporter')
  }
  if (token.ruleCapabilities?.power != null) ids.push('Power', 'capability.power')
  if (token.ruleCapabilities?.naturewalk?.trim()) ids.push('Naturewalk', 'capability.naturewalk')
  return [...new Set(ids)]
}

const materializeCanonicalCapabilityIds = (
  profile: EffectiveEncounterCreatureRules,
  baseIds: readonly string[],
): EffectiveEncounterCreatureRules => {
  const canonicalIds = baseIds.flatMap((id) => {
    const parsed = parseCapabilityLabel(id)
    if (parsed.canonicalId !== id) return []
    const stableId = `capability.${stableCapabilitySegment(id)}`
    return profile.capabilityIds.includes(stableId) ? [id] : []
  })
  if (canonicalIds.length === 0) return profile
  return Object.freeze({
    ...profile,
    capabilityIds: Object.freeze([...new Set([...profile.capabilityIds, ...canonicalIds])]),
  })
}

const baseSize = (token: SpawnedPokemon): string | null => (
  token.ruleCapabilities?.size ?? token.size ?? null
)

const baseFormId = (token: SpawnedPokemon): string => {
  const normalized = stableCapabilitySegment(token.species)
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
): EffectiveEncounterCreatureRules => {
  if (token.creatureRules) return token.creatureRules
  const capabilityIds = baseCapabilityIds(token)
  return materializeCanonicalCapabilityIds(projectEncounterCreatureRules({
    base: {
      typeIds: token.defenderTypes,
      abilityNames: token.abilityNames ?? [],
      formId: baseFormId(token),
      size: baseSize(token),
      capabilityIds,
      grounding: token.movementProfile?.state.grounding ?? 'grounded',
    },
    target: {
      placementId: token.id,
      position: token.position,
      base: token.base,
      clearance: token.clearance,
    },
  }), capabilityIds)
}

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
  /** Canonical sheet species; token.species may intentionally be a display nickname. */
  readonly baseFormSpecies?: string
  /** Materialize the complete unchanged profile when a static form needs it. */
  readonly forceProfile?: boolean
}): SpawnedPokemon => {
  const capabilityIds = baseCapabilityIds(input.token)
  const profile = materializeCanonicalCapabilityIds(projectEncounterCreatureRules({
    base: {
      typeIds: input.token.defenderTypes,
      abilityNames: input.token.abilityNames ?? [],
      formId: stableCapabilitySegment(input.baseFormSpecies ?? input.token.species) || 'unknown-form',
      size: baseSize(input.token),
      capabilityIds,
      grounding: input.token.movementProfile?.state.grounding ?? 'grounded',
    },
    effects: input.effects,
    target: targetFor(input.placement, input.token),
  }), capabilityIds)
  if (profile.sources.length === 0 && input.forceProfile !== true) return input.token

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
