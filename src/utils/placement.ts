/**
 * Helpers for turning a `SheetPlacement` (which only stores a sheet
 * reference + map-local data) into a fully-populated `SpawnedPokemon`
 * the renderer can consume.
 *
 * The conversion pulls the sprite, footprint, name, and HP from the
 * referenced sheet at render time, so any sheet edit (HP loss, sprite
 * change, etc.) automatically propagates to every map showing that
 * sheet.
 */
import {
  catalogEntryForPokemonSheet,
  catalogEntryForTrainerSheet,
  pokemonHpSnapshot,
  trainerHpSnapshot,
} from '~/utils/sheetSpawn'
import { sheetAbilityNames } from '~/utils/sheetAbilities'
import { deriveTrainerAutomaticAbilities } from '~/utils/sheets/trainerCombatDerivations'
import { pokemonHeldItemNames, trainerEquippedItemNames } from '~/utils/sheetItemNames'
import { normalizeTrainerAccentColor, trainerAccentColorForPokemonSlug } from '~/utils/trainerAccent'
import {
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
} from '~/utils/tokenFacing'
import { temporaryHpForPlacement } from '~/utils/mapTemporaryHitPoints'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import { projectEncounterCreatureRuleToken } from '~/utils/encounterCreatureRules'
import { projectEffectiveMovement } from '~/utils/encounterMovement'
import { projectEncounterTransformationToken } from '~/utils/encounterTransformations'
import { projectEncounterIllusionAppearances } from '~/utils/encounterIllusions'
import { resolvePokemonRuleCapabilityProjection } from '~/utils/pokemonRuleCapabilities'
import { projectNativeAbilityTokenStats } from '~/utils/nativeAbilityTokenStats'
import {
  pokemonSheetConditionNames,
  trainerSheetConditionNames,
} from '~/utils/sheetConditions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface SheetLookup {
  pokemon: Map<string, CharacterSheet>
  trainer: Map<string, TrainerSheet>
}

type PlacementConditionMap = Pick<
  TabletopMap,
  'activeScene' | 'temporaryHitPoints' | 'encounterState' | 'metadata'
>

const projectCapabilityPresentationToken = (
  token: SpawnedPokemon,
  map: PlacementConditionMap | null | undefined,
): SpawnedPokemon => {
  const states = Array.isArray(map?.metadata?.automationPresentationStates)
    ? map.metadata.automationPresentationStates.flatMap((raw): readonly Record<string, unknown>[] => (
        raw && typeof raw === 'object' && !Array.isArray(raw)
          && (raw as Record<string, unknown>).placementId === token.id
          ? [raw as Record<string, unknown>] : []
      )) : []
  const has = (state: string): boolean => states.some(entry => entry.state === state)
  const described = (state: string): string | null => {
    const description = states.find(entry => entry.state === state)?.description
    return typeof description === 'string' && description.trim() && description.length <= 240
      ? description.trim() : null
  }
  if (states.length === 0) return token
  const scale = has('inflated') ? 1.25 : has('shrunken') ? 0.25 : 1
  const shape = described('shapechanged')
  const zygarde = described('zygarde-form')
  const weatherForm = described('weather-form')
  return {
    ...token,
    ...(shape ? { species: shape }
      : zygarde ? { species: zygarde === '10-percent' ? 'Zygarde 10% Forme' : 'Zygarde 50% Forme' }
        : weatherForm ? { species: weatherForm } : {}),
    width: Math.max(0.05, token.width * scale),
    height: Math.max(0.05, token.height * scale),
    base: Math.max(1, Math.ceil(token.base * scale)),
    clearance: has('shadow-melded') ? 1 : Math.max(1, Math.ceil(token.clearance * scale)),
  }
}

const effectiveConditionsForPlacement = (
  placement: SheetPlacement,
  footprint: { readonly base: number; readonly clearance: number },
  sheetConditions: readonly string[],
  map: PlacementConditionMap | null | undefined,
): readonly string[] => projectEffectiveConditions({
  sheetConditions,
  encounterEffects: map?.encounterState?.effects,
  target: {
    placementId: placement.id,
    ...(placement.sideId === undefined ? {} : { sideId: placement.sideId }),
    position: placement.position,
    base: footprint.base,
    clearance: footprint.clearance,
  },
}).conditions

const effectiveMovementForPlacement = (
  placement: SheetPlacement,
  footprint: { readonly base: number; readonly clearance: number },
  movementCapabilities: NonNullable<SpawnedPokemon['movementCapabilities']>,
  movementTraits: NonNullable<SpawnedPokemon['movementTraits']>,
  conditions: readonly string[],
  map: PlacementConditionMap | null | undefined,
  deferEncounterMovementProjection = false,
) => projectEffectiveMovement({
  sheetCapabilities: movementCapabilities,
  sheetTraits: movementTraits,
  sheetConditions: conditions,
  encounterEffects: deferEncounterMovementProjection ? [] : map?.encounterState?.effects,
  target: {
    placementId: placement.id,
    ...(placement.sideId === undefined ? {} : { sideId: placement.sideId }),
    position: placement.position,
    base: footprint.base,
    clearance: footprint.clearance,
  },
})

