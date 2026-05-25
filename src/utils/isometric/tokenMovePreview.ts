import * as THREE from 'three'
import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'
import { getAnchorCenter } from '~/utils/gridGeometry'
import { tokenFacingForPlacement, tokenFacingTowardPoint, tokenFacingVector } from '~/utils/tokenFacing'
import {
  TACTICAL_SELECTION_HIGHLIGHT_COLOR,
  buildVolumeMaterials,
  paintVolumeMaterials,
} from '~/utils/isometric/materials'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import { buildElevationBadge, updateElevationBadge } from '~/utils/isometric/tokenHud'
import type { WorldSpriteState } from '~/utils/isometric/types'
import {
  createMovementPreviewAnimationState,
  movementPreviewAnimationStateNeedsFrame,
  type MovementPreviewAnimationState,
} from '~/utils/isometric/movementPreviewAnimation'
import {
  applyAnimationFrame,
  buildWorldSprite,
  disposeWorldSprite,
  setWorldSpriteInvalid,
  setWorldSpriteVisible,
  updateSpriteFacing,
  updateWorldSpriteLighting,
} from '~/utils/isometric/worldSprites'

const MIN_MOVEMENT_PATH_LINE_POINT_CAPACITY = 2

export interface MovementPathLineGeometryBuffer {
  readonly geometry: THREE.BufferGeometry
  pointCapacity: number
}

export const createMovementPathLineGeometryBuffer = (): MovementPathLineGeometryBuffer => {
  const geometry = new THREE.BufferGeometry()
  geometry.setDrawRange(0, 0)

  return {
    geometry,
    pointCapacity: 0,
  }
}

const ensureMovementPathLinePointCapacity = (
  buffer: MovementPathLineGeometryBuffer,
  pointCount: number,
) => {
  if (buffer.pointCapacity >= pointCount) return

  let nextCapacity = Math.max(
    MIN_MOVEMENT_PATH_LINE_POINT_CAPACITY,
    buffer.pointCapacity || MIN_MOVEMENT_PATH_LINE_POINT_CAPACITY,
  )
  while (nextCapacity < pointCount) nextCapacity *= 2

  const positionAttribute = new THREE.Float32BufferAttribute(new Float32Array(nextCapacity * 3), 3)
  positionAttribute.setUsage(THREE.DynamicDrawUsage)
  buffer.geometry.setAttribute('position', positionAttribute)
  buffer.pointCapacity = nextCapacity
}

export const resetMovementPathLineGeometry = (buffer: MovementPathLineGeometryBuffer) => {
  buffer.geometry.setDrawRange(0, 0)
  buffer.geometry.boundingBox = null
  buffer.geometry.boundingSphere = null
}

export const updateMovementPathLineGeometry = (
  buffer: MovementPathLineGeometryBuffer,
  options: {
    path: readonly GridAnchor[] | null | undefined
    base: number
    clearance: number
  },
) => {
  const path = options.path ?? []
  const pointCount = path.length
  if (pointCount <= 0) {
    resetMovementPathLineGeometry(buffer)
    return 0
  }

  ensureMovementPathLinePointCapacity(buffer, pointCount)

  const positionAttribute = buffer.geometry.getAttribute('position') as THREE.BufferAttribute
  const positions = positionAttribute.array as Float32Array
  for (let index = 0; index < pointCount; index += 1) {
    const step = path[index]
    const waypoint = getAnchorCenter(step, options.base)
    const offset = index * 3
    positions[offset] = waypoint.x
    positions[offset + 1] = waypoint.y + options.clearance / 2
    positions[offset + 2] = waypoint.z
  }

  positionAttribute.needsUpdate = true
  buffer.geometry.setDrawRange(0, pointCount)
  buffer.geometry.boundingBox = null
  buffer.geometry.boundingSphere = null
  return pointCount
}

