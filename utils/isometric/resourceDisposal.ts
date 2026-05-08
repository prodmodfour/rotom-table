import * as THREE from 'three'

export const disposeObject3D = (object: THREE.Object3D | null | undefined) => {
  if (!object) return

  object.parent?.remove(object)
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined

    geometry?.dispose?.()

    if (Array.isArray(material)) {
      for (const item of material) item.dispose()
    } else {
      material?.dispose?.()
    }

    if (typeof HTMLElement !== 'undefined' && 'element' in child && child.element instanceof HTMLElement) {
      child.element.remove()
    }
  })
  object.clear()
}
