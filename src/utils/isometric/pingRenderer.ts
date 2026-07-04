import * as THREE from 'three'
import { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type {
  LivePlayPresenceAccent,
  LivePlayPresenceGridCell,
  LivePlayPresenceParticipantSummary,
} from '#shared/livePlayPresence'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'

export interface IsometricPresencePing {
  readonly id: string
  readonly cell: LivePlayPresenceGridCell
  readonly label?: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly creator: LivePlayPresenceParticipantSummary
}

export interface PresencePingRendererSyncOptions {
  readonly nowMs: number
}

export interface PresencePingRenderer {
  sync(pings: readonly IsometricPresencePing[], options: PresencePingRendererSyncOptions): boolean
  dispose(): void
}

export const PRESENCE_PING_CSS_SIZE_PX = 92
export const PRESENCE_PING_WORLD_SIZE = 1.36
export const PRESENCE_PING_Y_OFFSET = 0.16

const PRESENCE_PING_RENDER_STATE_KEY = 'rotomPresencePingRenderState'

interface PresencePingRenderState {
  readonly id: string
  readonly label: string
  readonly accent: LivePlayPresenceAccent
  readonly creatorLabel: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly nowMs: number
  readonly x: number
  readonly y: number
  readonly z: number
}

const PRESENCE_PING_ACCENT_COLORS = {
  rose: '#fb7185',
  orange: '#fb923c',
  amber: '#fbbf24',
  lime: '#a3e635',
  green: '#4ade80',
  teal: '#2dd4bf',
  cyan: '#22d3ee',
  blue: '#60a5fa',
  indigo: '#818cf8',
  violet: '#a78bfa',
  fuchsia: '#e879f9',
  slate: '#94a3b8',
} satisfies Record<LivePlayPresenceAccent, string>

const hexToRgb = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16)
  return `${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}`
}

const setCssProperty = (style: CSSStyleDeclaration, property: string, value: string): void => {
  if (typeof style.setProperty === 'function') {
    style.setProperty(property, value)
    return
  }

  ;(style as unknown as Record<string, string>)[property] = value
}

const samePresencePingRenderState = (
  previous: PresencePingRenderState | null,
  next: PresencePingRenderState,
): boolean => Boolean(previous
  && previous.id === next.id
  && previous.label === next.label
  && previous.accent === next.accent
  && previous.creatorLabel === next.creatorLabel
  && previous.createdAt === next.createdAt
  && previous.expiresAt === next.expiresAt
  && previous.nowMs === next.nowMs
  && previous.x === next.x
  && previous.y === next.y
  && previous.z === next.z)

const presencePingRenderState = (sprite: CSS3DSprite): PresencePingRenderState | null => {
  const state = sprite.userData[PRESENCE_PING_RENDER_STATE_KEY]
  if (!state || typeof state !== 'object') return null

  const maybeState = state as Partial<PresencePingRenderState>
  return typeof maybeState.id === 'string'
    && typeof maybeState.label === 'string'
    && typeof maybeState.accent === 'string'
    && typeof maybeState.creatorLabel === 'string'
    && typeof maybeState.createdAt === 'number'
    && typeof maybeState.expiresAt === 'number'
    && typeof maybeState.nowMs === 'number'
    && typeof maybeState.x === 'number'
    && typeof maybeState.y === 'number'
    && typeof maybeState.z === 'number'
    ? maybeState as PresencePingRenderState
    : null
}

const rememberPresencePingRenderState = (
  sprite: CSS3DSprite,
  state: PresencePingRenderState,
): void => {
  sprite.userData[PRESENCE_PING_RENDER_STATE_KEY] = state
}

const clampDurationMs = (ping: Pick<IsometricPresencePing, 'createdAt' | 'expiresAt'>): number => (
  Math.max(1, ping.expiresAt - ping.createdAt)
)

const clampElapsedMs = (ping: Pick<IsometricPresencePing, 'createdAt' | 'expiresAt'>, nowMs: number): number => (
  THREE.MathUtils.clamp(nowMs - ping.createdAt, 0, clampDurationMs(ping))
)

const createPresencePingElement = (): HTMLElement => {
  const element = document.createElement('div')
  element.className = 'map-presence-ping-anchor'
  element.style.pointerEvents = 'none'
  element.style.zIndex = '18'
  element.setAttribute('aria-live', 'polite')

  const marker = document.createElement('div')
  marker.className = 'map-presence-ping'
  marker.setAttribute('aria-hidden', 'true')
  element.appendChild(marker)

  const label = document.createElement('span')
  label.className = 'map-presence-ping__label'
  label.hidden = true
  element.appendChild(label)

  return element
}

