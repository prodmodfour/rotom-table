import type { TokenManeuverMenuOption } from '~/utils/mapTokenManeuvers'
import type { SpawnedPokemon } from '~/types/pokemon'

export const DEFAULT_MANEUVER_LOG_ENTRIES = 100

export interface ManeuverLogTransaction {
  userId: string
  userName: string
  maneuverName: string
  lines: string[]
}

export const buildManeuverUseLogLines = (
  user: Pick<SpawnedPokemon, 'species'>,
  maneuver: TokenManeuverMenuOption,
  options: { target?: Pick<SpawnedPokemon, 'species'> | null } = {},
): string[] => [
  `${user.species} used ${maneuver.name}.`,
  ...(options.target ? [`Target: ${options.target.species}`] : []),
  ...(maneuver.action ? [`Action: ${maneuver.action}`] : []),
  ...(maneuver.ac !== null && maneuver.ac !== undefined ? [`AC: ${maneuver.ac}`] : []),
  ...(maneuver.range ? [`Range: ${maneuver.range}`] : []),
  ...(maneuver.trigger ? [`Trigger: ${maneuver.trigger}`] : []),
  ...(maneuver.effect ? [`Effect: ${maneuver.effect}`] : []),
  ...(maneuver.special ? [`Special: ${maneuver.special}`] : []),
]

export const appendManeuverLogEntry = (
  metadata: Record<string, unknown> | undefined,
  transaction: ManeuverLogTransaction,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.maneuverLog) ? next.maneuverLog : []
  next.maneuverLog = [
    ...previous,
    {
      at: options.now?.() ?? Date.now(),
      userId: transaction.userId,
      userName: transaction.userName,
      maneuverName: transaction.maneuverName,
      lines: transaction.lines,
    },
  ].slice(-(options.maxLogEntries ?? DEFAULT_MANEUVER_LOG_ENTRIES))
  return next
}
