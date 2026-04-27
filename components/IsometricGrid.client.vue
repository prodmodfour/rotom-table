<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS3DRenderer, CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { GridVoxel, VoxelMaterial } from '~/types/grid'
import type { PreviewState } from '~/utils/grid'
import { findPathForPokemon, getAnchorCenter, getPokemonCenter } from '~/utils/grid'
import {
  buildFacePalette,
  buildVoxelOccupancy,
  cellInsidePokemonFootprint,
  getMaterialDef,
  parseHexColor,
  voxelBaseColor,
  voxelGroupKey,
  voxelKey,
} from '~/utils/voxels'

export type BuildTool = 'pencil' | 'eraser'

const props = defineProps<{
  dimensions: GridDimensions
  pokemons: SpawnedPokemon[]
  selectedId: string | null
  voxels: GridVoxel[]
  buildMode: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'preview-change', preview: PreviewState): void
  (event: 'place-voxel', voxel: GridVoxel): void
  (event: 'remove-voxel', cell: { x: number; y: number; z: number }): void
}>()

interface PokemonRenderObject {
  sprite: CSS3DSprite
  elevationBadge: CSS3DSprite
  hpBar: CSS3DSprite
  /**
   * Volume box wrapping the pokemon's footprint × clearance. Uses a
   * 6-material array so we can paint each face with the gruvbox
   * top/left/right brightness ramp (see ``TERRAIN_PALETTE``).
   */
  volume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]>
  edges: THREE.LineSegments
  proxy: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  /** Soft radial-gradient disc on the floor; the "planted on the ground" cue. */
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  currentCenter: THREE.Vector3
  targetCenter: THREE.Vector3
  width: number
  height: number
  base: number
  clearance: number
  elevation: number
  spriteUrl: string
  backSpriteUrl?: string
  turned: boolean
  currentHp: number
  maxHp: number
}

interface VoxelGroup {
  key: string
  geometry: THREE.BoxGeometry
  materials: THREE.MeshBasicMaterial[]
  mesh: THREE.InstancedMesh
  voxels: GridVoxel[]
}

interface BuildTarget {
  action: 'place' | 'remove'
  cell: { x: number; y: number; z: number }
  valid: boolean
}

/**
 * Gruvbox terrain palette for isometric face shading.
 *
 * The classic isometric trick is roughly 100 / 80 / 60 % brightness for
 * top / left / right faces. With gruvbox we step bg3 → bg2 → bg1
 * (and dark/neutral/bright for accent variants) so everything stays
 * in-palette without any literal HSL math.
 *
 * Opposite faces share roles so 90° azimuth rotations preserve the
 * lighting pattern: ±X faces are always the "shadow" axis, ±Z faces
 * are always the "side" axis, and ±Y is top/bottom.
 */
const TERRAIN_PALETTE = {
  idle: {
    // fg-band rather than bg-band so the cage sits visually above the
    // terrain's brightness range. Terrain pulls from gruvbox bg/mid,
    // sprites pull from bright accents — the cage takes the fg/grey
    // band in between, giving each layer its own zone instead of the
    // cage merging with the grid underneath it.
    top:    0xbdae93, // fg3 — lit top
    side:   0xa89984, // fg4 — Z-perp visible side
    shadow: 0x7c6f64, // bg4 — X-perp shadowed side (sharpened ramp so
                      //       top↔shadow contrast reads across the table)
    bottom: 0x665c54, // bg3 — floor of the cage (rarely seen)
  },
  selected: {
    top:    0xfabd2f, // yellow bright
    side:   0xd79921, // yellow neutral
    shadow: 0xb57614, // yellow faded
    bottom: 0x79740e, // yellow dim
  },
  reachable: {
    top:    0xfabd2f,
    side:   0xd79921,
    shadow: 0xb57614,
    bottom: 0x79740e,
  },
  unreachable: {
    top:    0xfb4934, // red bright
    side:   0xcc241d, // red neutral
    shadow: 0x9d0006, // red faded
    bottom: 0x79190f, // red dim
  },
} as const

type TerrainVariant = keyof typeof TERRAIN_PALETTE

/**
 * Build a 6-material array for a ``THREE.BoxGeometry`` with gruvbox
 * face shading. BoxGeometry face groups are ordered
 * ``+X, -X, +Y, -Y, +Z, -Z`` — we map opposing faces to the same role
 * so the box reads consistently regardless of camera azimuth.
 */
const buildVolumeMaterials = (
  variant: TerrainVariant,
  opacity: number,
): THREE.MeshBasicMaterial[] => {
  const palette = TERRAIN_PALETTE[variant]
  const make = (color: number) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
    })

  return [
    make(palette.shadow), // +X — "right" visible from default isometric
    make(palette.shadow), // -X — becomes "right" after 180° rotation
    make(palette.top),    // +Y — top
    make(palette.bottom), // -Y — bottom
    make(palette.side),   // +Z — "left" visible from default isometric
    make(palette.side),   // -Z — becomes "left" after 180° rotation
  ]
}

/**
 * Re-tint an existing per-face material array in place. Avoids
 * disposing/recreating materials when state flips (selected,
 * reachable, etc.).
 */
const paintVolumeMaterials = (
  materials: THREE.MeshBasicMaterial[],
  variant: TerrainVariant,
  opacity: number,
) => {
  const palette = TERRAIN_PALETTE[variant]
  const colors: ReadonlyArray<number> = [
    palette.shadow, // +X
    palette.shadow, // -X
    palette.top,    // +Y
    palette.bottom, // -Y
    palette.side,   // +Z
    palette.side,   // -Z
  ]
  for (let i = 0; i < materials.length; i += 1) {
    materials[i].color.setHex(colors[i])
    materials[i].opacity = opacity
    materials[i].transparent = opacity < 1
  }
}

/**
 * Lazily-built canvas texture used as ``.map`` on voxel top faces. We
 * draw a thin dark border on the edges so adjacent voxels' top faces
 * butt up to form a grid pattern — same role the floor's bg0_h seam
 * lines play for the bare tabletop, but only on +Y. Sides and shadows
 * stay solid (the elevation badge handles vertical counting).
 *
 * Module-level lazy init so we only build the canvas after the
 * component mounts (the ``.client.vue`` suffix already gates this on
 * the browser, so ``document`` exists).
 */
let topFaceGridTexture: THREE.CanvasTexture | null = null

