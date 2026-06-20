import * as THREE from 'three'
import { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import type { GridAnchor } from '~/types/map'
import type {
  MoveAutomationFeedbackState,
  MoveAutomationTargetHitChance,
} from '~/types/moveAutomation'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import {
  clearTrainerAccentCssVariables,
  normalizeTrainerAccentColor,
  setTrainerAccentCssVariables,
} from '~/utils/trainerAccent'
import { renderRollingD20Graphic } from '~/utils/isometric/moveAutomationRollGraphic'

const RETICLE_CSS_SIZE_PX = 72
const FEEDBACK_CSS_WIDTH_PX = 180
const FEEDBACK_WORLD_WIDTH = 2.06

const createTargetReticleElement = (label: string): HTMLElement => {
  const element = document.createElement('div')
  element.className = 'move-target-reticle-anchor'
  element.setAttribute('aria-label', label)
  element.style.pointerEvents = 'none'
  element.style.zIndex = '20'

  const hitChance = document.createElement('div')
  hitChance.className = 'move-target-hit-chance'
  hitChance.hidden = true
  element.appendChild(hitChance)

  const ring = document.createElement('div')
  ring.className = 'move-target-reticle'
  ring.setAttribute('aria-hidden', 'true')
  element.appendChild(ring)

  return element
}

const updateTargetReticleElement = (
  element: HTMLElement,
  hitChance: MoveAutomationTargetHitChance | undefined,
  selected = true,
): boolean => {
  let changed = false
  const badge = element.querySelector<HTMLElement>('.move-target-hit-chance')
  if (!badge) return changed

  const badgeHidden = !hitChance
  const badgeText = hitChance?.label ?? ''
  const badgeTitle = hitChance?.title ?? ''
  const badgeClassName = [
    'move-target-hit-chance',
    hitChance ? `is-${hitChance.tone}` : '',
    selected ? '' : 'is-unselected',
  ].filter(Boolean).join(' ')

  if (badge.hidden !== badgeHidden) {
    badge.hidden = badgeHidden
    changed = true
  }
  if (badge.textContent !== badgeText) {
    badge.textContent = badgeText
    changed = true
  }
  if (badge.title !== badgeTitle) {
    badge.title = badgeTitle
    changed = true
  }
  if (badge.className !== badgeClassName) {
    badge.className = badgeClassName
    changed = true
  }

  const ring = element.querySelector<HTMLElement>('.move-target-reticle')
  if (ring) {
    const ringClassName = [
      'move-target-reticle',
      hitChance ? `is-${hitChance.tone}` : '',
      selected ? '' : 'is-unselected',
    ].filter(Boolean).join(' ')
    if (ring.className !== ringClassName) {
      ring.className = ringClassName
      changed = true
    }
  }
  if (element.title !== badgeTitle) {
    element.title = badgeTitle
    changed = true
  }

  return changed
}

const reticleY = (renderObject: PokemonRenderObject): number =>
  renderObject.currentCenter.y + Math.max(renderObject.height * 0.58, 0.45)

interface TargetReticleRenderState {
  visible: boolean
  hitChanceKey: string
  selected: boolean
  x: number
  y: number
  z: number
  scale: number
}

const TARGET_RETICLE_RENDER_STATE_KEY = 'rotomMoveTargetReticleRenderState'

const targetReticleHitChanceKey = (hitChance: MoveAutomationTargetHitChance | undefined): string => (
  hitChance ? `${hitChance.percent}|${hitChance.label}|${hitChance.tone}|${hitChance.title}` : ''
)

const targetReticleRenderState = (reticle: CSS3DSprite): TargetReticleRenderState | null => {
  const state = reticle.userData[TARGET_RETICLE_RENDER_STATE_KEY]
  if (!state || typeof state !== 'object') return null

  const maybeState = state as Partial<TargetReticleRenderState>
  return typeof maybeState.visible === 'boolean'
    && typeof maybeState.hitChanceKey === 'string'
    && typeof maybeState.selected === 'boolean'
    && typeof maybeState.x === 'number'
    && typeof maybeState.y === 'number'
    && typeof maybeState.z === 'number'
    && typeof maybeState.scale === 'number'
    ? maybeState as TargetReticleRenderState
    : null
}

const rememberTargetReticleRenderState = (
  reticle: CSS3DSprite,
  state: TargetReticleRenderState,
) => {
  reticle.userData[TARGET_RETICLE_RENDER_STATE_KEY] = state
}

const sameTargetReticleRenderState = (
  previous: TargetReticleRenderState | null,
  next: TargetReticleRenderState,
): boolean => Boolean(previous
  && previous.visible === next.visible
  && previous.hitChanceKey === next.hitChanceKey
  && previous.selected === next.selected
  && previous.x === next.x
  && previous.y === next.y
  && previous.z === next.z
  && previous.scale === next.scale)

const setTargetReticleHidden = (reticle: CSS3DSprite): boolean => {
  const previous = targetReticleRenderState(reticle)
  const changed = reticle.visible || previous?.visible === true
  if (!changed && previous?.visible === false) return false

  reticle.visible = false
  rememberTargetReticleRenderState(reticle, {
    visible: false,
    hitChanceKey: previous?.hitChanceKey ?? '',
    selected: previous?.selected ?? true,
    x: reticle.position.x,
    y: reticle.position.y,
    z: reticle.position.z,
    scale: reticle.scale.x,
  })
  return changed
}

export const createMoveTargetingReticleRenderer = (scene: THREE.Scene) => {
  const reticles = new Map<string, CSS3DSprite>()

  const ensure = (id: string) => {
    let reticle = reticles.get(id)
    if (reticle) return reticle

    reticle = new CSS3DSprite(createTargetReticleElement('Move target'))
    reticle.element.style.pointerEvents = 'none'
    reticle.element.style.zIndex = '20'
    reticle.visible = false
    scene.add(reticle)
    reticles.set(id, reticle)
    return reticle
  }

  const remove = (id: string): boolean => {
    const reticle = reticles.get(id)
    if (!reticle) return false
    const changed = reticle.visible || targetReticleRenderState(reticle)?.visible === true
    disposeObject3D(reticle)
    reticles.delete(id)
    return changed
  }

  const syncIds = (candidateIds: readonly string[]): boolean => {
    let changed = false
    const live = new Set(candidateIds)
    for (const id of candidateIds) ensure(id)
    for (const id of Array.from(reticles.keys())) {
      if (!live.has(id)) changed = remove(id) || changed
    }
    return changed
  }

  const update = (options: {
    candidateIds: readonly string[]
    hitChances?: Readonly<Record<string, MoveAutomationTargetHitChance | undefined>>
    selectedIds?: readonly string[]
    renderObjects: Map<string, PokemonRenderObject>
    show: boolean
  }): boolean => {
    let changed = syncIds(options.show ? options.candidateIds : [])
    const candidateSet = new Set(options.candidateIds)
    const selectedSet = options.selectedIds ? new Set(options.selectedIds) : null
    for (const [id, reticle] of reticles) {
      const renderObject = options.renderObjects.get(id)
      const visible = Boolean(options.show && renderObject && candidateSet.has(id))
      if (!visible || !renderObject) {
        changed = setTargetReticleHidden(reticle) || changed
        continue
      }

      const selected = selectedSet ? selectedSet.has(id) : true
      const hitChance = options.hitChances?.[id]
      const scale = Math.max(0.95, renderObject.base * 0.95) / RETICLE_CSS_SIZE_PX
      const nextState: TargetReticleRenderState = {
        visible: true,
        hitChanceKey: targetReticleHitChanceKey(hitChance),
        selected,
        x: renderObject.currentCenter.x,
        y: reticleY(renderObject),
        z: renderObject.currentCenter.z,
        scale,
      }

      if (reticle.visible && sameTargetReticleRenderState(targetReticleRenderState(reticle), nextState)) {
        continue
      }

      updateTargetReticleElement(reticle.element, hitChance, selected)
      reticle.position.set(nextState.x, nextState.y, nextState.z)
      reticle.scale.setScalar(nextState.scale)
      reticle.visible = true
      rememberTargetReticleRenderState(reticle, nextState)
      changed = true
    }
    return changed
  }

  const dispose = () => {
    for (const id of Array.from(reticles.keys())) remove(id)
  }

  return { update, dispose }
}

const createFeedbackElement = (): HTMLElement => {
  const element = document.createElement('div')
  element.className = 'move-automation-roll-anchor'
  element.style.pointerEvents = 'none'
  element.style.zIndex = '30'

  const body = document.createElement('div')
  body.className = 'move-automation-roll'
  element.appendChild(body)

  return element
}

const formatRollModifier = (modifier: number): string =>
  modifier >= 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`

const hitRollFormulaText = (feedback: MoveAutomationFeedbackState): string => {
  const modifier = feedback.modifiedRoll - feedback.naturalRoll
  return `${feedback.naturalRoll} ${formatRollModifier(modifier)} = ${feedback.modifiedRoll}`
}

const hitRollText = (feedback: MoveAutomationFeedbackState): string =>
  `${hitRollFormulaText(feedback)} Hit Roll`

const outcomeText = (feedback: MoveAutomationFeedbackState): string => {
  if (!feedback.hit) return 'Miss'
  return feedback.crit ? 'Critical Hit' : 'Hit'
}

const conditionText = (condition: MoveAutomationFeedbackState['conditions'][number]): string | null => {
  if (condition.applied) return condition.condition
  if (condition.blockedBy) return `${condition.condition} immune`
  return null
}

const effectivenessText = (feedback: MoveAutomationFeedbackState): string => {
  if (feedback.effectiveness === 'super-effective') return 'Super Effective!'
  if (feedback.effectiveness === 'resisted') return 'Resisted..'
  return outcomeText(feedback)
}

const finalResultText = (feedback: MoveAutomationFeedbackState): string => {
  const parts: string[] = []
  if (feedback.damageResolved) parts.push(`${feedback.damageLoss} Damage`)
  for (const condition of feedback.conditions) {
    const text = conditionText(condition)
    if (text) parts.push(text)
  }
  return parts.length ? parts.join(' · ') : outcomeText(feedback)
}

const feedbackText = (feedback: MoveAutomationFeedbackState): string => {
  if (feedback.phase === 'rolling') return 'd20'
  if (feedback.phase === 'hit-roll') return hitRollText(feedback)
  if (feedback.phase === 'outcome') return outcomeText(feedback)
  if (feedback.phase === 'effectiveness') return effectivenessText(feedback)
  return finalResultText(feedback)
}

const feedbackUsesOutcomeTone = (feedback: MoveAutomationFeedbackState): boolean =>
  feedback.phase === 'outcome' || feedback.phase === 'effectiveness' || feedback.phase === 'damage'

const renderFeedbackText = (body: HTMLElement, text: string): boolean => {
  let changed = false
  if (body.dataset.rollGraphic) {
    delete body.dataset.rollGraphic
    body.removeAttribute('aria-label')
    body.removeAttribute('role')
    changed = true
  }
  if (body.textContent !== text) {
    body.textContent = text
    changed = true
  }
  return changed
}

const updateFeedbackElement = (element: HTMLElement, feedback: MoveAutomationFeedbackState): boolean => {
  let changed = false
  const body = element.querySelector<HTMLElement>('.move-automation-roll')
  if (!body) return changed

  const useOutcomeTone = feedbackUsesOutcomeTone(feedback)
  const bodyClassName = [
    'move-automation-roll',
    feedback.phase === 'rolling' ? 'is-rolling' : 'is-result',
    feedback.phase === 'hit-roll' ? 'is-hit-roll' : '',
    feedback.phase === 'effectiveness' && feedback.effectiveness ? `is-${feedback.effectiveness}` : '',
    useOutcomeTone ? (feedback.hit ? 'is-hit' : 'is-miss') : '',
    useOutcomeTone && feedback.crit ? 'is-crit' : '',
  ].filter(Boolean).join(' ')
  const text = feedbackText(feedback)
  const title = feedback.accuracyCheck == null
    ? 'This move cannot miss.'
    : `${hitRollText(feedback)}; AC ${feedback.accuracyCheck} (${feedback.targetEvasionLabel} ${feedback.targetEvasion})`

  if (body.className !== bodyClassName) {
    body.className = bodyClassName
    changed = true
  }
  changed = (feedback.phase === 'rolling'
    ? renderRollingD20Graphic(body)
    : renderFeedbackText(body, text)) || changed
  if (element.title !== title) {
    element.title = title
    changed = true
  }

  return changed
}

const feedbackY = (renderObject: PokemonRenderObject): number =>
  renderObject.currentCenter.y + Math.max(renderObject.height, renderObject.clearance) + 0.95

const feedbackAnchorsToUser = (feedback: MoveAutomationFeedbackState): boolean =>
  feedback.phase === 'rolling' || feedback.phase === 'hit-roll'

const feedbackAnchorRenderObject = (
  feedback: MoveAutomationFeedbackState,
  renderObjects: Map<string, PokemonRenderObject>,
): PokemonRenderObject | null => {
  const anchorId = feedbackAnchorsToUser(feedback) ? feedback.userId : feedback.targetId
  return renderObjects.get(anchorId)
    ?? (anchorId === feedback.targetId ? renderObjects.get(feedback.userId) : null)
    ?? null
}

interface MoveAutomationFeedbackRenderState {
  visible: boolean
  feedbackKey: string
  accentColor: string
  x: number
  y: number
  z: number
}

const MOVE_AUTOMATION_FEEDBACK_RENDER_STATE_KEY = 'rotomMoveAutomationFeedbackRenderState'

const moveAutomationFeedbackKey = (feedback: MoveAutomationFeedbackState): string => JSON.stringify({
  id: feedback.id,
  userId: feedback.userId,
  targetId: feedback.targetId,
  moveName: feedback.moveName,
  phase: feedback.phase,
  naturalRoll: feedback.naturalRoll,
  modifiedRoll: feedback.modifiedRoll,
  hit: feedback.hit,
  crit: feedback.crit,
  damageResolved: feedback.damageResolved,
  damageLoss: feedback.damageLoss,
  effectiveness: feedback.effectiveness,
  accuracyCheck: feedback.accuracyCheck,
  targetEvasionLabel: feedback.targetEvasionLabel,
  targetEvasion: feedback.targetEvasion,
  conditions: feedback.conditions,
})

const moveAutomationFeedbackRenderState = (
  sprite: CSS3DSprite,
): MoveAutomationFeedbackRenderState | null => {
  const state = sprite.userData[MOVE_AUTOMATION_FEEDBACK_RENDER_STATE_KEY]
  if (!state || typeof state !== 'object') return null

  const maybeState = state as Partial<MoveAutomationFeedbackRenderState>
  return typeof maybeState.visible === 'boolean'
    && typeof maybeState.feedbackKey === 'string'
    && typeof maybeState.accentColor === 'string'
    && typeof maybeState.x === 'number'
    && typeof maybeState.y === 'number'
    && typeof maybeState.z === 'number'
    ? maybeState as MoveAutomationFeedbackRenderState
    : null
}

const rememberMoveAutomationFeedbackRenderState = (
  sprite: CSS3DSprite,
  state: MoveAutomationFeedbackRenderState,
) => {
  sprite.userData[MOVE_AUTOMATION_FEEDBACK_RENDER_STATE_KEY] = state
}

const sameMoveAutomationFeedbackRenderState = (
  previous: MoveAutomationFeedbackRenderState | null,
  next: MoveAutomationFeedbackRenderState,
): boolean => Boolean(previous
  && previous.visible === next.visible
  && previous.feedbackKey === next.feedbackKey
  && previous.accentColor === next.accentColor
  && previous.x === next.x
  && previous.y === next.y
  && previous.z === next.z)

const setMoveAutomationFeedbackHidden = (sprite: CSS3DSprite): boolean => {
  const previous = moveAutomationFeedbackRenderState(sprite)
  const changed = sprite.visible || previous?.visible === true
  if (!changed && previous?.visible === false) return false

  sprite.visible = false
  rememberMoveAutomationFeedbackRenderState(sprite, {
    visible: false,
    feedbackKey: previous?.feedbackKey ?? '',
    accentColor: previous?.accentColor ?? '',
    x: sprite.position.x,
    y: sprite.position.y,
    z: sprite.position.z,
  })
  return changed
}

export const createMoveAreaTemplateRenderer = (scene: THREE.Scene) => {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)
  let signature = ''
  const cellSize = 0.92
  const cellInset = (1 - cellSize) / 2

  const disposeCells = () => {
    for (const child of [...group.children]) disposeObject3D(child)
  }

  const cellSignature = (cells: readonly GridAnchor[]): string =>
    cells.map((cell) => `${cell.x},${cell.y},${cell.z}`).join('|')

  const appendEdge = (
    segments: number[],
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => segments.push(ax, ay, az, bx, by, bz)

  const appendCellEdges = (segments: number[], cell: GridAnchor) => {
    const x0 = cell.x + cellInset
    const x1 = x0 + cellSize
    const y0 = cell.y + cellInset
    const y1 = y0 + cellSize
    const z0 = cell.z + cellInset
    const z1 = z0 + cellSize

    appendEdge(segments, x0, y0, z0, x1, y0, z0)
    appendEdge(segments, x1, y0, z0, x1, y0, z1)
    appendEdge(segments, x1, y0, z1, x0, y0, z1)
    appendEdge(segments, x0, y0, z1, x0, y0, z0)
    appendEdge(segments, x0, y1, z0, x1, y1, z0)
    appendEdge(segments, x1, y1, z0, x1, y1, z1)
    appendEdge(segments, x1, y1, z1, x0, y1, z1)
    appendEdge(segments, x0, y1, z1, x0, y1, z0)
    appendEdge(segments, x0, y0, z0, x0, y1, z0)
    appendEdge(segments, x1, y0, z0, x1, y1, z0)
    appendEdge(segments, x1, y0, z1, x1, y1, z1)
    appendEdge(segments, x0, y0, z1, x0, y1, z1)
  }

  const addCells = (cells: readonly GridAnchor[]) => {
    const geometry = new THREE.BoxGeometry(cellSize, cellSize, cellSize)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffc97a,
      transparent: true,
      opacity: 0.16,
      depthTest: true,
      depthWrite: false,
    })
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length)
    const matrix = new THREE.Matrix4()
    cells.forEach((cell, index) => {
      matrix.makeTranslation(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5)
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = 36
    group.add(mesh)

    const edgeSegments: number[] = []
    for (const cell of cells) appendCellEdges(edgeSegments, cell)
    const edgeGeometry = new THREE.BufferGeometry()
    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgeSegments, 3))
    edgeGeometry.computeBoundingSphere()
    const edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: 0xf7f7f2,
        transparent: true,
        opacity: 0.56,
        depthTest: true,
        depthWrite: false,
      }),
    )
    edges.renderOrder = 37
    group.add(edges)
  }

  const update = (options: { cells: readonly GridAnchor[]; show: boolean }) => {
    group.visible = Boolean(options.show && options.cells.length)
    if (!group.visible) return

    const nextSignature = cellSignature(options.cells)
    if (nextSignature === signature) return
    signature = nextSignature
    disposeCells()
    addCells(options.cells)
  }

  const dispose = () => {
    disposeCells()
    disposeObject3D(group)
  }

  return { update, dispose }
}

export const createMoveAutomationFeedbackRenderer = (scene: THREE.Scene) => {
  const sprite = new CSS3DSprite(createFeedbackElement())
  sprite.element.style.pointerEvents = 'none'
  sprite.element.style.zIndex = '30'
  sprite.visible = false
  sprite.scale.setScalar(FEEDBACK_WORLD_WIDTH / FEEDBACK_CSS_WIDTH_PX)
  scene.add(sprite)

  const update = (options: {
    feedback: MoveAutomationFeedbackState | null | undefined
    renderObjects: Map<string, PokemonRenderObject>
    show: boolean
  }): boolean => {
    const feedback = options.feedback
    const anchorObject = feedback ? feedbackAnchorRenderObject(feedback, options.renderObjects) : null
    const visible = Boolean(options.show && feedback && anchorObject)
    if (!visible || !feedback || !anchorObject) return setMoveAutomationFeedbackHidden(sprite)

    const accentObject = options.renderObjects.get(feedback.userId) ?? anchorObject
    const accentColor = normalizeTrainerAccentColor(accentObject.accentColor) ?? ''
    const nextState: MoveAutomationFeedbackRenderState = {
      visible: true,
      feedbackKey: moveAutomationFeedbackKey(feedback),
      accentColor,
      x: anchorObject.currentCenter.x,
      y: feedbackY(anchorObject),
      z: anchorObject.currentCenter.z,
    }

    if (sprite.visible && sameMoveAutomationFeedbackRenderState(moveAutomationFeedbackRenderState(sprite), nextState)) {
      return false
    }

    if (accentColor) setTrainerAccentCssVariables(sprite.element.style, accentColor)
    else clearTrainerAccentCssVariables(sprite.element.style)
    updateFeedbackElement(sprite.element, feedback)
    sprite.position.set(nextState.x, nextState.y, nextState.z)
    sprite.visible = true
    rememberMoveAutomationFeedbackRenderState(sprite, nextState)
    return true
  }

  const dispose = () => disposeObject3D(sprite)

  return { update, dispose }
}
