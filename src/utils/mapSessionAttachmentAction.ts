import { mapEditorSessionPath } from '~/utils/mapRoutes'

export type MapSessionAttachmentRememberedRole = 'gm' | 'player' | null
export type MapSessionAttachmentStatusKind = 'ready' | 'blocked' | 'busy' | 'success' | 'error'

export interface BuildMapSessionAttachmentActionModelOptions {
  readonly mapSlug?: string | null
  readonly sessionModeEnabled?: boolean
  readonly localRoleIsGm?: boolean
  readonly rememberedRole?: MapSessionAttachmentRememberedRole
  readonly busy?: boolean
  readonly attachedMapSlug?: string | null
  readonly lastError?: string | null
  readonly lastNotice?: string | null
}

export interface MapSessionAttachmentActionModel {
  readonly mapSlug: string | null
  readonly modeLabel: string
  readonly modeSummary: string
  readonly canAttach: boolean
  readonly statusKind: MapSessionAttachmentStatusKind
  readonly statusMessage: string
  readonly attachButtonLabel: string
  readonly disabledReason: string | null
  readonly openSessionMapHref: string | null
  readonly openSessionMapLabel: string
}

const GM_KEY_VALUE_RE = /\bgmkey_[A-Za-z0-9_-]{8,}\b/g

const normalizeText = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeStatusText = (value: string | null | undefined): string | null => {
  const normalized = normalizeText(value)
  return normalized === null ? null : normalized.replace(GM_KEY_VALUE_RE, '[hidden GM key]')
}

export const buildMapSessionAttachmentActionModel = (
  options: BuildMapSessionAttachmentActionModelOptions = {},
): MapSessionAttachmentActionModel => {
  const mapSlug = normalizeText(options.mapSlug)
  const attachedMapSlug = normalizeText(options.attachedMapSlug)
  const lastError = normalizeStatusText(options.lastError)
  const lastNotice = normalizeStatusText(options.lastNotice)
  const sessionModeEnabled = options.sessionModeEnabled === true
  const busy = options.busy === true
  const localRoleIsGm = options.localRoleIsGm === true
  const rememberedRole = options.rememberedRole ?? null
  const wasAttached = mapSlug !== null && attachedMapSlug === mapSlug

  const disabledReason = (() => {
    if (mapSlug === null) return 'Open a saved map before attaching it to a live session.'
    if (!localRoleIsGm) return 'GM login is required before attaching a map to a live session.'
    if (rememberedRole === 'player') {
      return 'This browser remembers a player live session. Use the lobby to switch to a GM live session before attaching a map.'
    }
    if (rememberedRole !== 'gm') {
      return 'Start or load a GM live session in this browser before attaching a map.'
    }
    if (busy) return 'Attaching the map to the live session…'
    return null
  })()

  const statusKind: MapSessionAttachmentStatusKind = lastError !== null
    ? 'error'
    : busy
      ? 'busy'
      : wasAttached
        ? 'success'
        : disabledReason !== null
          ? 'blocked'
          : 'ready'

  const statusMessage = (() => {
    if (lastError !== null) return lastError
    if (wasAttached) return lastNotice ?? `Attached ${mapSlug} to the live session map.`
    if (disabledReason !== null) return disabledReason
    return 'Ready to attach this persisted map to the active live session.'
  })()

  return {
    mapSlug,
    modeLabel: sessionModeEnabled ? 'Session mode view' : 'Local-first map view',
    modeSummary: sessionModeEnabled
      ? 'This view reads the server-owned session map and sends table actions as session commands. Attaching republishes the persisted map by slug if the GM chooses to do it.'
      : 'This view stays local-first. Attaching publishes the persisted map by slug to the server-owned live session map; open session mode after attach to use session commands.',
    canAttach: disabledReason === null,
    statusKind,
    statusMessage,
    attachButtonLabel: busy
      ? 'Attaching map…'
      : wasAttached
        ? 'Attach current map again'
        : 'Attach current map to live session',
    disabledReason,
    openSessionMapHref: mapSlug === null ? null : mapEditorSessionPath(mapSlug),
    openSessionMapLabel: wasAttached ? 'Open attached session map' : 'Open session map',
  }
}
