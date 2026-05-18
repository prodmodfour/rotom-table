import * as THREE from 'three'
import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'
import { getAnchorCenter } from '~/utils/gridGeometry'
import { tokenFacingForPlacement, tokenFacingVector } from '~/utils/tokenFacing'
import { buildVolumeMaterials, paintVolumeMaterials } from '~/utils/isometric/materials'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import { buildElevationBadge, updateElevationBadge } from '~/utils/isometric/tokenHud'
import type { WorldSpriteState } from '~/utils/isometric/types'
import {
  applyAnimationFrame,
  buildWorldSprite,
  disposeWorldSprite,
  setWorldSpriteInvalid,
  setWorldSpriteVisible,
  updateSpriteFacing,
  updateWorldSpriteLighting,
} from '~/utils/isometric/worldSprites'

export const createTokenMovePreviewRenderer = (containers: {
  scene: THREE.Scene
  group: THREE.Group
}) => {
  let ghostSprite: THREE.Sprite | null = null
  let ghostSpriteState: WorldSpriteState | null = null
  let elevationBadge: ReturnType<typeof buildElevationBadge> | null = null
  let volume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]> | null = null
  let edges: THREE.LineSegments | null = null
  let pathLine: THREE.Line | null = null
  let ownerId: string | null = null

  const disposeOwner = () => {
    disposeWorldSprite(ghostSpriteState)
    disposeObject3D(elevationBadge)
    disposeObject3D(volume)
    disposeObject3D(edges)
    ghostSprite = null
    ghostSpriteState = null
    elevationBadge = null
    volume = null
    edges = null
    ownerId = null
  }

  const ensurePathLine = () => {
    if (pathLine) return

    pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xff1f2d, // red active path trail
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
    ghostSpriteState = buildWorldSprite(pokemon, true)
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

    if (pathLine) {
      pathLine.visible = false
      pathLine.geometry.dispose()
      pathLine.geometry = new THREE.BufferGeometry()
    }
  }

  return {
    ensure,
    clear,
    disposeOwner,

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
      if (pathLine) {
        const points =
          options.path?.map((step) => {
            const waypoint = getAnchorCenter(step, options.pokemon.base)
            return new THREE.Vector3(
              waypoint.x,
              waypoint.y + options.pokemon.clearance / 2,
              waypoint.z,
            )
          }) ?? []

        pathLine.geometry.dispose()
        pathLine.geometry = new THREE.BufferGeometry().setFromPoints(points)
        pathLine.visible = points.length >= 2
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
      updateSpriteFacing(ghostSpriteState, {
        camera: options.camera,
        center: ghostCenter,
        facingDirection: tokenFacingVector(tokenFacingForPlacement(options.pokemon)),
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
    },
  }
}