const getTopFaceGridTexture = (): THREE.CanvasTexture => {
  if (topFaceGridTexture) return topFaceGridTexture
  const canvas = document.createElement('canvas')
  const size = 64
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  // White interior so the face's solid ``color`` shows through
  // unchanged after the texture multiply.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  // Mid-gray border = ~0.45 multiplier on the face color, giving a
  // darker-but-in-hue grout line (deep green seams on grass tops,
  // deep brown on dirt, etc.) instead of pure-black tile lines.
  ctx.fillStyle = '#737373'
  const seam = 2
  ctx.fillRect(0, 0, size, seam)
  ctx.fillRect(0, size - seam, size, seam)
  ctx.fillRect(0, 0, seam, size)
  ctx.fillRect(size - seam, 0, seam, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  topFaceGridTexture = texture
  return texture
}

/**
 * Lazily-built radial-gradient texture for sprite contact shadows. A
 * soft dark blob laid flat on the floor under each pokemon — the
 * "this thing is sitting on the world" cue the cage alone can't give.
 * Tinted ``bg0_h`` (warm near-black, same as floor seam lines) so the
 * shadow blends into the gruvbox palette instead of reading as a hard
 * black decal.
 */
let contactShadowTexture: THREE.CanvasTexture | null = null

const getContactShadowTexture = (): THREE.CanvasTexture => {
  if (contactShadowTexture) return contactShadowTexture
  const canvas = document.createElement('canvas')
  const size = 128
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  const center = size / 2
  // Radial fade from opaque core to fully-transparent rim. The 0.85
  // stop ensures the geometry's edge sits in transparent territory so
  // the disc has no visible boundary.
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0,    'rgba(29, 32, 33, 0.78)') // bg0_h core
  gradient.addColorStop(0.55, 'rgba(29, 32, 33, 0.42)')
  gradient.addColorStop(0.85, 'rgba(29, 32, 33, 0)')
  gradient.addColorStop(1,    'rgba(29, 32, 33, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  contactShadowTexture = texture
  return texture
}

/**
 * Build a 6-material array for a solid voxel block from a single
 * base color, applying the same isometric brightness ramp used for
 * pokemon volume boxes. Only +Y gets the grid-line texture — sides
 * stay solid since lateral seams aren't needed for movement clarity.
 */
const buildVoxelFaceMaterials = (baseColor: number): THREE.MeshBasicMaterial[] => {
  const palette = buildFacePalette(baseColor)
  const make = (color: number) => new THREE.MeshBasicMaterial({ color })
  const top = make(palette.top)
  top.map = getTopFaceGridTexture()
  return [
    make(palette.shadow), // +X
    make(palette.shadow), // -X
    top,                  // +Y — textured grid lines for cell-counting
    make(palette.bottom), // -Y
    make(palette.side),   // +Z
    make(palette.side),   // -Z
  ]
}

/**
 * Re-tint a 6-material array using a base color + per-face palette.
 * Used by the build ghost preview which switches between the active
 * material color and a red "blocked / erase" tint.
 */
const paintBuildGhostMaterials = (
  materials: THREE.MeshBasicMaterial[],
  baseColor: number,
  opacity: number,
) => {
  const palette = buildFacePalette(baseColor)
  const colors: ReadonlyArray<number> = [
    palette.shadow,
    palette.shadow,
    palette.top,
    palette.bottom,
    palette.side,
    palette.side,
  ]
  for (let i = 0; i < materials.length; i += 1) {
    materials[i].color.setHex(colors[i])
    materials[i].opacity = opacity
    materials[i].transparent = opacity < 1
  }
}

const SPRITE_PIXELS_PER_METRE = 128
const ELEVATION_BADGE_PIXELS_PER_METRE = 48
const HP_BAR_PIXELS_PER_METRE = 48
const ISO_POLAR_ANGLE = THREE.MathUtils.degToRad(54.735610317245346)
const ISO_AZIMUTH_ANGLE = THREE.MathUtils.degToRad(45)
const DEFAULT_FACING_DIRECTION = new THREE.Vector2(
  Math.cos(ISO_AZIMUTH_ANGLE),
  Math.sin(ISO_AZIMUTH_ANGLE),
)
const EMPTY_PREVIEW: PreviewState = {
  position: null,
  reachable: false,
  pathLength: 0,
}

const container = ref<HTMLDivElement | null>(null)
const contextMenu = ref<{ x: number; y: number; id: string; canTurn: boolean } | null>(null)
const selectedPokemon = computed(
  () => props.pokemons.find((pokemon) => pokemon.id === props.selectedId) ?? null,
)
const voxelOccupancy = computed(() => buildVoxelOccupancy(props.voxels))

const scene = new THREE.Scene()
const raycaster = new THREE.Raycaster()
const gridGroup = new THREE.Group()
const worldGroup = new THREE.Group()
const previewGroup = new THREE.Group()
const voxelContainer = new THREE.Group()
const clock = new THREE.Clock()

scene.add(gridGroup)
scene.add(worldGroup)
scene.add(previewGroup)
worldGroup.add(voxelContainer)

const renderObjects = new Map<string, PokemonRenderObject>()
const voxelGroups = new Map<string, VoxelGroup>()
let renderer: THREE.WebGLRenderer | null = null
let cssRenderer: CSS3DRenderer | null = null
let camera: THREE.OrthographicCamera | null = null
let controls: OrbitControls | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrame = 0
let floorGridLines: THREE.LineSegments | null = null
let moveGridLines: THREE.LineSegments | null = null
let floorPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
let ghostSprite: CSS3DSprite | null = null
let previewElevationBadge: CSS3DSprite | null = null
let previewVolume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]> | null = null
let previewEdges: THREE.LineSegments | null = null
let previewPathLine: THREE.Line | null = null
let previewOwnerId: string | null = null
let buildGhost: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]> | null = null
let buildGhostEdges: THREE.LineSegments | null = null
let activePreview: PreviewState = { ...EMPTY_PREVIEW }
let activePreviewAnchor: GridAnchor | null = null
let pointerDown = { x: 0, y: 0 }
let pointerTravel = 0
let lastPointerCoords: { clientX: number; clientY: number } | null = null

const getPreviewLayerY = () => activePreviewAnchor?.y ?? selectedPokemon.value?.position.y ?? 0

const getSceneTarget = () =>
  new THREE.Vector3(props.dimensions.x / 2, 0, props.dimensions.z / 2)

