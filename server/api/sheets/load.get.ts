import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { expectSheetKind, expectSlug, requireNonProduction } from '../../utils/http'
import { getPlayerSessionAccessGrant, playerSessionCanAccessSheet } from '../../utils/sessionPlayerAccess'
import { loadSheetUseCase } from '../../useCases/loadSheet'

const markSessionAccessibleSheet = <TSheet extends { player?: unknown }>(
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

  const query = getQuery(event)
  const kind = expectSheetKind(query.kind)
  const slug = expectSlug(query.slug)
  const sessionAccess = role === 'player' ? getPlayerSessionAccessGrant(event) : null
  const sessionAccessible = playerSessionCanAccessSheet(sessionAccess, kind, slug)

  const result = loadSheetUseCase({
    role,
    kind,
    slug,
    canAccessPlayerSheet: (sheetKind, sheetSlug) => playerSessionCanAccessSheet(
      sessionAccess,
      sheetKind,
      sheetSlug,
    ),
  })

  return {
    ...result,
    sheet: role === 'player'
      ? markSessionAccessibleSheet(result.sheet, sessionAccessible)
      : result.sheet,
  }
})
