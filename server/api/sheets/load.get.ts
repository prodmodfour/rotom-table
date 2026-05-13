import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { expectSheetKind, expectSlug, requireNonProduction } from '../../utils/http'
import { loadSheetUseCase } from '../../useCases/loadSheet'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  if (role === 'gm') requireNonProduction()

  const query = getQuery(event)
  const kind = expectSheetKind(query.kind)
  const slug = expectSlug(query.slug)

  return loadSheetUseCase({ role, kind, slug })
})
