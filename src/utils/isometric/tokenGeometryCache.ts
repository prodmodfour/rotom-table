import * as THREE from 'three'

const tokenGeometryDimensionPart = (value: number): string => {
  if (Object.is(value, -0)) return '0'
  return String(value)
}

export const tokenBoxGeometryCacheKey = (
  width: number,
  height: number,
  depth: number = width,
): string => [width, height, depth].map(tokenGeometryDimensionPart).join('×')

interface TokenGeometryCacheEntry<TGeometry extends THREE.BufferGeometry> {
  geometry: TGeometry
  references: number
  disposed: boolean
}

export interface TokenGeometryLease<TGeometry extends THREE.BufferGeometry> {
  readonly geometry: TGeometry
  release(): void
}

export interface TokenRenderGeometryLeases {
  volumeBox?: TokenGeometryLease<THREE.BoxGeometry>
  volumeEdges?: TokenGeometryLease<THREE.EdgesGeometry>
  proxyBox?: TokenGeometryLease<THREE.BoxGeometry>
}

export interface TokenRenderGeometryCacheSnapshot {
  volumeBoxGeometryCount: number
  volumeEdgesGeometryCount: number
  proxyBoxGeometryCount: number
}

export interface TokenRenderGeometryCache {
  acquireVolumeBoxGeometry(base: number, clearance: number): TokenGeometryLease<THREE.BoxGeometry>
  acquireVolumeEdgesGeometry(base: number, clearance: number): TokenGeometryLease<THREE.EdgesGeometry>
  acquireProxyBoxGeometry(width: number, height: number): TokenGeometryLease<THREE.BoxGeometry>
  snapshot(): TokenRenderGeometryCacheSnapshot
  dispose(): void
}

const acquireCachedGeometry = <TGeometry extends THREE.BufferGeometry>(
  entries: Map<string, TokenGeometryCacheEntry<TGeometry>>,
  key: string,
  createGeometry: () => TGeometry,
): TokenGeometryLease<TGeometry> => {
  let entry = entries.get(key)
  if (!entry) {
    entry = {
      geometry: createGeometry(),
      references: 0,
      disposed: false,
    }
    entries.set(key, entry)
  }

  entry.references += 1
  let released = false

  return {
    geometry: entry.geometry,
    release() {
      if (released) return
      released = true

      entry.references -= 1
      if (entry.references > 0) return

      if (entries.get(key) === entry) entries.delete(key)
      if (!entry.disposed) {
        entry.disposed = true
        entry.geometry.dispose()
      }
    },
  }
}

const disposeGeometryEntries = <TGeometry extends THREE.BufferGeometry>(
  entries: Map<string, TokenGeometryCacheEntry<TGeometry>>,
) => {
  for (const entry of entries.values()) {
    if (entry.disposed) continue
    entry.disposed = true
    entry.geometry.dispose()
  }
  entries.clear()
}

export const createTokenRenderGeometryCache = (): TokenRenderGeometryCache => {
  const volumeBoxes = new Map<string, TokenGeometryCacheEntry<THREE.BoxGeometry>>()
  const volumeEdges = new Map<string, TokenGeometryCacheEntry<THREE.EdgesGeometry>>()
  const proxyBoxes = new Map<string, TokenGeometryCacheEntry<THREE.BoxGeometry>>()

  return {
    acquireVolumeBoxGeometry(base, clearance) {
      const key = tokenBoxGeometryCacheKey(base, clearance, base)
      return acquireCachedGeometry(
        volumeBoxes,
        key,
        () => new THREE.BoxGeometry(base, clearance, base),
      )
    },

    acquireVolumeEdgesGeometry(base, clearance) {
      const key = tokenBoxGeometryCacheKey(base, clearance, base)
      return acquireCachedGeometry(
        volumeEdges,
        key,
        () => {
          const boxGeometry = new THREE.BoxGeometry(base, clearance, base)
          const edgesGeometry = new THREE.EdgesGeometry(boxGeometry)
          boxGeometry.dispose()
          return edgesGeometry
        },
      )
    },

    acquireProxyBoxGeometry(width, height) {
      const key = tokenBoxGeometryCacheKey(width, height, width)
      return acquireCachedGeometry(
        proxyBoxes,
        key,
        () => new THREE.BoxGeometry(width, height, width),
      )
    },

    snapshot() {
      return {
        volumeBoxGeometryCount: volumeBoxes.size,
        volumeEdgesGeometryCount: volumeEdges.size,
        proxyBoxGeometryCount: proxyBoxes.size,
      }
    },

    dispose() {
      disposeGeometryEntries(volumeBoxes)
      disposeGeometryEntries(volumeEdges)
      disposeGeometryEntries(proxyBoxes)
    },
  }
}
