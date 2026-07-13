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
import { projectEffectiveMovement } from '~/utils/encounterMovement'
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
  'activeScene' | 'temporaryHitPoints' | 'encounterState'
>

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
) => projectEffectiveMovement({
  sheetCapabilities: movementCapabilities,
  sheetTraits: movementTraits,
  sheetConditions: conditions,
  encounterEffects: map?.encounterState?.effects,
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

export const placementToSpawned = (
  placement: SheetPlacement,
  sheets: SheetLookup,
  map?: PlacementConditionMap | null,
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
    )
    const defenderCapabilities = defenderCapabilitiesForMovement(movement)
    const abilityNames = pokemonTokenAbilityNames(sheet)
    const accentColor = trainerAccentColorForPokemonSlug(sheets.trainer.values(), sheet.slug)
    return {
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
  )
  const defenderCapabilities = defenderCapabilitiesForMovement(movement)
  const abilityNames = trainerTokenAbilityNames(sheet)
  const accentColor = normalizeTrainerAccentColor(sheet.accentColor)
  return {
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
  return out
}

export const createPlacementId = (): string =>
  `pkm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