const defenderCapabilitiesForMovement = (
  movement: ReturnType<typeof effectiveMovementForPlacement>,
): Pick<NonNullable<SpawnedPokemon['defenderCapabilities']>, 'sky' | 'levitate'> | undefined => {
  const sky = movement.speeds.sky
  const levitate = movement.speeds.levitate
  return (sky ?? 0) > 0 || (levitate ?? 0) > 0
    ? {
        ...((sky ?? 0) > 0 ? { sky } : {}),
        ...((levitate ?? 0) > 0 ? { levitate } : {}),
      }
    : undefined
}

export type UnresolvedPlacementReason = 'missing-sheet' | 'missing-catalog'

export interface UnresolvedPlacementReference {
  id: string
  sheetKind: SheetPlacement['sheetKind']
  sheetSlug: string
  reason: UnresolvedPlacementReason
}

const pokemonTokenAbilityNames = (sheet: CharacterSheet): string[] =>
  sheetAbilityNames(sheet.abilities)

const trainerTokenAbilityNames = (sheet: TrainerSheet): string[] =>
  sheetAbilityNames([
    ...deriveTrainerAutomaticAbilities(sheet).map((ability) => ability.entry),
    ...(sheet.abilities ?? []),
  ])

const unresolvedReferenceForPlacement = (
  placement: SheetPlacement,
  sheets: SheetLookup,
): UnresolvedPlacementReference | null => {
  if (placement.sheetKind === 'pokemon') {
    const sheet = sheets.pokemon.get(placement.sheetSlug)
    if (!sheet) {
      return {
        id: placement.id,
        sheetKind: placement.sheetKind,
        sheetSlug: placement.sheetSlug,
        reason: 'missing-sheet',
      }
    }
    if (!catalogEntryForPokemonSheet(sheet)) {
      return {
        id: placement.id,
        sheetKind: placement.sheetKind,
        sheetSlug: placement.sheetSlug,
        reason: 'missing-catalog',
      }
    }
    return null
  }

  const sheet = sheets.trainer.get(placement.sheetSlug)
  if (!sheet) {
    return {
      id: placement.id,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      reason: 'missing-sheet',
    }
  }
  if (!catalogEntryForTrainerSheet(sheet)) {
    return {
      id: placement.id,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      reason: 'missing-catalog',
    }
  }
  return null
}

export const unresolvedPlacementReferences = (
  map: TabletopMap | null,
  sheets: SheetLookup,
): UnresolvedPlacementReference[] => {
  if (!map) return []
  const out: UnresolvedPlacementReference[] = []
  for (const placement of map.placements) {
    const unresolved = unresolvedReferenceForPlacement(placement, sheets)
    if (unresolved) out.push(unresolved)
  }
  return out
}

export interface PlacementSpawnOptions {
  /** AA-077 is projected from exact effective abilities by authoritative callers. */
  readonly skipAa077NativeProjection?: boolean
  /** Defer generic typed movement effects so authoritative static providers run first. */
  readonly deferEncounterMovementProjection?: boolean
}

