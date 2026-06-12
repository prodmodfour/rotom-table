import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { parsePlayerProfileId, type PlayerProfileId } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { ApiGetOptions, ApiRequestParams } from '~/utils/apiClient'

export const PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE =
  'Choose a player profile before opening or saving linked character sheets.'

export const PLAYER_PROFILE_INVALID_FOR_SHEET_REQUEST_MESSAGE =
  'The selected player profile could not be used. Choose a player profile again.'

export interface SheetApiProfileContext {
  readonly isPlayer: boolean
  readonly selectedProfileId?: unknown
}

export interface BuildSheetLoadQueryOptions {
  readonly kind: SheetKind
  readonly slug: string
  readonly profileContext?: SheetApiProfileContext
}

export interface BuildSheetSaveBodyOptions {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: unknown
  readonly clientId?: string
  readonly profileContext?: SheetApiProfileContext
  readonly requireSelectedPlayerProfile?: boolean
  /** When false, the save route must not rename the sheet resource from its display name. */
  readonly allowSlugSync?: boolean
}

export const sheetApiProfileContext = (
  isPlayer: boolean,
  selectedProfileId: unknown,
): SheetApiProfileContext => ({ isPlayer, selectedProfileId })

const hasProfileIdValue = (value: unknown): boolean => (
  value !== undefined && value !== null && value !== ''
)

export const selectedPlayerProfileIdForSheetRequest = (
  context: SheetApiProfileContext | null | undefined,
): PlayerProfileId | undefined => {
  if (context?.isPlayer !== true) return undefined
  if (!hasProfileIdValue(context.selectedProfileId)) return undefined

  try {
    return parsePlayerProfileId(context.selectedProfileId)
  } catch {
    throw new Error(PLAYER_PROFILE_INVALID_FOR_SHEET_REQUEST_MESSAGE)
  }
}

export const requireSelectedPlayerProfileIdForSheetRequest = (
  context: SheetApiProfileContext | null | undefined,
): PlayerProfileId => {
  const profileId = selectedPlayerProfileIdForSheetRequest(context)
  if (profileId) return profileId
  throw new Error(PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE)
}

const withSelectedProfileParam = <TParams extends ApiRequestParams>(
  params: TParams,
  context: SheetApiProfileContext | null | undefined,
): TParams & { profileId?: PlayerProfileId } => {
  const profileId = selectedPlayerProfileIdForSheetRequest(context)
  return profileId ? { ...params, profileId } : params
}

export const buildSheetLoadQuery = (
  options: BuildSheetLoadQueryOptions,
): ApiRequestParams => withSelectedProfileParam({ kind: options.kind, slug: options.slug }, options.profileContext)

export const buildSheetListFetchOptions = (
  context: SheetApiProfileContext | null | undefined,
): ApiGetOptions | undefined => {
  const profileId = selectedPlayerProfileIdForSheetRequest(context)
  return profileId ? { params: { profileId } } : undefined
}

export const buildSheetSaveBody = (
  options: BuildSheetSaveBodyOptions,
): Record<string, unknown> => {
  const profileId = options.requireSelectedPlayerProfile === true
    ? requireSelectedPlayerProfileIdForSheetRequest(options.profileContext)
    : selectedPlayerProfileIdForSheetRequest(options.profileContext)

  return {
    kind: options.kind,
    slug: options.slug,
    sheet: options.sheet,
    interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
    ...(options.clientId ? { clientId: options.clientId } : {}),
    ...(profileId ? { profileId } : {}),
    ...(options.allowSlugSync === false ? { allowSlugSync: false } : {}),
  }
}
