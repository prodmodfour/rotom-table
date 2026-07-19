import type { EffectiveEncounterCreatureRules } from '#shared/moveAutomation/creatureRuleOverlays'
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

export interface MoveAutomationCreatureRuleResolver {
  resolve(placementId: string): EffectiveEncounterCreatureRules | null
  hasType(placementId: string, typeId: string): boolean
  hasAbility(placementId: string, abilityName: string): boolean
  hasCapability(placementId: string, capabilityId: string): boolean
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
    profiles.set(placement.id, grounding === base.grounding
      ? base
      : deepFreeze({
          ...base,
          grounding,
          typeIds: [...base.typeIds],
          abilityNames: [...base.abilityNames],
          capabilityIds: [...base.capabilityIds],
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
      if (profile?.capabilityIds.includes(capabilityId)) return true
      const placement = placements.get(placementId)
      return capabilityId === DIGESTION_BUFF_TRADED_CAPABILITY_ID
        && placement !== undefined
        && hasSheetBoundCapabilityEffect({
          effects: input.effects ?? [],
          placement,
          capabilityId,
        })
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
