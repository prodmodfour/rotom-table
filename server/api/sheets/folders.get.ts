import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { requireNonProduction } from '../../utils/http'
import { listSheetFoldersUseCase } from '../../useCases/listSheetFolders'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  if (role === 'player') return listSheetFoldersUseCase({ role })

  requireNonProduction()
  return listSheetFoldersUseCase({ role })
})