const buildFloorGridGeometry = (dimensions: GridDimensions) => {
  const points: number[] = []
  const y = 0.02

  for (let z = 0; z <= dimensions.z; z += 1) {
    points.push(0, y, z, dimensions.x, y, z)
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    points.push(x, y, 0, x, y, dimensions.z)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return geometry
}

const buildMoveGridGeometry = (dimensions: GridDimensions) => {
  const points: number[] = []

  for (let y = 1; y <= dimensions.y; y += 1) {
    for (let z = 0; z <= dimensions.z; z += 1) {
      points.push(0, y, z, dimensions.x, y, z)
    }
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    for (let z = 0; z <= dimensions.z; z += 1) {
      points.push(x, 0, z, x, dimensions.y, z)
    }
  }

  for (let x = 0; x <= dimensions.x; x += 1) {
    for (let y = 1; y <= dimensions.y; y += 1) {
      points.push(x, y, 0, x, y, dimensions.z)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return geometry
}

const buildSprite = (pokemon: SpawnedPokemon, ghost = false) => {
  const wrapper = document.createElement('div')
  wrapper.className = `pokemon-sprite${ghost ? ' is-ghost' : ''}`
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.style.pointerEvents = 'none'
  wrapper.style.width = `${Math.max(0.1, pokemon.width) * SPRITE_PIXELS_PER_METRE}px`
  wrapper.style.height = `${Math.max(0.1, pokemon.height) * SPRITE_PIXELS_PER_METRE}px`

  const image = document.createElement('img')
  image.src = pokemon.spriteUrl
  image.alt = pokemon.species
  image.draggable = false

  if (pokemon.spriteCrop) {
    wrapper.style.position = 'relative'
    wrapper.style.overflow = 'hidden'

    image.style.position = 'absolute'
    image.style.width = `${(pokemon.spriteCrop.canvasWidth / pokemon.spriteCrop.width) * 100}%`
    image.style.height = `${(pokemon.spriteCrop.canvasHeight / pokemon.spriteCrop.height) * 100}%`
    image.style.left = `${-(pokemon.spriteCrop.left / pokemon.spriteCrop.width) * 100}%`
    image.style.top = `${-(pokemon.spriteCrop.top / pokemon.spriteCrop.height) * 100}%`
    image.style.objectFit = 'fill'
  }

  wrapper.appendChild(image)

  const sprite = new CSS3DSprite(wrapper)
  sprite.element.style.pointerEvents = 'none'
  sprite.scale.setScalar(1 / SPRITE_PIXELS_PER_METRE)
  sprite.visible = true
  return sprite
}

const getSpriteImageElement = (sprite: CSS3DSprite) =>
  sprite.element.querySelector('img') as HTMLImageElement | null

const buildElevationBadge = (ghost = false) => {
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

const buildHpBar = () => {
  const wrapper = document.createElement('div')
  wrapper.className = 'hp-bar'
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.style.pointerEvents = 'none'

  const fill = document.createElement('div')
  fill.className = 'hp-bar__fill'
  wrapper.appendChild(fill)

  // CSS3DSprite billboards to the camera so the bar reads as a flat ribbon
  // floating above the sprite regardless of orbit angle.
  const bar = new CSS3DSprite(wrapper)
  bar.element.style.pointerEvents = 'none'
  bar.scale.setScalar(1 / HP_BAR_PIXELS_PER_METRE)
  bar.visible = false
  return bar
}

/**
 * Flat circular contact shadow under a pokemon sprite. Slightly larger
 * than the cage footprint so the soft alpha rim spills past the cage
 * edges, anchoring the billboarded sprite to the ground.
 */
const buildContactShadow = (
  pokemon: SpawnedPokemon,
): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> => {
  const radius = Math.max(pokemon.base, 0.5) * 0.6
  const geometry = new THREE.CircleGeometry(radius, 32)
  const material = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  // Lay flat on the XZ plane so the disc reads as ground shadow.
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

const shouldUseFrontSprite = (center: THREE.Vector3, turned = false) => {
  if (!camera) {
    return true
  }

  const toCamera = new THREE.Vector2(camera.position.x - center.x, camera.position.z - center.z)

  if (toCamera.lengthSq() === 0) {
    return true
  }

  toCamera.normalize()
  const facing = DEFAULT_FACING_DIRECTION.clone().multiplyScalar(turned ? -1 : 1)

  return facing.dot(toCamera) >= 0
}

const updateSpriteFacing = (
  sprite: CSS3DSprite,
  center: THREE.Vector3,
  frontSpriteUrl: string,
  backSpriteUrl?: string,
  turned = false,
) => {
  const image = getSpriteImageElement(sprite)

  if (!image) {
    return
  }

  const nextSrc = backSpriteUrl && !shouldUseFrontSprite(center, turned) ? backSpriteUrl : frontSpriteUrl

  if (image.dataset.currentSrc !== nextSrc) {
    image.src = nextSrc
    image.dataset.currentSrc = nextSrc
  }
}

const disposeObject3D = (object: THREE.Object3D | null) => {
  if (!object) {
    return
  }

  object.parent?.remove(object)

  const mesh = object as THREE.Mesh
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined
  const material = mesh.material as THREE.Material | THREE.Material[] | undefined

  geometry?.dispose?.()

  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose()
    }
  } else {
    material?.dispose?.()
  }

  if ('element' in object && object.element instanceof HTMLElement) {
    object.element.remove()
  }
}

const setOrthographicFrustum = () => {
  if (!camera || !container.value) {
    return
  }

  const bounds = container.value.getBoundingClientRect()
  const aspect = bounds.width / Math.max(bounds.height, 1)
  const frustumSize = Math.max(props.dimensions.x, props.dimensions.y, props.dimensions.z) * 1.7

  camera.left = (-frustumSize * aspect) / 2
  camera.right = (frustumSize * aspect) / 2
  camera.top = frustumSize / 2
  camera.bottom = -frustumSize / 2
  camera.near = -frustumSize * 6
  camera.far = frustumSize * 6
  camera.updateProjectionMatrix()
}

const syncRendererSize = () => {
  if (!renderer || !cssRenderer || !container.value) {
    return
  }

  const bounds = container.value.getBoundingClientRect()
  renderer.setSize(bounds.width, bounds.height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  cssRenderer.setSize(bounds.width, bounds.height)
  setOrthographicFrustum()
}

const alignCameraToGrid = (initial = false) => {
  if (!camera || !controls) {
    return
  }

  const nextTarget = getSceneTarget()

  if (initial) {
    const radius = Math.max(props.dimensions.x, props.dimensions.y, props.dimensions.z) * 2.1
    camera.position.set(
      nextTarget.x + radius * Math.sin(ISO_POLAR_ANGLE) * Math.cos(ISO_AZIMUTH_ANGLE),
      nextTarget.y + radius * Math.cos(ISO_POLAR_ANGLE),
      nextTarget.z + radius * Math.sin(ISO_POLAR_ANGLE) * Math.sin(ISO_AZIMUTH_ANGLE),
    )
  } else {
    const offset = camera.position.clone().sub(controls.target)
    camera.position.copy(nextTarget.clone().add(offset))
  }

  controls.target.copy(nextTarget)
  controls.update()
}

const updateGridVisibility = () => {
  const isMovingPokemon = Boolean(selectedPokemon.value)

  if (floorGridLines) {
    floorGridLines.visible = true
  }

  if (moveGridLines) {
    moveGridLines.visible = isMovingPokemon || props.buildMode
  }
}

const buildGrid = () => {
  disposeObject3D(floorGridLines)
  disposeObject3D(moveGridLines)
  disposeObject3D(floorPlane)

  // Gruvbox terrain seam lines: bg0_h, the same warm near-black as the
  // page background. Per the reference palette, seam lines should
  // "keep the grid legible without harsh contrast" — they read as
  // dark grout between lit tiles rather than a bright overlay.
  floorGridLines = new THREE.LineSegments(
    buildFloorGridGeometry(props.dimensions),
    new THREE.LineBasicMaterial({
      color: 0x1d2021, // bg0_h
      transparent: true,
      opacity: 0.85,
    }),
  )
  gridGroup.add(floorGridLines)

  moveGridLines = new THREE.LineSegments(
    buildMoveGridGeometry(props.dimensions),
    new THREE.LineBasicMaterial({
      color: 0x1d2021,
      transparent: true,
      opacity: 0.01,
    }),
  )
  gridGroup.add(moveGridLines)

  // Floor plane = the lit "top" of the tabletop. bg2 is the classic
  // gruvbox "left/mid face" tone but feels right for a horizontal
  // surface that catches no direct sun in the per-face ramp — it
  // sits just below the bg3 box-tops so anything placed on the grid
  // visually pops upward.
  floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(props.dimensions.x, props.dimensions.z),
    new THREE.MeshBasicMaterial({
      color: 0x504945, // bg2 — lit horizontal surface
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  floorPlane.rotation.x = -Math.PI / 2
  floorPlane.position.set(props.dimensions.x / 2, 0, props.dimensions.z / 2)
  gridGroup.add(floorPlane)

  updateGridVisibility()
}

const getElevationBadgeOffset = (center: THREE.Vector3, base: number) => {
  const inset = Math.min(0.18, base / 4)
  const edgeOffset = Math.max(base / 2 - inset, 0)

  if (!camera) {
    return {
      x: edgeOffset,
      z: edgeOffset,
    }
  }

  return {
    x: (camera.position.x >= center.x ? 1 : -1) * edgeOffset,
    z: (camera.position.z >= center.z ? 1 : -1) * edgeOffset,
  }
}

const updateElevationBadge = (
  badge: CSS3DSprite,
  center: THREE.Vector3,
  base: number,
  elevation: number,
) => {
  if (elevation <= 0) {
    badge.visible = false
    return
  }

  const offset = getElevationBadgeOffset(center, base)
  badge.position.set(center.x + offset.x, center.y + 0.08, center.z + offset.z)
  badge.element.textContent = `${elevation} ↑`
  badge.visible = true
}

const hpTierForRatio = (ratio: number): 'critical' | 'wounded' | 'healthy' => {
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'wounded'
  return 'healthy'
}

const updateHpBar = (
  bar: CSS3DSprite,
  center: THREE.Vector3,
  spriteHeight: number,
  currentHp: number,
  maxHp: number,
) => {
  // Hidden at full HP (per spec) and when there's nothing meaningful to
  // show (max ≤ 0).
  if (maxHp <= 0 || currentHp >= maxHp) {
    bar.visible = false
    return
  }

  const ratio = Math.max(0, Math.min(1, currentHp / maxHp))
  const fill = bar.element.firstElementChild as HTMLElement | null
  if (fill) {
    fill.style.width = `${ratio * 100}%`
  }
  bar.element.dataset.hpTier = hpTierForRatio(ratio)

  // Floats just above the sprite's head; the sprite is centered at
  // ``center.y + spriteHeight / 2`` so its top edge sits at
  // ``center.y + spriteHeight``.
  bar.position.set(center.x, center.y + spriteHeight + 0.18, center.z)
  bar.visible = true
}

const buildRenderObject = (pokemon: SpawnedPokemon): PokemonRenderObject => {
  const sprite = buildSprite(pokemon)
  const elevationBadge = buildElevationBadge()
  const hpBar = buildHpBar()
  const shadow = buildContactShadow(pokemon)
  const volumeGeometry = new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base)
  // Per-face gruvbox shading: top=fg3, Z-sides=fg4, X-sides=gray.
  // Sits in the foreground brightness band so the cage reads above
  // the bg-band terrain instead of merging with it.
  const volume = new THREE.Mesh(
    volumeGeometry,
    buildVolumeMaterials('idle', 0.28),
  )

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(volumeGeometry),
    new THREE.LineBasicMaterial({
      color: 0xa89984, // fg4
      transparent: true,
      opacity: 0.55,
    }),
  )

  const pickWidth = Math.max(pokemon.base, pokemon.width, 1)
  const pickHeight = Math.max(pokemon.clearance, pokemon.height, 1)
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(pickWidth, pickHeight, pickWidth),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  )
  proxy.userData.pokemonId = pokemon.id

  const center = getPokemonCenter(pokemon)
  const currentCenter = new THREE.Vector3(center.x, center.y, center.z)
  const targetCenter = currentCenter.clone()

  worldGroup.add(shadow)
  worldGroup.add(volume)
  worldGroup.add(edges)
  worldGroup.add(proxy)
  scene.add(sprite)
  scene.add(elevationBadge)
  scene.add(hpBar)

  return {
    sprite,
    elevationBadge,
    hpBar,
    volume,
    edges,
    proxy,
    shadow,
    currentCenter,
    targetCenter,
    width: pokemon.width,
    height: pokemon.height,
    base: pokemon.base,
    clearance: pokemon.clearance,
    elevation: pokemon.position.y,
    spriteUrl: pokemon.spriteUrl,
    backSpriteUrl: pokemon.backSpriteUrl,
    turned: Boolean(pokemon.turned),
    currentHp: pokemon.currentHp,
    maxHp: pokemon.maxHp,
  }
}

const applyRenderObjectPosition = (renderObject: PokemonRenderObject) => {
  renderObject.sprite.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + renderObject.height / 2,
    renderObject.currentCenter.z,
  )
  renderObject.volume.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + renderObject.clearance / 2,
    renderObject.currentCenter.z,
  )
  renderObject.edges.position.copy(renderObject.volume.position)
  renderObject.proxy.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + Math.max(renderObject.height, renderObject.clearance) / 2,
    renderObject.currentCenter.z,
  )
  // Tiny y-offset keeps the shadow above the floor plane / voxel top
  // it sits on, avoiding z-fighting without lifting it visibly off
  // the surface.
  renderObject.shadow.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + 0.005,
    renderObject.currentCenter.z,
  )
  updateElevationBadge(
    renderObject.elevationBadge,
    renderObject.currentCenter,
    renderObject.base,
    renderObject.elevation,
  )
  updateHpBar(
    renderObject.hpBar,
    renderObject.currentCenter,
    renderObject.height,
    renderObject.currentHp,
    renderObject.maxHp,
  )
}

