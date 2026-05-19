import * as THREE from 'three'
import { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import type { GridAnchor } from '~/types/map'
import type { MoveAutomationFeedbackState } from '~/types/moveAutomation'
import type { PokemonRenderObject } from '~/utils/isometric/types'

const RETICLE_CSS_SIZE_PX = 72
const FEEDBACK_CSS_WIDTH_PX = 118
const FEEDBACK_WORLD_WIDTH = 1.35

const createTargetReticleElement = (label: string): HTMLElement => {
  const element = document.createElement('div')
  element.className = 'move-target-reticle-anchor'
  element.setAttribute('aria-label', label)
  element.style.pointerEvents = 'none'

  const ring = document.createElement('div')
  ring.className = 'move-target-reticle'
  ring.setAttribute('aria-hidden', 'true')
  element.appendChild(ring)

  return element
}

const setReticleScale = (sprite: CSS3DSprite, renderObject: PokemonRenderObject) => {
  const worldWidth = Math.max(0.95, renderObject.base * 0.95)
  sprite.scale.setScalar(worldWidth / RETICLE_CSS_SIZE_PX)
}

const reticleY = (renderObject: PokemonRenderObject): number =>
  renderObject.currentCenter.y + Math.max(renderObject.height * 0.58, 0.45)

export const createMoveTargetingReticleRenderer = (scene: THREE.Scene) => {
  const reticles = new Map<string, CSS3DSprite>()

  const ensure = (id: string) => {
    let reticle = reticles.get(id)
    if (reticle) return reticle

    reticle = new CSS3DSprite(createTargetReticleElement('Move target'))
    reticle.visible = false
    scene.add(reticle)
    reticles.set(id, reticle)
    return reticle
  }

  const remove = (id: string) => {
    const reticle = reticles.get(id)
    if (!reticle) return
    disposeObject3D(reticle)
    reticles.delete(id)
  }

  const syncIds = (candidateIds: readonly string[]) => {
    const live = new Set(candidateIds)
    for (const id of candidateIds) ensure(id)
    for (const id of reticles.keys()) {
      if (!live.has(id)) remove(id)
    }
  }

  const update = (options: {
    candidateIds: readonly string[]
    renderObjects: Map<string, PokemonRenderObject>
    show: boolean
  }) => {
    syncIds(options.show ? options.candidateIds : [])
    const candidateSet = new Set(options.candidateIds)
    for (const [id, reticle] of reticles) {
      const renderObject = options.renderObjects.get(id)
      reticle.visible = Boolean(options.show && renderObject && candidateSet.has(id))
      if (!renderObject || !reticle.visible) continue
      reticle.position.set(
        renderObject.currentCenter.x,
        reticleY(renderObject),
        renderObject.currentCenter.z,
      )
      setReticleScale(reticle, renderObject)
    }
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

  const body = document.createElement('div')
  body.className = 'move-automation-roll'
  element.appendChild(body)

  return element
}

const resultText = (feedback: MoveAutomationFeedbackState): string => {
  if (!feedback.hit) return `${feedback.naturalRoll} Miss`
  const parts = [`${feedback.naturalRoll} Hit`]
  if (feedback.crit) parts.push('Crit')
  if (feedback.damageLoss > 0) parts.push(`${feedback.damageLoss} HP`)
  for (const condition of feedback.conditions) {
    if (condition.applied) parts.push(condition.condition)
    else if (condition.blockedBy) parts.push(`${condition.condition} immune`)
  }
  return parts.join(' · ')
}

const updateFeedbackElement = (element: HTMLElement, feedback: MoveAutomationFeedbackState) => {
  const body = element.querySelector<HTMLElement>('.move-automation-roll')
  if (!body) return

  body.className = [
    'move-automation-roll',
    feedback.phase === 'rolling' ? 'is-rolling' : 'is-result',
    feedback.hit ? 'is-hit' : 'is-miss',
    feedback.crit ? 'is-crit' : '',
  ].filter(Boolean).join(' ')
  body.textContent = feedback.phase === 'rolling' ? 'd20' : resultText(feedback)
  element.title = feedback.accuracyCheck == null
    ? 'This move cannot miss.'
    : `Accuracy ${feedback.modifiedRoll} vs AC ${feedback.accuracyCheck} (${feedback.targetEvasionLabel} ${feedback.targetEvasion})`
}

const feedbackY = (renderObject: PokemonRenderObject): number =>
  renderObject.currentCenter.y + Math.max(renderObject.height, renderObject.clearance) + 0.95

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
      color: 0xff1f2d,
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
  sprite.visible = false
  sprite.scale.setScalar(FEEDBACK_WORLD_WIDTH / FEEDBACK_CSS_WIDTH_PX)
  scene.add(sprite)

  const update = (options: {
    feedback: MoveAutomationFeedbackState | null | undefined
    renderObjects: Map<string, PokemonRenderObject>
    show: boolean
  }) => {
    const feedback = options.feedback
    const renderObject = feedback ? options.renderObjects.get(feedback.userId) : null
    sprite.visible = Boolean(options.show && feedback && renderObject)
    if (!feedback || !renderObject || !sprite.visible) return

    updateFeedbackElement(sprite.element, feedback)
    sprite.position.set(
      renderObject.currentCenter.x,
      feedbackY(renderObject),
      renderObject.currentCenter.z,
    )
  }

  const dispose = () => disposeObject3D(sprite)

  return { update, dispose }
}
