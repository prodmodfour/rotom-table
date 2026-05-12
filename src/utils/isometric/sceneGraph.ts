import * as THREE from 'three'

export interface IsometricSceneGraph {
  scene: THREE.Scene
  raycaster: THREE.Raycaster
  gridGroup: THREE.Group
  worldGroup: THREE.Group
  previewGroup: THREE.Group
  voxelContainer: THREE.Group
  fieldEffectContainer: THREE.Group
  hazardContainer: THREE.Group
  clock: THREE.Clock
}

export const createIsometricSceneGraph = (): IsometricSceneGraph => {
  const scene = new THREE.Scene()
  const raycaster = new THREE.Raycaster()
  const gridGroup = new THREE.Group()
  const worldGroup = new THREE.Group()
  const previewGroup = new THREE.Group()
  const voxelContainer = new THREE.Group()
  const fieldEffectContainer = new THREE.Group()
  const hazardContainer = new THREE.Group()
  const clock = new THREE.Clock()

  scene.add(gridGroup)
  scene.add(worldGroup)
  scene.add(previewGroup)
  worldGroup.add(fieldEffectContainer)
  worldGroup.add(voxelContainer)
  worldGroup.add(hazardContainer)

  return {
    scene,
    raycaster,
    gridGroup,
    worldGroup,
    previewGroup,
    voxelContainer,
    fieldEffectContainer,
    hazardContainer,
    clock,
  }
}
