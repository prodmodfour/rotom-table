import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { expectSheetKind, expectSlug } from '../../utils/http'
import { playerProfileCanAccessSheet, resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { getPlayerSessionAccessGrant, playerSessionCanAccessSheet } from '../../utils/sessionPlayerAccess'
import type { TrainerSheet } from '~/types/trainerSheet'
import { listSheetFilesWithFolders } from '../../utils/sheetStorage'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { loadSheetUseCase } from '../../useCases/loadSheet'

const markPlayerAccessibleSheet = <TSheet extends { player?: unknown }>(
  sheet: TSheet,
  options: { readonly sessionAccessible: boolean; readonly profileAccessible: boolean },
): TSheet => {
  if (!options.sessionAccessible && !options.profileAccessible) return sheet

  return {
    ...sheet,
    ...(options.sessionAccessible ? { sessionPlayerAccessible: true } : {}),
    ...(options.profileAccessible ? { playerProfileAccessible: true } : {}),
  } as TSheet
}

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  const kind = expectSheetKind(query.kind)
  const slug = expectSlug(query.slug)
  try {
    const sessionAccess = role === 'player' ? getPlayerSessionAccessGrant(event) : null
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    const sessionAccessible = playerSessionCanAccessSheet(sessionAccess, kind, slug)
    const linkedTrainerSheets = kind === 'pokemon'
      ? () => listSheetFilesWithFolders<TrainerSheet>('trainer')
      : undefined
    const profileAccessible = playerProfileCanAccessSheet(playerProfile, kind, slug, { linkedTrainerSheets })

    const result = loadSheetUseCase({
      role,
      kind,
      slug,
      playerProfile,
      canAccessPlayerSheet: (sheetKind, sheetSlug) => playerSessionCanAccessSheet(
        sessionAccess,
        sheetKind,
        sheetSlug,
      ),
    })

    return {
      ...result,
      sheet: role === 'player'
        ? markPlayerAccessibleSheet(result.sheet, { sessionAccessible, profileAccessible })
        : result.sheet,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