const refreshPokemonStyles = () => {
  for (const pokemon of props.pokemons) {
    const renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      continue
    }

    const selected = props.selectedId === pokemon.id
    // Re-tint the per-face material array with the appropriate
    // gruvbox terrain ramp instead of a single solid color.
    paintVolumeMaterials(
      renderObject.volume.material,
      selected ? 'selected' : 'idle',
      selected ? 0.32 : 0.28,
    )
    ;(renderObject.edges.material as THREE.LineBasicMaterial).color.set(selected ? 0xfbf1c7 : 0xa89984)
    ;(renderObject.edges.material as THREE.LineBasicMaterial).opacity = selected ? 0.95 : 0.55
  }
}

const syncPokemonObjects = () => {
  const nextIds = new Set(props.pokemons.map((pokemon) => pokemon.id))

  for (const [id, renderObject] of renderObjects.entries()) {
    if (nextIds.has(id)) {
      continue
    }

    disposeObject3D(renderObject.sprite)
    disposeObject3D(renderObject.elevationBadge)
    disposeObject3D(renderObject.hpBar)
    disposeObject3D(renderObject.volume)
    disposeObject3D(renderObject.edges)
    disposeObject3D(renderObject.proxy)
    disposeObject3D(renderObject.shadow)
    renderObjects.delete(id)
  }

  for (const pokemon of props.pokemons) {
    let renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      renderObject = buildRenderObject(pokemon)
      renderObjects.set(pokemon.id, renderObject)
      applyRenderObjectPosition(renderObject)
    }

    const center = getPokemonCenter(pokemon)
    renderObject.targetCenter.set(center.x, center.y, center.z)
    renderObject.elevation = pokemon.position.y
    renderObject.spriteUrl = pokemon.spriteUrl
    renderObject.backSpriteUrl = pokemon.backSpriteUrl
    renderObject.turned = Boolean(pokemon.turned)
    renderObject.currentHp = pokemon.currentHp
    renderObject.maxHp = pokemon.maxHp
  }

  refreshPokemonStyles()
}

