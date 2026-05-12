import * as THREE from 'three'
import { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { CombatStageMap } from '~/types/combatStages'
import {
  COMBAT_STAGE_SHORT_LABELS,
  normalizeCombatStages,
} from '~/utils/combatStages'
import { conditionTagSvg, normalizeConditionNames } from '~/utils/statusConditions'
import { itemSpriteUrl } from '~/utils/itemSprites'
import {
  ELEVATION_BADGE_PIXELS_PER_METRE,
  TOKEN_STATUS_HEAD_GAP_EXTRA,
  TOKEN_STATUS_CSS_WIDTH_PX,
  TOKEN_STATUS_WORLD_WIDTH,
  activeCombatStageEntries,
  formatCombatStage,
  formatElevationDelta,
  formatTokenLevel,
  getElevationBadgeOffset,
  hpTierForRatio,
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
}) => {
  const localY = mapSpecificY(elevation, groundLevelY)
  if (!show || localY === 0) {
    badge.visible = false
    return
  }

  const offset = getElevationBadgeOffset(center, base, camera)
  badge.position.set(center.x + offset.x, center.y + 0.08, center.z + offset.z)
  badge.element.textContent = formatElevationDelta(localY)
  badge.visible = true
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

  if (levelNode) {
    const levelText = `Lv ${formatTokenLevel(level)}`
    if (levelNode.textContent !== levelText) levelNode.textContent = levelText
  }
}

const updateTokenCombatStages = (element: HTMLElement, stages: CombatStageMap) => {
  const strip = element.querySelector<HTMLElement>('.token-status__cs-strip')
  if (!strip) return

  const entries = activeCombatStageEntries(stages)
  strip.replaceChildren()
  strip.hidden = entries.length === 0

  for (const { key, value } of entries) {
    const chip = document.createElement('span')
    chip.className = `token-status__cs-chip ${value > 0 ? 'is-positive' : 'is-negative'}`
    chip.textContent = `${COMBAT_STAGE_SHORT_LABELS[key]} ${formatCombatStage(value)}`
    strip.appendChild(chip)
  }
}

const updateTokenConditions = (element: HTMLElement, conditions: readonly string[]) => {
  const strip = element.querySelector<HTMLElement>('.token-status__condition-strip')
  if (!strip) return

  const entries = normalizeConditionNames(conditions)
  strip.replaceChildren()
  strip.hidden = entries.length === 0

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
  const key = entries.join('\u001f')
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

  const combatStages = document.createElement('div')
  combatStages.className = 'token-status__cs-strip'
  combatStages.hidden = true

  const conditions = document.createElement('div')
  conditions.className = 'token-status__condition-strip'
  conditions.hidden = true

  const hpRow = document.createElement('div')
  hpRow.className = 'token-status__hp-row'

  const track = document.createElement('div')
  track.className = 'hp-bar'

  const fill = document.createElement('div')
  fill.className = 'hp-bar__fill'
  track.appendChild(fill)

  const itemStack = document.createElement('div')
  itemStack.className = 'token-status__item-stack'
  itemStack.hidden = true

  hpRow.append(track, itemStack)
  wrapper.append(turnChevron, combatStages, conditions, label, hpRow)
  updateTokenStatusLabel(wrapper, pokemon.species, pokemon.level)
  updateTokenCombatStages(wrapper, normalizeCombatStages(pokemon.combatStages))
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
  combatStages,
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
  combatStages: CombatStageMap
  conditions: readonly string[]
  tokenItems: readonly string[]
  activeTurn: boolean
  show?: boolean
}) => {
  // Hide the whole token HUD when the token layer is disabled or HP data is
  // not meaningful. CSS3DRenderer rewrites DOM display from object.visible,
  // so keep this on the CSS3D object instead of only touching element.style.
  if (!show || maxHp <= 0) {
    bar.visible = false
    return
  }

  const ratio = Math.max(0, Math.min(1, currentHp / maxHp))
  const fill = bar.element.querySelector<HTMLElement>('.hp-bar__fill')
  if (fill) {
    fill.style.width = `${ratio * 100}%`
  }

  const track = bar.element.querySelector<HTMLElement>('.hp-bar')
  if (track) {
    track.dataset.hpTier = hpTierForRatio(ratio)
  }
  updateTokenStatusLabel(bar.element, displayName, level)
  updateTokenCombatStages(bar.element, combatStages)
  updateTokenConditions(bar.element, conditions)
  updateTokenItems(bar.element, tokenItems)
  updateTokenActiveTurn(bar.element, activeTurn)

  // Floats just above the sprite's head. WebGL world sprites are
  // bottom-anchored at ``center.y``, so the top edge is
  // ``center.y + spriteHeight``. The offset accounts for the scaled DOM
  // height so smaller sprites keep the HUD tucked close instead of floating
  // as a detached nameplate.
  const overlayHalfHeight = tokenStatusCssHeight(displayName, combatStages, conditions, activeTurn) * bar.scale.y / 2
  const headGap = THREE.MathUtils.clamp(spriteHeight * 0.06, 0.025, 0.08) + TOKEN_STATUS_HEAD_GAP_EXTRA
  bar.position.set(center.x, center.y + spriteHeight + overlayHalfHeight + headGap, center.z)
  bar.visible = true
}
