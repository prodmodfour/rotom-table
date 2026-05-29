import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

export const TRAINER_TEAM_LIMIT = 6

export type TrainerPokemonRosterKind = 'team' | 'box'

export interface ResolvedTrainerPokemonLink {
  slug: string
  sheet: CharacterSheet | null
  displayName: string
  species: string | null
  level: number | null
  spriteUrl: string | null
}

export interface TrainerPokemonBrowserEntry extends ResolvedTrainerPokemonLink {
  sheet: CharacterSheet
  folder: string
  linkedAs: TrainerPokemonRosterKind | null
  searchText: string
  sortKey: string
}

export interface ResolveTrainerPokemonLinksOptions {
  slugs?: readonly string[]
  pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  spriteUrlForSpecies: (species: string) => string | null
}

export interface BuildTrainerPokemonBrowserEntriesOptions {
  pokemonSheets: Iterable<CharacterSheet>
  currentTeam?: readonly string[]
  boxedPokemon?: readonly string[]
  spriteUrlForSpecies: (species: string) => string | null
  /** Player trainers should only browse player-owned Pokémon sheets. */
  playerOnly?: boolean
  /** Example/generated sheets should never appear in this linking browser. Defaults to true. */
  excludeExamples?: boolean
}

const normalizeSearchText = (value: string): string => value.trim().toLocaleLowerCase()

export const isExamplePokemonFolder = (folder: string | undefined): boolean => (
  (folder ?? '').split('/')[0]?.toLocaleLowerCase() === 'examples'
)

export const isTrainerPokemonBrowserCandidate = (
  sheet: CharacterSheet,
  options: Pick<BuildTrainerPokemonBrowserEntriesOptions, 'playerOnly' | 'excludeExamples'> = {},
): boolean => {
  if (options.excludeExamples !== false && isExamplePokemonFolder(sheet.folder)) return false
  if (options.playerOnly === true && sheet.player !== true) return false
  return true
}

export const normalizePokemonSlug = (slug: unknown): string => (
  typeof slug === 'string' ? slug.trim() : ''
)

export const normalizePokemonSlugList = (slugs?: readonly unknown[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of slugs ?? []) {
    const slug = normalizePokemonSlug(value)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }

  return out
}

const hasSlug = (list: readonly string[] | undefined, slug: string): boolean => (
  normalizePokemonSlugList(list).includes(slug)
)

const findSlugIndex = (list: readonly string[], slug: string): number => (
  list.findIndex((value) => normalizePokemonSlug(value) === slug)
)

const removeSlug = (list: string[], slug: string): boolean => {
  let removed = false
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (normalizePokemonSlug(list[i]) === slug) {
      list.splice(i, 1)
      removed = true
    }
  }
  return removed
}

const normalizeInsertIndex = (index: number | undefined, fallback: number, length: number): number => {
  if (index == null || !Number.isInteger(index)) return fallback
  return Math.min(Math.max(index, 0), length)
}

const ensureTeam = (sheet: TrainerSheet): string[] => {
  if (!Array.isArray(sheet.currentTeam)) sheet.currentTeam = []
  return sheet.currentTeam
}

const ensureBox = (sheet: TrainerSheet): string[] => {
  if (!Array.isArray(sheet.boxedPokemon)) sheet.boxedPokemon = []
  return sheet.boxedPokemon
}

export const trainerTeamSlotCount = (
  sheet: Pick<TrainerSheet, 'currentTeam'>,
): number => normalizePokemonSlugList(sheet.currentTeam).length

export const trainerTeamHasOpenSlot = (
  sheet: Pick<TrainerSheet, 'currentTeam'>,
  limit = TRAINER_TEAM_LIMIT,
): boolean => trainerTeamSlotCount(sheet) < limit

export const resolveTrainerPokemonLinks = ({
  slugs,
  pokemonBySlug,
  spriteUrlForSpecies,
}: ResolveTrainerPokemonLinksOptions): ResolvedTrainerPokemonLink[] => (
  normalizePokemonSlugList(slugs).map((slug): ResolvedTrainerPokemonLink => {
    const sheet = pokemonBySlug.get(slug) ?? null
    return {
      slug,
      sheet,
      displayName: sheet?.nickname ?? slug,
      species: sheet?.species ?? null,
      level: typeof sheet?.level === 'number' ? sheet.level : null,
      spriteUrl: sheet ? spriteUrlForSpecies(sheet.species) : null,
    }
  })
)