const disposeVoxelGroup = (group: VoxelGroup) => {
  voxelContainer.remove(group.mesh)
  group.mesh.dispose()
  group.geometry.dispose()
  for (const material of group.materials) material.dispose()
}

const disposeAllVoxelGroups = () => {
  for (const group of voxelGroups.values()) {
    disposeVoxelGroup(group)
  }
  voxelGroups.clear()
}

const syncVoxelMeshes = () => {
  // Bucket voxels by group key so visually identical voxels share
  // an InstancedMesh.
  const buckets = new Map<string, GridVoxel[]>()
  for (const voxel of props.voxels) {
    const key = voxelGroupKey(voxel)
    let arr = buckets.get(key)
    if (!arr) {
      arr = []
      buckets.set(key, arr)
    }
    arr.push(voxel)
  }

  // Drop groups that no longer have any voxels.
  for (const [key, group] of voxelGroups.entries()) {
    if (!buckets.has(key)) {
      disposeVoxelGroup(group)
      voxelGroups.delete(key)
    }
  }

  // Rebuild each bucket. We always rebuild rather than try to mutate
  // ``InstancedMesh.count`` in place — voxel changes are debounced
  // through the save layer so the cost is bounded.
  const matrix = new THREE.Matrix4()
  for (const [key, voxels] of buckets.entries()) {
    const existing = voxelGroups.get(key)
    if (existing) {
      disposeVoxelGroup(existing)
      voxelGroups.delete(key)
    }
    const baseColor = voxelBaseColor(voxels[0])
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const materials = buildVoxelFaceMaterials(baseColor)
    const mesh = new THREE.InstancedMesh(geometry, materials, voxels.length)
    mesh.userData.voxels = voxels
    for (let i = 0; i < voxels.length; i += 1) {
      const v = voxels[i]
      matrix.makeTranslation(v.x + 0.5, v.y + 0.5, v.z + 0.5)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    voxelContainer.add(mesh)
    voxelGroups.set(key, { key, geometry, materials, mesh, voxels })
  }
}

const ensureBuildGhost = () => {
  if (buildGhost && buildGhostEdges) return
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const materials = buildVoxelFaceMaterials(0xfabd2f).map((material) => {
    material.transparent = true
    material.opacity = 0.45
    material.depthTest = false
    material.depthWrite = false
    return material
  })
  buildGhost = new THREE.Mesh(geometry, materials)
  buildGhost.renderOrder = 999
  buildGhost.visible = false
  previewGroup.add(buildGhost)

  const edgeGeometry = new THREE.EdgesGeometry(geometry)
  buildGhostEdges = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({
      color: 0xfbf1c7,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    }),
  )
  buildGhostEdges.renderOrder = 1000
  buildGhostEdges.visible = false
  previewGroup.add(buildGhostEdges)
}

const disposeBuildGhost = () => {
  if (buildGhost) {
    disposeObject3D(buildGhost)
    buildGhost = null
  }
  if (buildGhostEdges) {
    disposeObject3D(buildGhostEdges)
    buildGhostEdges = null
  }
}

const hideBuildGhost = () => {
  if (buildGhost) buildGhost.visible = false
  if (buildGhostEdges) buildGhostEdges.visible = false
}

const currentBuildBaseColor = () => {
  if (props.buildColor) {
    const parsed = parseHexColor(props.buildColor)
    if (parsed !== null) return parsed
  }
  return getMaterialDef(props.buildMaterial).baseColor
}

const ensurePreviewObjects = () => {
  if (!selectedPokemon.value) {
    return
  }

  if (
    previewOwnerId === selectedPokemon.value.id &&
    ghostSprite &&
    previewElevationBadge &&
    previewVolume &&
    previewEdges &&
    previewPathLine
  ) {
    return
  }

  disposeObject3D(ghostSprite)
  disposeObject3D(previewElevationBadge)
  disposeObject3D(previewVolume)
  disposeObject3D(previewEdges)
  ghostSprite = null
  previewElevationBadge = null
  previewVolume = null
  previewEdges = null

  const selected = selectedPokemon.value
  previewOwnerId = selected.id
  ghostSprite = buildSprite(selected, true)
  ghostSprite.visible = false
  scene.add(ghostSprite)

  previewElevationBadge = buildElevationBadge(true)
  previewElevationBadge.visible = false
  scene.add(previewElevationBadge)

  // Preview volume gets the same per-face shading as live pokemon
  // boxes, but tinted with gruvbox yellow (reachable) or red
  // (unreachable) instead of the warm gray ramp.
  previewVolume = new THREE.Mesh(
    new THREE.BoxGeometry(selected.base, selected.clearance, selected.base),
    buildVolumeMaterials('reachable', 0.24),
  )
  previewVolume.visible = false
  previewGroup.add(previewVolume)

  previewEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(selected.base, selected.clearance, selected.base)),
    new THREE.LineBasicMaterial({
      color: 0xfbf1c7, // fg0 - bright cream highlight on the yellow box
      transparent: true,
      opacity: 0.92,
    }),
  )
  previewEdges.visible = false
  previewGroup.add(previewEdges)

  if (!previewPathLine) {
    previewPathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xfabd2f, // gruvbox yellow path trail
        transparent: true,
        opacity: 0.95,
      }),
    )
    previewPathLine.visible = false
    previewGroup.add(previewPathLine)
  }
}

