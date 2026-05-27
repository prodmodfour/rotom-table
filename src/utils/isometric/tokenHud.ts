import * as THREE from 'three'
import { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { SpawnedPokemon } from '~/types/pokemon'
import { conditionTagSvg, normalizeConditionNames } from '~/utils/statusConditions'
import { itemSpriteUrl } from '~/utils/itemSprites'
import {
  getHpBarDisplayMetrics,
  hpBarPercentFromRatio,
  hpTierForRatio,
} from '~/utils/hpBarDisplay'
import {
  ELEVATION_BADGE_PIXELS_PER_METRE,
  TOKEN_STATUS_HEAD_GAP_EXTRA,
  TOKEN_STATUS_CSS_WIDTH_PX,
  TOKEN_STATUS_WORLD_WIDTH,
  formatElevationDelta,
  formatTokenLevel,
  getElevationBadgeOffset,
  mapSpecificY,
  tokenStatusCssHeight,
  tokenStatusNameWords,
} from '~/utils/isometric/tokenHudMetrics'

export const buildElevationBadge = (ghost = false) => {
  const wrapper = document.createElement('div')
  wrapper.className = `elevation-badge${ghost ? ' is-ghost' : ''}`
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.style.pointerEvents = 'none'

  const badge = new CSS3DSprite(wrapper)
  badge.element.style.pointerEvents = 'none'
  badge.scale.setScalar(1 / ELEVATION_BADGE_PIXELS_PER_METRE)
  badge.visible = false
  return badge
}

interface ElevationBadgeRenderState {
  visible: boolean
  textContent: string
  x: number
  y: number
  z: number
}

const ELEVATION_BADGE_RENDER_STATE_KEY = 'rotomElevationBadgeRenderState'

const elevationBadgeRenderState = (badge: CSS3DSprite): ElevationBadgeRenderState | null => {
  const state = badge.userData[ELEVATION_BADGE_RENDER_STATE_KEY]
  if (!state || typeof state !== 'object') return null

  const maybeState = state as Partial<ElevationBadgeRenderState>
  return typeof maybeState.visible === 'boolean'
    && typeof maybeState.textContent === 'string'
    && typeof maybeState.x === 'number'
    && typeof maybeState.y === 'number'
    && typeof maybeState.z === 'number'
    ? maybeState as ElevationBadgeRenderState
    : null
}

const rememberElevationBadgeRenderState = (
  badge: CSS3DSprite,
  state: ElevationBadgeRenderState,
) => {
  badge.userData[ELEVATION_BADGE_RENDER_STATE_KEY] = state
}

const setElevationBadgeHidden = (badge: CSS3DSprite): boolean => {
  const previous = elevationBadgeRenderState(badge)
  const changed = badge.visible || previous?.visible === true
  if (!changed && previous?.visible === false) return false

  badge.visible = false
  rememberElevationBadgeRenderState(badge, {
    visible: false,
    textContent: badge.element.textContent ?? '',
    x: badge.position.x,
    y: badge.position.y,
    z: badge.position.z,
  })
  return changed
}

const sameElevationBadgeRenderState = (
  previous: ElevationBadgeRenderState | null,
  next: ElevationBadgeRenderState,
): boolean => Boolean(previous
  && previous.visible === next.visible
  && previous.textContent === next.textContent
  && previous.x === next.x
  && previous.y === next.y
  && previous.z === next.z)

export const updateElevationBadge = ({
  badge,
  center,
  base,
  elevation,
  groundLevelY,
  camera,
  show = true,
}: {
  badge: CSS3DSprite
  center: THREE.Vector3
  base: number
  elevation: number
  groundLevelY: number
  camera: THREE.Camera | null
  show?: boolean
}): boolean => {
  const localY = mapSpecificY(elevation, groundLevelY)
  if (!show || localY === 0) {
    return setElevationBadgeHidden(badge)
  }

  const offset = getElevationBadgeOffset(center, base, camera)
  const nextState: ElevationBadgeRenderState = {
    visible: true,
    textContent: formatElevationDelta(localY),
    x: center.x + offset.x,
    y: center.y + 0.08,
    z: center.z + offset.z,
  }

  if (badge.visible && sameElevationBadgeRenderState(elevationBadgeRenderState(badge), nextState)) {
    return false
  }

  badge.position.set(nextState.x, nextState.y, nextState.z)
  if (badge.element.textContent !== nextState.textContent) {
    badge.element.textContent = nextState.textContent
  }
  badge.visible = true
  rememberElevationBadgeRenderState(badge, nextState)
  return true
}

const TOKEN_LEVEL_PREFIX_TEXT = 'Lv'

const ensureTokenLevelNodes = (levelNode: HTMLElement) => {
  let prefix = levelNode.querySelector<HTMLElement>('.token-status__level-prefix')
  let value = levelNode.querySelector<HTMLElement>('.token-status__level-value')

  if (!prefix || !value) {
    prefix = document.createElement('span')
    prefix.className = 'token-status__level-prefix'
    prefix.textContent = TOKEN_LEVEL_PREFIX_TEXT

    value = document.createElement('span')
    value.className = 'token-status__level-value'
    levelNode.replaceChildren(prefix, value)
  }

  return { prefix, value }
}

const updateTokenStatusLevel = (levelNode: HTMLElement, level: number) => {
  const { prefix, value } = ensureTokenLevelNodes(levelNode)
  const formattedLevel = formatTokenLevel(level)

  if (prefix.textContent !== TOKEN_LEVEL_PREFIX_TEXT) prefix.textContent = TOKEN_LEVEL_PREFIX_TEXT
  if (value.textContent !== formattedLevel) value.textContent = formattedLevel
}

const updateTokenStatusLabel = (
  element: HTMLElement,
  displayName: string,
  level: number,
) => {
  const label = element.querySelector<HTMLElement>('.token-status__label')
  const name = element.querySelector<HTMLElement>('.token-status__name')
  const separator = element.querySelector<HTMLElement>('.token-status__separator')
  const levelNode = element.querySelector<HTMLElement>('.token-status__level')
  const words = tokenStatusNameWords(displayName)
  const stacked = words.length > 1

  label?.classList.toggle('is-stacked-name', stacked)
  if (separator) separator.hidden = stacked

  if (name) {
    const nameKey = words.join('\n')
    if (name.dataset.displayName !== nameKey) {
      name.replaceChildren()
      for (const word of words) {
        const wordNode = document.createElement('span')
        wordNode.className = 'token-status__name-word'
        wordNode.textContent = word
        name.appendChild(wordNode)
      }
      name.dataset.displayName = nameKey
    }
  }

  if (levelNode) updateTokenStatusLevel(levelNode, level)
}

const TOKEN_STATUS_KEY_SEPARATOR = '\u001f'

const tokenStatusConditionKey = (conditions: readonly string[]): string => (
  normalizeConditionNames(conditions).join(TOKEN_STATUS_KEY_SEPARATOR)
)

const tokenStatusItemKey = (items: readonly string[]): string => (
  items.map((item) => item.trim()).filter(Boolean).join(TOKEN_STATUS_KEY_SEPARATOR)
)

const updateTokenConditions = (element: HTMLElement, conditions: readonly string[]) => {
  const strip = element.querySelector<HTMLElement>('.token-status__condition-strip')
  if (!strip) return

  const entries = normalizeConditionNames(conditions)
  const key = entries.join(TOKEN_STATUS_KEY_SEPARATOR)
  const hidden = entries.length === 0

  if (strip.dataset.conditionNamesKey === key) {
    if (strip.hidden !== hidden) strip.hidden = hidden
    return
  }

  strip.dataset.conditionNamesKey = key
  strip.replaceChildren()
  strip.hidden = hidden

  for (const condition of entries) {
    const chip = document.createElement('span')
    chip.className = 'token-status__condition-chip'
    chip.innerHTML = conditionTagSvg(condition, 'xs')
    strip.appendChild(chip)
  }
}

const updateTokenItems = (element: HTMLElement, items: readonly string[]) => {
  const stack = element.querySelector<HTMLElement>('.token-status__item-stack')
  if (!stack) return

  const entries = items.map((item) => item.trim()).filter(Boolean)
  const key = entries.join(TOKEN_STATUS_KEY_SEPARATOR)
  if (stack.dataset.itemNamesKey === key) return
  stack.dataset.itemNamesKey = key

  stack.replaceChildren()
  let iconCount = 0

  for (const item of entries) {
    const src = itemSpriteUrl(item)
    const icon = src ? document.createElement('img') : document.createElement('span')
    icon.className = `token-status__item-icon${src ? '' : ' token-status__item-icon--fallback'}`
    icon.title = item
    icon.setAttribute('aria-hidden', 'true')

    if (src && icon instanceof HTMLImageElement) {
      icon.src = src
      icon.alt = ''
      icon.loading = 'lazy'
      icon.decoding = 'async'
    } else {
      icon.textContent = item.charAt(0).toUpperCase() || '•'
    }

    stack.appendChild(icon)
    iconCount += 1
  }

  stack.hidden = iconCount === 0
}

const updateTokenActiveTurn = (element: HTMLElement, activeTurn: boolean) => {
  element.classList.toggle('is-active-turn', activeTurn)
}

const applyTokenStatusScale = (status: CSS3DSprite) => {
  status.scale.setScalar(TOKEN_STATUS_WORLD_WIDTH / TOKEN_STATUS_CSS_WIDTH_PX)
}

const formatInjuryBlockTitle = (injuries: number | undefined, blockedRatio: number): string => {
  const injuryCount = injuries == null || !Number.isFinite(injuries) ? 0 : Math.max(0, Math.floor(injuries))
  const injuryLabel = injuryCount > 0
    ? `${injuryCount} ${injuryCount === 1 ? 'Injury' : 'Injuries'}`
    : 'Injuries'
  return `${injuryLabel} block ${hpBarPercentFromRatio(blockedRatio)} of Max HP.`
}

interface TokenStatusRenderState {
  visible: boolean
  fillWidth: string
  blockedWidth: string
  blockedHidden: boolean
  hpTier: ReturnType<typeof hpTierForRatio>
  injuryBlocked: boolean
  title: string
  displayName: string
  level: number
  conditionsKey: string
  tokenItemsKey: string
  activeTurn: boolean
  x: number
  y: number
  z: number
}

const TOKEN_STATUS_RENDER_STATE_KEY = 'rotomTokenStatusRenderState'

const tokenStatusRenderState = (bar: CSS3DSprite): TokenStatusRenderState | null => {
  const state = bar.userData[TOKEN_STATUS_RENDER_STATE_KEY]
  if (!state || typeof state !== 'object') return null

  const maybeState = state as Partial<TokenStatusRenderState>
  return typeof maybeState.visible === 'boolean'
    && typeof maybeState.fillWidth === 'string'
    && typeof maybeState.blockedWidth === 'string'
    && typeof maybeState.blockedHidden === 'boolean'
    && typeof maybeState.hpTier === 'string'
    && typeof maybeState.injuryBlocked === 'boolean'
    && typeof maybeState.title === 'string'
    && typeof maybeState.displayName === 'string'
    && typeof maybeState.level === 'number'
    && typeof maybeState.conditionsKey === 'string'
    && typeof maybeState.tokenItemsKey === 'string'
    && typeof maybeState.activeTurn === 'boolean'
    && typeof maybeState.x === 'number'
    && typeof maybeState.y === 'number'
    && typeof maybeState.z === 'number'
    ? maybeState as TokenStatusRenderState
    : null
}

const rememberTokenStatusRenderState = (
  bar: CSS3DSprite,
  state: TokenStatusRenderState,
) => {
  bar.userData[TOKEN_STATUS_RENDER_STATE_KEY] = state
}

const sameTokenStatusRenderState = (
  previous: TokenStatusRenderState | null,
  next: TokenStatusRenderState,
): boolean => Boolean(previous
  && previous.visible === next.visible
  && previous.fillWidth === next.fillWidth
  && previous.blockedWidth === next.blockedWidth
  && previous.blockedHidden === next.blockedHidden
  && previous.hpTier === next.hpTier
  && previous.injuryBlocked === next.injuryBlocked
  && previous.title === next.title
  && previous.displayName === next.displayName
  && previous.level === next.level
  && previous.conditionsKey === next.conditionsKey
  && previous.tokenItemsKey === next.tokenItemsKey
  && previous.activeTurn === next.activeTurn
  && previous.x === next.x
  && previous.y === next.y
  && previous.z === next.z)

const setTokenStatusHidden = (bar: CSS3DSprite): boolean => {
  const previous = tokenStatusRenderState(bar)
  const changed = bar.visible || previous?.visible === true
  if (!changed && previous?.visible === false) return false

  bar.visible = false
  rememberTokenStatusRenderState(bar, {
    visible: false,
    fillWidth: previous?.fillWidth ?? '',
    blockedWidth: previous?.blockedWidth ?? '',
    blockedHidden: previous?.blockedHidden ?? true,
    hpTier: previous?.hpTier ?? 'healthy',
    injuryBlocked: previous?.injuryBlocked ?? false,
    title: previous?.title ?? '',
    displayName: previous?.displayName ?? '',
    level: previous?.level ?? 0,
    conditionsKey: previous?.conditionsKey ?? '',
    tokenItemsKey: previous?.tokenItemsKey ?? '',
    activeTurn: previous?.activeTurn ?? false,
    x: bar.position.x,
    y: bar.position.y,
    z: bar.position.z,
  })
  return changed
}

export const buildHpBar = (pokemon: SpawnedPokemon) => {
  const wrapper = document.createElement('div')
  wrapper.className = 'token-status'
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.style.pointerEvents = 'none'

  const turnChevron = document.createElement('div')
  turnChevron.className = 'token-status__turn-chevron'
  turnChevron.textContent = '⌄'

  const label = document.createElement('div')
  label.className = 'token-status__label'

  const name = document.createElement('span')
  name.className = 'token-status__name'

  const separator = document.createElement('span')
  separator.className = 'token-status__separator'
  separator.textContent = ' · '

  const level = document.createElement('span')
  level.className = 'token-status__level'

  label.append(name, separator, level)

  const conditions = document.createElement('div')
  conditions.className = 'token-status__condition-strip'
  conditions.hidden = true

  const hpRow = document.createElement('div')
  hpRow.className = 'token-status__hp-row'

  const track = document.createElement('div')
  track.className = 'hp-bar'

  const fill = document.createElement('div')
  fill.className = 'hp-bar__fill'

  const blocked = document.createElement('div')
  blocked.className = 'hp-bar__blocked'
  blocked.hidden = true

  track.append(fill, blocked)

  const itemStack = document.createElement('div')
  itemStack.className = 'token-status__item-stack'
  itemStack.hidden = true

  hpRow.append(track, itemStack)
  wrapper.append(turnChevron, conditions, label, hpRow)
  updateTokenStatusLabel(wrapper, pokemon.species, pokemon.level)
  updateTokenConditions(wrapper, pokemon.conditions)
  updateTokenItems(wrapper, pokemon.tokenItems)

  // CSS3DSprite billboards to the camera so the status reads as a compact
  // floating HUD regardless of orbit angle.
  const bar = new CSS3DSprite(wrapper)
  bar.element.style.pointerEvents = 'none'
  applyTokenStatusScale(bar)
  bar.visible = false
  return bar
}

export const updateHpBar = ({
  bar,
  center,
  spriteHeight,
  displayName,
  level,
  currentHp,
  maxHp,
  fullMaxHp,
  injuries,
  conditions,
  tokenItems,
  activeTurn,
  show = true,
}: {
  bar: CSS3DSprite
  center: THREE.Vector3
  spriteHeight: number
  displayName: string
  level: number
  currentHp: number
  maxHp: number
  fullMaxHp?: number
  injuries?: number
  conditions: readonly string[]
  tokenItems: readonly string[]
  activeTurn: boolean
  show?: boolean
}): boolean => {
  const hpMetrics = getHpBarDisplayMetrics({ currentHp, maxHp, fullMaxHp })

  // Hide the whole token HUD when the token layer is disabled or HP data is
  // not meaningful. CSS3DRenderer rewrites DOM display from object.visible,
  // so keep this on the CSS3D object instead of only touching element.style.
  if (!show || hpMetrics.trackMaxHp <= 0) {
    return setTokenStatusHidden(bar)
  }

  // Floats just above the sprite's head. WebGL world sprites are
  // bottom-anchored at ``center.y``, so the top edge is
  // ``center.y + spriteHeight``. The offset accounts for the scaled DOM
  // height so smaller sprites keep the HUD tucked close instead of floating
  // as a detached nameplate.
  const overlayHalfHeight = tokenStatusCssHeight(displayName, conditions, activeTurn) * bar.scale.y / 2
  const headGap = THREE.MathUtils.clamp(spriteHeight * 0.06, 0.025, 0.08) + TOKEN_STATUS_HEAD_GAP_EXTRA
  const fillWidth = hpBarPercentFromRatio(hpMetrics.currentRatio)
  const blockedWidth = hpBarPercentFromRatio(hpMetrics.blockedRatio)
  const blockedHidden = hpMetrics.blockedRatio <= 0
  const hpTier = hpTierForRatio(hpMetrics.currentRatio)
  const injuryBlocked = hpMetrics.blockedRatio > 0
  const title = injuryBlocked ? formatInjuryBlockTitle(injuries, hpMetrics.blockedRatio) : ''
  const nextState: TokenStatusRenderState = {
    visible: true,
    fillWidth,
    blockedWidth,
    blockedHidden,
    hpTier,
    injuryBlocked,
    title,
    displayName,
    level,
    conditionsKey: tokenStatusConditionKey(conditions),
    tokenItemsKey: tokenStatusItemKey(tokenItems),
    activeTurn,
    x: center.x,
    y: center.y + spriteHeight + overlayHalfHeight + headGap,
    z: center.z,
  }

  if (bar.visible && sameTokenStatusRenderState(tokenStatusRenderState(bar), nextState)) {
    // Selection lift is applied after HUD layout each animation frame. Reset
    // the CSS3D object back to its layout anchor even when the HUD content did
    // not change, otherwise the post-layout lift offset accumulates and the HP
    // bar visibly drifts upward while a token is selected.
    if (
      bar.position.x !== nextState.x ||
      bar.position.y !== nextState.y ||
      bar.position.z !== nextState.z
    ) {
      bar.position.set(nextState.x, nextState.y, nextState.z)
    }
    return false
  }

  const fill = bar.element.querySelector<HTMLElement>('.hp-bar__fill')
  if (fill && fill.style.width !== fillWidth) {
    fill.style.width = fillWidth
  }

  const blocked = bar.element.querySelector<HTMLElement>('.hp-bar__blocked')
  if (blocked) {
    if (blocked.style.width !== blockedWidth) blocked.style.width = blockedWidth
    if (blocked.hidden !== blockedHidden) blocked.hidden = blockedHidden
  }

  const track = bar.element.querySelector<HTMLElement>('.hp-bar')
  if (track) {
    if (track.dataset.hpTier !== hpTier) track.dataset.hpTier = hpTier
    if (injuryBlocked) {
      track.dataset.injuryBlocked = 'true'
      if (track.title !== title) track.title = title
    } else {
      delete track.dataset.injuryBlocked
      track.removeAttribute('title')
    }
  }
  updateTokenStatusLabel(bar.element, displayName, level)
  updateTokenConditions(bar.element, conditions)
  updateTokenItems(bar.element, tokenItems)
  updateTokenActiveTurn(bar.element, activeTurn)

  bar.position.set(nextState.x, nextState.y, nextState.z)
  bar.visible = true
  rememberTokenStatusRenderState(bar, nextState)
  return true
}
