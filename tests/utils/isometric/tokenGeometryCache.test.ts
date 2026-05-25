import { describe, expect, it, vi } from 'vitest'
import {
  createTokenRenderGeometryCache,
  tokenBoxGeometryCacheKey,
} from '~/utils/isometric/tokenGeometryCache'

describe('token render geometry cache', () => {
  it('builds stable dimension keys for token box geometries', () => {
    expect(tokenBoxGeometryCacheKey(1, 2)).toBe('1×2×1')
    expect(tokenBoxGeometryCacheKey(-0, 2, -0)).toBe('0×2×0')
    expect(tokenBoxGeometryCacheKey(1.25, 2.5, 3.75)).toBe('1.25×2.5×3.75')
  })

  it('reuses volume, edge, and proxy geometries by dimensions with separate ownership buckets', () => {
    const cache = createTokenRenderGeometryCache()

    const volumeA = cache.acquireVolumeBoxGeometry(2, 3)
    const volumeB = cache.acquireVolumeBoxGeometry(2, 3)
    const edgesA = cache.acquireVolumeEdgesGeometry(2, 3)
    const edgesB = cache.acquireVolumeEdgesGeometry(2, 3)
    const proxyA = cache.acquireProxyBoxGeometry(2, 3)
    const proxyB = cache.acquireProxyBoxGeometry(2, 3)

    expect(volumeB.geometry).toBe(volumeA.geometry)
    expect(edgesB.geometry).toBe(edgesA.geometry)
    expect(proxyB.geometry).toBe(proxyA.geometry)
    expect(proxyA.geometry).not.toBe(volumeA.geometry)
    expect(cache.snapshot()).toEqual({
      volumeBoxGeometryCount: 1,
      volumeEdgesGeometryCount: 1,
      proxyBoxGeometryCount: 1,
    })

    volumeA.release()
    edgesA.release()
    proxyA.release()
    expect(cache.snapshot()).toEqual({
      volumeBoxGeometryCount: 1,
      volumeEdgesGeometryCount: 1,
      proxyBoxGeometryCount: 1,
    })

    volumeB.release()
    edgesB.release()
    proxyB.release()
    expect(cache.snapshot()).toEqual({
      volumeBoxGeometryCount: 0,
      volumeEdgesGeometryCount: 0,
      proxyBoxGeometryCount: 0,
    })
  })

  it('disposes shared geometry only after the last lease releases it', () => {
    const cache = createTokenRenderGeometryCache()
    const first = cache.acquireVolumeBoxGeometry(1, 2)
    const second = cache.acquireVolumeBoxGeometry(1, 2)
    const disposeSpy = vi.spyOn(first.geometry, 'dispose')

    first.release()
    expect(disposeSpy).not.toHaveBeenCalled()

    second.release()
    expect(disposeSpy).toHaveBeenCalledTimes(1)

    second.release()
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('can dispose all cached geometries as a renderer-lifecycle fallback', () => {
    const cache = createTokenRenderGeometryCache()
    const volume = cache.acquireVolumeBoxGeometry(1, 1)
    const edges = cache.acquireVolumeEdgesGeometry(1, 1)
    const proxy = cache.acquireProxyBoxGeometry(1, 1)
    const disposeSpies = [volume.geometry, edges.geometry, proxy.geometry]
      .map((geometry) => vi.spyOn(geometry, 'dispose'))

    cache.dispose()

    expect(cache.snapshot()).toEqual({
      volumeBoxGeometryCount: 0,
      volumeEdgesGeometryCount: 0,
      proxyBoxGeometryCount: 0,
    })
    expect(disposeSpies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1])
  })
})