const clearPreviewVisuals = () => {
  activePreview = { ...EMPTY_PREVIEW }
  activePreviewAnchor = null

  if (ghostSprite) {
    ghostSprite.visible = false
    ghostSprite.element.classList.remove('is-invalid')
  }

  if (previewElevationBadge) {
    previewElevationBadge.visible = false
  }

  if (previewVolume) {
    previewVolume.visible = false
  }

  if (previewEdges) {
    previewEdges.visible = false
  }

  if (previewPathLine) {
    previewPathLine.visible = false
    previewPathLine.geometry.dispose()
    previewPathLine.geometry = new THREE.BufferGeometry()
  }

  emit('preview-change', { ...EMPTY_PREVIEW })
}

const updatePreviewAtAnchor = (anchor: GridAnchor | null) => {
  if (!selectedPokemon.value) {
    clearPreviewVisuals()
    return
  }

  ensurePreviewObjects()

  if (!anchor || !ghostSprite || !previewElevationBadge || !previewVolume || !previewEdges) {
    clearPreviewVisuals()
    return
  }

  const selected = selectedPokemon.value
  const path = findPathForPokemon(
    selected,
    selected.position,
    anchor,
    [],
    props.dimensions,
    selected.id,
    voxelOccupancy.value,
  )
  const reachable = Boolean(path)
  const center = getAnchorCenter(anchor, selected.base)

  ghostSprite.position.set(center.x, anchor.y + selected.height / 2, center.z)
  ghostSprite.visible = true
  ghostSprite.element.classList.toggle('is-invalid', !reachable)

  previewVolume.position.set(center.x, anchor.y + selected.clearance / 2, center.z)
  // Repaint all 6 faces with the appropriate brightness ramp.
  paintVolumeMaterials(
    previewVolume.material,
    reachable ? 'reachable' : 'unreachable',
    reachable ? 0.24 : 0.22,
  )
  previewVolume.visible = true

  ;(previewEdges.material as THREE.LineBasicMaterial).color.set(reachable ? 0xfbf1c7 : 0xfb4934)
  previewEdges.position.copy(previewVolume.position)
  previewEdges.visible = true

  updateElevationBadge(
    previewElevationBadge,
    new THREE.Vector3(center.x, anchor.y, center.z),
    selected.base,
    anchor.y,
  )

  if (previewPathLine) {
    const points =
      path?.map((step) => {
        const waypoint = getAnchorCenter(step, selected.base)
        return new THREE.Vector3(waypoint.x, waypoint.y + selected.clearance / 2, waypoint.z)
      }) ?? []

    previewPathLine.geometry.dispose()
    previewPathLine.geometry = new THREE.BufferGeometry().setFromPoints(points)
    previewPathLine.visible = points.length >= 2
  }

  activePreviewAnchor = anchor
  activePreview = {
    position: anchor,
    reachable,
    pathLength: path ? Math.max(path.length - 1, 0) : 0,
  }
  emit('preview-change', { ...activePreview })
}

const setPointerFromCoords = (coords: { clientX: number; clientY: number }) => {
  if (!renderer || !camera) {
    return null
  }

  const bounds = renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((coords.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((coords.clientY - bounds.top) / bounds.height) * 2 + 1,
  )

  raycaster.setFromCamera(pointer, camera)
  return pointer
}

const pickPokemonId = (event: MouseEvent | PointerEvent) => {
  if (!camera) {
    return null
  }

  setPointerFromCoords(event)
  const proxies = Array.from(renderObjects.values(), (renderObject) => renderObject.proxy)
  const intersections = raycaster.intersectObjects(proxies, false)
  const hit = intersections[0]?.object

  return (hit?.userData.pokemonId as string | undefined) ?? null
}

const getMoveGridIntersection = (event: MouseEvent | PointerEvent, yLevel: number) => {
  if (!camera) {
    return null
  }

  setPointerFromCoords(event)
  const point = new THREE.Vector3()
  const hit = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -yLevel),
    point,
  )

  if (!hit) {
    return null
  }

  return point
}

const updatePreviewFromPointer = (event: MouseEvent | PointerEvent) => {
  if (!selectedPokemon.value) {
    clearPreviewVisuals()
    return
  }

  const previewLayerY = getPreviewLayerY()
  const point = getMoveGridIntersection(event, previewLayerY)

  if (
    !point ||
    point.x < 0 ||
    point.x > props.dimensions.x ||
    point.z < 0 ||
    point.z > props.dimensions.z
  ) {
    clearPreviewVisuals()
    return
  }

  const maxX = props.dimensions.x - selectedPokemon.value.base
  const maxY = props.dimensions.y - selectedPokemon.value.clearance
  const maxZ = props.dimensions.z - selectedPokemon.value.base

  if (maxX < 0 || maxY < 0 || maxZ < 0) {
    clearPreviewVisuals()
    return
  }

  const anchor = {
    x: Math.min(maxX, Math.max(0, Math.round(point.x - selectedPokemon.value.base / 2))),
    y: Math.min(maxY, Math.max(0, previewLayerY)),
    z: Math.min(maxZ, Math.max(0, Math.round(point.z - selectedPokemon.value.base / 2))),
  }

  updatePreviewAtAnchor(anchor)
}

const pickBuildTarget = (
  event: MouseEvent | PointerEvent,
  tool: BuildTool,
): BuildTarget | null => {
  if (!renderer || !camera) return null
  setPointerFromCoords(event)

  const targets: THREE.Object3D[] = []
  if (floorPlane) targets.push(floorPlane)
  for (const group of voxelGroups.values()) targets.push(group.mesh)

  const intersections = raycaster.intersectObjects(targets, false)
  const hit = intersections[0]
  if (!hit) return null

  let voxel: GridVoxel | null = null
  if (hit.object !== floorPlane) {
    const mesh = hit.object as THREE.InstancedMesh
    const voxels = mesh.userData.voxels as GridVoxel[] | undefined
    if (voxels && hit.instanceId !== undefined) {
      voxel = voxels[hit.instanceId] ?? null
    }
  }

  if (tool === 'eraser') {
    if (!voxel) return null
    return {
      action: 'remove',
      cell: { x: voxel.x, y: voxel.y, z: voxel.z },
      valid: true,
    }
  }

  let cell: { x: number; y: number; z: number }
  if (voxel && hit.face) {
    const normal = hit.face.normal
    cell = {
      x: voxel.x + Math.round(normal.x),
      y: voxel.y + Math.round(normal.y),
      z: voxel.z + Math.round(normal.z),
    }
  } else {
    cell = {
      x: Math.floor(hit.point.x),
      y: 0,
      z: Math.floor(hit.point.z),
    }
  }

  const inBounds =
    cell.x >= 0 &&
    cell.x < props.dimensions.x &&
    cell.y >= 0 &&
    cell.y < props.dimensions.y &&
    cell.z >= 0 &&
    cell.z < props.dimensions.z
  const occupiedByVoxel = voxelOccupancy.value.has(voxelKey(cell.x, cell.y, cell.z))
  const insidePokemon = cellInsidePokemonFootprint(cell.x, cell.y, cell.z, props.pokemons)

  return {
    action: 'place',
    cell,
    valid: inBounds && !occupiedByVoxel && !insidePokemon,
  }
}