export const createTokenMovePreviewRenderer = (containers: {
  scene: THREE.Scene
  group: THREE.Group
  onTextureLoadComplete?: () => void
}) => {
  let ghostSprite: THREE.Sprite | null = null
  let ghostSpriteState: WorldSpriteState | null = null
  let ghostAnchor: GridAnchor | null = null
  let elevationBadge: ReturnType<typeof buildElevationBadge> | null = null
  let volume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]> | null = null
  let edges: THREE.LineSegments | null = null
  let pathLine: THREE.Line | null = null
  let pathLineGeometryBuffer: MovementPathLineGeometryBuffer | null = null
  let ownerId: string | null = null

  const disposeOwner = () => {
    disposeWorldSprite(ghostSpriteState)
    disposeObject3D(elevationBadge)
    disposeObject3D(volume)
    disposeObject3D(edges)
    ghostSprite = null
    ghostSpriteState = null
    ghostAnchor = null
    elevationBadge = null
    volume = null
    edges = null
    ownerId = null
  }

  const ensurePathLine = () => {
    if (pathLine && pathLineGeometryBuffer) return

    disposeObject3D(pathLine)
    pathLineGeometryBuffer = createMovementPathLineGeometryBuffer()

    pathLine = new THREE.Line(
      pathLineGeometryBuffer.geometry,
      new THREE.LineBasicMaterial({
        color: TACTICAL_SELECTION_HIGHLIGHT_COLOR, // light orange active path trail
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      }),
    )
    pathLine.visible = false
    containers.group.add(pathLine)
  }

  const ensure = (pokemon: SpawnedPokemon) => {
    if (
      ownerId === pokemon.id &&
      ghostSprite &&
      ghostSpriteState &&
      elevationBadge &&
      volume &&
      edges &&
      pathLine
    ) {
      return true
    }

    disposeOwner()
    ensurePathLine()

    ownerId = pokemon.id
    ghostSpriteState = buildWorldSprite(pokemon, {
      ghost: true,
      onTextureLoadComplete: containers.onTextureLoadComplete,
    })
    ghostSprite = ghostSpriteState.sprite
    setWorldSpriteVisible(ghostSpriteState, false)
    containers.group.add(ghostSpriteState.halo)
    containers.group.add(ghostSprite)

    elevationBadge = buildElevationBadge(true)
    elevationBadge.visible = false
    containers.scene.add(elevationBadge)

    // Preview volume gets the same per-face shading as live pokemon
    // boxes, but tinted with white/red tactical feedback instead of the
    // neutral graphite ramp.
    volume = new THREE.Mesh(
      new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base),
      buildVolumeMaterials('reachable', 0.24),
    )
    volume.visible = false
    containers.group.add(volume)

    edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base)),
      new THREE.LineBasicMaterial({
        color: 0xf7f7f2, // bright white highlight on the preview box
        transparent: true,
        opacity: 0.92,
        depthTest: true,
        depthWrite: false,
      }),
    )
    edges.visible = false
    containers.group.add(edges)
    return true
  }

  const clear = () => {
    if (ghostSpriteState) {
      setWorldSpriteVisible(ghostSpriteState, false)
      setWorldSpriteInvalid(ghostSpriteState, false)
    }

    if (elevationBadge) elevationBadge.visible = false
    if (volume) volume.visible = false
    if (edges) edges.visible = false

    if (pathLine) pathLine.visible = false
    if (pathLineGeometryBuffer) resetMovementPathLineGeometry(pathLineGeometryBuffer)
  }

  const movementPreviewVisible = () => Boolean(
    ghostSpriteState?.sprite.visible ||
    ghostSpriteState?.halo.visible ||
    elevationBadge?.visible ||
    volume?.visible ||
    edges?.visible ||
    pathLine?.visible,
  )

  const getAnimationState = (): MovementPreviewAnimationState => createMovementPreviewAnimationState(
    movementPreviewVisible(),
    ghostSpriteState,
  )

  return {
    ensure,
    clear,
    disposeOwner,
    getAnimationState,

    needsAnimationFrame() {
      return movementPreviewAnimationStateNeedsFrame(getAnimationState())
    },

    update(options: {
      pokemon: SpawnedPokemon
      anchor: GridAnchor
      canForcePlace: boolean
      reachable: boolean
      path: GridAnchor[] | null
      groundLevelY: number
      camera: THREE.Camera | null
    }) {
      if (!ensure(options.pokemon) || !ghostSprite || !ghostSpriteState || !elevationBadge || !volume || !edges) {
        return false
      }

      const center = getAnchorCenter(options.anchor, options.pokemon.base)
      ghostAnchor = options.anchor
      ghostSprite.position.set(center.x, options.anchor.y, center.z)
      ghostSpriteState.halo.position.copy(ghostSprite.position)
      setWorldSpriteVisible(ghostSpriteState, true)
      setWorldSpriteInvalid(ghostSpriteState, !options.canForcePlace)

      volume.position.set(center.x, options.anchor.y + options.pokemon.clearance / 2, center.z)
      // Repaint all 6 faces with the appropriate brightness ramp.
      paintVolumeMaterials(
        volume.material,
        options.reachable ? 'reachable' : 'unreachable',
        options.reachable ? 0.24 : 0.22,
      )
      volume.visible = true

      ;(edges.material as THREE.LineBasicMaterial).color.set(options.reachable ? 0xf7f7f2 : 0xff4a55)
      edges.position.copy(volume.position)
      edges.visible = true

      updateElevationBadge({
        badge: elevationBadge,
        center: new THREE.Vector3(center.x, options.anchor.y, center.z),
        base: options.pokemon.base,
        elevation: options.anchor.y,
        groundLevelY: options.groundLevelY,
        camera: options.camera,
      })

      ensurePathLine()
      if (pathLine && pathLineGeometryBuffer) {
        const pointCount = updateMovementPathLineGeometry(pathLineGeometryBuffer, {
          path: options.path,
          base: options.pokemon.base,
          clearance: options.pokemon.clearance,
        })
        pathLine.visible = pointCount >= 2
      }

      return true
    },

    animate(options: {
      pokemon: SpawnedPokemon | null
      positionY: number | null
      camera: THREE.Camera
      frameNowMs: number
      spriteBrightness: number
      haloAlpha: number
    }) {
      if (!ghostSprite || !ghostSpriteState || !options.pokemon) return

      const ghostCenter = new THREE.Vector3(
        ghostSprite.position.x,
        options.positionY ?? options.pokemon.position.y,
        ghostSprite.position.z,
      )
      const currentFacing = tokenFacingForPlacement(options.pokemon)
      const previewFacing = ghostAnchor
        ? tokenFacingTowardPoint(options.pokemon.position, ghostAnchor, currentFacing) ?? currentFacing
        : currentFacing

      updateSpriteFacing(ghostSpriteState, {
        camera: options.camera,
        center: ghostCenter,
        facingDirection: tokenFacingVector(previewFacing),
        frontSpriteUrl: options.pokemon.spriteUrl,
        frontSpriteAnimation: options.pokemon.spriteAnimation,
        backSpriteUrl: options.pokemon.backSpriteUrl,
        backSpriteAnimation: options.pokemon.backSpriteAnimation,
        spriteCrop: options.pokemon.spriteCrop,
      })
      // Ghost gets the directional tint too so it previews how the
      // pokemon will be lit at the destination.
      if (ghostSpriteState.animationMeta) {
        applyAnimationFrame(ghostSpriteState, options.frameNowMs)
      }
      updateWorldSpriteLighting(ghostSpriteState, options.spriteBrightness, options.haloAlpha)
    },

    dispose() {
      clear()
      disposeOwner()
      disposeObject3D(pathLine)
      pathLine = null
      pathLineGeometryBuffer = null
    },
  }
}
