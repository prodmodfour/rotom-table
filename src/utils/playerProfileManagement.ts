import type { LinkedCharacterRef, PlayerProfile } from '#shared/playerProfiles'
import { linkedCharacterRefKey } from '#shared/playerProfiles'
import { sheetEditorPath, sheetKindLabel } from '~/utils/sheetRoutes'

export const PLAYER_PROFILE_MANAGEMENT_EMPTY_TEXT =
  'No player profiles exist yet. Players can create one from Player Login.'
export const PLAYER_PROFILE_MANAGEMENT_NO_SELECTION_TEXT =
  'Select a player profile to review its linked characters.'
export const PLAYER_PROFILE_MANAGEMENT_NO_LINKS_TEXT =
  'No linked characters yet. This profile currently controls no character sheets.'

export interface LinkedCharacterManagementView {
  readonly key: string
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

export const playerProfileLinkedCharacterLabel = (ref: LinkedCharacterRef): string =>
  `${sheetKindLabel(ref.sheetKind)} sheet · ${ref.sheetSlug}`

export const buildLinkedCharacterManagementView = (
  ref: LinkedCharacterRef,
): LinkedCharacterManagementView => ({
  key: linkedCharacterRefKey(ref),
  label: playerProfileLinkedCharacterLabel(ref),
  kindLabel: sheetKindLabel(ref.sheetKind),
  sheetSlug: ref.sheetSlug,
  href: sheetEditorPath(ref.sheetKind, ref.sheetSlug),
})

export const buildPlayerProfileManagementDetail = (
  profile: PlayerProfile | null | undefined,
): PlayerProfileManagementDetail | null => {
  if (!profile) return null

  return {
    id: profile.id,
    displayName: profile.displayName,
    linkedCharacterCountLabel: playerProfileLinkedCharacterCountLabel(profile.linkedCharacters.length),
    linkedCharacters: profile.linkedCharacters.map(buildLinkedCharacterManagementView),
  }
}