export const buildTrainerPokemonBrowserEntries = ({
  pokemonSheets,
  currentTeam,
  boxedPokemon,
  spriteUrlForSpecies,
  playerOnly = false,
  excludeExamples = true,
}: BuildTrainerPokemonBrowserEntriesOptions): TrainerPokemonBrowserEntry[] => {
  const teamSlugs = new Set(normalizePokemonSlugList(currentTeam))
  const boxSlugs = new Set(normalizePokemonSlugList(boxedPokemon))

  return Array.from(pokemonSheets)
    .filter((sheet) => isTrainerPokemonBrowserCandidate(sheet, { playerOnly, excludeExamples }))
    .map((sheet): TrainerPokemonBrowserEntry => {
      const linkedAs: TrainerPokemonRosterKind | null = teamSlugs.has(sheet.slug)
        ? 'team'
        : boxSlugs.has(sheet.slug)
          ? 'box'
          : null
      const folder = sheet.folder ?? ''
      const displayName = sheet.nickname
      const species = sheet.species
      const level = sheet.level
      const searchText = normalizeSearchText([
        displayName,
        species,
        sheet.slug,
        folder,
        `lv ${level}`,
        `level ${level}`,
      ].join(' '))

      return {
        slug: sheet.slug,
        sheet,
        folder,
        linkedAs,
        displayName,
        species,
        level,
        spriteUrl: spriteUrlForSpecies(species),
        searchText,
        sortKey: normalizeSearchText(`${displayName} ${species} ${sheet.slug}`),
      }
    })
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
}

export const filterTrainerPokemonBrowserEntries = (
  entries: readonly TrainerPokemonBrowserEntry[],
  query: string,
): TrainerPokemonBrowserEntry[] => {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return [...entries]
  return entries.filter((entry) => entry.searchText.includes(normalizedQuery))
}

export const addPokemonToTrainerTeam = (
  sheet: TrainerSheet,
  slugInput: string,
  limit = TRAINER_TEAM_LIMIT,
): boolean => {
  const slug = normalizePokemonSlug(slugInput)
  if (!slug) return false

  const team = ensureTeam(sheet)
  const box = ensureBox(sheet)
  if (hasSlug(team, slug)) return removeSlug(box, slug)
  if (!trainerTeamHasOpenSlot(sheet, limit)) return false

  removeSlug(box, slug)
  team.push(slug)
  return true
}

export const boxPokemonForTrainer = (sheet: TrainerSheet, slugInput: string): boolean => {
  const slug = normalizePokemonSlug(slugInput)
  if (!slug) return false

  const team = ensureTeam(sheet)
  const box = ensureBox(sheet)
  const removedFromTeam = removeSlug(team, slug)
  if (hasSlug(box, slug)) return removedFromTeam

  box.push(slug)
  return true
}

export const moveTrainerPokemonLink = (
  sheet: TrainerSheet,
  slugInput: string,
  targetRoster: TrainerPokemonRosterKind,
  targetIndex?: number,
  limit = TRAINER_TEAM_LIMIT,
): boolean => {
  const slug = normalizePokemonSlug(slugInput)
  if (!slug) return false

  const team = ensureTeam(sheet)
  const box = ensureBox(sheet)
  const sourceRoster: TrainerPokemonRosterKind | null = hasSlug(team, slug)
    ? 'team'
    : hasSlug(box, slug)
      ? 'box'
      : null
  if (!sourceRoster) return false
  if (targetRoster === 'team' && sourceRoster !== 'team' && !trainerTeamHasOpenSlot(sheet, limit)) {
    return false
  }

  const sourceList = sourceRoster === 'team' ? team : box
  const targetList = targetRoster === 'team' ? team : box
  const sourceIndex = findSlugIndex(sourceList, slug)
  let insertIndex = normalizeInsertIndex(targetIndex, targetList.length, targetList.length)
  if (sourceList === targetList && sourceIndex >= 0 && sourceIndex < insertIndex) insertIndex -= 1

  removeSlug(team, slug)
  removeSlug(box, slug)

  const updatedTargetList = targetRoster === 'team' ? team : box
  const boundedInsertIndex = normalizeInsertIndex(insertIndex, updatedTargetList.length, updatedTargetList.length)
  updatedTargetList.splice(boundedInsertIndex, 0, slug)
  return true
}

export const unlinkPokemonFromTrainer = (sheet: TrainerSheet, slugInput: string): boolean => {
  const slug = normalizePokemonSlug(slugInput)
  if (!slug) return false

  const removedFromTeam = removeSlug(ensureTeam(sheet), slug)
  const removedFromBox = removeSlug(ensureBox(sheet), slug)
  return removedFromTeam || removedFromBox
}
