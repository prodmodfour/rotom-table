import type { EffectiveEncounterCreatureRules } from '#shared/moveAutomation/creatureRuleOverlays'
import { parseCapabilityLabel } from '#shared/capabilityAutomation/catalog'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { pokemonTypeId } from '#shared/pokemonTypes'
import type { SheetPlacement } from '~/types/map'
import type { MovementGroundingState } from '~/types/movement'
import type { SpawnedPokemon } from '~/types/pokemon'
import { encounterCreatureRuleProfileForToken } from '~/utils/encounterCreatureRules'
import {
  DIGESTION_BUFF_TRADED_CAPABILITY_ID,
  hasSheetBoundCapabilityEffect,
} from './digestionBuffTrade'

export type MoveAutomationCreatureSonicReasonCode =
  | 'creature.sonic-available'
  | 'creature.sonic-locked'
  | 'creature.rules-unresolved'

export interface MoveAutomationCreatureSonicResolution {
  readonly allowed: boolean
  readonly reasonCode: MoveAutomationCreatureSonicReasonCode
  readonly sourceEffectIds: readonly string[]
}

export interface MoveAutomationEffectiveCapabilityIdentity {
  readonly instanceId: string
  readonly canonicalId: string
}

export interface MoveAutomationCreatureRuleResolver {
  resolve(placementId: string): EffectiveEncounterCreatureRules | null
  hasType(placementId: string, typeId: string): boolean
  hasAbility(placementId: string, abilityName: string): boolean
  hasCapability(placementId: string, capabilityId: string): boolean
  hasCapabilityInstance(placementId: string, capabilityInstanceId: string, canonicalId: string): boolean
  sonicUse(placementId: string): MoveAutomationCreatureSonicResolution
}

export type MoveAutomationCreatureRuleQueryErrorCode =
  | 'duplicate-placement-id'
  | 'duplicate-token-id'

export class MoveAutomationCreatureRuleQueryError extends Error {
  readonly code: MoveAutomationCreatureRuleQueryErrorCode

  constructor(code: MoveAutomationCreatureRuleQueryErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationCreatureRuleQueryError'
    this.code = code
  }
}

const fail = (
  code: MoveAutomationCreatureRuleQueryErrorCode,
  message: string,
): never => {
  throw new MoveAutomationCreatureRuleQueryError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const indexUnique = <Value>(input: {
  readonly values: readonly Value[]
  readonly idFor: (value: Value) => string
  readonly code: MoveAutomationCreatureRuleQueryErrorCode
  readonly label: string
}): ReadonlyMap<string, Value> => {
  const indexed = new Map<string, Value>()
  for (const value of input.values) {
    const id = input.idFor(value)
    if (indexed.has(id)) fail(input.code, `${input.label} ${id} was listed more than once.`)
    indexed.set(id, value)
  }
  return indexed
}

const MOVEMENT_CANONICAL_ID_BY_RULE_ID: Readonly<Record<string, string>> = Object.freeze({
  'movement.overland': 'Overland',
  'movement.sky': 'Sky',
  'movement.swim': 'Swim',
  'movement.levitate': 'Levitate',
  'movement.burrow': 'Burrow',
  'movement.teleport': 'Teleporter',
  'movement.jump': 'Jump',
  'movement.climb': 'Wallclimber',
})

const MOVEMENT_RULE_ID_BY_CANONICAL_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(MOVEMENT_CANONICAL_ID_BY_RULE_ID).map(([ruleId, canonicalId]) => (
    [canonicalId, ruleId]
  ))),
)

const stableCapabilitySegment = (value: string): string => value
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const canonicalCapabilityIdForQuery = (value: string): string | null => {
  const normalized = value.trim()
  const movementCanonicalId = MOVEMENT_CANONICAL_ID_BY_RULE_ID[normalized.toLocaleLowerCase('en-US')]
  if (movementCanonicalId) return movementCanonicalId
  return parseCapabilityLabel(
    normalized.replace(/^capability\./i, '').replace(/-/g, ' '),
  ).canonicalId
}

const capabilityProfileIds = (
  identities: readonly MoveAutomationEffectiveCapabilityIdentity[],
): readonly string[] => [...new Set(identities.flatMap(({ canonicalId }) => [
  canonicalId,
  `capability.${stableCapabilitySegment(canonicalId)}`,
  ...(MOVEMENT_RULE_ID_BY_CANONICAL_ID[canonicalId]
    ? [MOVEMENT_RULE_ID_BY_CANONICAL_ID[canonicalId]!]
    : []),
]))]

