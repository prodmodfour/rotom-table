import type { LinkedCharacterRef } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { sheetEditorPath } from '~/utils/sheetRoutes'
import { normalizePokemonSlugList, type TrainerPokemonRosterKind } from '~/utils/trainerPokemonLinks'

export interface PlayerTrainerPortalPokemon {
  slug: string
  sheet: CharacterSheet | null
  displayName: string
  species: string | null
  level: number | null
  spriteUrl: string | null
  path: string | null
  roster: TrainerPokemonRosterKind | 'other'
}

export interface PlayerTrainerPortalTrainer {
  slug: string
  sheet: TrainerSheet
  displayName: string
  level: number
  spriteUrl: string | null
  path: string
  team: PlayerTrainerPortalPokemon[]
  box: PlayerTrainerPortalPokemon[]
}

export interface PlayerTrainerPortalModel {
  trainers: PlayerTrainerPortalTrainer[]
  otherPokemon: PlayerTrainerPortalPokemon[]
}

export interface BuildPlayerTrainerPortalOptions {
  trainerSheets: readonly TrainerSheet[]
  pokemonSheets: readonly CharacterSheet[]
  linkedCharacters?: readonly LinkedCharacterRef[]
  spriteUrlForSpecies: (species: string) => string | null
}

const comparePortalPokemon = (
  left: PlayerTrainerPortalPokemon,
  right: PlayerTrainerPortalPokemon,
): number => left.displayName.localeCompare(right.displayName) || left.slug.localeCompare(right.slug)

const comparePortalTrainers = (
  left: PlayerTrainerPortalTrainer,
  right: PlayerTrainerPortalTrainer,
): number => left.displayName.localeCompare(right.displayName) || left.slug.localeCompare(right.slug)

const linkedSlugsForKind = (
  linkedCharacters: readonly LinkedCharacterRef[],
  kind: 'pokemon' | 'trainer',
): Set<string> => new Set(
  linkedCharacters
    .filter((ref) => ref.sheetKind === kind)
    .map((ref) => ref.sheetSlug),
)

const sheetIsProfileAccessible = (
  sheet: { playerProfileAccessible?: unknown },
): boolean => sheet.playerProfileAccessible === true

const resolvePokemon = (
  slug: string,
  roster: PlayerTrainerPortalPokemon['roster'],
  pokemonBySlug: ReadonlyMap<string, CharacterSheet>,
  spriteUrlForSpecies: (species: string) => string | null,
): PlayerTrainerPortalPokemon => {
  const sheet = pokemonBySlug.get(slug) ?? null
  return {
    slug,
    sheet,
    displayName: sheet?.nickname ?? slug,
    species: sheet?.species ?? null,
    level: typeof sheet?.level === 'number' ? sheet.level : null,
    spriteUrl: sheet ? spriteUrlForSpecies(sheet.species) : null,
    path: sheet ? sheetEditorPath('pokemon', sheet.slug) : null,
    roster,
  }
}

export const buildPlayerTrainerPortal = ({
  trainerSheets,
  pokemonSheets,
  linkedCharacters = [],
  spriteUrlForSpecies,
}: BuildPlayerTrainerPortalOptions): PlayerTrainerPortalModel => {
  const linkedTrainerSlugs = linkedSlugsForKind(linkedCharacters, 'trainer')
  const linkedPokemonSlugs = linkedSlugsForKind(linkedCharacters, 'pokemon')
  const hasLoadedLinkedCharacters = linkedCharacters.length > 0
  const pokemonBySlug = new Map(pokemonSheets.map((sheet) => [sheet.slug, sheet]))
  const rosterPokemonSlugs = new Set<string>()

  const trainers = trainerSheets
    .filter((sheet) => (
      linkedTrainerSlugs.has(sheet.slug)
      || (!hasLoadedLinkedCharacters && sheetIsProfileAccessible(sheet))
    ))
    .map((sheet): PlayerTrainerPortalTrainer => {
      const teamSlugs = normalizePokemonSlugList(sheet.currentTeam)
      const teamSlugSet = new Set(teamSlugs)
      const boxSlugs = normalizePokemonSlugList(sheet.boxedPokemon)
        .filter((slug) => !teamSlugSet.has(slug))

      for (const slug of [...teamSlugs, ...boxSlugs]) rosterPokemonSlugs.add(slug)

      return {
        slug: sheet.slug,
        sheet,
        displayName: sheet.name || sheet.slug,
        level: sheet.level,
        spriteUrl: sheet.portraitUrl ?? null,
        path: sheetEditorPath('trainer', sheet.slug),
        team: teamSlugs.map((slug) => resolvePokemon(slug, 'team', pokemonBySlug, spriteUrlForSpecies)),
        box: boxSlugs.map((slug) => resolvePokemon(slug, 'box', pokemonBySlug, spriteUrlForSpecies)),
      }
    })
    .sort(comparePortalTrainers)

  const otherLinkedPokemonSlugs = hasLoadedLinkedCharacters
    ? [...linkedPokemonSlugs]
    : pokemonSheets.filter(sheetIsProfileAccessible).map((sheet) => sheet.slug)

  const otherPokemon = otherLinkedPokemonSlugs
    .filter((slug) => !rosterPokemonSlugs.has(slug))
    .map((slug) => resolvePokemon(slug, 'other', pokemonBySlug, spriteUrlForSpecies))
    .sort(comparePortalPokemon)

  return { trainers, otherPokemon }
}
