import { linkedCharacterRefKey, type PlayerProfile } from '#shared/playerProfiles'
import type { SpawnedPokemon } from '~/types/pokemon'

export interface PlayerCharacterSheetAccessMarkers {
  /** Public sheet visibility alone does not make a token player-controlled. */
  readonly player?: boolean
  readonly playerProfileAccessible?: boolean
  readonly sessionPlayerAccessible?: boolean
}

export interface PlayerCharacterTokenLookup {
  readonly playerCharacterSheetKeys: ReadonlySet<string>
  readonly pokemonBySlug: ReadonlyMap<string, PlayerCharacterSheetAccessMarkers>
  readonly trainerBySlug: ReadonlyMap<string, PlayerCharacterSheetAccessMarkers>
}

export const playerCharacterSheetKeysForProfiles = (
  profiles: readonly Pick<PlayerProfile, 'linkedCharacters'>[],
): ReadonlySet<string> => new Set(
  profiles.flatMap((profile) => profile.linkedCharacters.map(linkedCharacterRefKey)),
)

export const playerCharacterSheetKeyForToken = (
  token: Pick<SpawnedPokemon, 'sheetKind' | 'sheetSlug'>,
): string => linkedCharacterRefKey({ sheetKind: token.sheetKind, sheetSlug: token.sheetSlug })

const sheetHasPlayerSpecificAccess = (
  sheet: PlayerCharacterSheetAccessMarkers | undefined,
): boolean => sheet?.playerProfileAccessible === true || sheet?.sessionPlayerAccessible === true

const accessMarkersForToken = (
  token: Pick<SpawnedPokemon, 'sheetKind' | 'sheetSlug'>,
  lookup: Pick<PlayerCharacterTokenLookup, 'pokemonBySlug' | 'trainerBySlug'>,
): PlayerCharacterSheetAccessMarkers | undefined => (
  token.sheetKind === 'pokemon'
    ? lookup.pokemonBySlug.get(token.sheetSlug)
    : lookup.trainerBySlug.get(token.sheetSlug)
)

export const isPlayerCharacterToken = (
  token: Pick<SpawnedPokemon, 'sheetKind' | 'sheetSlug'>,
  lookup: PlayerCharacterTokenLookup,
): boolean => (
  lookup.playerCharacterSheetKeys.has(playerCharacterSheetKeyForToken(token))
  || sheetHasPlayerSpecificAccess(accessMarkersForToken(token, lookup))
)

export const isPlayerCharacterAttackOfOpportunityPair = (
  input: PlayerCharacterTokenLookup & {
    readonly attacker: Pick<SpawnedPokemon, 'sheetKind' | 'sheetSlug'>
    readonly provoker: Pick<SpawnedPokemon, 'sheetKind' | 'sheetSlug'>
  },
): boolean => (
  isPlayerCharacterToken(input.attacker, input)
  && isPlayerCharacterToken(input.provoker, input)
)