/** Build immutable placement-ID creature queries over one authoritative token snapshot. */
export const createMoveAutomationCreatureRuleResolver = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly tokens: readonly SpawnedPokemon[]
  /** Scene-bound sheet markers remain queryable after placement replacement. */
  readonly effects?: readonly EncounterEffect[]
  /** Global fields may override final grounding without rewriting effect/token state. */
  readonly resolveGrounding?: (input: {
    readonly placement: SheetPlacement
    readonly base: MovementGroundingState
  }) => MovementGroundingState
  /** Exact effective canonical/instance identities from the authoritative sheet projection. */
  readonly effectiveCapabilityIdentitiesByPlacement?: ReadonlyMap<
    string,
    readonly MoveAutomationEffectiveCapabilityIdentity[]
  >
  readonly recordSheetRead?: (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ) => void
}): MoveAutomationCreatureRuleResolver => {
  const placements = indexUnique({
    values: input.placements,
    idFor: placement => placement.id,
    code: 'duplicate-placement-id',
    label: 'Creature-rule placement',
  })
  const tokens = indexUnique({
    values: input.tokens,
    idFor: token => token.id,
    code: 'duplicate-token-id',
    label: 'Creature-rule token',
  })
  const profiles = new Map<string, EffectiveEncounterCreatureRules | null>()
  for (const placement of input.placements) {
    const token = tokens.get(placement.id)
    if (
      !token
      || token.sheetKind !== placement.sheetKind
      || token.sheetSlug !== placement.sheetSlug
    ) {
      profiles.set(placement.id, null)
      continue
    }
    const base = encounterCreatureRuleProfileForToken(token)
    const grounding = input.resolveGrounding?.({ placement, base: base.grounding })
      ?? base.grounding
    const effectiveIdentities = input.effectiveCapabilityIdentitiesByPlacement?.get(placement.id)
    profiles.set(placement.id, grounding === base.grounding && effectiveIdentities === undefined
      ? base
      : deepFreeze({
          ...base,
          grounding,
          typeIds: [...base.typeIds],
          abilityNames: [...base.abilityNames],
          capabilityIds: effectiveIdentities === undefined
            ? [...base.capabilityIds]
            : [...capabilityProfileIds(effectiveIdentities)],
          sources: base.sources.map(source => ({
            ...source,
            duration: { ...source.duration },
          })),
          sourceEffectIds: [...base.sourceEffectIds],
          sonicLockSourceEffectIds: [...base.sonicLockSourceEffectIds],
        }))
  }

  const resolve = (placementId: string): EffectiveEncounterCreatureRules | null => {
    const placement = placements.get(placementId)
    if (!placement) return null
    input.recordSheetRead?.(placement)
    return profiles.get(placementId) ?? null
  }

  return Object.freeze({
    resolve,
    hasType: (placementId: string, typeId: string): boolean => {
      const profile = resolve(placementId)
      const canonical = pokemonTypeId(typeId)
      return canonical !== null && Boolean(profile?.typeIds.includes(canonical))
    },
    hasAbility: (placementId: string, abilityName: string): boolean => {
      const profile = resolve(placementId)
      const key = abilityName.trim().toLowerCase()
      return Boolean(key && profile?.abilityNames.some(name => name.toLowerCase() === key))
    },
    hasCapability: (placementId: string, capabilityId: string): boolean => {
      const profile = resolve(placementId)
      const canonicalId = canonicalCapabilityIdForQuery(capabilityId)
      const effectiveIdentities = input.effectiveCapabilityIdentitiesByPlacement?.get(placementId)
      if (canonicalId && effectiveIdentities !== undefined) {
        return profile !== null
          && effectiveIdentities.some(identity => identity.canonicalId === canonicalId)
      }
      const canonicalCandidates = canonicalId
        ? [canonicalId, `capability.${stableCapabilitySegment(canonicalId)}`]
        : []
      if (profile?.capabilityIds.some(id => id === capabilityId || canonicalCandidates.includes(id))) return true
      const placement = placements.get(placementId)
      return capabilityId === DIGESTION_BUFF_TRADED_CAPABILITY_ID
        && placement !== undefined
        && hasSheetBoundCapabilityEffect({
          effects: input.effects ?? [],
          placement,
          capabilityId,
        })
    },
    hasCapabilityInstance: (placementId: string, capabilityInstanceId: string, canonicalId: string): boolean => {
      if (resolve(placementId) === null) return false
      return input.effectiveCapabilityIdentitiesByPlacement?.get(placementId)?.some(identity => (
        identity.instanceId === capabilityInstanceId && identity.canonicalId === canonicalId
      )) === true
    },
    sonicUse: (placementId: string): MoveAutomationCreatureSonicResolution => {
      const profile = resolve(placementId)
      if (!profile) {
        return deepFreeze({
          allowed: false,
          reasonCode: 'creature.rules-unresolved' as const,
          sourceEffectIds: [],
        })
      }
      return deepFreeze({
        allowed: !profile.sonicLocked,
        reasonCode: profile.sonicLocked
          ? 'creature.sonic-locked' as const
          : 'creature.sonic-available' as const,
        sourceEffectIds: [...profile.sonicLockSourceEffectIds],
      })
    },
  })
}
