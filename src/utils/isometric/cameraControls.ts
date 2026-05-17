import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridDimensions, SpawnedPokemon } from '~/types/pokemon'

const ISO_POLAR_ANGLE = THREE.MathUtils.degToRad(54.735610317245346)
const ISO_AZIMUTH_ANGLE = THREE.MathUtils.degToRad(45)
const FOCUS_CAMERA_TARGET_HEIGHT_FACTOR = 0.35
const FOCUS_CAMERA_VISIBLE_UNITS_PER_SUBJECT = 4
const FOCUS_CAMERA_MIN_VISIBLE_UNITS = 7
const FOCUS_CAMERA_MAX_VISIBLE_UNITS = 14

export const DEFAULT_FACING_DIRECTION = new THREE.Vector2(
  Math.cos(ISO_AZIMUTH_ANGLE),
  Math.sin(ISO_AZIMUTH_ANGLE),
)

const getSceneTarget = (dimensions: GridDimensions) =>
  new THREE.Vector3(dimensions.x / 2, 0, dimensions.z / 2)

const fallbackFrustumHeight = (dimensions: GridDimensions) =>
  Math.max(dimensions.x, dimensions.y, dimensions.z) * 1.7

const currentFrustumHeight = (
  camera: THREE.OrthographicCamera | null,
  dimensions: GridDimensions,
) => {
  if (!camera) return fallbackFrustumHeight(dimensions)
  return Math.abs(camera.top - camera.bottom) || fallbackFrustumHeight(dimensions)
}

export const maxUsefulCameraZoom = (
  camera: THREE.OrthographicCamera | null,
  dimensions: GridDimensions,
) => Math.max(5, currentFrustumHeight(camera, dimensions) / FOCUS_CAMERA_MIN_VISIBLE_UNITS)

export const createIsometricCamera = () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 200)
  camera.up.set(0, 1, 0)
  camera.zoom = 1.1
  return camera
}

export const createIsometricWebGLRenderer = () => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setClearColor(0x050608, 1) // Pokémon black surface
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.touchAction = 'none'
  return renderer
}

export const createIsometricCssRenderer = () => {
  const renderer = new CSS3DRenderer()
  renderer.domElement.style.position = 'absolute'
  renderer.domElement.style.inset = '0'
  renderer.domElement.style.pointerEvents = 'none'
  renderer.domElement.style.overflow = 'hidden'
  return renderer
}

