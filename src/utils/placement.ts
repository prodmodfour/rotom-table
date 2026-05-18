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
import { pokemonHeldItemNames, trainerEquippedItemNames } from '~/utils/sheetItemNames'
import {
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
} from '~/utils/tokenFacing'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface SheetLookup {
  pokemon: Map<string, CharacterSheet>
  trainer: Map<string, TrainerSheet>
}

const pokemonTokenAbilityNames = (sheet: CharacterSheet): string[] =>
  sheetAbilityNames(sheet.abilities)

const trainerTokenAbilityNames = (sheet: TrainerSheet): string[] =>
  sheetAbilityNames(sheet.abilities)


export const placementToSpawned = (
  placement: SheetPlacement,
  sheets: SheetLookup,
): SpawnedPokemon | null => {
  const facing = tokenFacingForPlacement(placement)
  const turned = tokenFacingStoresLegacyTurned(facing)

  if (placement.sheetKind === 'pokemon') {
    const sheet = sheets.pokemon.get(placement.sheetSlug)
    if (!sheet) return null
    const catalog = catalogEntryForPokemonSheet(sheet)
    if (!catalog) return null
    const hp = pokemonHpSnapshot(sheet)
    const abilityNames = pokemonTokenAbilityNames(sheet)
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
      ...(sheet.gender ? { gender: sheet.gender } : {}),
      currentHp: hp.currentHp,
      maxHp: hp.maxHp,
      atk: hp.atk,
      satk: hp.satk,
      def: hp.def,
      sdef: hp.sdef,
      spd: hp.spd,
      evasion: hp.evasion,
      defenderTypes: hp.defenderTypes,
      ...(hp.defenderCapabilities ? { defenderCapabilities: hp.defenderCapabilities } : {}),
      ...(abilityNames.length ? { abilityNames } : {}),
      combatSkillRankValue: hp.combatSkillRankValue,
      focusSkillRankValue: hp.focusSkillRankValue,
      combatStages: hp.combatStages,
      conditions: hp.conditions,
      tokenItems: pokemonHeldItemNames(sheet),
    }
  }
  const sheet = sheets.trainer.get(placement.sheetSlug)
  if (!sheet) return null
  const catalog = catalogEntryForTrainerSheet(sheet)
  if (!catalog) return null
  const hp = trainerHpSnapshot(sheet)
  const abilityNames = trainerTokenAbilityNames(sheet)
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
    ...(sheet.sex ? { gender: sheet.sex } : {}),
    currentHp: hp.currentHp,
    maxHp: hp.maxHp,
    atk: hp.atk,
    satk: hp.satk,
    def: hp.def,
    sdef: hp.sdef,
    spd: hp.spd,
    evasion: hp.evasion,
    defenderTypes: hp.defenderTypes,
    ...(hp.defenderCapabilities ? { defenderCapabilities: hp.defenderCapabilities } : {}),
    ...(abilityNames.length ? { abilityNames } : {}),
    combatSkillRankValue: hp.combatSkillRankValue,
    focusSkillRankValue: hp.focusSkillRankValue,
    combatStages: hp.combatStages,
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
    const spawned = placementToSpawned(placement, sheets)
    if (spawned) out.push(spawned)
  }
  return out
}

export const createPlacementId = (): string =>
  `pkm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
