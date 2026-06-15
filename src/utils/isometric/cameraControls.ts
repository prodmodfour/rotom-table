import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { AppThemeMode } from '~/utils/appTheme'
import { isTokenFacingDirection, tokenFacingVector } from '~/utils/tokenFacing'
import {
  ISOMETRIC_WEBGL_RENDERER_PARAMETERS,
  resolveIsometricRendererPixelRatio,
} from './rendererQuality'

export const ISO_POLAR_ANGLE = THREE.MathUtils.degToRad(54.735610317245346)
const ISO_AZIMUTH_ANGLE = THREE.MathUtils.degToRad(45)
const HALF_TURN_RADIANS = Math.PI
const FULL_TURN_RADIANS = Math.PI * 2
const ISOMETRIC_YAW_STEP_RADIANS = Math.PI / 2
const CAMERA_OFFSET_EPSILON = 1e-9

export type IsometricYawStepDirection = 'left' | 'right'
export type FocusCameraYawMode = 'preserve-current' | 'initiative'

export const ISOMETRIC_YAW_SNAP_AZIMUTHS = [
  ISO_AZIMUTH_ANGLE,
  ISO_AZIMUTH_ANGLE + ISOMETRIC_YAW_STEP_RADIANS,
  ISO_AZIMUTH_ANGLE + HALF_TURN_RADIANS,
  ISO_AZIMUTH_ANGLE + HALF_TURN_RADIANS + ISOMETRIC_YAW_STEP_RADIANS,
] as const
const FOCUS_CAMERA_TARGET_HEIGHT_FACTOR = 0.35
const FOCUS_CAMERA_VISIBLE_UNITS_PER_SUBJECT = 4
const FOCUS_CAMERA_MIN_VISIBLE_UNITS = 7
const FOCUS_CAMERA_MAX_VISIBLE_UNITS = 14

export const DEFAULT_FACING_DIRECTION = new THREE.Vector2(
  Math.cos(ISO_AZIMUTH_ANGLE),
  Math.sin(ISO_AZIMUTH_ANGLE),
)

export const normalizeIsometricYawAzimuth = (azimuth: number): number => (
  THREE.MathUtils.euclideanModulo(azimuth, FULL_TURN_RADIANS)
)

const yawAzimuthDistance = (a: number, b: number): number => (
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
)

export const snapIsometricYawAzimuth = (azimuth: number): number => {
  const normalized = normalizeIsometricYawAzimuth(azimuth)

  return ISOMETRIC_YAW_SNAP_AZIMUTHS.reduce((closest, candidate) => (
    yawAzimuthDistance(normalized, candidate) < yawAzimuthDistance(normalized, closest)
      ? candidate
      : closest
  ), ISOMETRIC_YAW_SNAP_AZIMUTHS[0])
}

export const getIsometricOffsetYawAzimuth = (offset: THREE.Vector3): number => (
  normalizeIsometricYawAzimuth(Math.atan2(offset.z, offset.x))
)

export const createIsometricOffsetFromYaw = (radius: number, azimuth: number): THREE.Vector3 => {
  const horizontalRadius = radius * Math.sin(ISO_POLAR_ANGLE)

  return new THREE.Vector3(
    horizontalRadius * Math.cos(azimuth),
    radius * Math.cos(ISO_POLAR_ANGLE),
    horizontalRadius * Math.sin(azimuth),
  )
}

const isValidCameraOffsetRadius = (radius: number): boolean => (
  Number.isFinite(radius) && radius > CAMERA_OFFSET_EPSILON
)

export const rotateIsometricYawOffset = (
  offset: THREE.Vector3,
  direction: IsometricYawStepDirection,
): THREE.Vector3 | null => {
  const radius = offset.length()
  if (!isValidCameraOffsetRadius(radius)) return null

  const step = direction === 'left' ? ISOMETRIC_YAW_STEP_RADIANS : -ISOMETRIC_YAW_STEP_RADIANS
  const azimuth = snapIsometricYawAzimuth(getIsometricOffsetYawAzimuth(offset) + step)
  return createIsometricOffsetFromYaw(radius, azimuth)
}

export interface IsometricYawCameraState {
  position: THREE.Vector3
  target: THREE.Vector3
  zoom: number
}

