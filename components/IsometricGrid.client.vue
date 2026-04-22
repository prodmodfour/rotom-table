<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS3DRenderer, CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { PreviewState } from '~/utils/grid'
import { findPathForPokemon, getAnchorCenter, getPokemonCenter } from '~/utils/grid'

const props = defineProps<{
  dimensions: GridDimensions
  pokemons: SpawnedPokemon[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'delete-pokemon', id: string): void
  (event: 'preview-change', preview: PreviewState): void
}>()

interface PokemonRenderObject {
  sprite: CSS3DSprite
  volume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  edges: THREE.LineSegments
  proxy: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>
  currentCenter: THREE.Vector3
  targetCenter: THREE.Vector3
  width: number
  height: number
  base: number
  clearance: number
}

const SPRITE_PIXELS_PER_METRE = 128
const ISO_POLAR_ANGLE = THREE.MathUtils.degToRad(54.735610317245346)
const ISO_AZIMUTH_ANGLE = THREE.MathUtils.degToRad(45)
const EMPTY_PREVIEW: PreviewState = {
  position: null,
  reachable: false,
  pathLength: 0,
}

const container = ref<HTMLDivElement | null>(null)
const selectedPokemon = computed(
  () => props.pokemons.find((pokemon) => pokemon.id === props.selectedId) ?? null,
)
const overlayText = computed(() =>
  selectedPokemon.value
    ? `Moving ${selectedPokemon.value.species}: hover to preview, left click to place.`
    : 'Drag to rotate · Scroll to zoom · Left click to select · Right click to delete.',
)

const scene = new THREE.Scene()
const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const gridGroup = new THREE.Group()
const worldGroup = new THREE.Group()
const previewGroup = new THREE.Group()
const clock = new THREE.Clock()

scene.add(gridGroup)
scene.add(worldGroup)
scene.add(previewGroup)

const renderObjects = new Map<string, PokemonRenderObject>()
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
let previewVolume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null
let previewEdges: THREE.LineSegments | null = null
let previewPathLine: THREE.Line | null = null
let previewOwnerId: string | null = null
let activePreview: PreviewState = { ...EMPTY_PREVIEW }
let activePreviewAnchor: GridAnchor | null = null
let pointerDown = { x: 0, y: 0 }
let pointerTravel = 0

const getSceneTarget = () =>
  new THREE.Vector3(props.dimensions.x / 2, props.dimensions.y / 2, props.dimensions.z / 2)

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

  wrapper.appendChild(image)

  const sprite = new CSS3DSprite(wrapper)
  sprite.element.style.pointerEvents = 'none'
  sprite.scale.setScalar(1 / SPRITE_PIXELS_PER_METRE)
  sprite.visible = true
  return sprite
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
    moveGridLines.visible = isMovingPokemon
  }
}

const buildGrid = () => {
  disposeObject3D(floorGridLines)
  disposeObject3D(moveGridLines)
  disposeObject3D(floorPlane)

  floorGridLines = new THREE.LineSegments(
    buildFloorGridGeometry(props.dimensions),
    new THREE.LineBasicMaterial({
      color: 0x2d7cff,
      transparent: true,
      opacity: 0.34,
    }),
  )
  gridGroup.add(floorGridLines)

  moveGridLines = new THREE.LineSegments(
    buildMoveGridGeometry(props.dimensions),
    new THREE.LineBasicMaterial({
      color: 0x2d7cff,
      transparent: true,
      opacity: 0.16,
    }),
  )
  gridGroup.add(moveGridLines)

  floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(props.dimensions.x, props.dimensions.z),
    new THREE.MeshBasicMaterial({
      color: 0x07162d,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  floorPlane.rotation.x = -Math.PI / 2
  floorPlane.position.set(props.dimensions.x / 2, 0, props.dimensions.z / 2)
  gridGroup.add(floorPlane)

  updateGridVisibility()
}

const buildRenderObject = (pokemon: SpawnedPokemon): PokemonRenderObject => {
  const sprite = buildSprite(pokemon)
  const volumeGeometry = new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base)
  const volumeMaterial = new THREE.MeshBasicMaterial({
    color: 0x2563eb,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  })
  const volume = new THREE.Mesh(volumeGeometry, volumeMaterial)

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(volumeGeometry),
    new THREE.LineBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.48,
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
  const currentCenter = new THREE.Vector3(center.x, 0, center.z)
  const targetCenter = currentCenter.clone()

  worldGroup.add(volume)
  worldGroup.add(edges)
  worldGroup.add(proxy)
  scene.add(sprite)

  return {
    sprite,
    volume,
    edges,
    proxy,
    currentCenter,
    targetCenter,
    width: pokemon.width,
    height: pokemon.height,
    base: pokemon.base,
    clearance: pokemon.clearance,
  }
}

const applyRenderObjectPosition = (renderObject: PokemonRenderObject) => {
  renderObject.sprite.position.set(
    renderObject.currentCenter.x,
    renderObject.height / 2,
    renderObject.currentCenter.z,
  )
  renderObject.volume.position.set(
    renderObject.currentCenter.x,
    renderObject.clearance / 2,
    renderObject.currentCenter.z,
  )
  renderObject.edges.position.copy(renderObject.volume.position)
  renderObject.proxy.position.set(
    renderObject.currentCenter.x,
    Math.max(renderObject.height, renderObject.clearance) / 2,
    renderObject.currentCenter.z,
  )
}

const refreshPokemonStyles = () => {
  for (const pokemon of props.pokemons) {
    const renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      continue
    }

    const selected = props.selectedId === pokemon.id
    renderObject.volume.material.color.set(selected ? 0x67e8f9 : 0x2563eb)
    renderObject.volume.material.opacity = selected ? 0.18 : 0.08
    ;(renderObject.edges.material as THREE.LineBasicMaterial).color.set(selected ? 0xbef4ff : 0x60a5fa)
    ;(renderObject.edges.material as THREE.LineBasicMaterial).opacity = selected ? 0.92 : 0.48
  }
}