export const createIsometricOrbitControls = (
  camera: THREE.OrthographicCamera,
  domElement: HTMLElement,
  maxZoom: number,
) => {
  const controls = new OrbitControls(camera, domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.screenSpacePanning = false
  controls.zoomToCursor = true
  controls.minPolarAngle = ISO_POLAR_ANGLE
  controls.maxPolarAngle = ISO_POLAR_ANGLE
  controls.minZoom = 0.4
  controls.maxZoom = maxZoom
  controls.zoomSpeed = 1.1
  controls.rotateSpeed = 0.8
  return controls
}

export const setOrthographicFrustum = (options: {
  camera: THREE.OrthographicCamera
  container: HTMLElement
  controls: OrbitControls | null
  dimensions: GridDimensions
}) => {
  const bounds = options.container.getBoundingClientRect()
  const aspect = bounds.width / Math.max(bounds.height, 1)
  const frustumSize = fallbackFrustumHeight(options.dimensions)

  options.camera.left = (-frustumSize * aspect) / 2
  options.camera.right = (frustumSize * aspect) / 2
  options.camera.top = frustumSize / 2
  options.camera.bottom = -frustumSize / 2
  options.camera.near = -frustumSize * 6
  options.camera.far = frustumSize * 6
  options.camera.updateProjectionMatrix()
  if (options.controls) options.controls.maxZoom = maxUsefulCameraZoom(options.camera, options.dimensions)
}

export const syncIsometricRendererSize = (options: {
  renderer: THREE.WebGLRenderer
  cssRenderer: CSS3DRenderer
  camera: THREE.OrthographicCamera
  controls: OrbitControls | null
  container: HTMLElement
  dimensions: GridDimensions
}) => {
  const bounds = options.container.getBoundingClientRect()
  options.renderer.setSize(bounds.width, bounds.height)
  options.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  options.cssRenderer.setSize(bounds.width, bounds.height)
  setOrthographicFrustum(options)
}

export const alignCameraToGrid = (options: {
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  dimensions: GridDimensions
  initial?: boolean
}) => {
  const nextTarget = getSceneTarget(options.dimensions)

  if (options.initial) {
    const radius = Math.max(options.dimensions.x, options.dimensions.y, options.dimensions.z) * 2.1
    options.camera.position.set(
      nextTarget.x + radius * Math.sin(ISO_POLAR_ANGLE) * Math.cos(ISO_AZIMUTH_ANGLE),
      nextTarget.y + radius * Math.cos(ISO_POLAR_ANGLE),
      nextTarget.z + radius * Math.sin(ISO_POLAR_ANGLE) * Math.sin(ISO_AZIMUTH_ANGLE),
    )
  } else {
    const offset = options.camera.position.clone().sub(options.controls.target)
    options.camera.position.copy(nextTarget.clone().add(offset))
  }

  options.controls.target.copy(nextTarget)
  options.controls.update()
}

const fallbackCameraOffset = (dimensions: GridDimensions) => {
  const radius = Math.max(dimensions.x, dimensions.y, dimensions.z) * 2.1
  return new THREE.Vector3(
    radius * Math.sin(ISO_POLAR_ANGLE) * Math.cos(ISO_AZIMUTH_ANGLE),
    radius * Math.cos(ISO_POLAR_ANGLE),
    radius * Math.sin(ISO_POLAR_ANGLE) * Math.sin(ISO_AZIMUTH_ANGLE),
  )
}

const focusZoomForPokemon = (options: {
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  dimensions: GridDimensions
  pokemon: SpawnedPokemon
}) => {
  const subjectSpan = Math.max(
    options.pokemon.base,
    options.pokemon.clearance,
    options.pokemon.width,
    options.pokemon.height,
    1,
  )
  const desiredVisibleHeight = THREE.MathUtils.clamp(
    subjectSpan * FOCUS_CAMERA_VISIBLE_UNITS_PER_SUBJECT,
    FOCUS_CAMERA_MIN_VISIBLE_UNITS,
    FOCUS_CAMERA_MAX_VISIBLE_UNITS,
  )
  const frustumHeight = currentFrustumHeight(options.camera, options.dimensions)
  const minZoom = Number.isFinite(options.controls.minZoom) ? options.controls.minZoom : 0.1
  const maxZoom = Math.max(
    Number.isFinite(options.controls.maxZoom) ? options.controls.maxZoom : 0,
    maxUsefulCameraZoom(options.camera, options.dimensions),
  )

  return THREE.MathUtils.clamp(frustumHeight / desiredVisibleHeight, minZoom, maxZoom)
}

export const focusCameraOnPokemon = (options: {
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  dimensions: GridDimensions
  pokemon: SpawnedPokemon
  center: THREE.Vector3
}) => {
  const targetHeight = Math.max(options.pokemon.clearance, options.pokemon.height, 1)
  const nextTarget = new THREE.Vector3(
    options.center.x,
    options.center.y + targetHeight * FOCUS_CAMERA_TARGET_HEIGHT_FACTOR,
    options.center.z,
  )
  const offset = options.camera.position.clone().sub(options.controls.target)
  const nextOffset = offset.lengthSq() > 0.0001 ? offset : fallbackCameraOffset(options.dimensions)

  options.controls.target.copy(nextTarget)
  options.camera.position.copy(nextTarget.clone().add(nextOffset))
  options.camera.zoom = focusZoomForPokemon(options)
  options.camera.updateProjectionMatrix()
  options.controls.update()
}