export const rotateIsometricYawCameraState = (
  state: IsometricYawCameraState,
  direction: IsometricYawStepDirection,
): IsometricYawCameraState | null => {
  const nextOffset = rotateIsometricYawOffset(state.position.clone().sub(state.target), direction)
  if (!nextOffset) return null

  const target = state.target.clone()
  return {
    position: target.clone().add(nextOffset),
    target,
    zoom: state.zoom,
  }
}

export const rotateIsometricYawToAzimuth = (options: {
  camera: THREE.OrthographicCamera
  controls: Pick<OrbitControls, 'target' | 'update'>
  yawAzimuth: number
}): boolean => {
  if (!Number.isFinite(options.yawAzimuth)) return false

  const target = options.controls.target
  const offset = options.camera.position.clone().sub(target)
  const radius = offset.length()
  if (!isValidCameraOffsetRadius(radius)) return false

  const zoom = options.camera.zoom
  const nextOffset = createIsometricOffsetFromYaw(radius, normalizeIsometricYawAzimuth(options.yawAzimuth))

  options.camera.position.copy(target.clone().add(nextOffset))
  options.camera.zoom = zoom
  options.controls.update()
  return true
}

export const rotateIsometricYawByDelta = (options: {
  camera: THREE.OrthographicCamera
  controls: Pick<OrbitControls, 'target' | 'update'>
  deltaRadians: number
}): boolean => {
  if (!Number.isFinite(options.deltaRadians)) return false

  const offset = options.camera.position.clone().sub(options.controls.target)
  const radius = offset.length()
  if (!isValidCameraOffsetRadius(radius)) return false

  return rotateIsometricYawToAzimuth({
    camera: options.camera,
    controls: options.controls,
    yawAzimuth: getIsometricOffsetYawAzimuth(offset) + options.deltaRadians,
  })
}

export const rotateIsometricYawStep = (options: {
  camera: THREE.OrthographicCamera
  controls: Pick<OrbitControls, 'target' | 'update'>
  direction: IsometricYawStepDirection
}): boolean => {
  const nextState = rotateIsometricYawCameraState({
    position: options.camera.position,
    target: options.controls.target,
    zoom: options.camera.zoom,
  }, options.direction)

  if (!nextState) return false

  options.camera.position.copy(nextState.position)
  options.controls.target.copy(nextState.target)
  options.camera.zoom = nextState.zoom
  options.controls.update()
  return true
}

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

const ISOMETRIC_CLEAR_COLORS: Record<AppThemeMode, number> = {
  dark: 0x050608,
  light: 0xfff8ed,
}

export const applyIsometricWebGLRendererTheme = (
  renderer: THREE.WebGLRenderer,
  themeMode: AppThemeMode,
) => {
  renderer.setClearColor(ISOMETRIC_CLEAR_COLORS[themeMode], 1)
}