const updateBuildGhost = (target: BuildTarget | null) => {
  if (!props.buildMode) {
    hideBuildGhost()
    return
  }

  ensureBuildGhost()
  if (!buildGhost || !buildGhostEdges) return

  if (!target) {
    hideBuildGhost()
    return
  }

  buildGhost.position.set(target.cell.x + 0.5, target.cell.y + 0.5, target.cell.z + 0.5)
  buildGhostEdges.position.copy(buildGhost.position)
  buildGhost.visible = true
  buildGhostEdges.visible = true

  const edgeMaterial = buildGhostEdges.material as THREE.LineBasicMaterial
  if (target.action === 'remove') {
    paintBuildGhostMaterials(buildGhost.material, 0xfb4934, 0.42)
    edgeMaterial.color.setHex(0xfb4934)
  } else if (!target.valid) {
    paintBuildGhostMaterials(buildGhost.material, 0xfb4934, 0.32)
    edgeMaterial.color.setHex(0xfb4934)
  } else {
    paintBuildGhostMaterials(buildGhost.material, currentBuildBaseColor(), 0.55)
    edgeMaterial.color.setHex(0xfbf1c7)
  }
}

const updateBuildPreviewFromPointer = (event: MouseEvent | PointerEvent) => {
  if (!props.buildMode) {
    hideBuildGhost()
    return
  }
  const target = pickBuildTarget(event, props.buildTool)
  updateBuildGhost(target)
}

const replayBuildPreview = () => {
  if (!props.buildMode || !lastPointerCoords) return
  const synthetic = {
    clientX: lastPointerCoords.clientX,
    clientY: lastPointerCoords.clientY,
  } as MouseEvent
  updateBuildPreviewFromPointer(synthetic)
}

const performBuildAction = (event: MouseEvent | PointerEvent, tool: BuildTool) => {
  const target = pickBuildTarget(event, tool)
  if (!target) return
  if (target.action === 'remove') {
    emit('remove-voxel', target.cell)
    return
  }
  if (!target.valid) return
  const voxel: GridVoxel = {
    x: target.cell.x,
    y: target.cell.y,
    z: target.cell.z,
    material: props.buildMaterial,
  }
  if (props.buildColor) voxel.color = props.buildColor
  emit('place-voxel', voxel)
}

const closeContextMenu = () => {
  contextMenu.value = null
}

const openContextMenu = (event: MouseEvent, id: string) => {
  if (!container.value) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === id)
  const canTurn = Boolean(target?.entityKind === 'pokemon' && target.backSpriteUrl)
  const bounds = container.value.getBoundingClientRect()
  const menuWidth = 180
  const menuHeight = canTurn ? 96 : 52
  const padding = 12

  contextMenu.value = {
    id,
    canTurn,
    x: Math.min(bounds.width - menuWidth - padding, Math.max(padding, event.clientX - bounds.left)),
    y: Math.min(bounds.height - menuHeight - padding, Math.max(padding, event.clientY - bounds.top)),
  }
}

const handleContextTurn = () => {
  if (!contextMenu.value) {
    return
  }

  emit('turn-pokemon', contextMenu.value.id)
  closeContextMenu()
}

const handleContextDelete = () => {
  if (!contextMenu.value) {
    return
  }

  emit('delete-pokemon', contextMenu.value.id)
  closeContextMenu()
}

const handleLeftClick = (event: PointerEvent) => {
  closeContextMenu()
  const hitId = pickPokemonId(event)

  if (!props.selectedId) {
    if (hitId) {
      emit('select-pokemon', hitId)
    }

    return
  }

  if (activePreview.position && activePreview.reachable) {
    emit('move-pokemon', {
      id: props.selectedId,
      position: activePreview.position,
    })
  }
}

const handleRightClick = (event: MouseEvent) => {
  event.preventDefault()

  if (props.buildMode) {
    if (pointerTravel <= 6) {
      performBuildAction(event, 'eraser')
    }
    return
  }

  const hitId = pickPokemonId(event)

  if (!hitId) {
    closeContextMenu()
    return
  }

  openContextMenu(event, hitId)
}

const handlePointerDown = (event: PointerEvent) => {
  closeContextMenu()
  pointerDown = { x: event.clientX, y: event.clientY }
  pointerTravel = 0
}

const handlePointerMove = (event: PointerEvent) => {
  pointerTravel = Math.max(
    pointerTravel,
    Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y),
  )
  lastPointerCoords = { clientX: event.clientX, clientY: event.clientY }

  if (props.buildMode) {
    updateBuildPreviewFromPointer(event)
    return
  }

  if (selectedPokemon.value) {
    updatePreviewFromPointer(event)
  }
}

const handleWheel = (event: WheelEvent) => {
  if (!selectedPokemon.value) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const maxY = props.dimensions.y - selectedPokemon.value.clearance

  if (maxY < 0) {
    return
  }

  const currentAnchor = activePreview.position ?? selectedPokemon.value.position
  const direction = event.deltaY < 0 ? 1 : -1
  const nextY = Math.min(maxY, Math.max(0, currentAnchor.y + direction))

  if (nextY === currentAnchor.y) {
    return
  }

  updatePreviewAtAnchor({
    ...currentAnchor,
    y: nextY,
  })
}

const handlePointerUp = (event: PointerEvent) => {
  if (pointerTravel > 6 || event.button !== 0) {
    return
  }

  if (props.buildMode) {
    performBuildAction(event, props.buildTool)
    return
  }

  handleLeftClick(event)
}

const handlePointerLeave = () => {
  lastPointerCoords = null
  if (props.buildMode) {
    hideBuildGhost()
  }
}

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (contextMenu.value) {
      closeContextMenu()
      return
    }

    emit('select-pokemon', null)
  }
}

const animate = () => {
  animationFrame = window.requestAnimationFrame(animate)

  if (!renderer || !cssRenderer || !camera || !controls) {
    return
  }

  const delta = Math.min(clock.getDelta(), 0.1)
  const damping = 1 - Math.exp(-delta * 12)

  for (const renderObject of renderObjects.values()) {
    if (renderObject.currentCenter.distanceToSquared(renderObject.targetCenter) < 0.000001) {
      renderObject.currentCenter.copy(renderObject.targetCenter)
    } else {
      renderObject.currentCenter.lerp(renderObject.targetCenter, damping)
    }

    applyRenderObjectPosition(renderObject)
  }

  controls.update()

  for (const renderObject of renderObjects.values()) {
    updateSpriteFacing(
      renderObject.sprite,
      renderObject.currentCenter,
      renderObject.spriteUrl,
      renderObject.backSpriteUrl,
      renderObject.turned,
    )
  }

  if (ghostSprite && selectedPokemon.value) {
    const ghostCenter = new THREE.Vector3(
      ghostSprite.position.x,
      activePreview.position?.y ?? selectedPokemon.value.position.y,
      ghostSprite.position.z,
    )
    updateSpriteFacing(
      ghostSprite,
      ghostCenter,
      selectedPokemon.value.spriteUrl,
      selectedPokemon.value.backSpriteUrl,
      Boolean(selectedPokemon.value.turned),
    )
  }

  renderer.render(scene, camera)
  cssRenderer.render(scene, camera)
}

