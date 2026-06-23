import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { getPlayerSessionAccessGrant } from '../../utils/sessionPlayerAccess'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { sqlitePlayerVisibleMapSheetAccessKeys } from '../../utils/mapSheetAccess'
import { playerSheetAccessContextFromKeys } from '../../useCases/authorizeSheetList'
import { listSheetsUseCase } from '../../useCases/listSheets'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  try {
    const query = getQuery(event)
    const sessionAccess = role === 'player' ? getPlayerSessionAccessGrant(event) : null
    const mapSheetAccess = role === 'player' ? sqlitePlayerVisibleMapSheetAccessKeys() : null
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    const playerAccessContext = role === 'player'
      ? playerSheetAccessContextFromKeys({
          sessionAccessKeys: sessionAccess?.sheetKeys ?? null,
          mapSheetAccessKeys: mapSheetAccess,
        })
      : {}

    return listSheetsUseCase({
      role,
      playerProfile,
      ...playerAccessContext,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
