import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { requireNonProduction } from '../../utils/http'
import { playerProfileCanAccessSheet, resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { getPlayerSessionAccessGrant, playerSessionCanAccessSheet } from '../../utils/sessionPlayerAccess'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { listSheetsUseCase } from '../../useCases/listSheets'

const markPlayerAccessibleSheet = <TSheet extends { slug: string; player?: unknown }>(
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
  if (role === 'gm') requireNonProduction()
  try {
    const query = getQuery(event)
    const sessionAccess = role === 'player' ? getPlayerSessionAccessGrant(event) : null
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    const result = listSheetsUseCase({
      role,
      playerProfile,
      canAccessPlayerSheet: (kind, slug) => playerSessionCanAccessSheet(sessionAccess, kind, slug),
    })

    if (role !== 'player') return result

    const linkedTrainerSheets = result.trainerSheets

    return {
      pokemonSheets: result.pokemonSheets.map((sheet) => markPlayerAccessibleSheet(
        sheet,
        {
          sessionAccessible: playerSessionCanAccessSheet(sessionAccess, 'pokemon', sheet.slug),
          profileAccessible: playerProfileCanAccessSheet(playerProfile, 'pokemon', sheet.slug, { linkedTrainerSheets }),
        },
      )),
      trainerSheets: result.trainerSheets.map((sheet) => markPlayerAccessibleSheet(
        sheet,
        {
          sessionAccessible: playerSessionCanAccessSheet(sessionAccess, 'trainer', sheet.slug),
          profileAccessible: playerProfileCanAccessSheet(playerProfile, 'trainer', sheet.slug, { linkedTrainerSheets }),
        },
      )),
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
