import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import { FakeHTMLElement, installFakeDom } from './fakeDom'

describe('isometric resource disposal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes renderer objects from parents and disposes nested geometry, materials, and CSS elements', () => {
    installFakeDom()
    const scene = new THREE.Scene()
    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const materialA = new THREE.MeshBasicMaterial()
    const materialB = new THREE.MeshBasicMaterial()
    const mesh = new THREE.Mesh(geometry, [materialA, materialB])
    const cssParent = document.createElement('div') as unknown as FakeHTMLElement
    const cssElement = document.createElement('div') as unknown as FakeHTMLElement
    const cssObject = new THREE.Object3D() as THREE.Object3D & { element: HTMLElement }

    cssParent.appendChild(cssElement)
    cssObject.element = cssElement as unknown as HTMLElement
    root.add(mesh)
    root.add(cssObject)
    scene.add(root)

    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialADispose = vi.spyOn(materialA, 'dispose')
    const materialBDispose = vi.spyOn(materialB, 'dispose')
    const cssRemove = vi
      .spyOn(cssElement, 'remove')
      .mockImplementation(() => FakeHTMLElement.prototype.remove.call(cssElement))

    disposeObject3D(root)

    expect(scene.children.includes(root)).toBe(false)
    expect(root.children).toHaveLength(0)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialADispose).toHaveBeenCalledOnce()
    expect(materialBDispose).toHaveBeenCalledOnce()
    expect(cssRemove).toHaveBeenCalledOnce()
    expect(cssParent.children.includes(cssElement)).toBe(false)
  })
})
