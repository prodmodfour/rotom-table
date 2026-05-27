import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { requireNonProduction } from '../../utils/http'
import { getPlayerSessionAccessGrant, playerSessionCanAccessSheet } from '../../utils/sessionPlayerAccess'
import { listSheetsUseCase } from '../../useCases/listSheets'

const markSessionAccessibleSheet = <TSheet extends { slug: string; player?: unknown }>(
  sheet: TSheet,
  sessionAccessible: boolean,
): TSheet => (
  sheet.player === true || !sessionAccessible
    ? sheet
    : { ...sheet, sessionPlayerAccessible: true } as TSheet
)

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  if (role === 'gm') requireNonProduction()
  const sessionAccess = role === 'player' ? getPlayerSessionAccessGrant(event) : null
  const result = listSheetsUseCase({
    role,
    canAccessPlayerSheet: (kind, slug) => playerSessionCanAccessSheet(sessionAccess, kind, slug),
  })

  if (role !== 'player') return result

  return {
    pokemonSheets: result.pokemonSheets.map((sheet) => markSessionAccessibleSheet(
      sheet,
      playerSessionCanAccessSheet(sessionAccess, 'pokemon', sheet.slug),
    )),
    trainerSheets: result.trainerSheets.map((sheet) => markSessionAccessibleSheet(
      sheet,
      playerSessionCanAccessSheet(sessionAccess, 'trainer', sheet.slug),
    )),
  }
})
