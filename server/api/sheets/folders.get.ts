import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { listSheetFoldersUseCase } from '../../useCases/listSheetFolders'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  return listSheetFoldersUseCase({ role })
})