export const createIsometricWebGLRenderer = (themeMode: AppThemeMode = 'dark') => {
  const renderer = new THREE.WebGLRenderer(ISOMETRIC_WEBGL_RENDERER_PARAMETERS)
  applyIsometricWebGLRendererTheme(renderer, themeMode)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.style.position = 'relative'
  renderer.domElement.style.zIndex = '1'
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
  renderer.domElement.style.zIndex = '2'
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
  controls.enablePan = true
  controls.enableRotate = false
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

export interface IsometricCameraControlState {
  cameraPositionX: number
  cameraPositionY: number
  cameraPositionZ: number
  cameraQuaternionX: number
  cameraQuaternionY: number
  cameraQuaternionZ: number
  cameraQuaternionW: number
  cameraZoom: number
  targetX: number
  targetY: number
  targetZ: number
}

const CAMERA_CONTROL_STATE_EPSILON = 1e-9

export const readIsometricCameraControlState = (
  camera: THREE.OrthographicCamera,
  controls: Pick<OrbitControls, 'target'>,
): IsometricCameraControlState => ({
  cameraPositionX: camera.position.x,
  cameraPositionY: camera.position.y,
  cameraPositionZ: camera.position.z,
  cameraQuaternionX: camera.quaternion.x,
  cameraQuaternionY: camera.quaternion.y,
  cameraQuaternionZ: camera.quaternion.z,
  cameraQuaternionW: camera.quaternion.w,
  cameraZoom: camera.zoom,
  targetX: controls.target.x,
  targetY: controls.target.y,
  targetZ: controls.target.z,
})

const isSameCameraControlValue = (a: number, b: number): boolean => (
  Math.abs(a - b) <= CAMERA_CONTROL_STATE_EPSILON
)

export const isSameIsometricCameraControlState = (
  a: IsometricCameraControlState,
  b: IsometricCameraControlState,
): boolean => (
  isSameCameraControlValue(a.cameraPositionX, b.cameraPositionX)
  && isSameCameraControlValue(a.cameraPositionY, b.cameraPositionY)
  && isSameCameraControlValue(a.cameraPositionZ, b.cameraPositionZ)
  && isSameCameraControlValue(a.cameraQuaternionX, b.cameraQuaternionX)
  && isSameCameraControlValue(a.cameraQuaternionY, b.cameraQuaternionY)
  && isSameCameraControlValue(a.cameraQuaternionZ, b.cameraQuaternionZ)
  && isSameCameraControlValue(a.cameraQuaternionW, b.cameraQuaternionW)
  && isSameCameraControlValue(a.cameraZoom, b.cameraZoom)
  && isSameCameraControlValue(a.targetX, b.targetX)
  && isSameCameraControlValue(a.targetY, b.targetY)
  && isSameCameraControlValue(a.targetZ, b.targetZ)
)

export const bindIsometricCameraControlChangeInvalidation = (options: {
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  requestRender: (reason: 'camera') => void
}): (() => void) => {
  let previousState = readIsometricCameraControlState(options.camera, options.controls)

  const handleControlsChange = () => {
    const nextState = readIsometricCameraControlState(options.camera, options.controls)

    if (isSameIsometricCameraControlState(previousState, nextState)) {
      return
    }

    previousState = nextState
    options.requestRender('camera')
  }

  options.controls.addEventListener('change', handleControlsChange)

  return () => {
    options.controls.removeEventListener('change', handleControlsChange)
  }
}

export interface IsometricRendererSizeState {
  width: number
  height: number
  pixelRatio: number
  dimensionsX: number
  dimensionsY: number
  dimensionsZ: number
}

interface IsometricRendererSizeChanges {
  rendererSize: boolean
  pixelRatio: boolean
  frustum: boolean
}

export interface IsometricRendererSizeSyncResult {
  changed: boolean
  size: IsometricRendererSizeState
}

interface IsometricRendererBounds {
  width: number
  height: number
}

const readBrowserDevicePixelRatio = (): number => {
  const maybeGlobal = globalThis as typeof globalThis & {
    devicePixelRatio?: number
    window?: { devicePixelRatio?: number }
  }

  return maybeGlobal.window?.devicePixelRatio ?? maybeGlobal.devicePixelRatio ?? 1
}

const createRendererSizeState = (
  bounds: IsometricRendererBounds,
  dimensions: GridDimensions,
  pixelRatio = resolveIsometricRendererPixelRatio(readBrowserDevicePixelRatio()),
): IsometricRendererSizeState => ({
  width: bounds.width,
  height: bounds.height,
  pixelRatio,
  dimensionsX: dimensions.x,
  dimensionsY: dimensions.y,
  dimensionsZ: dimensions.z,
})

const rendererAspectRatio = (state: Pick<IsometricRendererSizeState, 'width' | 'height'>): number => (
  state.width / Math.max(state.height, 1)
)

const createRendererSizeChanges = (
  previous: IsometricRendererSizeState | null | undefined,
  next: IsometricRendererSizeState,
): IsometricRendererSizeChanges => {
  if (!previous) {
    return {
      rendererSize: true,
      pixelRatio: true,
      frustum: true,
    }
  }

  const rendererSize = previous.width !== next.width || previous.height !== next.height
  const pixelRatio = previous.pixelRatio !== next.pixelRatio
  const dimensionsChanged = previous.dimensionsX !== next.dimensionsX
    || previous.dimensionsY !== next.dimensionsY
    || previous.dimensionsZ !== next.dimensionsZ
  const frustum = dimensionsChanged || rendererAspectRatio(previous) !== rendererAspectRatio(next)

  return {
    rendererSize,
    pixelRatio,
    frustum,
  }
}

const rendererSizeChangesIncludeWork = (changes: IsometricRendererSizeChanges): boolean => (
  changes.rendererSize || changes.pixelRatio || changes.frustum
)

const applyOrthographicFrustumForBounds = (options: {
  camera: THREE.OrthographicCamera
  controls: OrbitControls | null
  dimensions: GridDimensions
  bounds: IsometricRendererBounds
}) => {
  const aspect = options.bounds.width / Math.max(options.bounds.height, 1)
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

export const setOrthographicFrustum = (options: {
  camera: THREE.OrthographicCamera
  container: HTMLElement
  controls: OrbitControls | null
  dimensions: GridDimensions
}) => {
  applyOrthographicFrustumForBounds({
    camera: options.camera,
    controls: options.controls,
    dimensions: options.dimensions,
    bounds: options.container.getBoundingClientRect(),
  })
}

export const syncIsometricRendererSize = (options: {
  renderer: THREE.WebGLRenderer
  cssRenderer: CSS3DRenderer
  camera: THREE.OrthographicCamera
  controls: OrbitControls | null
  container: HTMLElement
  dimensions: GridDimensions
  previousSize?: IsometricRendererSizeState | null
}): IsometricRendererSizeSyncResult => {
  const bounds = options.container.getBoundingClientRect()
  const size = createRendererSizeState(bounds, options.dimensions)
  const changes = createRendererSizeChanges(options.previousSize, size)

  if (!rendererSizeChangesIncludeWork(changes)) {
    return { changed: false, size }
  }

  if (changes.rendererSize) {
    options.renderer.setSize(bounds.width, bounds.height)
    options.cssRenderer.setSize(bounds.width, bounds.height)
  }

  if (changes.pixelRatio) {
    options.renderer.setPixelRatio(size.pixelRatio)
  }

  if (changes.frustum) {
    applyOrthographicFrustumForBounds({
      camera: options.camera,
      controls: options.controls,
      dimensions: options.dimensions,
      bounds,
    })
  }

  return { changed: true, size }
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

const facingYawAzimuth = (pokemon: SpawnedPokemon): number | null => {
  if (!isTokenFacingDirection(pokemon.facing)) return null

  const facingVector = tokenFacingVector(pokemon.facing)
  return snapIsometricYawAzimuth(Math.atan2(facingVector.y, facingVector.x))
}

const currentCameraYawAzimuth = (options: {
  camera: THREE.OrthographicCamera
  controls: Pick<OrbitControls, 'target'>
}): number => {
  const offset = options.camera.position.clone().sub(options.controls.target)
  if (offset.lengthSq() <= CAMERA_OFFSET_EPSILON) return ISO_AZIMUTH_ANGLE

  return getIsometricOffsetYawAzimuth(offset)
}

export const resolveFocusCameraYawAzimuth = (options: {
  camera: THREE.OrthographicCamera
  controls: Pick<OrbitControls, 'target'>
  pokemon: SpawnedPokemon
  preferredMode?: FocusCameraYawMode
}): number | null => {
  if (options.preferredMode !== 'initiative') return null

  return facingYawAzimuth(options.pokemon)
    ?? snapIsometricYawAzimuth(currentCameraYawAzimuth(options))
}

export const focusCameraOnPokemon = (options: {
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  dimensions: GridDimensions
  pokemon: SpawnedPokemon
  center: THREE.Vector3
  preferredYawAzimuth?: number
  focusYawMode?: FocusCameraYawMode
}) => {
  const targetHeight = Math.max(options.pokemon.clearance, options.pokemon.height, 1)
  const nextTarget = new THREE.Vector3(
    options.center.x,
    options.center.y + targetHeight * FOCUS_CAMERA_TARGET_HEIGHT_FACTOR,
    options.center.z,
  )
  const offset = options.camera.position.clone().sub(options.controls.target)
  const currentOffset = offset.lengthSq() > 0.0001 ? offset : fallbackCameraOffset(options.dimensions)
  const radius = currentOffset.length()
  const resolvedYawAzimuth = typeof options.preferredYawAzimuth === 'number'
    && Number.isFinite(options.preferredYawAzimuth)
    ? options.preferredYawAzimuth
    : resolveFocusCameraYawAzimuth({
        camera: options.camera,
        controls: options.controls,
        pokemon: options.pokemon,
        preferredMode: options.focusYawMode,
      })
  const nextOffset = resolvedYawAzimuth === null
    ? currentOffset
    : createIsometricOffsetFromYaw(radius, resolvedYawAzimuth)

  options.controls.target.copy(nextTarget)
  options.camera.position.copy(nextTarget.clone().add(nextOffset))
  options.camera.zoom = focusZoomForPokemon(options)
  options.camera.updateProjectionMatrix()
  options.controls.update()
}
