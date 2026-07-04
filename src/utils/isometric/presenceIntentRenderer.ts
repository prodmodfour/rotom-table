import * as THREE from 'three'
import { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import type {
  MapPresenceIntentOverlay,
  MapPresenceIntentOverlayAnchor,
} from '~/utils/mapPresenceIntentOverlays'

export type IsometricPresenceIntentOverlay = MapPresenceIntentOverlay

export interface PresenceIntentOverlayRendererSyncOptions {
  readonly renderObjects: ReadonlyMap<string, PokemonRenderObject>
  readonly show: boolean
  readonly softened?: boolean
}

export interface PresenceIntentOverlayRenderer {
  sync(overlays: readonly IsometricPresenceIntentOverlay[], options: PresenceIntentOverlayRendererSyncOptions): boolean
  dispose(): void
}

export const PRESENCE_INTENT_CSS_WIDTH_PX = 124
export const PRESENCE_INTENT_WORLD_WIDTH = 1.72
export const PRESENCE_INTENT_CELL_Y_OFFSET = 0.24
export const PRESENCE_INTENT_TOKEN_Y_MIN_OFFSET = 0.92
export const PRESENCE_INTENT_STACK_Y_OFFSET = 0.22

const PRESENCE_INTENT_RENDER_STATE_KEY = 'rotomPresenceIntentRenderState'

interface PresenceIntentRenderState {
  readonly id: string
  readonly className: string
  readonly label: string
  readonly detail: string
  readonly participantLabel: string
  readonly title: string
  readonly accentColor: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly scale: number
}

interface PresenceIntentPosition {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly scale: number
}

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

const createPresenceIntentElement = (): HTMLElement => {
  const element = document.createElement('div')
  element.className = 'map-presence-intent-anchor'
  element.style.pointerEvents = 'none'
  element.style.zIndex = '16'
  element.setAttribute('aria-live', 'polite')

  const reticle = document.createElement('span')
  reticle.className = 'map-presence-intent__reticle'
  reticle.setAttribute('aria-hidden', 'true')
  element.appendChild(reticle)

  const badge = document.createElement('span')
  badge.className = 'map-presence-intent__badge'

  const participant = document.createElement('span')
  participant.className = 'map-presence-intent__participant'
  badge.appendChild(participant)

  const label = document.createElement('strong')
  label.className = 'map-presence-intent__label'
  badge.appendChild(label)

  const detail = document.createElement('span')
  detail.className = 'map-presence-intent__detail'
  badge.appendChild(detail)

  element.appendChild(badge)
  return element
}

const presenceIntentRenderState = (sprite: CSS3DSprite): PresenceIntentRenderState | null => {
  const state = sprite.userData[PRESENCE_INTENT_RENDER_STATE_KEY]
  if (!state || typeof state !== 'object') return null

  const maybeState = state as Partial<PresenceIntentRenderState>
  return typeof maybeState.id === 'string'
    && typeof maybeState.className === 'string'
    && typeof maybeState.label === 'string'
    && typeof maybeState.detail === 'string'
    && typeof maybeState.participantLabel === 'string'
    && typeof maybeState.title === 'string'
    && typeof maybeState.accentColor === 'string'
    && typeof maybeState.x === 'number'
    && typeof maybeState.y === 'number'
    && typeof maybeState.z === 'number'
    && typeof maybeState.scale === 'number'
    ? maybeState as PresenceIntentRenderState
    : null
}

const rememberPresenceIntentRenderState = (
  sprite: CSS3DSprite,
  state: PresenceIntentRenderState,
): void => {
  sprite.userData[PRESENCE_INTENT_RENDER_STATE_KEY] = state
}

const samePresenceIntentRenderState = (
  previous: PresenceIntentRenderState | null,
  next: PresenceIntentRenderState,
): boolean => Boolean(previous
  && previous.id === next.id
  && previous.className === next.className
  && previous.label === next.label
  && previous.detail === next.detail
  && previous.participantLabel === next.participantLabel
  && previous.title === next.title
  && previous.accentColor === next.accentColor
  && previous.x === next.x
  && previous.y === next.y
  && previous.z === next.z
  && previous.scale === next.scale)

const anchorClass = (anchor: MapPresenceIntentOverlayAnchor): string => (
  anchor.kind === 'token' ? 'is-token' : 'is-cell'
)

const overlayClassName = (overlay: IsometricPresenceIntentOverlay, softened: boolean): string => [
  'map-presence-intent-anchor',
  `is-${overlay.kind}`,
  anchorClass(overlay.anchor),
  `is-${overlay.participant.accent}`,
  softened ? 'is-softened' : '',
].filter(Boolean).join(' ')

const overlayTitle = (overlay: IsometricPresenceIntentOverlay): string => {
  const anchor = overlay.anchor.kind === 'token'
    ? 'a visible token'
    : `cell (${overlay.anchor.cell.x}, ${overlay.anchor.cell.y}, ${overlay.anchor.cell.z})`
  return `${overlay.participantLabel}: ${overlay.label} · ${overlay.detail} at ${anchor}`
}

const updatePresenceIntentElement = (
  element: HTMLElement,
  overlay: IsometricPresenceIntentOverlay,
  className: string,
  title: string,
): void => {
  element.className = className
  element.title = title
  element.setAttribute('aria-label', title)

  const participant = element.querySelector<HTMLElement>('.map-presence-intent__participant')
  if (participant) participant.textContent = overlay.participantLabel

  const label = element.querySelector<HTMLElement>('.map-presence-intent__label')
  if (label) label.textContent = overlay.label

  const detail = element.querySelector<HTMLElement>('.map-presence-intent__detail')
  if (detail) {
    detail.textContent = overlay.detail
    detail.hidden = overlay.detail.length === 0
  }

  setCssProperty(element.style, '--map-presence-intent-accent', overlay.accentColor)
  setCssProperty(element.style, '--map-presence-intent-accent-rgb', hexToRgb(overlay.accentColor))
}

const tokenOverlayPosition = (
  overlay: IsometricPresenceIntentOverlay,
  renderObject: PokemonRenderObject,
): PresenceIntentPosition => {
  const yOffset = Math.max(renderObject.height * 0.92, PRESENCE_INTENT_TOKEN_Y_MIN_OFFSET)
  return {
    x: renderObject.currentCenter.x,
    y: renderObject.currentCenter.y + yOffset + overlay.stackIndex * PRESENCE_INTENT_STACK_Y_OFFSET,
    z: renderObject.currentCenter.z,
    scale: Math.max(PRESENCE_INTENT_WORLD_WIDTH, renderObject.base * PRESENCE_INTENT_WORLD_WIDTH) / PRESENCE_INTENT_CSS_WIDTH_PX,
  }
}

const cellOverlayPosition = (overlay: IsometricPresenceIntentOverlay): PresenceIntentPosition => {
  if (overlay.anchor.kind !== 'cell') {
    throw new Error('cellOverlayPosition requires a cell-anchored presence intent overlay.')
  }
  return {
    x: overlay.anchor.cell.x + 0.5,
    y: overlay.anchor.cell.y + PRESENCE_INTENT_CELL_Y_OFFSET + overlay.stackIndex * PRESENCE_INTENT_STACK_Y_OFFSET,
    z: overlay.anchor.cell.z + 0.5,
    scale: PRESENCE_INTENT_WORLD_WIDTH / PRESENCE_INTENT_CSS_WIDTH_PX,
  }
}

const overlayPosition = (
  overlay: IsometricPresenceIntentOverlay,
  renderObjects: ReadonlyMap<string, PokemonRenderObject>,
): PresenceIntentPosition | null => {
  if (overlay.anchor.kind === 'cell') return cellOverlayPosition(overlay)
  const renderObject = renderObjects.get(overlay.anchor.tokenId)
  return renderObject ? tokenOverlayPosition(overlay, renderObject) : null
}

export const createPresenceIntentOverlayRenderer = (scene: THREE.Scene): PresenceIntentOverlayRenderer => {
  const sprites = new Map<string, CSS3DSprite>()

  const ensure = (id: string): CSS3DSprite => {
    const existing = sprites.get(id)
    if (existing) return existing

    const sprite = new CSS3DSprite(createPresenceIntentElement())
    sprite.element.style.pointerEvents = 'none'
    sprite.element.style.zIndex = '16'
    sprite.scale.setScalar(PRESENCE_INTENT_WORLD_WIDTH / PRESENCE_INTENT_CSS_WIDTH_PX)
    sprite.renderOrder = 16
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
    overlays: readonly IsometricPresenceIntentOverlay[],
    options: PresenceIntentOverlayRendererSyncOptions,
  ): boolean => {
    let changed = false
    const renderableOverlays = options.show
      ? overlays.flatMap((overlay) => {
          const position = overlayPosition(overlay, options.renderObjects)
          return position ? [{ overlay, position }] : []
        })
      : []
    const liveIds = new Set(renderableOverlays.map(({ overlay }) => overlay.id))

    for (const id of Array.from(sprites.keys())) {
      if (!liveIds.has(id)) changed = remove(id) || changed
    }

    for (const { overlay, position } of renderableOverlays) {
      const sprite = ensure(overlay.id)
      const className = overlayClassName(overlay, options.softened === true)
      const title = overlayTitle(overlay)
      const nextState: PresenceIntentRenderState = {
        id: overlay.id,
        className,
        label: overlay.label,
        detail: overlay.detail,
        participantLabel: overlay.participantLabel,
        title,
        accentColor: overlay.accentColor,
        x: position.x,
        y: position.y,
        z: position.z,
        scale: position.scale,
      }

      if (sprite.visible && samePresenceIntentRenderState(presenceIntentRenderState(sprite), nextState)) {
        continue
      }

      updatePresenceIntentElement(sprite.element, overlay, className, title)
      sprite.position.set(position.x, position.y, position.z)
      sprite.scale.setScalar(position.scale)
      sprite.visible = true
      rememberPresenceIntentRenderState(sprite, nextState)
      changed = true
    }

    return changed
  }

  const dispose = (): void => {
    for (const id of Array.from(sprites.keys())) remove(id)
  }

  return { sync, dispose }
}
