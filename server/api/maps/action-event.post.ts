import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { expectSlug, readObjectBody } from '../../utils/http'
import { publishTransientRealtime } from '../../utils/realtime'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { publishMapActionEventUseCase } from '../../useCases/publishMapActionEvent'

interface ActionEventBody {
  slug?: unknown
  event?: unknown
  profileId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<ActionEventBody>(event)
  const slug = expectSlug(body.slug)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null
    const result = publishMapActionEventUseCase({
      role,
      slug,
      event: body.event,
      playerProfile,
    })
    publishTransientRealtime({
      event: result.event,
      access: { kind: 'map-access', mapSlug: slug },
    })
    return { ok: true as const }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