onMounted(() => {
  if (!container.value) {
    return
  }

  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 200)
  camera.up.set(0, 1, 0)
  camera.zoom = 1.1

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setClearColor(0x1d2021, 1) // gruvbox bg0_h
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.touchAction = 'none'

  cssRenderer = new CSS3DRenderer()
  cssRenderer.domElement.style.position = 'absolute'
  cssRenderer.domElement.style.inset = '0'
  cssRenderer.domElement.style.pointerEvents = 'none'
  cssRenderer.domElement.style.overflow = 'hidden'

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.screenSpacePanning = false
  controls.zoomToCursor = true
  controls.enableZoom = !selectedPokemon.value
  controls.minPolarAngle = ISO_POLAR_ANGLE
  controls.maxPolarAngle = ISO_POLAR_ANGLE
  controls.minZoom = 0.4
  controls.maxZoom = 5
  controls.zoomSpeed = 1.1
  controls.rotateSpeed = 0.8

  container.value.append(renderer.domElement, cssRenderer.domElement)
  syncRendererSize()
  buildGrid()
  syncPokemonObjects()
  syncVoxelMeshes()
  ensurePreviewObjects()
  if (props.buildMode) ensureBuildGhost()
  alignCameraToGrid(true)
  refreshPokemonStyles()

  renderer.domElement.addEventListener('pointerdown', handlePointerDown)
  renderer.domElement.addEventListener('pointermove', handlePointerMove)
  renderer.domElement.addEventListener('pointerup', handlePointerUp)
  renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
  renderer.domElement.addEventListener('contextmenu', handleRightClick)
  renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })
  window.addEventListener('keydown', handleEscape)

  resizeObserver = new ResizeObserver(() => {
    syncRendererSize()
  })
  resizeObserver.observe(container.value)

  animate()
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame)
  window.removeEventListener('keydown', handleEscape)

  if (renderer) {
    renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
    renderer.domElement.removeEventListener('pointermove', handlePointerMove)
    renderer.domElement.removeEventListener('pointerup', handlePointerUp)
    renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.removeEventListener('contextmenu', handleRightClick)
    renderer.domElement.removeEventListener('wheel', handleWheel)
  }

  resizeObserver?.disconnect()
  resizeObserver = null

  clearPreviewVisuals()
  disposeObject3D(ghostSprite)
  disposeObject3D(previewElevationBadge)
  disposeObject3D(previewVolume)
  disposeObject3D(previewEdges)
  disposeObject3D(previewPathLine)
  disposeBuildGhost()
  disposeAllVoxelGroups()
  if (topFaceGridTexture) {
    topFaceGridTexture.dispose()
    topFaceGridTexture = null
  }

  for (const renderObject of renderObjects.values()) {
    disposeObject3D(renderObject.sprite)
    disposeObject3D(renderObject.elevationBadge)
    disposeObject3D(renderObject.hpBar)
    disposeObject3D(renderObject.volume)
    disposeObject3D(renderObject.edges)
    disposeObject3D(renderObject.proxy)
  }

  renderObjects.clear()
  disposeObject3D(floorGridLines)
  disposeObject3D(moveGridLines)
  disposeObject3D(floorPlane)
  controls?.dispose()
  renderer?.dispose()
  cssRenderer?.domElement.remove()
})

watch(
  () => props.pokemons,
  () => {
    if (!renderer) {
      return
    }

    syncPokemonObjects()

    if (selectedPokemon.value && activePreviewAnchor) {
      updatePreviewAtAnchor(activePreviewAnchor)
    } else if (!selectedPokemon.value) {
      clearPreviewVisuals()
    }

    replayBuildPreview()
  },
  { deep: true },
)

watch(
  () => props.voxels,
  () => {
    if (!renderer) {
      return
    }

    syncVoxelMeshes()

    if (selectedPokemon.value && activePreviewAnchor) {
      // Voxels affect pathfinding — refresh the move preview.
      updatePreviewAtAnchor(activePreviewAnchor)
    }

    replayBuildPreview()
  },
  { deep: true },
)

watch(
  () => props.selectedId,
  () => {
    if (!renderer) {
      return
    }

    refreshPokemonStyles()
    updateGridVisibility()

    if (controls) {
      controls.enableZoom = !selectedPokemon.value
    }

    if (!selectedPokemon.value) {
      clearPreviewVisuals()
      closeContextMenu()
      disposeObject3D(ghostSprite)
      disposeObject3D(previewElevationBadge)
      disposeObject3D(previewVolume)
      disposeObject3D(previewEdges)
      ghostSprite = null
      previewElevationBadge = null
      previewVolume = null
      previewEdges = null
      previewOwnerId = null
      return
    }

    activePreviewAnchor = null
    activePreview = { ...EMPTY_PREVIEW }
    ensurePreviewObjects()
    emit('preview-change', { ...EMPTY_PREVIEW })
  },
)

watch(
  () => props.buildMode,
  (active) => {
    if (!renderer) return

    updateGridVisibility()

    if (active) {
      closeContextMenu()
      clearPreviewVisuals()
      ensureBuildGhost()
      replayBuildPreview()
    } else {
      hideBuildGhost()
    }
  },
)

watch(
  () => [props.buildTool, props.buildMaterial, props.buildColor] as const,
  () => {
    if (!renderer || !props.buildMode) return
    replayBuildPreview()
  },
)

watch(
  () => [props.dimensions.x, props.dimensions.y, props.dimensions.z] as const,
  () => {
    if (!renderer) {
      return
    }

    buildGrid()
    updateGridVisibility()
    alignCameraToGrid(false)
    syncRendererSize()

    if (selectedPokemon.value && activePreviewAnchor) {
      updatePreviewAtAnchor(activePreviewAnchor)
    } else if (!selectedPokemon.value) {
      clearPreviewVisuals()
    }

    if (props.buildMode) {
      hideBuildGhost()
    }
  },
)
</script>

<template>
  <div ref="container" class="scene-root">
    <div
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <button
        v-if="contextMenu.canTurn"
        type="button"
        class="context-menu__button"
        @click.stop="handleContextTurn"
      >
        Turn sprite
      </button>
      <button type="button" class="context-menu__button" @click.stop="handleContextDelete">
        Delete
      </button>
    </div>
  </div>
</template>

<style scoped>
.scene-root {
  position: relative;
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  background: var(--paper);
}

.context-menu {
  position: absolute;
  z-index: 8;
  min-width: 160px;
  padding: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}

.context-menu__button {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.8rem;
  text-align: left;
  cursor: pointer;
  letter-spacing: 0.02em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.context-menu__button + .context-menu__button {
  margin-top: 0.3rem;
}

.context-menu__button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}
</style>