const presencePingCreatorLabel = (creator: LivePlayPresenceParticipantSummary): string => {
  const roleLabel = creator.role === 'gm' ? 'GM' : 'Player'
  return creator.profileDisplayName
    ? `${creator.profileDisplayName} (${roleLabel})`
    : `${roleLabel} ${creator.clientIdSuffix}`
}

const presencePingLabel = (ping: IsometricPresencePing): string => ping.label?.trim() ?? ''

const presencePingTitle = (
  ping: IsometricPresencePing,
  creatorLabel: string,
): string => {
  const label = presencePingLabel(ping)
  const suffix = label ? `: ${label}` : ''
  return `Map ping by ${creatorLabel} at (${ping.cell.x}, ${ping.cell.y}, ${ping.cell.z})${suffix}`
}

const updatePresencePingElement = (
  element: HTMLElement,
  ping: IsometricPresencePing,
  nowMs: number,
  creatorLabel: string,
): void => {
  const labelText = presencePingLabel(ping)
  const label = element.querySelector<HTMLElement>('.map-presence-ping__label')
  if (label) {
    label.hidden = labelText.length === 0
    label.textContent = labelText
  }

  element.className = `map-presence-ping-anchor is-${ping.creator.accent}`
  element.title = presencePingTitle(ping, creatorLabel)
  element.setAttribute('aria-label', element.title)

  const accentColor = PRESENCE_PING_ACCENT_COLORS[ping.creator.accent]
  setCssProperty(element.style, '--map-presence-ping-accent', accentColor)
  setCssProperty(element.style, '--map-presence-ping-accent-rgb', hexToRgb(accentColor))
  setCssProperty(element.style, '--map-presence-ping-duration', `${clampDurationMs(ping)}ms`)
  setCssProperty(element.style, '--map-presence-ping-delay', `${-clampElapsedMs(ping, nowMs)}ms`)
}

const pingIsRenderable = (ping: IsometricPresencePing, nowMs: number): boolean => (
  ping.expiresAt > nowMs
  && Number.isFinite(ping.cell.x)
  && Number.isFinite(ping.cell.y)
  && Number.isFinite(ping.cell.z)
)

const presencePingPosition = (cell: LivePlayPresenceGridCell) => ({
  x: cell.x + 0.5,
  y: cell.y + PRESENCE_PING_Y_OFFSET,
  z: cell.z + 0.5,
})

export const createPresencePingRenderer = (scene: THREE.Scene): PresencePingRenderer => {
  const sprites = new Map<string, CSS3DSprite>()

  const ensure = (id: string): CSS3DSprite => {
    const existing = sprites.get(id)
    if (existing) return existing

    const sprite = new CSS3DSprite(createPresencePingElement())
    sprite.element.style.pointerEvents = 'none'
    sprite.element.style.zIndex = '18'
    sprite.scale.setScalar(PRESENCE_PING_WORLD_SIZE / PRESENCE_PING_CSS_SIZE_PX)
    sprite.renderOrder = 18
    sprite.visible = false
    scene.add(sprite)
    sprites.set(id, sprite)
    return sprite
  }

  const remove = (id: string): boolean => {
    const sprite = sprites.get(id)
    if (!sprite) return false

    disposeObject3D(sprite)
    sprites.delete(id)
    return true
  }

  const sync = (
    pings: readonly IsometricPresencePing[],
    options: PresencePingRendererSyncOptions,
  ): boolean => {
    let changed = false
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
    const renderablePings = pings.filter((ping) => pingIsRenderable(ping, nowMs))
    const liveIds = new Set(renderablePings.map((ping) => ping.id))

    for (const id of Array.from(sprites.keys())) {
      if (!liveIds.has(id)) changed = remove(id) || changed
    }

    for (const ping of renderablePings) {
      const sprite = ensure(ping.id)
      const position = presencePingPosition(ping.cell)
      const creatorLabel = presencePingCreatorLabel(ping.creator)
      const nextState: PresencePingRenderState = {
        id: ping.id,
        label: presencePingLabel(ping),
        accent: ping.creator.accent,
        creatorLabel,
        createdAt: ping.createdAt,
        expiresAt: ping.expiresAt,
        nowMs,
        x: position.x,
        y: position.y,
        z: position.z,
      }

      if (sprite.visible && samePresencePingRenderState(presencePingRenderState(sprite), nextState)) {
        continue
      }

      updatePresencePingElement(sprite.element, ping, nowMs, creatorLabel)
      sprite.position.set(position.x, position.y, position.z)
      sprite.visible = true
      rememberPresencePingRenderState(sprite, nextState)
      changed = true
    }

    return changed
  }

  const dispose = (): void => {
    for (const id of Array.from(sprites.keys())) remove(id)
  }

  return { sync, dispose }
}
