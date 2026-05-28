import type { LinkedCharacterRef, PlayerProfile } from '#shared/playerProfiles'
import {
  linkedCharacterRefKey,
  normalizeLinkedCharacterRef,
} from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { sheetEditorPath, sheetKindLabel } from '~/utils/sheetRoutes'

export const PLAYER_PROFILE_MANAGEMENT_EMPTY_TEXT =
  'No player profiles exist yet. Players can create one from Player Login.'
export const PLAYER_PROFILE_MANAGEMENT_NO_SELECTION_TEXT =
  'Select a player profile to review its linked characters.'
export const PLAYER_PROFILE_MANAGEMENT_NO_LINKS_TEXT =
  'No linked characters yet. This profile currently controls no character sheets.'

export interface LinkablePokemonSheetSummary {
  readonly slug: string
  readonly nickname?: string
  readonly species?: string
  readonly folder?: string
}

export interface LinkableTrainerSheetSummary {
  readonly slug: string
  readonly name?: string
  readonly folder?: string
}

export interface LinkableCharacterSheetOption {
  readonly key: string
  readonly ref: LinkedCharacterRef
  readonly label: string
  readonly detailsLabel: string
  readonly displayName: string
  readonly kindLabel: string
  readonly sheetSlug: string
  readonly folder: string
  readonly href: string
}

export interface LinkedCharacterManagementView {
  readonly key: string
  readonly ref: LinkedCharacterRef
  readonly label: string
  readonly kindLabel: string
  readonly sheetSlug: string
  readonly href: string
}

export interface PlayerProfileManagementDetail {
  readonly id: string
  readonly displayName: string
  readonly linkedCharacterCountLabel: string
  readonly linkedCharacters: readonly LinkedCharacterManagementView[]
}

export const playerProfileLinkedCharacterCountLabel = (count: number): string => (
  count === 1 ? '1 linked character' : `${count} linked characters`
)

const normalizeDisplayText = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

const folderSuffix = (folder: string): string => (folder.length > 0 ? ` · ${folder}` : '')

export const buildLinkableCharacterSheetOptions = ({
  pokemonSheets,
  trainerSheets,
}: {
  pokemonSheets: ReadonlyArray<LinkablePokemonSheetSummary | CharacterSheet>
  trainerSheets: ReadonlyArray<LinkableTrainerSheetSummary | TrainerSheet>
}): LinkableCharacterSheetOption[] => {
  const options: LinkableCharacterSheetOption[] = []

  for (const sheet of pokemonSheets) {
    const ref = normalizeLinkedCharacterRef({ sheetKind: 'pokemon', sheetSlug: sheet.slug })
    const displayName = normalizeDisplayText(sheet.nickname, sheet.slug)
    const species = normalizeDisplayText(sheet.species, '')
    const folder = normalizeDisplayText(sheet.folder, '')
    const kindLabel = sheetKindLabel(ref.sheetKind)
    const speciesSuffix = species && species !== displayName ? ` · ${species}` : ''
    options.push({
      key: linkedCharacterRefKey(ref),
      ref,
      label: `${displayName} · ${kindLabel} sheet`,
      detailsLabel: `${ref.sheetSlug}${speciesSuffix}${folderSuffix(folder)}`,
      displayName,
      kindLabel,
      sheetSlug: ref.sheetSlug,
      folder,
      href: sheetEditorPath(ref.sheetKind, ref.sheetSlug),
    })
  }

  for (const sheet of trainerSheets) {
    const ref = normalizeLinkedCharacterRef({ sheetKind: 'trainer', sheetSlug: sheet.slug })
    const displayName = normalizeDisplayText(sheet.name, sheet.slug)
    const folder = normalizeDisplayText(sheet.folder, '')
    const kindLabel = sheetKindLabel(ref.sheetKind)
    options.push({
      key: linkedCharacterRefKey(ref),
      ref,
      label: `${displayName} · ${kindLabel} sheet`,
      detailsLabel: `${ref.sheetSlug}${folderSuffix(folder)}`,
      displayName,
      kindLabel,
      sheetSlug: ref.sheetSlug,
      folder,
      href: sheetEditorPath(ref.sheetKind, ref.sheetSlug),
    })
  }

  return options.sort((left, right) => {
    const labelOrder = left.label.localeCompare(right.label)
    if (labelOrder !== 0) return labelOrder
    return left.key.localeCompare(right.key)
  })
}

export const linkableCharacterOptionByKey = (
  options: ReadonlyArray<LinkableCharacterSheetOption>,
  key: string,
): LinkableCharacterSheetOption | null => (
  options.find((option) => option.key === key) ?? null
)

export const filterAvailableLinkableCharacterOptions = (
  options: ReadonlyArray<LinkableCharacterSheetOption>,
  linkedCharacters: readonly LinkedCharacterRef[],
): LinkableCharacterSheetOption[] => {
  const linkedKeys = new Set(linkedCharacters.map(linkedCharacterRefKey))
  return options.filter((option) => !linkedKeys.has(option.key))
}

export const playerProfileLinkedCharacterLabel = (
  ref: LinkedCharacterRef,
  options: ReadonlyArray<LinkableCharacterSheetOption> = [],
): string => {
  const option = linkableCharacterOptionByKey(options, linkedCharacterRefKey(ref))
  return option ? option.label : `${sheetKindLabel(ref.sheetKind)} sheet · ${ref.sheetSlug}`
}

export const buildLinkedCharacterManagementView = (
  ref: LinkedCharacterRef,
  options: ReadonlyArray<LinkableCharacterSheetOption> = [],
): LinkedCharacterManagementView => ({
  key: linkedCharacterRefKey(ref),
  ref,
  label: playerProfileLinkedCharacterLabel(ref, options),
  kindLabel: sheetKindLabel(ref.sheetKind),
  sheetSlug: ref.sheetSlug,
  href: sheetEditorPath(ref.sheetKind, ref.sheetSlug),
})

export const buildPlayerProfileManagementDetail = (
  profile: PlayerProfile | null | undefined,
  options: ReadonlyArray<LinkableCharacterSheetOption> = [],
): PlayerProfileManagementDetail | null => {
  if (!profile) return null

  return {
    id: profile.id,
    displayName: profile.displayName,
    linkedCharacterCountLabel: playerProfileLinkedCharacterCountLabel(profile.linkedCharacters.length),
    linkedCharacters: profile.linkedCharacters.map((ref) => buildLinkedCharacterManagementView(ref, options)),
  }
}