export const placementToSpawned = (
  placement: SheetPlacement,
  sheets: SheetLookup,
  map?: PlacementConditionMap | null,
  options: PlacementSpawnOptions = {},
): SpawnedPokemon | null => {
  const temporaryHp = temporaryHpForPlacement(map, placement.id)
  const facing = tokenFacingForPlacement(placement)
  const turned = tokenFacingStoresLegacyTurned(facing)

  if (placement.sheetKind === 'pokemon') {
    const sheet = sheets.pokemon.get(placement.sheetSlug)
    if (!sheet) return null
    const catalog = catalogEntryForPokemonSheet(sheet)
    if (!catalog) return null
    const sheetConditions = pokemonSheetConditionNames(sheet)
    const conditions = effectiveConditionsForPlacement(
      placement,
      catalog,
      sheetConditions,
      map,
    )
    const hp = pokemonHpSnapshot(sheet, { conditions })
    const movement = effectiveMovementForPlacement(
      placement,
      catalog,
      hp.movementCapabilities,
      hp.movementTraits,
      hp.conditions,
      map,
      options.deferEncounterMovementProjection,
    )
    const defenderCapabilities = defenderCapabilitiesForMovement(movement)
    const abilityNames = pokemonTokenAbilityNames(sheet)
    const accentColor = trainerAccentColorForPokemonSlug(sheets.trainer.values(), sheet.slug)
    const ruleCapabilities = resolvePokemonRuleCapabilityProjection({
      sheet,
      movementSpeeds: movement.speeds,
      movementTraits: movement.traits,
    })
    const baseToken: SpawnedPokemon = {
      ...catalog,
      species: sheet.nickname,
      id: placement.id,
      position: placement.position,
      facing,
      turned,
      sheetKind: 'pokemon',
      sheetSlug: sheet.slug,
      level: sheet.level,
      ...(typeof sheet.totalExp === 'number' ? { totalExp: sheet.totalExp } : {}),
      ...(accentColor ? { accentColor } : {}),
      ...(sheet.gender ? { gender: sheet.gender } : {}),
      ...(hp.loyalty != null ? { loyalty: hp.loyalty } : {}),
      currentHp: hp.currentHp,
      ...(temporaryHp > 0 ? { temporaryHp } : {}),
      maxHp: hp.maxHp,
      fullMaxHp: hp.fullMaxHp,
      injuries: hp.injuries,
      atk: hp.atk,
      satk: hp.satk,
      def: hp.def,
      sdef: hp.sdef,
      spd: hp.spd,
      evasion: hp.evasion,
      ...(hp.activeTrainingFeature ? { activeTrainingFeature: hp.activeTrainingFeature } : {}),
      ...(hp.accuracyRollBonus ? { accuracyRollBonus: hp.accuracyRollBonus } : {}),
      defenderTypes: hp.defenderTypes,
      ...(ruleCapabilities.weightClass === null
        ? {}
        : { weightClass: ruleCapabilities.weightClass }),
      ruleCapabilities: ruleCapabilities.capabilities,
      movementCapabilities: movement.speeds,
      movementTraits: movement.traits,
      movementProfile: movement,
      ...(defenderCapabilities ? { defenderCapabilities } : {}),
      ...(abilityNames.length ? { abilityNames } : {}),
      combatSkillRankValue: hp.combatSkillRankValue,
      focusSkillRankValue: hp.focusSkillRankValue,
      combatStages: hp.combatStages,
      sheetConditions,
      conditions: hp.conditions,
      tokenItems: pokemonHeldItemNames(sheet),
    }
    const transformedToken = projectEncounterTransformationToken({
      placement,
      token: baseToken,
      effects: map?.encounterState?.effects,
      deferEncounterMovementProjection: options.deferEncounterMovementProjection,
    })
    return projectCapabilityPresentationToken(projectNativeAbilityTokenStats(projectEncounterCreatureRuleToken({
      placement,
      token: transformedToken,
      effects: map?.encounterState?.effects,
      baseFormSpecies: sheet.species,
      forceProfile: true,
    }), sheet, options), map)
  }
  const sheet = sheets.trainer.get(placement.sheetSlug)
  if (!sheet) return null
  const catalog = catalogEntryForTrainerSheet(sheet)
  if (!catalog) return null
  const sheetConditions = trainerSheetConditionNames(sheet)
  const conditions = effectiveConditionsForPlacement(
    placement,
    catalog,
    sheetConditions,
    map,
  )
  const hp = trainerHpSnapshot(sheet, { conditions })
  const movement = effectiveMovementForPlacement(
    placement,
    catalog,
    hp.movementCapabilities,
    hp.movementTraits,
    hp.conditions,
    map,
    options.deferEncounterMovementProjection,
  )
  const defenderCapabilities = defenderCapabilitiesForMovement(movement)
  const abilityNames = trainerTokenAbilityNames(sheet)
  const accentColor = normalizeTrainerAccentColor(sheet.accentColor)
  const baseToken: SpawnedPokemon = {
    ...catalog,
    species: sheet.name,
    id: placement.id,
    position: placement.position,
    facing,
    turned,
    sheetKind: 'trainer',
    sheetSlug: sheet.slug,
    level: sheet.level,
    ...(accentColor ? { accentColor } : {}),
    ...(sheet.sex ? { gender: sheet.sex } : {}),
    currentHp: hp.currentHp,
    ...(temporaryHp > 0 ? { temporaryHp } : {}),
    maxHp: hp.maxHp,
    fullMaxHp: hp.fullMaxHp,
    injuries: hp.injuries,
    atk: hp.atk,
    satk: hp.satk,
    def: hp.def,
    sdef: hp.sdef,
    spd: hp.spd,
    evasion: hp.evasion,
    defenderTypes: hp.defenderTypes,
    movementCapabilities: movement.speeds,
    movementTraits: movement.traits,
    movementProfile: movement,
    ...(defenderCapabilities ? { defenderCapabilities } : {}),
    ...(abilityNames.length ? { abilityNames } : {}),
    combatSkillRankValue: hp.combatSkillRankValue,
    focusSkillRankValue: hp.focusSkillRankValue,
    combatStages: hp.combatStages,
    sheetConditions,
    conditions: hp.conditions,
    tokenItems: trainerEquippedItemNames(sheet),
  }
  return projectCapabilityPresentationToken(projectNativeAbilityTokenStats(projectEncounterCreatureRuleToken({
    placement,
    token: baseToken,
    effects: map?.encounterState?.effects,
    forceProfile: true,
  }), sheet, options), map)
}

export const placementsToSpawned = (
  map: TabletopMap | null,
  sheets: SheetLookup,
): SpawnedPokemon[] => {
  if (!map) return []
  const out: SpawnedPokemon[] = []
  for (const placement of map.placements) {
    const spawned = placementToSpawned(placement, sheets, map)
    if (spawned) out.push(spawned)
  }
  return projectEncounterIllusionAppearances({ tokens: out, map })
}

export const createPlacementId = (): string =>
  `pkm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