const syncPokemonObjects = () => {
  const nextIds = new Set(props.pokemons.map((pokemon) => pokemon.id))

  for (const [id, renderObject] of renderObjects.entries()) {
    if (nextIds.has(id)) {
      continue
    }

    disposeObject3D(renderObject.sprite)
    disposeObject3D(renderObject.volume)
    disposeObject3D(renderObject.edges)
    disposeObject3D(renderObject.proxy)
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
    renderObject.targetCenter.set(center.x, 0, center.z)
  }

  refreshPokemonStyles()
}

const ensurePreviewObjects = () => {
  if (!selectedPokemon.value) {
    return
  }

  if (
    previewOwnerId === selectedPokemon.value.id &&
    ghostSprite &&
    previewVolume &&
    previewEdges &&
    previewPathLine
  ) {
    return
  }

  disposeObject3D(ghostSprite)
  disposeObject3D(previewVolume)
  disposeObject3D(previewEdges)
  ghostSprite = null
  previewVolume = null
  previewEdges = null

  const selected = selectedPokemon.value
  previewOwnerId = selected.id
  ghostSprite = buildSprite(selected, true)
  ghostSprite.visible = false
  scene.add(ghostSprite)

  previewVolume = new THREE.Mesh(
    new THREE.BoxGeometry(selected.base, selected.clearance, selected.base),
    new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  )
  previewVolume.visible = false
  previewGroup.add(previewVolume)

  previewEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(selected.base, selected.clearance, selected.base)),
    new THREE.LineBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.9,
    }),
  )
  previewEdges.visible = false
  previewGroup.add(previewEdges)

  if (!previewPathLine) {
    previewPathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
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

  if (!anchor || !ghostSprite || !previewVolume || !previewEdges) {
    clearPreviewVisuals()
    return
  }

  const selected = selectedPokemon.value
  const path = findPathForPokemon(
    selected,
    selected.position,
    anchor,
    props.pokemons,
    props.dimensions,
    selected.id,
  )
  const reachable = Boolean(path)
  const center = getAnchorCenter(anchor, selected.base)

  ghostSprite.position.set(center.x, selected.height / 2, center.z)
  ghostSprite.visible = true
  ghostSprite.element.classList.toggle('is-invalid', !reachable)

  previewVolume.position.set(center.x, selected.clearance / 2, center.z)
  previewVolume.material.color.set(reachable ? 0xfbbf24 : 0xf87171)
  previewVolume.material.opacity = reachable ? 0.12 : 0.1
  previewVolume.visible = true

  ;(previewEdges.material as THREE.LineBasicMaterial).color.set(reachable ? 0xfef08a : 0xfca5a5)
  previewEdges.position.copy(previewVolume.position)
  previewEdges.visible = true

  if (previewPathLine) {
    const points =
      path?.map((step) => {
        const waypoint = getAnchorCenter(step, selected.base)
        return new THREE.Vector3(waypoint.x, 0.08, waypoint.z)
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

const setPointerFromEvent = (event: MouseEvent | PointerEvent) => {
  if (!renderer || !camera) {
    return null
  }

  const bounds = renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  )

  raycaster.setFromCamera(pointer, camera)
  return pointer
}

const pickPokemonId = (event: MouseEvent | PointerEvent) => {
  if (!camera) {
    return null
  }

  setPointerFromEvent(event)
  const proxies = Array.from(renderObjects.values(), (renderObject) => renderObject.proxy)
  const intersections = raycaster.intersectObjects(proxies, false)
  const hit = intersections[0]?.object

  return (hit?.userData.pokemonId as string | undefined) ?? null
}

const getGroundIntersection = (event: MouseEvent | PointerEvent) => {
  if (!camera) {
    return null
  }

  setPointerFromEvent(event)
  const point = new THREE.Vector3()
  const hit = raycaster.ray.intersectPlane(groundPlane, point)

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

  const point = getGroundIntersection(event)

  if (
    !point ||
    point.x < 0 ||
    point.x > props.dimensions.x ||
    point.z < 0 ||
    point.z > props.dimensions.z ||
    props.dimensions.x < selectedPokemon.value.base ||
    props.dimensions.z < selectedPokemon.value.base
  ) {
    clearPreviewVisuals()
    return
  }

  const maxX = props.dimensions.x - selectedPokemon.value.base
  const maxZ = props.dimensions.z - selectedPokemon.value.base
  const anchor = {
    x: Math.min(maxX, Math.max(0, Math.round(point.x - selectedPokemon.value.base / 2))),
    z: Math.min(maxZ, Math.max(0, Math.round(point.z - selectedPokemon.value.base / 2))),
  }

  updatePreviewAtAnchor(anchor)
}

const handleLeftClick = (event: PointerEvent) => {
  const hitId = pickPokemonId(event)

  if (!props.selectedId) {
    if (hitId) {
      emit('select-pokemon', hitId)
    }

    return
  }

  if (hitId) {
    emit('select-pokemon', hitId === props.selectedId ? null : hitId)
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
  const hitId = pickPokemonId(event)

  if (hitId) {
    emit('delete-pokemon', hitId)
  }
}

const handlePointerDown = (event: PointerEvent) => {
  pointerDown = { x: event.clientX, y: event.clientY }
  pointerTravel = 0
}

const handlePointerMove = (event: PointerEvent) => {
  pointerTravel = Math.max(
    pointerTravel,
    Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y),
  )

  if (selectedPokemon.value) {
    updatePreviewFromPointer(event)
  }
}

const handlePointerUp = (event: PointerEvent) => {
  if (pointerTravel > 6 || event.button !== 0) {
    return
  }

  handleLeftClick(event)
}

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
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
  renderer.setClearColor(0x050d1b, 1)
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
  ensurePreviewObjects()
  alignCameraToGrid(true)
  refreshPokemonStyles()

  renderer.domElement.addEventListener('pointerdown', handlePointerDown)
  renderer.domElement.addEventListener('pointermove', handlePointerMove)
  renderer.domElement.addEventListener('pointerup', handlePointerUp)
  renderer.domElement.addEventListener('contextmenu', handleRightClick)
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
    renderer.domElement.removeEventListener('contextmenu', handleRightClick)
  }

  resizeObserver?.disconnect()
  resizeObserver = null

  clearPreviewVisuals()
  disposeObject3D(ghostSprite)
  disposeObject3D(previewVolume)
  disposeObject3D(previewEdges)
  disposeObject3D(previewPathLine)

  for (const renderObject of renderObjects.values()) {
    disposeObject3D(renderObject.sprite)
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

    if (!selectedPokemon.value) {
      clearPreviewVisuals()
      disposeObject3D(ghostSprite)
      disposeObject3D(previewVolume)
      disposeObject3D(previewEdges)
      ghostSprite = null
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
  },
)
</script>

<template>
  <div ref="container" class="scene-root">
    <div class="scene-overlay">
      <p>{{ overlayText }}</p>
      <p class="scene-subtle">Grid uses 1 metre squares. Pokémon occupancy is based on base × base × clearance.</p>
    </div>
  </div>
</template>

<style scoped>
.scene-root {
  position: relative;
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at top, rgba(37, 99, 235, 0.12), transparent 40%),
    linear-gradient(180deg, rgba(3, 10, 23, 0.55), rgba(5, 13, 27, 0.92));
}

.scene-overlay {
  position: absolute;
  top: 1rem;
  left: 1rem;
  z-index: 5;
  max-width: 26rem;
  pointer-events: none;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 16px;
  background: rgba(5, 15, 33, 0.7);
  padding: 0.8rem 0.95rem;
  backdrop-filter: blur(8px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.2);
}

.scene-overlay p {
  margin: 0;
  color: rgba(226, 242, 255, 0.92);
  line-height: 1.45;
}

.scene-subtle {
  margin-top: 0.35rem !important;
  color: rgba(191, 219, 254, 0.72) !important;
  font-size: 0.86rem;
}
</style>
